// Layout of the solutions repo: which folder each problem lives in and what
// every README says. background.js only moves the files built here to GitHub.
//
//   README.md                    dashboard: totals, topics, recent activity
//   Array/README.md              index of one topic
//   Array/0001-two-sum/README.md problem page with history and description
//   Array/0001-two-sum/solution.py
//   .leetcode-sync/state.json    everything the READMEs are built from

export const STATE_PATH = ".leetcode-sync/state.json";

const LANG_EXTENSIONS = {
  bash: "sh",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  dart: "dart",
  elixir: "ex",
  erlang: "erl",
  golang: "go",
  java: "java",
  javascript: "js",
  kotlin: "kt",
  mssql: "sql",
  mysql: "sql",
  oraclesql: "sql",
  php: "php",
  postgresql: "sql",
  python: "py",
  python3: "py",
  pythondata: "py",
  racket: "rkt",
  ruby: "rb",
  rust: "rs",
  scala: "scala",
  swift: "swift",
  typescript: "ts",
};

// Several languages share an extension, so they get distinct file names.
const FILE_NAMES = {
  python: "solution_python2.py",
  pythondata: "solution_pandas.py",
  mssql: "solution_mssql.sql",
  oraclesql: "solution_oracle.sql",
  postgresql: "solution_postgresql.sql",
};

const RECENT_LIMIT = 15;

export function emptyState() {
  return { version: 1, synced_through: 0, problems: {} };
}

export function solutionFileName(lang) {
  return FILE_NAMES[lang] || `solution.${LANG_EXTENSIONS[lang] || "txt"}`;
}

const isAccepted = (status) => status === "Accepted";

// Accepted code beats any other result; otherwise the newer submission wins.
function isBetter(candidate, current) {
  if (!current) return true;
  if (isAccepted(candidate.status) !== isAccepted(current.status)) return isAccepted(candidate.status);
  return candidate.id > current.id;
}

// Tags that describe a general technique rather than what a problem is about.
// LeetCode sometimes lists one first (Number of 1 Bits: Divide and Conquer,
// Bit Manipulation), so they only become the main topic when nothing else fits.
const GENERAL_TAGS = new Set([
  "Brainteaser",
  "Divide and Conquer",
  "Enumeration",
  "Interactive",
  "Iterator",
  "Memoization",
  "Recursion",
  "Simulation",
]);

export function mainTopic(tags) {
  return tags.find((tag) => !GENERAL_TAGS.has(tag)) || tags[0] || "Other";
}

function topicFolder(topic) {
  return topic.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "Other";
}

function problemFolder(question, slug) {
  const id = String(question.id);
  const prefix = /^\d+$/.test(id) ? id.padStart(4, "0") : id.replace(/\W+/g, "-");
  return `${topicFolder(mainTopic(question.tags))}/${prefix}-${slug}`;
}

/**
 * Work out what a sync has to fetch. `listed` is submission metadata from
 * LeetCode ({id, slug, lang, status, timestamp}). Returns the problems with new
 * submissions (oldest first, so an interrupted import resumes cleanly) and the
 * submission ids whose code is worth downloading.
 */
export function planSync(state, listed) {
  const known = new Set();
  for (const problem of Object.values(state.problems)) {
    for (const submission of problem.submissions) known.add(submission.id);
  }
  const fresh = listed.filter((submission) => !known.has(submission.id));

  const best = new Map();
  const oldest = new Map();
  for (const submission of fresh) {
    const key = `${submission.slug}\n${submission.lang}`;
    if (isBetter(submission, best.get(key))) best.set(key, submission);
    oldest.set(submission.slug, Math.min(oldest.get(submission.slug) ?? Infinity, submission.id));
  }

  const codeIds = [];
  for (const submission of best.values()) {
    const problem = state.problems[submission.slug];
    if (isBetter(submission, problem && problem.languages[submission.lang])) codeIds.push(submission.id);
  }
  const slugs = [...oldest.keys()].sort((a, b) => oldest.get(a) - oldest.get(b));
  const newSlugs = slugs.filter((slug) => !state.problems[slug]).length;
  return { slugs, newSlugs, codeIds, count: fresh.length };
}

