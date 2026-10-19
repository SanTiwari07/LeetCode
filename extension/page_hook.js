// Runs in the page itself (world: MAIN) so it can see LeetCode's own network
// requests. When a submission is judged (Accepted or not), it gathers the code
// and problem details and hands them to content.js via postMessage. It also
// runs LeetCode GraphQL queries for content.js, since requests made from the
// page carry the same login as LeetCode's own.
(() => {
  if (window.__leetcodeGithubSync) return;
  window.__leetcodeGithubSync = true;

  const SOURCE = "leetcode-github-sync";
  const SUBMIT_RE = /\/problems\/([^/]+)\/submit\/?$/;
  const CHECK_RE = /\/submissions\/detail\/(\d+)\/check\/?$/;

  const originalFetch = window.fetch;
  const pending = new Map(); // submission_id -> { slug, lang, code }
  const handled = new Set();

  function pathOf(url) {
    try {
      return new URL(url, location.origin).pathname;
    } catch {
      return "";
    }
  }

  function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Retries on rate limits and server errors, backing off each time.
  async function graphql(query, variables) {
    for (let attempt = 0; ; attempt++) {
      const response = await originalFetch.call(window, "/graphql/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrftoken": csrfToken() },
        body: JSON.stringify({ query, variables }),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 5) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (!response.ok) throw new Error(`LeetCode ${response.status}`);
      const payload = await response.json();
      if (payload.errors) throw new Error(JSON.stringify(payload.errors));
      return payload.data;
    }
  }

  const QUESTION_QUERY = `query question($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionFrontendId title titleSlug difficulty content
      topicTags { name }
    }
  }`;

  const cleanStat = (value) => (value && !/N\/A/i.test(value) ? value : null);

  function onSubmit(path, body, responseJson) {
    const slug = path.match(SUBMIT_RE)[1];
    try {
      const request = typeof body === "string" ? JSON.parse(body) : null;
      if (request && responseJson && responseJson.submission_id) {
        pending.set(String(responseJson.submission_id), {
          slug,
          lang: request.lang,
          code: request.typed_code,
        });
      }
    } catch {
      // Not the request shape we expect; the check handler falls back to GraphQL.
    }
  }

  async function onCheck(submissionId, result) {
    if (result.state !== "SUCCESS" || !result.status_msg) return;
    if (handled.has(submissionId)) return;
    handled.add(submissionId);

    try {
      let submission = pending.get(submissionId);
      if (!submission || !submission.code) {
        const data = await graphql(
          `query submissionDetails($id: Int!) {
             submissionDetails(submissionId: $id) {
               code
               lang { name }
               question { titleSlug }
             }
           }`,
          { id: Number(submissionId) }
        );
        const details = data.submissionDetails;
        submission = {
          slug: details.question.titleSlug,
          lang: details.lang.name,
          code: details.code,
        };
      }

      const { question } = await graphql(QUESTION_QUERY, { titleSlug: submission.slug });
      window.postMessage(
        {
          source: SOURCE,
          type: "judged",
          submission: {
            id: Number(submissionId),
            slug: submission.slug,
            lang: submission.lang,
            status: result.status_msg,
            timestamp: Math.floor(Date.now() / 1000),
            runtime: cleanStat(result.status_runtime),
            memory: cleanStat(result.status_memory),
            code: submission.code,
          },
          question: {
            id: question.questionFrontendId,
            title: question.title,
            difficulty: question.difficulty,
            content: question.content,
            tags: (question.topicTags || []).map((tag) => tag.name),
          },
        },
        location.origin
      );
    } catch (error) {
      handled.delete(submissionId);
      window.postMessage({ source: SOURCE, type: "error", message: String(error) }, location.origin);
    } finally {
      pending.delete(submissionId);
    }
  }

  // content.js asks for GraphQL queries during a history sync.
  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.source !== SOURCE || message.type !== "graphql-request") return;
    try {
      const data = await graphql(message.query, message.variables);
      window.postMessage({ source: SOURCE, type: "graphql-response", id: message.id, data }, location.origin);
    } catch (error) {
      window.postMessage(
        { source: SOURCE, type: "graphql-response", id: message.id, error: String(error) },
        location.origin
      );
    }
  });

  function inspect(url, requestBody, responseJson) {
    const path = pathOf(url);
    if (SUBMIT_RE.test(path)) {
      onSubmit(path, requestBody, responseJson);
    } else if (CHECK_RE.test(path) && responseJson) {
      onCheck(path.match(CHECK_RE)[1], responseJson);
    }
  }

  function interesting(url) {
    const path = pathOf(url);
    return SUBMIT_RE.test(path) || CHECK_RE.test(path);
  }

  window.fetch = async function (input, init) {
    const response = await originalFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input && input.url;
      if (url && interesting(url)) {
        const body = init && init.body;
        response
          .clone()
          .json()
          .then((json) => inspect(url, body, json))
          .catch(() => {});
      }
    } catch {
      // Never break LeetCode's own requests.
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__syncUrl = url;
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__syncUrl && interesting(this.__syncUrl)) {
      this.addEventListener("load", () => {
        try {
          inspect(this.__syncUrl, body, JSON.parse(this.responseText));
        } catch {
          // Ignore unparseable responses.
        }
      });
    }
    return originalSend.apply(this, arguments);
  };
})();
