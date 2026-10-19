import { STATE_PATH, applySubmissions, emptyState, indexFiles, planSync } from "./layout.js";

const API = "https://api.github.com";
const LOG_LIMIT = 30;
const SYNC_STALE_MS = 90 * 1000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = HANDLERS[message.type];
  if (!handler) return false;
  handler(message, sender).then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
  return true; // Keep the channel open for the async response.
});

const HANDLERS = {
  submission: (message) => pushSubmission(message.submission, message.question),
  retry: (message) => retry(message.key),
  test: () => testConnection(),
  "start-sync": (message) => startSync(message.full),
  "sync-begin": (message, sender) => syncBegin(sender.tab && sender.tab.id),
  "sync-plan": (message) => syncPlan(message.listed),
  "sync-batch": (message) => syncBatch(message),
  "sync-progress": (message) => setSync({ running: true, text: message.text, heartbeat: Date.now() }),
  "sync-end": (message) => syncEnd(message),
};

// ---------------------------------------------------------------------------
// GitHub

async function settings() {
  const stored = await chrome.storage.local.get(["token", "owner", "repo", "branch"]);
  if (!stored.token || !stored.owner || !stored.repo) {
    throw new Error("Open the extension settings and add your GitHub token and repo.");
  }
  return stored;
}

async function github(token, method, path, body, { raw = false } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    // GitHub marks API responses cacheable for 60s; a cached branch head makes
    // every commit after the first one fail with "not a fast forward".
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // 404 is a missing file or branch; 409 is "Git Repository is empty".
  if ((response.status === 404 || response.status === 409) && method === "GET") return null;
  if (response.ok && raw) return response.text();
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`GitHub ${response.status}: ${(data && data.message) || response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function utf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function repoInfo(token, owner, repo) {
  const info = await github(token, "GET", `/repos/${owner}/${repo}`);
  if (!info) throw new Error(`Repository ${owner}/${repo} not found (check the name and the token's access).`);
  return info;
}

async function readState(token, base, sha) {
  const text = await github(token, "GET", `${base}/contents/${STATE_PATH}?ref=${sha}`, null, { raw: true });
  return text ? JSON.parse(text) : emptyState();
}

// The Git Data API refuses to work on a repo with no commits, so the first
// file goes in through the Contents API, which creates the branch.
async function initializeRepo(token, base, branch) {
  await github(token, "PUT", `${base}/contents/README.md`, {
    message: "Initialize LeetCode Solved",
    content: utf8Base64("# LeetCode Solved\n"),
    branch,
  });
}

/**
 * Commit the result of `build(state)` in one commit. `build` gets the state
 * from the branch head and returns {files, message, ...extra} or null when
 * there is nothing to do. If the branch moves underneath us (a live
 * submission landing during an import), the commit is rebuilt on the new head.
 */
async function commitWith(build) {
  const { token, owner, repo, branch: configured } = await settings();
  const base = `/repos/${owner}/${repo}`;
  const branch = configured || (await repoInfo(token, owner, repo)).default_branch;

  for (let attempt = 0; attempt < 5; attempt++) {
    let ref = await github(token, "GET", `${base}/git/ref/heads/${encodeURIComponent(branch)}`);
    if (!ref) {
      if (attempt > 0) throw new Error(`Branch "${branch}" not found in ${owner}/${repo}.`);
      await initializeRepo(token, base, branch);
      ref = await github(token, "GET", `${base}/git/ref/heads/${encodeURIComponent(branch)}`);
      if (!ref) throw new Error(`Branch "${branch}" not found in ${owner}/${repo}.`);
    }
    const parentSha = ref.object.sha;
    const parent = await github(token, "GET", `${base}/git/commits/${parentSha}`);
    const state = await readState(token, base, parentSha);

    const change = build(state);
    if (!change) return { skipped: true };

    const tree = await github(token, "POST", `${base}/git/trees`, {
      base_tree: parent.tree.sha,
      tree: Object.entries(change.files).map(([path, content]) => ({ path, mode: "100644", type: "blob", content })),
    });
    const commit = await github(token, "POST", `${base}/git/commits`, {
      message: change.message,
      tree: tree.sha,
      parents: [parentSha],
    });
    try {
      await github(token, "PATCH", `${base}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha });
    } catch (error) {
      if (error.status !== 422 || attempt === 4) throw error;
      // Not a fast-forward: someone else committed. Rebuild on the new head.
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    return { ...change, files: undefined, url: `https://github.com/${owner}/${repo}/commit/${commit.sha}` };
  }
  throw new Error("The branch kept changing; try again.");
}

async function testConnection() {
  try {
    const { token, owner, repo, branch } = await settings();
    const info = await repoInfo(token, owner, repo);
    if (info.permissions && !info.permissions.push) {
      return { ok: false, error: "The token can read this repo but cannot write to it. Give it Contents: Read and write." };
    }
    const target = branch || info.default_branch;
    const ref = await github(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(target)}`);
    if (!ref) {
      if (info.size === 0) return { ok: true, message: `Connected to ${info.full_name}. It's empty; the first sync will set it up.` };
      return { ok: false, error: `Branch "${target}" does not exist.` };
    }
    return { ok: true, message: `Connected to ${info.full_name} (branch: ${target}).` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Live submissions (one commit per judged submission)

function describe(problem, submission) {
  return `${problem.id}. ${problem.title} (${submission.lang})`;
}

async function pushSubmission(submission, question) {
  const entry = {
    key: String(submission.id),
    title: `${question.id}. ${question.title}`,
    detail: `${submission.status} · ${submission.lang}`,
    time: Date.now(),
  };
  try {
    const result = await commitWith((state) => {
      const change = applySubmissions(state, [submission], { [submission.slug]: question });
      if (!change) return null;
      const { problem, firstSolve } = change.events[0];
      const name = describe(problem, submission);
      const subject =
        submission.status !== "Accepted"
          ? `Attempt ${name}: ${submission.status}`
          : `${firstSolve ? "Solve" : "Update"} ${name}`;
      const stats = [submission.runtime, submission.memory].filter(Boolean).join(", ");
      return {
        files: { ...change.files, ...indexFiles(state) },
        message: `${subject}\n\n${problem.difficulty}${stats ? ` · ${stats}` : ""}\nhttps://leetcode.com/problems/${problem.slug}/`,
        summary: name,
      };
    });
    await log({ ...entry, ok: true, url: result.url || null, note: result.skipped ? "already saved" : "" });
    return { ok: true, summary: result.summary || entry.title, url: result.url, skipped: result.skipped };
  } catch (error) {
    // Keep the payload so the popup can retry it.
    await log({ ...entry, ok: false, error: error.message, payload: { submission, question } });
    return { ok: false, error: error.message };
  }
}

async function log(entry) {
  const { history = [] } = await chrome.storage.local.get("history");
  const rest = history.filter((item) => item.key !== entry.key);
  await chrome.storage.local.set({ history: [entry, ...rest].slice(0, LOG_LIMIT) });
}

async function retry(key) {
  const { history = [] } = await chrome.storage.local.get("history");
  const entry = history.find((item) => item.key === key);
  if (!entry || !entry.payload) return { ok: false, error: "Nothing to retry." };
  return pushSubmission(entry.payload.submission, entry.payload.question);
}

// ---------------------------------------------------------------------------
// History sync. content.js on a leetcode.com tab drives it, because only the
// logged-in page can read your submissions; this side plans and commits.

async function setSync(fields) {
  const { sync = {} } = await chrome.storage.local.get("sync");
  await chrome.storage.local.set({ sync: { ...sync, ...fields } });
  return { ok: true };
}

async function syncBegin(tabId) {
  const { sync = {} } = await chrome.storage.local.get("sync");
  if (sync.running && sync.tabId !== tabId && Date.now() - (sync.heartbeat || 0) < SYNC_STALE_MS) {
    return { ok: false, busy: true, error: "A sync is already running in another LeetCode tab." };
  }
  const { token, owner, repo, branch: configured } = await settings();
  const base = `/repos/${owner}/${repo}`;
  const branch = configured || (await repoInfo(token, owner, repo)).default_branch;
  const ref = await github(token, "GET", `${base}/git/ref/heads/${encodeURIComponent(branch)}`);
  const state = ref ? await readState(token, base, ref.object.sha) : emptyState();
  await setSync({ running: true, tabId, heartbeat: Date.now(), text: "Reading your LeetCode submissions..." });
  return { ok: true, syncedThrough: state.synced_through || 0 };
}

async function syncPlan(listed) {
  const { token, owner, repo, branch: configured } = await settings();
  const base = `/repos/${owner}/${repo}`;
  const branch = configured || (await repoInfo(token, owner, repo)).default_branch;
  const ref = await github(token, "GET", `${base}/git/ref/heads/${encodeURIComponent(branch)}`);
  const state = ref ? await readState(token, base, ref.object.sha) : emptyState();
  return { ok: true, ...planSync(state, listed) };
}

async function syncBatch({ submissions, questions, syncedThrough, label }) {
  await setSync({ heartbeat: Date.now() });
  const result = await commitWith((state) => {
    const change = applySubmissions(state, submissions, questions);
    const moved = syncedThrough > (state.synced_through || 0);
    if (moved) state.synced_through = syncedThrough;
    if (!change && !moved) return null;

    const latest = new Map();
    for (const { problem, submission } of change ? change.events : []) latest.set(problem.slug, { problem, submission });
    const lines = [...latest.values()].map(
      ({ problem, submission }) => `- ${problem.id}. ${problem.title}: ${problem.solved_at !== null ? "Solved" : submission.status}`
    );
    const subject = lines.length
      ? `${label}: ${lines.length} problem${lines.length === 1 ? "" : "s"}`
      : `${label}: up to date`;
    return {
      files: { ...(change ? change.files : {}), ...indexFiles(state) },
      message: lines.length ? `${subject}\n\n${lines.join("\n")}` : subject,
      problems: lines.length,
    };
  });
  return { ok: true, url: result.url || null, problems: result.problems || 0 };
}

async function syncEnd({ ok, text, url, problems }) {
  await setSync({ running: false, ok, text, finishedAt: Date.now() });
  if (!ok || problems) {
    await log({
      key: `sync-${Date.now()}`,
      title: ok ? text : "Sync failed",
      detail: "",
      ok,
      url: url || null,
      time: Date.now(),
      error: ok ? "" : text,
    });
  }
  return { ok: true };
}

// Popup buttons: run the sync in a LeetCode tab, opening one if needed.
async function startSync(full) {
  const { sync = {} } = await chrome.storage.local.get("sync");
  if (sync.running && Date.now() - (sync.heartbeat || 0) < SYNC_STALE_MS) {
    return { ok: false, error: "A sync is already running." };
  }
  await settings();

  let [tab] = await chrome.tabs.query({ url: "https://leetcode.com/*" });
  if (!tab) {
    tab = await chrome.tabs.create({ url: "https://leetcode.com/problemset/", active: false });
    await waitForLoad(tab.id);
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "run-sync", full });
  } catch {
    // The tab was open before the extension loaded, so it has no content script yet.
    await chrome.tabs.reload(tab.id);
    await waitForLoad(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "run-sync", full });
  }
  return { ok: true };
}

// Resolves when the tab finishes loading, or after 30s so a page that never
// loads (offline) ends in an error instead of a popup stuck on "Starting...".
function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") done();
    };
    const timer = setTimeout(done, 30 * 1000);
    chrome.tabs.onUpdated.addListener(listener);
  });
}