/**
 * Record submissions in the state. Each submission is {id, slug, lang, status,
 * timestamp, runtime, memory, code?}; `questions` maps slug to {id, title,
 * difficulty, tags, content} for every slug involved. Returns the changed
 * problem files and what happened, or null when everything was already known.
 */
export function applySubmissions(state, submissions, questions) {
  const files = {};
  const events = [];
  const touched = new Set();

  for (const submission of [...submissions].sort((a, b) => a.id - b.id)) {
    const question = questions[submission.slug];
    let problem = state.problems[submission.slug];
    if (!problem) {
      if (!question) continue;
      problem = state.problems[submission.slug] = {
        id: String(question.id),
        title: question.title,
        slug: submission.slug,
        difficulty: question.difficulty,
        tags: question.tags,
        topic: mainTopic(question.tags),
        dir: problemFolder(question, submission.slug),
        first_attempt_at: submission.timestamp,
        last_attempt_at: submission.timestamp,
        solved_at: null,
        languages: {},
        submissions: [],
      };
    }
    if (problem.submissions.some((known) => known.id === submission.id)) continue;

    const wasSolved = problem.solved_at !== null;
    const record = {
      id: submission.id,
      status: submission.status,
      lang: submission.lang,
      timestamp: submission.timestamp,
      runtime: submission.runtime || null,
      memory: submission.memory || null,
    };
    problem.submissions.push(record);
    problem.submissions.sort((a, b) => a.id - b.id);
    problem.first_attempt_at = Math.min(problem.first_attempt_at, submission.timestamp);
    problem.last_attempt_at = Math.max(problem.last_attempt_at, submission.timestamp);
    if (isAccepted(submission.status)) {
      problem.solved_at = Math.min(problem.solved_at ?? Infinity, submission.timestamp);
    }

    let codeSaved = false;
    if (submission.code != null && isBetter(record, problem.languages[submission.lang])) {
      const file = solutionFileName(submission.lang);
      problem.languages[submission.lang] = { file, ...record };
      files[`${problem.dir}/${file}`] = submission.code.endsWith("\n") ? submission.code : submission.code + "\n";
      codeSaved = true;
    }

    events.push({ problem, submission: record, firstSolve: isAccepted(submission.status) && !wasSolved, codeSaved });
    touched.add(submission.slug);
  }

  if (!events.length) return null;
  for (const slug of touched) {
    const problem = state.problems[slug];
    const question = questions[slug];
    if (question) {
      problem.title = question.title;
      problem.difficulty = question.difficulty;
      problem.tags = question.tags;
    }
    files[`${problem.dir}/README.md`] = problemReadme(problem, question && question.content);
  }
  return { files, events };
}

/** README files that summarize the whole repo, plus the state file itself. */
export function indexFiles(state) {
  const files = {
    "README.md": rootReadme(state),
    [STATE_PATH]: serializeState(state),
    // GitHub counts .sql files as data, so SQL solutions would be missing from
    // the repo's language bar without this.
    ".gitattributes": "*.sql linguist-detectable=true\n",
  };
  for (const [folder, problems] of byTopic(state)) {
    files[`${folder}/README.md`] = topicReadme(state, folder, problems);
  }
  return files;
}

// ---------------------------------------------------------------------------
// Rendering

const pad = (n) => String(n).padStart(2, "0");

