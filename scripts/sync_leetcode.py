#!/usr/bin/env python3
"""Sync solved LeetCode problems into this repository.

Runs in one of two modes:

* Public (no secrets): uses LeetCode's public profile API to pick up recently
  accepted problems. LeetCode only exposes the ~20 most recent ones, so run
  this often. Each problem gets a folder with its description, but code is
  not available without logging in.

* Authenticated (LEETCODE_SESSION and LEETCODE_CSRF_TOKEN set): walks your
  submission history and saves the code of your latest accepted submission
  for every problem and language. The first run imports your full history.

Only the Python standard library is used, so no install step is needed.
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROBLEMS_DIR = ROOT / "problems"
STATE_FILE = ROOT / "data" / "solved.json"
README_FILE = ROOT / "README.md"

GRAPHQL_URL = "https://leetcode.com/graphql/"
README_START = "<!-- LEETCODE-SYNC:START -->"
README_END = "<!-- LEETCODE-SYNC:END -->"

LANG_EXTENSIONS = {
    "bash": "sh",
    "c": "c",
    "cpp": "cpp",
    "csharp": "cs",
    "dart": "dart",
    "elixir": "ex",
    "erlang": "erl",
    "golang": "go",
    "java": "java",
    "javascript": "js",
    "kotlin": "kt",
    "mssql": "sql",
    "mysql": "sql",
    "oraclesql": "sql",
    "php": "php",
    "postgresql": "sql",
    "python": "py",
    "python3": "py",
    "pythondata": "py",
    "racket": "rkt",
    "ruby": "rb",
    "rust": "rs",
    "scala": "scala",
    "swift": "swift",
    "typescript": "ts",
}

# Several languages share an extension (python/python3, the SQL dialects), so
# the file name keeps the language to avoid one overwriting another.
FILE_NAMES = {
    "python": "solution_python2.py",
    "pythondata": "solution_pandas.py",
    "mssql": "solution_mssql.sql",
    "oraclesql": "solution_oracle.sql",
    "postgresql": "solution_postgresql.sql",
}

QUESTION_QUERY = """
query question($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    title
    titleSlug
    difficulty
    content
    isPaidOnly
    topicTags { name }
  }
}
"""

RECENT_AC_QUERY = """
query recentAc($username: String!, $limit: Int!) {
  recentAcSubmissionList(username: $username, limit: $limit) {
    id
    title
    titleSlug
    timestamp
  }
}
"""

STATS_QUERY = """
query stats($username: String!) {
  matchedUser(username: $username) {
    submitStatsGlobal { acSubmissionNum { difficulty count } }
  }
}
"""

USER_STATUS_QUERY = """
query { userStatus { isSignedIn username } }
"""

SUBMISSION_LIST_QUERY = """
query submissionList($offset: Int!, $limit: Int!, $lastKey: String) {
  submissionList(offset: $offset, limit: $limit, lastKey: $lastKey) {
    lastKey
    hasNext
    submissions { id title titleSlug statusDisplay lang timestamp }
  }
}
"""

SUBMISSION_DETAILS_QUERY = """
query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    code
    runtimeDisplay
    memoryDisplay
  }
}
"""


def warn(message):
    # Shows up as an annotation on the workflow run in GitHub Actions.
    print(f"::warning::{message}")


class LeetCode:
    def __init__(self, session=None, csrf=None):
        self.session = session
        self.csrf = csrf

    def query(self, query, variables=None, auth=False):
        headers = {
            "Content-Type": "application/json",
            "Referer": "https://leetcode.com",
            "Origin": "https://leetcode.com",
            "User-Agent": "Mozilla/5.0 (compatible; leetcode-sync)",
        }
        if auth:
            headers["Cookie"] = f"LEETCODE_SESSION={self.session}; csrftoken={self.csrf}"
            headers["x-csrftoken"] = self.csrf
        body = json.dumps({"query": query, "variables": variables or {}}).encode()

        for attempt in range(5):
            request = urllib.request.Request(GRAPHQL_URL, data=body, headers=headers)
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    payload = json.load(response)
                break
            except urllib.error.HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504) or attempt == 4:
                    raise
            except urllib.error.URLError:
                if attempt == 4:
                    raise
            time.sleep(2 ** (attempt + 1))

        if payload.get("errors"):
            raise RuntimeError(f"LeetCode API error: {payload['errors']}")
        return payload["data"]

    def question(self, slug):
        return self.query(QUESTION_QUERY, {"titleSlug": slug})["question"]

    def recent_accepted(self, username):
        data = self.query(RECENT_AC_QUERY, {"username": username, "limit": 20})
        return data["recentAcSubmissionList"] or []

    def stats(self, username):
        user = self.query(STATS_QUERY, {"username": username})["matchedUser"]
        if not user:
            return {}
        return {
            row["difficulty"]: row["count"]
            for row in user["submitStatsGlobal"]["acSubmissionNum"]
        }

    def signed_in_user(self):
        status = self.query(USER_STATUS_QUERY, auth=True)["userStatus"]
        return status["username"] if status and status["isSignedIn"] else None

    def submissions_since(self, last_id):
        """Yield submissions newer than last_id, newest first."""
        offset, last_key = 0, None
        while True:
            data = self.query(
                SUBMISSION_LIST_QUERY,
                {"offset": offset, "limit": 20, "lastKey": last_key},
                auth=True,
            )["submissionList"]
            for submission in data["submissions"]:
                if int(submission["id"]) <= last_id:
                    return
                yield submission
            if not data["hasNext"]:
                return
            offset += 20
            last_key = data["lastKey"]
            time.sleep(1)

    def submission_details(self, submission_id):
        return self.query(
            SUBMISSION_DETAILS_QUERY, {"submissionId": int(submission_id)}, auth=True
        )["submissionDetails"]


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"last_submission_id": 0, "problems": {}}


def save_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")


def folder_name(problem):
    frontend_id = problem["id"]
    prefix = f"{int(frontend_id):04d}" if frontend_id.isdigit() else re.sub(r"\W+", "-", frontend_id)
    return f"{prefix}-{problem['slug']}"


def ensure_problem(client, state, descriptions, slug, solved_at):
    """Add a problem to the state if it is new; return (entry, is_new)."""
    problems = state["problems"]
    if slug in problems:
        entry = problems[slug]
        entry["solved_at"] = min(entry["solved_at"], solved_at)
        return entry, False

    question = client.question(slug)
    problems[slug] = {
        "id": question["questionFrontendId"],
        "title": question["title"],
        "slug": slug,
        "difficulty": question["difficulty"],
        "tags": [tag["name"] for tag in question["topicTags"]],
        "solved_at": solved_at,
        "languages": {},
    }
    # Descriptions go into the problem README, not the state file.
    descriptions[slug] = question["content"]
    time.sleep(0.5)
    return problems[slug], True


def write_problem_readme(problem, content=None):
    folder = PROBLEMS_DIR / folder_name(problem)
    folder.mkdir(parents=True, exist_ok=True)
    readme = folder / "README.md"

    if content is None and readme.exists():
        # Reuse the description already on disk.
        existing = readme.read_text()
        match = re.search(r"<!-- DESCRIPTION -->\n(.*?)\n<!-- /DESCRIPTION -->", existing, re.S)
        content = match.group(1) if match else ""
    if not content:
        content = "_Description unavailable (premium problem or not provided by LeetCode)._"

    url = f"https://leetcode.com/problems/{problem['slug']}/"
    lines = [
        f"# [{problem['id']}. {problem['title']}]({url})",
        "",
        f"**Difficulty:** {problem['difficulty']}  ",
        f"**Topics:** {', '.join(problem['tags']) or '-'}",
        "",
        "<!-- DESCRIPTION -->",
        content.strip(),
        "<!-- /DESCRIPTION -->",
        "",
    ]
    if problem["languages"]:
        lines += ["## Solutions", ""]
        for lang, info in sorted(problem["languages"].items()):
            stats = ", ".join(
                part for part in (info.get("runtime"), info.get("memory")) if part
            )
            suffix = f" ({stats})" if stats else ""
            lines.append(f"- [{lang}]({info['file']}){suffix}")
        lines.append("")
    readme.write_text("\n".join(lines))


def write_solution(problem, submission, details):
    lang = submission["lang"]
    file_name = FILE_NAMES.get(lang, f"solution.{LANG_EXTENSIONS.get(lang, 'txt')}")
    folder = PROBLEMS_DIR / folder_name(problem)
    folder.mkdir(parents=True, exist_ok=True)
    code = details["code"]
    (folder / file_name).write_text(code if code.endswith("\n") else code + "\n")
    problem["languages"][lang] = {
        "file": file_name,
        "submission_id": int(submission["id"]),
        "timestamp": int(submission["timestamp"]),
        "runtime": details.get("runtimeDisplay"),
        "memory": details.get("memoryDisplay"),
    }


def render_readme(state, username, stats):
    problems = sorted(
        state["problems"].values(),
        key=lambda p: (not p["id"].isdigit(), int(p["id"]) if p["id"].isdigit() else 0, p["id"]),
    )
    counts = {"Easy": 0, "Medium": 0, "Hard": 0}
    for problem in problems:
        counts[problem["difficulty"]] = counts.get(problem["difficulty"], 0) + 1

    profile = f"https://leetcode.com/u/{username}/"
    lines = [README_START, ""]
    if stats:
        lines += [
            f"**[LeetCode profile]({profile})**: {stats.get('All', 0)} solved "
            f"({stats.get('Easy', 0)} Easy, {stats.get('Medium', 0)} Medium, {stats.get('Hard', 0)} Hard)",
            "",
        ]
    lines += [
        f"Problems in this repo: **{len(problems)}** "
        f"({counts['Easy']} Easy, {counts['Medium']} Medium, {counts['Hard']} Hard)",
        "",
        "| # | Problem | Difficulty | Solutions | Solved |",
        "|---|---------|------------|-----------|--------|",
    ]
    for problem in problems:
        folder = f"problems/{folder_name(problem)}"
        solutions = ", ".join(
            f"[{lang}]({folder}/{info['file']})"
            for lang, info in sorted(problem["languages"].items())
        ) or "-"
        solved = datetime.fromtimestamp(problem["solved_at"], timezone.utc).strftime("%Y-%m-%d")
        lines.append(
            f"| {problem['id']} | [{problem['title']}]({folder}/README.md) "
            f"| {problem['difficulty']} | {solutions} | {solved} |"
        )
    lines += ["", README_END]
    block = "\n".join(lines)

    if README_FILE.exists():
        text = README_FILE.read_text()
        if README_START in text and README_END in text:
            before = text.split(README_START)[0]
            after = text.split(README_END, 1)[1]
            README_FILE.write_text(before + block + after)
            return
    README_FILE.write_text(
        "# LeetCode Solutions\n\n"
        "My LeetCode solutions, synced automatically by "
        "[a GitHub Action](.github/workflows/sync-leetcode.yml).\n\n"
        + block
        + "\n"
    )


def main():
    username = os.environ.get("LEETCODE_USERNAME", "").strip()
    if not username:
        sys.exit("LEETCODE_USERNAME is not set")
    session = os.environ.get("LEETCODE_SESSION", "").strip()
    csrf = os.environ.get("LEETCODE_CSRF_TOKEN", "").strip()

    client = LeetCode(session, csrf)
    state = load_state()
    new_titles = []
    touched = set()
    descriptions = {}

    authenticated = False
    if session and csrf:
        signed_in = client.signed_in_user()
        if not signed_in:
            warn(
                "LEETCODE_SESSION is invalid or expired; syncing without code. "
                "Update the LEETCODE_SESSION and LEETCODE_CSRF_TOKEN secrets."
            )
        else:
            if signed_in.lower() != username.lower():
                warn(f"Secrets belong to '{signed_in}', not '{username}'.")
            authenticated = True

    if authenticated:
        latest, first_solved = {}, {}
        newest_id = state["last_submission_id"]
        for submission in client.submissions_since(state["last_submission_id"]):
            newest_id = max(newest_id, int(submission["id"]))
            if submission["statusDisplay"] != "Accepted":
                continue
            # Newest first: the first one seen per problem+language is the latest,
            # the last one seen per problem is the earliest accepted.
            slug = submission["titleSlug"]
            latest.setdefault((slug, submission["lang"]), submission)
            first_solved[slug] = int(submission["timestamp"])

        for (slug, lang), submission in latest.items():
            problem, is_new = ensure_problem(client, state, descriptions, slug, first_solved[slug])
            if is_new:
                new_titles.append(problem["title"])
                touched.add(slug)
            known = problem["languages"].get(lang)
            if known and known["submission_id"] >= int(submission["id"]):
                continue
            details = client.submission_details(submission["id"])
            if not details or details.get("code") is None:
                warn(f"Could not fetch code for submission {submission['id']} ({slug})")
                continue
            write_solution(problem, submission, details)
            touched.add(slug)
            time.sleep(1)
        state["last_submission_id"] = newest_id
    else:
        for submission in client.recent_accepted(username):
            problem, is_new = ensure_problem(
                client, state, descriptions, submission["titleSlug"], int(submission["timestamp"])
            )
            if is_new:
                new_titles.append(problem["title"])
                touched.add(problem["slug"])

    for slug in touched:
        write_problem_readme(state["problems"][slug], descriptions.get(slug))

    save_state(state)
    try:
        stats = client.stats(username)
    except Exception as error:  # Stats are cosmetic; never fail the sync for them.
        warn(f"Could not fetch profile stats: {error}")
        stats = {}
    render_readme(state, username, stats)

    mode = "with code" if authenticated else "public mode, no code"
    print(f"Synced {len(new_titles)} new problem(s), {len(touched)} updated ({mode}).")
    for title in new_titles:
        print(f"  + {title}")

    message_file = os.environ.get("COMMIT_MSG_FILE")
    if message_file:
        if new_titles:
            subject = f"Add {len(new_titles)} LeetCode problem(s)"
            body = "\n".join(f"- {title}" for title in new_titles)
            Path(message_file).write_text(f"{subject}\n\n{body}\n")
        else:
            Path(message_file).write_text("Update LeetCode solutions\n")


if __name__ == "__main__":
    main()
