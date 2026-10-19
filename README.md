# LeetCode Tracker

A Chrome extension that saves every LeetCode problem you attempt to a GitHub repo, sorted by
topic, so you can always see what you've solved, what you haven't yet, and when you did it.

- **Every submission is saved**, Accepted or not, the moment LeetCode judges it.
- **One-click import** of your whole LeetCode history, including your code.
- **Sorted by topic:** each problem goes in a folder for its main topic (Array, String,
  Dynamic Programming, ...), and every topic has its own index page.
- **A dashboard README** with your totals, problems you haven't solved yet, recent activity and
  progress by month.
- **No server, no cookies to copy.** The extension runs inside your logged-in LeetCode tab and
  talks only to leetcode.com and the GitHub API.

Example: [SanTiwari07/LeetCodeSolved](https://github.com/SanTiwari07/LeetCodeSolved)

## What your solutions repo looks like

```
README.md                      dashboard: totals, topics, not solved yet, activity, all problems
Array/
  README.md                    every Array problem, plus ones that also use Array
  0001-two-sum/
    README.md                  status, dates, your code per language, submission history, description
    solution.py
    solution.java
Dynamic-Programming/
  ...
.leetcode-sync/state.json      data the READMEs are built from (don't edit by hand)
```

---

## Setup (about 3 minutes)

### 1. Create the repo for your solutions

On GitHub, [create a new repository](https://github.com/new), for example `LeetCodeSolved`. It
can be public or private, and it can be completely empty.

### 2. Install the extension

Works in Chrome, Edge, Brave and other Chromium browsers.

1. Download this repo: **Code > Download ZIP** and unzip it, or run:

   ```bash
   git clone https://github.com/SanTiwari07/LeetCodeTracker.git
   ```

2. Go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the **`extension`** folder inside the download.

   > Pick `LeetCodeTracker/extension`, not `LeetCodeTracker` itself. Choosing the outer folder
   > gives the error "Manifest file is missing or unreadable".

4. Click the puzzle-piece icon in the toolbar and pin **LeetCode Sync** so it's easy to reach.

### 3. Make a GitHub token

The token lets the extension save files to your solutions repo, and nothing else.

1. Open [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
2. **Token name:** anything, for example `LeetCode Tracker`.
3. **Expiration:** pick one. "No expiration" is easiest; with a date, you'll make a new token when
   it runs out.
4. **Repository access:** choose **Only select repositories**, open **Select repositories**, and
   pick your solutions repo (for example `LeetCodeSolved`).
5. **Permissions:** click **+ Add permissions**, tick **Contents**, and close the list. Next to
   **Contents**, change **Read-only** to **Read and write**. GitHub adds **Metadata: Read-only**
   on its own; leave it.

   Don't add any other permissions. The extension doesn't need them.

6. Click **Generate token**. A box pops up to confirm. It should show exactly this:

   | Permission | Access |
   |---|---|
   | Contents | Read and write |
   | Metadata | Read-only |

   If it does, click **Generate token** in the box.
7. **Copy the token now** (it starts with `github_pat_`). GitHub shows it only once. If you lose
   it, just make a new one.

Keep the token private: paste it only into the extension, never into chats or code.

### 4. Connect

Click the extension icon > **Settings** and fill in:

| Field | Example |
|---|---|
| GitHub username | `SanTiwari07` |
| Repository | `LeetCodeSolved` |
| Branch | leave blank |
| GitHub token | the token you just copied |

Click **Test connection**. You should see "Connected to ...".

### 5. Import your history

Log in to [leetcode.com](https://leetcode.com), then click the extension icon > **Import full
history**. A progress message appears in the bottom-right corner of the LeetCode page. A few
hundred submissions take a few minutes; keep the tab open until it says it's done.

You're all set.

---

## Daily use

There's nothing to do. Solve problems as usual:

- When LeetCode judges a submission, a message in the corner says **Saved to GitHub**. Click it to
  see the commit.
- Accepted code always wins: a later Wrong Answer in the same language is recorded in the history
  but doesn't replace your working solution.
- Solved something on your phone or another computer? The next time you open LeetCode here, the
  extension catches up on its own. You can also click **Sync now** in the popup.

The popup shows your recent saves. If one failed (for example, you were offline), click **Retry**.

## Settings

| Setting | What it does |
|---|---|
| Save attempts that weren't accepted | On by default. Turn off to save only Accepted submissions. |
| Catch up automatically when I open LeetCode | On by default. Checks for missed submissions at most every 30 minutes. |
| Branch | Leave blank to use the repo's default branch. |

## Updating the extension

Download the new version (or `git pull`), then go to `chrome://extensions` and click the reload
icon on **LeetCode Sync**. Your settings are kept.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Manifest file is missing or unreadable" | You picked the wrong folder. Select the `extension` folder. |
| **Test connection** fails with 401 | The token is wrong or expired. Make a new one. |
| **Test connection** fails with 403 or 404 | Check the username and repo name, and that the token has access to that repo with **Contents: Read and write**. |
| Nothing happens after submitting | Reload the LeetCode tab (tabs opened before installing don't have the extension yet). |
| "Log in to LeetCode, then sync again" | Log in on leetcode.com in this browser, then click **Sync now**. |
| Import stopped halfway | Click **Import full history** again. It skips everything already saved. |

## Privacy

Your GitHub token is stored only in this browser's extension storage. The extension talks only to
`leetcode.com` (to read your own submissions) and `api.github.com` (to save them to your repo).
