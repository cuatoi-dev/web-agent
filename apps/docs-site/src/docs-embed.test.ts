// @vitest-environment jsdom
import { beforeAll, describe, it, expect, vi } from "vitest";
import type {
  AgentHooks, HookHandler, MessagePart,
  UserPromptPayload, UserPromptResult,
  PreToolPayload, PostToolPayload, TurnEndPayload,
  PreCompactPayload, PostCompactPayload, SessionStartPayload,
  ToolContext, ToolOutcome,
} from "@cuatoi/web-agent-core";

// This file needs a DOM (docs-site's project-wide vitest environment is
// "node" — see vitest.config.ts); the per-file override above pulls in jsdom
// (added as a devDependency for this test) without changing the other tests.
//
// Docs-site wires `bubble.hooks.onUserPrompt` to prepend the current
// page location as context. <docs-agent-widget> must exist in the DOM BEFORE
// the module is imported so wireAgent()'s top-level querySelector finds it —
// a static top-level import would be hoisted ahead of any DOM setup in this
// file, so a dynamic import is used instead (see cat-store's index.test.ts).
// One test drives every scenario: re-importing would redefine the
// `web-agent-bubble`/`docs-agent-widget` custom elements and throw
// (customElements.define allows a name only once), and `onUserPrompt` reads
// `window.location.hash` fresh on every call, so no re-import is needed to
// exercise both cases. This also means `wireAgent()` runs exactly once for
// the whole file — a second `import()` is a no-op (module cache) and would
// leave any OTHER `<docs-agent-widget>` instance unwired — so every scenario
// below, including 011's B-8/B-9 additions, reuses this single `bubble`.
//
// The DOM setup and the import live in `beforeAll`, not in the test: the
// cold transform of the whole `web-agent-lit` source graph counts against
// the 5000ms test timeout, and under a parallel `pnpm -r test` run it grows
// past it. A hook has its own timeout budget, set here
// to 30s, so the transform no longer risks the test's 5s.
//
// The bubble is now hosted inside <docs-agent-widget>'s shadow root
// rather than appended directly to the light DOM.
describe("docs-embed hooks wiring", () => {
  beforeAll(async () => {
    document.body.innerHTML = "<docs-agent-widget></docs-agent-widget>";
    window.location.hash = "#/guides/tools";
    await import("./docs-embed");
  }, 30_000);

  it("wires bubble.hooks.onUserPrompt to prepend the current page context, with a guides-index fallback", () => {
    const widget = document.querySelector("docs-agent-widget");
    const bubble = widget?.bubble ?? document.querySelector("web-agent-bubble");
    expect(bubble).not.toBeNull();
    const hooks = bubble!.hooks!;
    expect(typeof hooks.onUserPrompt).toBe("function");

    const onUserPrompt = hooks.onUserPrompt as HookHandler<UserPromptPayload, UserPromptResult>;
    const original: MessagePart[] = [{ type: "text", text: "How do I add a tool?" }];
    const withHash = onUserPrompt({ parts: original }) as UserPromptResult;
    expect(withHash.parts![0]).toEqual({ type: "text", text: "[Current Page Context: #/guides/tools]\n\n" });
    expect(withHash.parts![1]).toBe(original[0]);
    // B-8: the injected context header must not reach the visible transcript —
    // userDisplayText carries only what the reader typed.
    expect(withHash.userDisplayText).toBe("How do I add a tool?");

    window.location.hash = "";
    const withoutHash = onUserPrompt({ parts: [] }) as UserPromptResult;
    const withoutHashPart0 = withoutHash.parts![0] as Extract<MessagePart, { type: "text" }>;
    expect(withoutHashPart0.text).toContain("#/guides/index");
    expect(withoutHash.userDisplayText).toBeUndefined();

    // B-9: docs-site had zero lifecycle-hook console output. Restore parity
    // with cat-store's agent-panel-config.ts — all seven hooks, one
    // `[docs-site hooks]`-prefixed line each, observe-only (no truthy return)
    // except onUserPrompt, which already composes its context-injection reply.
    const names: (keyof AgentHooks)[] = ["onSessionStart", "onUserPrompt", "onPreTool", "onPostTool", "onTurnEnd", "onPreCompact", "onPostCompact"];
    for (const name of names) {
      expect(typeof hooks[name]).toBe("function");
    }

    const ctx = { app: {}, signal: new AbortController().signal } as ToolContext;
    const onSessionStart = hooks.onSessionStart as HookHandler<SessionStartPayload, void>;
    const onPreTool = hooks.onPreTool as HookHandler<PreToolPayload, unknown>;
    const onPostTool = hooks.onPostTool as HookHandler<PostToolPayload, unknown>;
    const onTurnEnd = hooks.onTurnEnd as HookHandler<TurnEndPayload, void>;
    const onPreCompact = hooks.onPreCompact as HookHandler<PreCompactPayload, unknown>;
    const onPostCompact = hooks.onPostCompact as HookHandler<PostCompactPayload, void>;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      void onSessionStart({ sessionId: "s1" });
      void onUserPrompt({ parts: [{ type: "text", text: "hi" }] });
      onPreTool({ name: "search_docs", input: { q: "tools" }, ctx });
      onPostTool({ name: "search_docs", input: {}, outcome: { content: "ok", isError: false } });
      void onTurnEnd({ stopReason: "end_turn", result: { assistantText: "done", blocks: [], stopReason: "end_turn" } });
      onPreCompact({ tokens: 1000, percent: 0.8 });
      void onPostCompact({ tokensBefore: 1000, tokensAfter: 400 });

      expect(log).toHaveBeenCalledTimes(7);
      for (const call of log.mock.calls) {
        expect(call[0]).toMatch(/^\[docs-site hooks\] /);
      }
      // Non-onUserPrompt handlers must return nothing — run-hooks.ts treats a
      // truthy return as an opinion (deny/rewrite/veto).
      const emptyOutcome: ToolOutcome = { content: "" };
      expect(onPreTool({ name: "x", input: {}, ctx })).toBeUndefined();
      expect(onPostTool({ name: "x", input: {}, outcome: emptyOutcome })).toBeUndefined();
      expect(onPreCompact({ tokens: 0, percent: 0 })).toBeUndefined();
    } finally {
      log.mockRestore();
    }
  });
});
