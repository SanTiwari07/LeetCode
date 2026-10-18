import { STATE_PATH, applySubmission } from "./layout.js";

const API = "https://api.github.com";
const LOG_LIMIT = 20;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "push") {
    push(message.payload).then(sendResponse);
    return true; // Keep the channel open for the async response.
  }
  if (message.type === "retry") {
    retry(message.submissionId).then(sendResponse);
    return true;
  }
  if (message.type === "test") {
    testConnection().then(sendResponse);
    return true;
  }
  return false;
});

async function settings() {
  const stored = await chrome.storage.local.get(["token", "owner", "repo", "branch"]);
  if (!stored.token || !stored.owner || !stored.repo) {
    throw new Error("Open the extension settings and add your GitHub token and repo.");
  }
  return stored;
}

async function github(token, method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 404 && method === "GET") return null;
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`GitHub ${response.status}: ${(data && data.message) || response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function decodeBase64(text) {
  const bytes = Uint8Array.from(atob(text.replace(/\n/g, "")), (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function resolveBranch(token, owner, repo, branch) {
  if (branch) return branch;
  const info = await github(token, "GET", `/repos/${owner}/${repo}`);
  if (!info) throw new Error(`Repository ${owner}/${repo} not found (check the token's access).`);
  return info.default_branch;
}

// Writes all files in one commit using the Git Data API. Retries when the
// branch moved underneath us (e.g. the GitHub Action pushed at the same time).
async function commitSubmission(submission) {
  const { token, owner, repo, branch: configured } = await settings();
  const branch = await resolveBranch(token, owner, repo, configured);
  const base = `/repos/${owner}/${repo}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = await github(token, "GET", `${base}/git/ref/heads/${encodeURIComponent(branch)}`);
    if (!ref) throw new Error(`Branch "${branch}" not found in ${owner}/${repo}.`);
    const parentSha = ref.object.sha;
    const parent = await github(token, "GET", `${base}/git/commits/${parentSha}`);

    const stateFile = await github(
      token,
      "GET",
      `${base}/contents/${STATE_PATH}?ref=${parentSha}`
    );
    const state = stateFile
      ? JSON.parse(decodeBase64(stateFile.content))
      : { last_submission_id: 0, problems: {} };

    const change = applySubmission(state, submission);
    if (!change) return { skipped: true, summary: `${submission.question.title} is already synced` };

    const tree = await github(token, "POST", `${base}/git/trees`, {
      base_tree: parent.tree.sha,
      tree: Object.entries(change.files).map(([path, content]) => ({
        path,
        mode: "100644",
        type: "blob",
        content,
      })),
    });

    const { problem, isNew } = change;
    const stats = [submission.runtime, submission.memory].filter(Boolean).join(", ");
    const title = `${isNew ? "Add" : "Update"} ${problem.id}. ${problem.title} (${submission.lang})`;
    const commit = await github(token, "POST", `${base}/git/commits`, {
      message: `${title}\n\n${problem.difficulty}${stats ? ` · ${stats}` : ""}\nhttps://leetcode.com/problems/${problem.slug}/`,
      tree: tree.sha,
      parents: [parentSha],
    });

    try {
      await github(token, "PATCH", `${base}/git/refs/heads/${encodeURIComponent(branch)}`, {
        sha: commit.sha,
      });
    } catch (error) {
      if (error.status === 422 && attempt < 2) continue; // Not a fast-forward; rebuild on the new head.
      throw error;
    }
    return {
      summary: `${problem.id}. ${problem.title} (${submission.lang})`,
      url: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
    };
  }
  throw new Error("Branch kept changing; try again.");
}

async function log(entry) {
  const { history = [] } = await chrome.storage.local.get("history");
  const rest = history.filter((item) => item.submissionId !== entry.submissionId);
  await chrome.storage.local.set({ history: [entry, ...rest].slice(0, LOG_LIMIT) });
}

async function push(submission) {
  const entry = {
    submissionId: submission.submissionId,
    title: `${submission.question.id}. ${submission.question.title}`,
    lang: submission.lang,
    time: Date.now(),
  };
  try {
    const result = await commitSubmission(submission);
    await log({ ...entry, ok: true, url: result.url || null, note: result.skipped ? "already synced" : "" });
    return { ok: true, ...result };
  } catch (error) {
    // Keep the payload so the popup can retry it.
    await log({ ...entry, ok: false, error: error.message, payload: submission });
    return { ok: false, error: error.message };
  }
}

async function retry(submissionId) {
  const { history = [] } = await chrome.storage.local.get("history");
  const entry = history.find((item) => item.submissionId === submissionId);
  if (!entry || !entry.payload) return { ok: false, error: "Nothing to retry." };
  return push(entry.payload);
}

async function testConnection() {
  try {
    const { token, owner, repo, branch } = await settings();
    const info = await github(token, "GET", `/repos/${owner}/${repo}`);
    if (!info) return { ok: false, error: `Repository ${owner}/${repo} not found (check the token's access).` };
    if (info.permissions && !info.permissions.push) {
      return { ok: false, error: "The token can read this repo but cannot write to it." };
    }
    const target = branch || info.default_branch;
    const ref = await github(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(target)}`);
    if (!ref) return { ok: false, error: `Branch "${target}" does not exist.` };
    return { ok: true, message: `Connected to ${info.full_name} (branch: ${target}).` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
