# LeetCode Solutions

My [LeetCode](https://leetcode.com/u/cmy7RSNHvA/) solutions. New problems are added
automatically: a browser extension pushes the code the moment a submission is accepted, and a
[GitHub Action](.github/workflows/sync-leetcode.yml) fills in anything missed every 4 hours.

<!-- LEETCODE-SYNC:START -->
_The problem list appears here after the first sync._
<!-- LEETCODE-SYNC:END -->

---

## Setup

There are two parts. You can use either one on its own, but they work best together.

| | Browser extension | GitHub Action |
|---|---|---|
| **When it syncs** | Instantly, on every **Accepted** | Every 4 hours, or when you run it |
| **Saves your code** | Yes | Only if you add your LeetCode cookies |
| **Setup time** | About 2 minutes | Nothing to do (optional cookies: about 2 minutes) |

### 1. Install the browser extension (recommended)

Works in Chrome, Edge, Brave and other Chromium browsers.

1. **Get the files.** On this repo's GitHub page click **Code > Download ZIP** and unzip it, or run:

   ```bash
   git clone https://github.com/SanTiwari07/LeetCode.git
   ```

2. **Load it.** Go to `chrome://extensions`, turn on **Developer mode** (top right), click
   **Load unpacked**, and select the `extension` folder.
3. **Make a GitHub token.** Open
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   and set:
   - **Repository access:** Only select repositories > this repo
   - **Permissions > Contents:** Read and write

   Click **Generate token** and copy it.
4. **Connect it.** Click the extension icon > **Settings**, then fill in:

   | Field | Example |
   |---|---|
   | GitHub username or org | `SanTiwari07` |
   | Repository | `LeetCode` |
   | Branch | leave blank to use the default branch |
   | GitHub token | the token from step 3 |

   Click **Save**, then **Test connection**. You should see "Connected to ...".

That's it. Solve a problem on leetcode.com, and when it's accepted a **Pushed to GitHub** message
appears on the page and a commit like `Add 1. Two Sum (python3)` shows up here.

The extension popup lists your recent syncs. If one failed (for example, you were offline), click
**Retry** there.

### 2. The GitHub Action (already running)

[`scripts/sync_leetcode.py`](scripts/sync_leetcode.py) runs every 4 hours with no setup. To run it
right away: **Actions** tab > **Sync LeetCode** > **Run workflow**.

On its own it can only see your **20 most recent** accepted problems, and it can't see your code.
To import your **full history with code**, give it your LeetCode login cookies:

1. Log in to [leetcode.com](https://leetcode.com) and open DevTools (`F12`).
2. Go to **Application > Cookies > https://leetcode.com** and copy the values of
   `LEETCODE_SESSION` and `csrftoken`.
3. In this repo go to **Settings > Secrets and variables > Actions > New repository secret** and
   add:

   | Secret name | Value |
   |---|---|
   | `LEETCODE_SESSION` | the `LEETCODE_SESSION` cookie |
   | `LEETCODE_CSRF_TOKEN` | the `csrftoken` cookie |

4. Run the workflow once from the **Actions** tab to import everything.

The session cookie expires every few weeks. When it does, the run shows a warning and keeps
syncing without code until you repeat the steps above with fresh values.

---

## Use it for your own account

1. Fork this repo (or copy it into a new one).
2. In [`.github/workflows/sync-leetcode.yml`](.github/workflows/sync-leetcode.yml), change
   `LEETCODE_USERNAME` to your LeetCode username.
3. Delete the `problems/` and `data/` folders if they exist, so you start empty.
4. Follow the [Setup](#setup) steps above, pointing the extension at your repo.

## How it's organized

```
problems/
  0001-two-sum/
    README.md          problem description and stats
    solution.py        one file per language you solved it in
data/solved.json       list of solved problems (used to build the table above)
extension/             the browser extension
scripts/               the sync script run by the GitHub Action
```

The table at the top of this file is rebuilt automatically. Don't edit anything between the
`LEETCODE-SYNC` markers by hand.

## Troubleshooting

| Problem | Fix |
|---|---|
| **Test connection** fails with 401 | The token is wrong or expired. Make a new one. |
| **Test connection** fails with 403 or 404 | Check the username and repo name, and that the token has access to this repo with **Contents: Read and write**. |
| Nothing happens after **Accepted** | Reload the LeetCode tab after installing the extension. Check the popup for errors. |
| Action runs but no code is saved | Add the cookie secrets, or they have expired. Replace them with fresh values. |
| Problem list didn't update | Open **Actions** and check the latest **Sync LeetCode** run for errors. |
