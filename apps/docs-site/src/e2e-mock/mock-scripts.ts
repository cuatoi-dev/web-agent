import type { MockResponse } from "@cuatoi/web-agent-core";
import type { ProviderCallOptions } from "@cuatoi/web-agent-core";

/**
 * Self-contained mock script for the docs-site search_docs tool loop.
 * Drives a 1-step sequence: search_docs → final text.
 * State-driven on tool-results in opts.messages — not call-index.
 * Must stay self-contained (no closures) so .toString() injection into the browser works.
 * Typed as the function form so callers and tests can call it directly.
 */
export const docsSearchScript: (opts: ProviderCallOptions) => MockResponse = function docsSearchScript(opts: ProviderCallOptions): MockResponse {
  const seen = new Set<string>();
  for (const msg of opts.messages) {
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      for (const part of msg.content as Array<{ type: string; toolName: string }>) {
        if (part.type === "tool-result") seen.add(part.toolName);
      }
    }
  }

  if (!seen.has("search_docs")) {
    return {
      toolCalls: [{ id: "call_search_docs", name: "search_docs", input: { query: "theming" } }],
    };
  }
  return {
    text: "See the Theming guide.",
    finishReason: "stop",
  };
};

/**
 * Script 1 — plain prose reply, no tool calls.
 *
 * Serves functional tests 1 and 2, nonvision test 3, and both turns of
 * navigation-session. The text is long enough to clear `length > 20`
 * (functional), `length > 5` (nonvision) and `length > 0`
 * (navigation-session), and deliberately contains none of `400`, `error` or
 * `fail`, which nonvision test 3 asserts against.
 *
 * Declared with no parameter: it reads nothing from `opts`, and an unused
 * parameter is a lint error in this file. A zero-arg function is still
 * assignable to the script type and is still called with `opts` at runtime.
 */
export const docsProseReplyScript: () => MockResponse = function docsProseReplyScript(): MockResponse {
  return {
    text:
      "Web Agent is a browser-native in-app chat agent. It runs inside " +
      "your page, reads the docs you are viewing, and can drive the UI " +
      "on your behalf.",
    finishReason: "stop",
  };
};

/**
 * Script 2 — markdown bulleted list, no tool calls.
 *
 * Serves functional test 3, which asserts `hasList || hasKeywords`. Returning a
 * real markdown list makes `hasList` true deterministically, so the assertion
 * no longer depends on how a live model happened to word its answer.
 */
export const docsMarkdownListScript: () => MockResponse = function docsMarkdownListScript(): MockResponse {
  return {
    text:
      "The main docs sections are:\n\n" +
      "- Guides\n" +
      "- Beer CSS Reference\n" +
      "- API\n",
    finishReason: "stop",
  };
};

/**
 * Script 3 — one `search_docs` round trip, then an answer naming a slug.
 *
 * Serves custom-tools tests 1, 2 and 4. All three ask a different question, but
 * none asserts on the wording, so one script serves them all.
 */
export const docsSlugSearchScript: (opts: ProviderCallOptions) => MockResponse = function docsSlugSearchScript(opts: ProviderCallOptions): MockResponse {
  // Turn-scoped: only tool results produced AFTER the last user message count.
  // Scanning the whole history would answer "was this tool ever called", which
  // makes a later turn skip a tool call it should make.
  const lastUserIdx = opts.messages.map((m) => m.role).lastIndexOf("user");
  const seenToolThisTurn = (toolName: string): boolean => {
    for (const msg of opts.messages.slice(lastUserIdx)) {
      if (msg.role !== "tool" || !Array.isArray(msg.content)) continue;
      for (const part of msg.content as Array<{ type: string; toolName: string }>) {
        if (part.type === "tool-result" && part.toolName === toolName) return true;
      }
    }
    return false;
  };

  if (!seenToolThisTurn("search_docs")) {
    return {
      toolCalls: [{ id: "call_search_docs", name: "search_docs", input: { query: "button" } }],
    };
  }
  return {
    text:
      "I found the page with slug `button` in the Beer CSS Reference " +
      "category, at route #/reference/button.",
    finishReason: "stop",
  };
};

