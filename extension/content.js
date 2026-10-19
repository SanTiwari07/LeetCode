// Bridges page_hook.js (page world) and background.js. It saves each judged
// submission, runs history syncs (the full import and the catch-up that runs
// when LeetCode opens), and shows a small toast on the page with the result.

const SOURCE = "leetcode-github-sync";
const AUTO_SYNC_EVERY_MS = 30 * 60 * 1000;
const BATCH_SIZE = 15; // problems per commit during a sync
const DELAY_MS = 400; // between LeetCode requests, to stay under its rate limit

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Messages from the page

const waiting = new Map();
let nextRequestId = 0;

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = event.data;
  if (!message || message.source !== SOURCE) return;

  if (message.type === "error") {
    toast(`GitHub sync failed: ${message.message}`, "error");
  } else if (message.type === "judged") {
    saveJudged(message.submission, message.question);
  } else if (message.type === "graphql-response") {
    const request = waiting.get(message.id);
    if (!request) return;
    waiting.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.data);
  }
});

// Runs a LeetCode GraphQL query through page_hook.js.
function graphql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${nextRequestId++}`;
    waiting.set(id, { resolve, reject });
    window.postMessage({ source: SOURCE, type: "graphql-request", id, query, variables }, location.origin);
    setTimeout(() => {
      if (waiting.delete(id)) reject(new Error("LeetCode did not respond. Reload the page and try again."));
    }, 120 * 1000);
  });
}

async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result || !result.ok) throw new Error((result && result.error) || "The extension did not respond.");
  return result;
}

// ---------------------------------------------------------------------------
// Live submissions

async function saveJudged(submission, question) {
  const accepted = submission.status === "Accepted";
  const { saveAttempts = true } = await chrome.storage.local.get("saveAttempts");
  if (!accepted && !saveAttempts) return;

  toast(accepted ? "Accepted. Saving to GitHub..." : `${submission.status}. Saving this attempt to GitHub...`, "info");
  try {
    const result = await send({ type: "submission", submission, question });
    toast(
      result.skipped ? `Already saved: ${result.summary}` : `Saved to GitHub: ${result.summary}`,
      "success",
      result.url
    );
  } catch (error) {
    toast(`GitHub sync failed: ${error.message}`, "error");
  }
}

// ---------------------------------------------------------------------------
// History sync

const SUBMISSION_LIST_QUERY = `query submissionList($offset: Int!, $limit: Int!, $lastKey: String) {
  submissionList(offset: $offset, limit: $limit, lastKey: $lastKey) {
    lastKey
    hasNext
    submissions { id titleSlug statusDisplay lang timestamp }
  }
}`;

const SUBMISSION_DETAILS_QUERY = `query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) { code runtimeDisplay memoryDisplay }
}`;

const QUESTION_QUERY = `query question($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId title difficulty content
    topicTags { name }
  }
}`;

const cleanStat = (value) => (value && !/N\/A/i.test(value) ? value : null);

// Newest first; stops at the first submission at or below `stopAt`.
async function listSubmissions(stopAt, onPage) {
  const listed = [];
  let offset = 0;
  let lastKey = null;
  for (;;) {
    const page = (await graphql(SUBMISSION_LIST_QUERY, { offset, limit: 20, lastKey })).submissionList;
    for (const item of page.submissions) {
      const id = Number(item.id);
      if (id <= stopAt) return listed;
      listed.push({
        id,
        slug: item.titleSlug,
        lang: item.lang,
        status: item.statusDisplay,
        timestamp: Number(item.timestamp),
      });
    }
    onPage(listed.length);
    if (!page.hasNext) return listed;
    offset += 20;
    lastKey = page.lastKey;
    await sleep(DELAY_MS);
  }
}

let syncing = false;

async function runSync(full, { quiet = false } = {}) {
  if (syncing) return;
  syncing = true;
  let loud = !quiet;
  const progress = (text) => {
    if (loud) toast(text, "info");
    chrome.runtime.sendMessage({ type: "sync-progress", text }).catch(() => {});
  };

  try {
    const begin = await chrome.runtime.sendMessage({ type: "sync-begin" });
    if (!begin || !begin.ok) {
      if (!quiet && begin && !begin.busy) toast(`Sync failed: ${begin.error}`, "error");
      return;
    }

    const { userStatus } = await graphql("query { userStatus { isSignedIn } }");
    if (!userStatus || !userStatus.isSignedIn) {
      const text = "Log in to LeetCode, then sync again.";
      if (!quiet) toast(text, "error");
      await send({ type: "sync-end", ok: quiet, text });
      return;
    }

    const stopAt = full ? 0 : begin.syncedThrough;
    const importing = stopAt === 0;
    const { saveAttempts = true } = await chrome.storage.local.get("saveAttempts");
    let listed = await listSubmissions(stopAt, (count) => progress(`Reading your submissions: ${count} found`));
    const newest = listed.length ? Math.max(...listed.map((item) => item.id)) : stopAt;
    if (!saveAttempts) listed = listed.filter((item) => item.status === "Accepted");

    const plan = await send({ type: "sync-plan", listed });
    if (plan.slugs.length) loud = true;
    const codeIds = new Set(plan.codeIds);
    const label = importing ? "Import LeetCode history" : "Sync from LeetCode";
    const batches = Math.max(1, Math.ceil(plan.slugs.length / BATCH_SIZE));
    let saved = 0;
    let url = null;
    // Anything LeetCode wouldn't give us is left out, and synced_through stays
    // put, so the next sync tries those submissions again.
    let incomplete = false;

    for (let batch = 0; batch < batches; batch++) {
      const slugs = plan.slugs.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);
      const questions = {};
      const submissions = [];
      for (const slug of slugs) {
        progress(`Saving problems: ${saved + Object.keys(questions).length + 1} of ${plan.slugs.length}`);
        const { question } = await graphql(QUESTION_QUERY, { titleSlug: slug });
        await sleep(DELAY_MS);
        if (!question) {
          incomplete = true;
          continue;
        }
        questions[slug] = {
          id: question.questionFrontendId,
          title: question.title,
          difficulty: question.difficulty,
          content: question.content,
          tags: (question.topicTags || []).map((tag) => tag.name),
        };
        for (const item of listed.filter((entry) => entry.slug === slug)) {
          const submission = { ...item };
          if (codeIds.has(item.id)) {
            const details = (await graphql(SUBMISSION_DETAILS_QUERY, { submissionId: item.id })).submissionDetails;
            await sleep(DELAY_MS);
            if (!details || details.code == null) {
              incomplete = true;
              continue;
            }
            submission.code = details.code;
            submission.runtime = cleanStat(details.runtimeDisplay);
            submission.memory = cleanStat(details.memoryDisplay);
          }
          submissions.push(submission);
        }
      }

      const last = batch === batches - 1;
      const result = await send({
        type: "sync-batch",
        submissions,
        questions,
        syncedThrough: last && !incomplete ? newest : 0,
        label: batches > 1 ? `${label} (${batch + 1}/${batches})` : label,
      });
      saved += slugs.length;
      url = result.url || url;
    }

    const updated = plan.slugs.length - plan.newSlugs;
    const parts = [];
    if (plan.newSlugs) parts.push(`${plan.newSlugs} new problem${plan.newSlugs === 1 ? "" : "s"}`);
    if (updated) parts.push(`${updated} updated`);
    const text = parts.length ? `Saved ${parts.join(", ")}` : "Everything is up to date";
    await send({ type: "sync-end", ok: true, text, url, problems: plan.slugs.length });
    if (loud) toast(`${text}.`, "success", url);
  } catch (error) {
    await chrome.runtime.sendMessage({ type: "sync-end", ok: false, text: error.message }).catch(() => {});
    if (loud) toast(`Sync failed: ${error.message}`, "error");
  } finally {
    syncing = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "run-sync") return false;
  runSync(Boolean(message.full));
  sendResponse({ ok: true });
  return false;
});

// Catch up on anything solved elsewhere (another browser, the mobile app)
// when LeetCode is opened, at most every half hour.
async function autoSync() {
  if (window.top !== window) return;
  const stored = await chrome.storage.local.get(["token", "owner", "repo", "autoSync", "lastAutoSync"]);
  if (!stored.token || !stored.owner || !stored.repo || stored.autoSync === false) return;
  if (Date.now() - (stored.lastAutoSync || 0) < AUTO_SYNC_EVERY_MS) return;
  await chrome.storage.local.set({ lastAutoSync: Date.now() });
  runSync(false, { quiet: true });
}

window.addEventListener("load", () => setTimeout(autoSync, 3000));

// ---------------------------------------------------------------------------
// Toast

function toast(text, kind, link) {
  const colors = { info: "#2b6cb0", success: "#2f855a", error: "#c53030" };
  let box = document.getElementById("leetcode-github-sync-toast");
  if (!box) {
    box = document.createElement("div");
    box.id = "leetcode-github-sync-toast";
    Object.assign(box.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      zIndex: 2147483647,
      maxWidth: "360px",
      padding: "10px 14px",
      borderRadius: "8px",
      color: "#fff",
      font: "13px/1.4 system-ui, sans-serif",
      boxShadow: "0 4px 16px rgba(0,0,0,.3)",
      cursor: "pointer",
    });
    box.addEventListener("click", () => {
      if (box.dataset.link) window.open(box.dataset.link, "_blank");
      box.remove();
    });
    document.documentElement.appendChild(box);
  }
  box.style.background = colors[kind] || colors.info;
  box.textContent = text;
  box.dataset.link = link || "";
  box.title = link ? "Click to open the commit" : "Click to dismiss";
  clearTimeout(box.__timer);
  if (kind !== "info") box.__timer = setTimeout(() => box.remove(), 8000);
}
