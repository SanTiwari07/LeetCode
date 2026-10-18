// Bridges page_hook.js (page world) and background.js, and shows a small toast
// on the LeetCode page with the result.

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = event.data;
  if (!message || message.source !== "leetcode-github-sync") return;

  if (message.type === "error") {
    toast(`GitHub sync failed: ${message.message}`, "error");
    return;
  }
  if (message.type !== "accepted") return;

  toast("Accepted! Pushing to GitHub…", "info");
  chrome.runtime.sendMessage({ type: "push", payload: message.payload }, (result) => {
    if (chrome.runtime.lastError) {
      toast(`GitHub sync failed: ${chrome.runtime.lastError.message}`, "error");
    } else if (result && result.ok) {
      toast(`Pushed to GitHub: ${result.summary}`, "success", result.url);
    } else {
      toast(`GitHub sync failed: ${result ? result.error : "unknown error"}`, "error");
    }
  });
});

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
