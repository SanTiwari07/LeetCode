// Runs in the page itself (world: MAIN) so it can see LeetCode's own network
// requests. It watches for a submission being judged "Accepted", gathers the
// code and problem details, and hands them to content.js via postMessage.
(() => {
  if (window.__leetcodeGithubSync) return;
  window.__leetcodeGithubSync = true;

  const SUBMIT_RE = /\/problems\/([^/]+)\/submit\/?$/;
  const CHECK_RE = /\/submissions\/detail\/(\d+)\/check\/?$/;
  const ACCEPTED = 10;

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

  async function graphql(query, variables) {
    const response = await originalFetch.call(window, "/graphql/", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-csrftoken": csrfToken() },
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json();
    if (payload.errors) throw new Error(JSON.stringify(payload.errors));
    return payload.data;
  }

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
    if (result.state !== "SUCCESS") return;
    if (result.status_code !== ACCEPTED && result.status_msg !== "Accepted") return;
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

      const { question } = await graphql(
        `query question($titleSlug: String!) {
           question(titleSlug: $titleSlug) {
             questionFrontendId title titleSlug difficulty content
             topicTags { name }
           }
         }`,
        { titleSlug: submission.slug }
      );

      window.postMessage(
        {
          source: "leetcode-github-sync",
          type: "accepted",
          payload: {
            submissionId: Number(submissionId),
            slug: submission.slug,
            lang: submission.lang,
            code: submission.code,
            timestamp: Math.floor(Date.now() / 1000),
            runtime: result.status_runtime || null,
            memory: result.status_memory || null,
            question: {
              id: question.questionFrontendId,
              title: question.title,
              difficulty: question.difficulty,
              content: question.content,
              tags: (question.topicTags || []).map((tag) => tag.name),
            },
          },
        },
        location.origin
      );
    } catch (error) {
      handled.delete(submissionId);
      window.postMessage(
        { source: "leetcode-github-sync", type: "error", message: String(error) },
        location.origin
      );
    } finally {
      pending.delete(submissionId);
    }
  }

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