/**
 * Script 4 — `search_skills` then `load_skill`, then a final answer.
 *
 * Serves custom-tools test "skills: search_skills + load_skill round-trip".
 * That test branches on whether the reply asks which framework
 * (`/which.*(framework|Lit)|Lit 3.*Lit 1|framework.*using|what.*framework/i`,
 * custom-tools.mock.spec.ts:115). The final text below matches none of those
 * four alternatives, so the branch is never taken and the test is
 * deterministic.
 */
export const docsSkillsScript: (opts: ProviderCallOptions) => MockResponse = function docsSkillsScript(opts: ProviderCallOptions): MockResponse {
  const lastUserIdx = opts.messages.map((m) => m.role).lastIndexOf("user");
  const seenToolThisTurn = (toolName: string): boolean => {
    for (const msg of opts.messages.slice(lastUserIdx)) {
      if (msg.role !== "tool" || !Array.isArray(msg.content)) continue;
      for (const part of msg.content as Array<{ type: string; toolName: string }>) {
        if (part.type === "tool-result" && part.toolName === toolName) return true;
      }
    }
    return false;
  };

  if (!seenToolThisTurn("search_skills")) {
    return {
      toolCalls: [{ id: "call_search_skills", name: "search_skills", input: { query: "integrate lit" } }],
    };
  }
  if (!seenToolThisTurn("load_skill")) {
    return {
      toolCalls: [{ id: "call_load_skill", name: "load_skill", input: { name: "docs-guide" } }],
    };
  }
  return {
    text:
      "To integrate Web Agent into a Lit 3 app, install " +
      "@cuatoi/web-agent-lit, supply lit-html as a peer dependency, " +
      "and mount the bubble element.",
    finishReason: "stop",
  };
};

/**
 * Script 5 — five tool-driven turns in one session.
 *
 * Serves multi-turn. Turn is derived from the number of user messages, and each
 * turn makes exactly one tool call before answering. Every tool named here is
 * registered on docs-site: `snapshot_page`, `query_state` from `domTools()`,
 * `search_docs` from `bubble.tools`, and `search_skills` / `load_skill` from
 * the core skill tools.
 */
export const docsMultiTurnScript: (opts: ProviderCallOptions) => MockResponse = function docsMultiTurnScript(opts: ProviderCallOptions): MockResponse {
  const turnIndex = opts.messages.filter((m) => m.role === "user").length;

  const lastUserIdx = opts.messages.map((m) => m.role).lastIndexOf("user");
  const seenToolThisTurn = (toolName: string): boolean => {
    for (const msg of opts.messages.slice(lastUserIdx)) {
      if (msg.role !== "tool" || !Array.isArray(msg.content)) continue;
      for (const part of msg.content as Array<{ type: string; toolName: string }>) {
        if (part.type === "tool-result" && part.toolName === toolName) return true;
      }
    }
    return false;
  };

  if (turnIndex === 1) {
    if (!seenToolThisTurn("snapshot_page")) {
      return { toolCalls: [{ id: "c1", name: "snapshot_page", input: {} }] };
    }
    return { text: "I can see the Web Agent docs landing page.", finishReason: "stop" };
  }

  if (turnIndex === 2) {
    if (!seenToolThisTurn("search_docs")) {
      return { toolCalls: [{ id: "c2", name: "search_docs", input: { query: "architecture" } }] };
    }
    return { text: "The architecture guide is at #/guides/architecture.", finishReason: "stop" };
  }

  if (turnIndex === 3) {
    if (!seenToolThisTurn("search_skills")) {
      return { toolCalls: [{ id: "c3", name: "search_skills", input: { query: "docs" } }] };
    }
    return { text: "There is a docs-guide skill available.", finishReason: "stop" };
  }

  if (turnIndex === 4) {
    if (!seenToolThisTurn("load_skill")) {
      return { toolCalls: [{ id: "c4", name: "load_skill", input: { name: "docs-guide" } }] };
    }
    return { text: "Loaded the docs-guide skill.", finishReason: "stop" };
  }

  if (turnIndex === 5) {
    if (!seenToolThisTurn("query_state")) {
      return { toolCalls: [{ id: "c5", name: "query_state", input: { path: "$" } }] };
    }
    return { text: "docs-site has no Redux store, so the state is empty.", finishReason: "stop" };
  }

  return { text: "Unknown turn.", finishReason: "stop" };
};

