const list = document.getElementById("history");
const target = document.getElementById("target");
const syncStatus = document.getElementById("sync-status");
const syncButton = document.getElementById("sync");
const importButton = document.getElementById("import");
const STALE_MS = 90 * 1000;

document.getElementById("settings").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

function ago(time) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

async function start(full) {
  syncStatus.className = "small";
  syncStatus.textContent = "Starting...";
  const result = await chrome.runtime.sendMessage({ type: "start-sync", full });
  if (!result.ok) {
    syncStatus.className = "small error";
    syncStatus.textContent = result.error;
  }
}

syncButton.addEventListener("click", () => start(false));
importButton.addEventListener("click", () => start(true));

function link(text, url) {
  const element = document.createElement(url ? "a" : "span");
  element.textContent = text;
  if (url) {
    element.href = url;
    element.target = "_blank";
  }
  return element;
}

async function render() {
  const { owner, repo, token, history = [], sync = {} } = await chrome.storage.local.get([
    "owner",
    "repo",
    "token",
    "history",
    "sync",
  ]);

  const ready = Boolean(token && owner && repo);
  target.replaceChildren();
  if (ready) {
    target.append("Saving to ", link(`${owner}/${repo}`, `https://github.com/${owner}/${repo}`));
  } else {
    target.textContent = "Not set up yet. Click Settings to add your GitHub token.";
  }

  const running = sync.running && Date.now() - (sync.heartbeat || 0) < STALE_MS;
  syncButton.disabled = importButton.disabled = !ready || running;
  if (running) {
    syncStatus.className = "small";
    syncStatus.textContent = sync.text || "Syncing...";
  } else if (sync.finishedAt) {
    syncStatus.className = sync.ok ? "small muted" : "small error";
    syncStatus.textContent = `Last sync ${ago(sync.finishedAt)}: ${sync.text}`;
  }

  list.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "Nothing saved yet. Submit a solution on LeetCode, or click Import full history.";
    list.append(empty);
    return;
  }

  for (const entry of history) {
    const item = document.createElement("li");
    item.className = entry.ok ? "" : "failed";
    const meta = document.createElement("div");
    meta.className = "muted small";
    meta.textContent = [entry.detail, ago(entry.time), entry.note, entry.ok ? "" : entry.error]
      .filter(Boolean)
      .join(" · ");
    item.append(link(entry.title, entry.url), meta);

    if (!entry.ok && entry.payload) {
      const button = document.createElement("button");
      button.textContent = "Retry";
      button.className = "secondary small";
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Retrying...";
        await chrome.runtime.sendMessage({ type: "retry", key: entry.key });
        render();
      });
      item.append(button);
    }
    list.append(item);
  }
}

chrome.storage.onChanged.addListener(render);
render();
