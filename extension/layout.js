// Repository layout shared with scripts/sync_leetcode.py. The output here must
// match the Python script byte for byte, so the GitHub Action and the extension
// can both write to the same repo without fighting over formatting.

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

const FILE_NAMES = {
  python: "solution_python2.py",
  pythondata: "solution_pandas.py",
  mssql: "solution_mssql.sql",
  oraclesql: "solution_oracle.sql",
  postgresql: "solution_postgresql.sql",
};

export const STATE_PATH = "data/solved.json";

export function solutionFileName(lang) {
  return FILE_NAMES[lang] || `solution.${LANG_EXTENSIONS[lang] || "txt"}`;
}

export function folderName(problem) {
  const id = problem.id;
  const prefix = /^\d+$/.test(id) ? String(Number(id)).padStart(4, "0") : id.replace(/\W+/g, "-");
  return `${prefix}-${problem.slug}`;
}

export function problemDir(problem) {
  return `problems/${folderName(problem)}`;
}

// Same as Python's json.dumps(state, indent=2, sort_keys=True) + "\n".
export function serializeState(state) {
  const sortKeys = (value) => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, sortKeys(value[key])])
      );
    }
    return value;
  };
  const json = JSON.stringify(sortKeys(state), null, 2).replace(
    /[\u0080-￿]/g,
    (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")
  );
  return json + "\n";
}

export function problemReadme(problem, content) {
  if (!content) {
    content = "_Description unavailable (premium problem or not provided by LeetCode)._";
  }
  const url = `https://leetcode.com/problems/${problem.slug}/`;
  const lines = [
    `# [${problem.id}. ${problem.title}](${url})`,
    "",
    `**Difficulty:** ${problem.difficulty}  `,
    `**Topics:** ${problem.tags.join(", ") || "-"}`,
    "",
    "<!-- DESCRIPTION -->",
    content.trim(),
    "<!-- /DESCRIPTION -->",
    "",
  ];
  const langs = Object.keys(problem.languages).sort();
  if (langs.length) {
    lines.push("## Solutions", "");
    for (const lang of langs) {
      const info = problem.languages[lang];
      const stats = [info.runtime, info.memory].filter(Boolean).join(", ");
      lines.push(`- [${lang}](${info.file})${stats ? ` (${stats})` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Apply an accepted submission to the repo state.
 * Returns { files: {path: text}, isNew, problem } or null if already synced.
 */
export function applySubmission(state, submission) {
  const { slug, lang, question } = submission;
  const problems = state.problems;
  const isNew = !(slug in problems);
  const problem = isNew
    ? {
        id: question.id,
        title: question.title,
        slug,
        difficulty: question.difficulty,
        tags: question.tags,
        solved_at: submission.timestamp,
        languages: {},
      }
    : problems[slug];
  problem.solved_at = Math.min(problem.solved_at, submission.timestamp);

  const known = problem.languages[lang];
  if (known && known.submission_id >= submission.submissionId) return null;

  const file = solutionFileName(lang);
  problem.languages[lang] = {
    file,
    submission_id: submission.submissionId,
    timestamp: submission.timestamp,
    runtime: submission.runtime,
    memory: submission.memory,
  };
  problems[slug] = problem;

  const dir = problemDir(problem);
  const code = submission.code.endsWith("\n") ? submission.code : submission.code + "\n";
  return {
    isNew,
    problem,
    files: {
      [`${dir}/${file}`]: code,
      [`${dir}/README.md`]: problemReadme(problem, question.content),
      [STATE_PATH]: serializeState(state),
    },
  };
}
