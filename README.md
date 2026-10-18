# LeetCode Solutions

My [LeetCode](https://leetcode.com/u/cmy7RSNHvA/) solutions, synced automatically by
[a GitHub Action](.github/workflows/sync-leetcode.yml) every 4 hours.

<!-- LEETCODE-SYNC:START -->
_The problem list appears here after the first sync._
<!-- LEETCODE-SYNC:END -->

## Browser extension (instant sync with code)

The [`extension/`](extension) folder is a Chrome extension that pushes your code to this repo the
moment LeetCode says **Accepted**. It's the easiest way to get your solutions in.

1. Download this repo (**Code → Download ZIP**) and unzip it, or `git clone` it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the
   `extension` folder.
3. Create a [fine-grained GitHub token](https://github.com/settings/personal-access-tokens/new):
   **Repository access** → only this repo, **Permissions** → **Contents: Read and write**.
4. Click the extension icon → **Settings**, paste the token, then click **Test connection**.

Now solve a problem. When it's accepted you'll see a "Pushed to GitHub" toast, and a commit like
`Add 1. Two Sum (python3)` appears here. The extension icon's popup shows recent syncs and lets you
retry a failed one.

## How the scheduled sync works

[`scripts/sync_leetcode.py`](scripts/sync_leetcode.py) runs on a schedule (and on demand from the
**Actions** tab → **Sync LeetCode** → **Run workflow**). Each problem gets a folder under
`problems/` with its description and solutions, and the table above is regenerated.

- **Without secrets**, it uses LeetCode's public API, which only shows your 20 most recent
  accepted problems and no code. Problems are added as you solve them, but not your code.
- **With secrets**, it imports your full history plus the code of your latest accepted
  submission in each language. To enable it:
  1. Log in to leetcode.com, open DevTools → Application → Cookies → `https://leetcode.com`.
  2. Copy the values of the `LEETCODE_SESSION` and `csrftoken` cookies.
  3. In this repo, go to **Settings → Secrets and variables → Actions** and add the repository
     secrets `LEETCODE_SESSION` and `LEETCODE_CSRF_TOKEN`.

  The session cookie expires every few weeks. When it does, the run shows a warning and keeps
  syncing without code until you paste in fresh cookie values.
