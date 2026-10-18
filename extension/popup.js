const list = document.getElementById("history");
const target = document.getElementById("target");

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

async function render() {
  const { owner, repo, token, history = [] } = await chrome.storage.local.get([
    "owner",
    "repo",
    "token",
    "history",
  ]);

  if (!token || !owner || !repo) {
    target.innerHTML = "⚠️ Not set up yet. Open <b>Settings</b> to add your GitHub token.";
  } else {
    target.textContent = `Syncing to ${owner}/${repo}`;
  }

  list.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "Nothing synced yet. Submit an accepted solution on LeetCode.";
    list.append(empty);
    return;
  }

  for (const entry of history) {
    const item = document.createElement("li");
    const title = document.createElement(entry.url ? "a" : "span");
    title.textContent = `${entry.ok ? "✅" : "❌"} ${entry.title} · ${entry.lang}`;
    if (entry.url) {
      title.href = entry.url;
      title.target = "_blank";
    }
    const meta = document.createElement("div");
    meta.className = "muted small";
    meta.textContent = [ago(entry.time), entry.note, entry.error].filter(Boolean).join(" · ");
    item.append(title, meta);

    if (!entry.ok && entry.payload) {
      const button = document.createElement("button");
      button.textContent = "Retry";
      button.className = "secondary small";
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Retrying…";
        await chrome.runtime.sendMessage({ type: "retry", submissionId: entry.submissionId });
        render();
      });
      item.append(button);
    }
    list.append(item);
  }
}

render();