function day(timestamp) {
  if (timestamp == null) return "-";
  const date = new Date(timestamp * 1000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function month(timestamp) {
  return day(timestamp).slice(0, 7);
}

const cell = (text) => String(text ?? "-").replace(/\|/g, "\\|").replace(/\n/g, " ");
const row = (cells) => `| ${cells.map(cell).join(" | ")} |`;
const header = (names) => [row(names), row(names.map(() => "---"))];

const solved = (problem) => problem.solved_at !== null;
const statusOf = (problem) => (solved(problem) ? "Solved" : "Attempted");
const leetcodeUrl = (problem) => `https://leetcode.com/problems/${problem.slug}/`;

function compareIds(a, b) {
  const x = Number(a.id);
  const y = Number(b.id);
  if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  return String(a.id).localeCompare(String(b.id));
}

function sortedProblems(state) {
  return Object.values(state.problems).sort(compareIds);
}

// Problems grouped by the topic folder they are filed under.
function byTopic(state) {
  const groups = new Map();
  for (const problem of sortedProblems(state)) {
    const folder = problem.dir.split("/")[0];
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(problem);
  }
  return groups;
}

function counts(problems) {
  const result = { total: problems.length, solved: 0, attempted: 0, Easy: 0, Medium: 0, Hard: 0 };
  for (const problem of problems) {
    result[solved(problem) ? "solved" : "attempted"]++;
    if (problem.difficulty in result) result[problem.difficulty]++;
  }
  return result;
}

export function problemReadme(problem, content) {
  const latestFirst = [...problem.submissions].reverse();
  const lines = [
    `# [${problem.id}. ${problem.title}](${leetcodeUrl(problem)})`,
    "",
    `[${problem.topic}](../README.md) / [All problems](../../README.md)`,
    "",
    ...header(["Difficulty", "Status", "Submissions", "First tried", "Solved on"]),
    row([problem.difficulty, statusOf(problem), problem.submissions.length, day(problem.first_attempt_at), day(problem.solved_at)]),
    "",
    `**Topics:** ${problem.tags.join(", ") || "-"}`,
    "",
    "## My code",
    "",
  ];

  const langs = Object.keys(problem.languages).sort();
  if (langs.length) {
    lines.push(...header(["Language", "Result", "Runtime", "Memory", "Date"]));
    for (const lang of langs) {
      const info = problem.languages[lang];
      lines.push(row([`[${lang}](${info.file})`, info.status, info.runtime, info.memory, day(info.timestamp)]));
    }
  } else {
    lines.push("_No code saved yet._");
  }

  lines.push("", "## Submission history", "", ...header(["Date", "Result", "Language", "Runtime", "Memory"]));
  for (const submission of latestFirst) {
    lines.push(row([day(submission.timestamp), submission.status, submission.lang, submission.runtime, submission.memory]));
  }

  lines.push(
    "",
    "## Problem",
    "",
    "<details>",
    "<summary>Show description</summary>",
    "",
    (content || "_Description unavailable (premium problem or not provided by LeetCode)._").trim(),
    "",
    "</details>",
    ""
  );
  return lines.join("\n");
}

function topicReadme(state, folder, problems) {
  const topic = problems[0].topic;
  const total = counts(problems);
  const lines = [
    `# ${topic}`,
    "",
    "[All topics](../README.md)",
    "",
    ...header(["Problems", "Solved", "Attempted", "Easy", "Medium", "Hard"]),
    row([total.total, total.solved, total.attempted, total.Easy, total.Medium, total.Hard]),
    "",
    ...header(["#", "Problem", "Difficulty", "Status", "Submissions", "Languages", "Solved on"]),
  ];
  for (const problem of problems) {
    lines.push(
      row([
        problem.id,
        `[${problem.title}](../${problem.dir}/README.md)`,
        problem.difficulty,
        statusOf(problem),
        problem.submissions.length,
        Object.keys(problem.languages).sort().join(", ") || "-",
        day(problem.solved_at),
      ])
    );
  }

  const elsewhere = sortedProblems(state).filter(
    (problem) => problem.dir.split("/")[0] !== folder && problem.tags.includes(topic)
  );
  if (elsewhere.length) {
    lines.push(
      "",
      `## Also tagged ${topic}`,
      "",
      "Filed under their main topic, but they use this one too.",
      "",
      ...header(["#", "Problem", "Filed under", "Difficulty", "Status"])
    );
    for (const problem of elsewhere) {
      lines.push(
        row([
          problem.id,
          `[${problem.title}](../${problem.dir}/README.md)`,
          problem.topic,
          problem.difficulty,
          statusOf(problem),
        ])
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

function rootReadme(state) {
  const problems = sortedProblems(state);
  const lines = [
    "# LeetCode Solved",
    "",
    "Every LeetCode problem I have attempted, sorted by topic. Updated automatically after each submission.",
    "",
  ];
  if (!problems.length) {
    lines.push("_Nothing here yet. Submit a solution on LeetCode and it will show up._", "");
    return lines.join("\n");
  }

  const total = counts(problems);
  const solvedBy = counts(problems.filter(solved));
  const last = Math.max(...problems.map((problem) => problem.last_attempt_at));
  lines.push(
    ...header(["Problems", "Solved", "Attempted", "Easy solved", "Medium solved", "Hard solved", "Last activity"]),
    row([total.total, total.solved, total.attempted, solvedBy.Easy, solvedBy.Medium, solvedBy.Hard, day(last)]),
    "",
    "## Topics",
    "",
    ...header(["Topic", "Problems", "Solved", "Attempted", "Easy", "Medium", "Hard"])
  );
  const topics = [...byTopic(state)].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [folder, group] of topics) {
    const c = counts(group);
    lines.push(row([`[${group[0].topic}](${folder}/README.md)`, c.total, c.solved, c.attempted, c.Easy, c.Medium, c.Hard]));
  }

  const link = (problem) => `[${problem.id}. ${problem.title}](${problem.dir}/README.md)`;

  const unsolved = problems.filter((problem) => !solved(problem)).sort((a, b) => b.last_attempt_at - a.last_attempt_at);
  if (unsolved.length) {
    lines.push("", "## Not solved yet", "", ...header(["Problem", "Topic", "Difficulty", "Submissions", "Last tried"]));
    for (const problem of unsolved) {
      lines.push(row([link(problem), problem.topic, problem.difficulty, problem.submissions.length, day(problem.last_attempt_at)]));
    }
  }

  const activity = problems
    .flatMap((problem) => problem.submissions.map((submission) => ({ problem, submission })))
    .sort((a, b) => b.submission.id - a.submission.id);
  lines.push("", "## Recent activity", "", ...header(["Date", "Problem", "Result", "Language"]));
  for (const { problem, submission } of activity.slice(0, RECENT_LIMIT)) {
    lines.push(row([day(submission.timestamp), link(problem), submission.status, submission.lang]));
  }

  const months = new Map();
  const bump = (key, field) => {
    if (!months.has(key)) months.set(key, { solved: 0, submissions: 0 });
    months.get(key)[field]++;
  };
  for (const { submission } of activity) bump(month(submission.timestamp), "submissions");
  for (const problem of problems.filter(solved)) bump(month(problem.solved_at), "solved");
  lines.push("", "## Progress by month", "", ...header(["Month", "Problems solved", "Submissions"]));
  for (const key of [...months.keys()].sort().reverse()) {
    lines.push(row([key, months.get(key).solved, months.get(key).submissions]));
  }

  lines.push(
    "",
    "## All problems",
    "",
    ...header(["#", "Problem", "Topic", "Difficulty", "Status", "Submissions", "First tried", "Solved on"])
  );
  for (const problem of problems) {
    lines.push(
      row([
        problem.id,
        `[${problem.title}](${problem.dir}/README.md)`,
        `[${problem.topic}](${problem.dir.split("/")[0]}/README.md)`,
        problem.difficulty,
        statusOf(problem),
        problem.submissions.length,
        day(problem.first_attempt_at),
        day(problem.solved_at),
      ])
    );
  }
  lines.push("");
  return lines.join("\n");
}

// Pretty JSON, but small flat objects and arrays stay on one line so a long
// submission history doesn't balloon the file.
export function serializeState(state) {
  const write = (value, indent) => {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    const entries = Array.isArray(value) ? value.map((item) => [null, item]) : Object.entries(value);
    const oneLine = JSON.stringify(value);
    const flat = entries.every(([, item]) => item === null || typeof item !== "object");
    if (!entries.length || (flat && oneLine.length <= 160)) return oneLine;
    const inner = indent + "  ";
    const body = entries.map(([key, item]) => inner + (key === null ? "" : `${JSON.stringify(key)}: `) + write(item, inner));
    const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
    return `${open}\n${body.join(",\n")}\n${indent}${close}`;
  };
  return write(state, "") + "\n";
}
