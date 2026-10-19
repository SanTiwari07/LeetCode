const fields = ["owner", "repo", "branch", "token"];
const checks = ["saveAttempts", "autoSync"];
const defaults = { owner: "SanTiwari07", repo: "LeetCodeSolved", branch: "", token: "", saveAttempts: true, autoSync: true };
const status = document.getElementById("status");

function show(text, ok) {
  status.textContent = text;
  status.className = ok ? "ok" : "error";
}

chrome.storage.local.get([...fields, ...checks]).then((stored) => {
  for (const field of fields) document.getElementById(field).value = stored[field] ?? defaults[field];
  for (const check of checks) document.getElementById(check).checked = stored[check] ?? defaults[check];
});

async function save() {
  const values = Object.fromEntries([
    ...fields.map((field) => [field, document.getElementById(field).value.trim()]),
    ...checks.map((check) => [check, document.getElementById(check).checked]),
  ]);
  await chrome.storage.local.set(values);
  return values;
}

document.getElementById("save").addEventListener("click", async () => {
  const values = await save();
  show(values.token ? "Saved." : "Saved, but a token is still needed.", Boolean(values.token));
});

document.getElementById("test").addEventListener("click", async () => {
  await save();
  show("Testing...", true);
  const result = await chrome.runtime.sendMessage({ type: "test" });
  show(result.ok ? result.message : result.error, result.ok);
});
