import { describe, it, expect, vi } from "vitest";
import { runHooks } from "./run-hooks.js";
import { attachmentChipsMeta } from "../attachments/types.js";
import type { AgentHooks, PreToolResult, PostToolResult, PreToolPayload, PostToolPayload } from "./types.js";
import type { ToolContext } from "../tools/build-tools.js";

describe("runHooks dispatcher", () => {
  it("returns the untouched payload input when no handlers are registered", async () => {
    const input = { a: 1 };
    const res = await runHooks(undefined, "onPreTool", {
      name: "test_tool",
      input,
      ctx: {} as ToolContext,
    });
    expect(res).toEqual({ decision: "allow", reason: undefined, input });
    expect(res.input).toBe(input);
  });

  it("accepts a single handler as well as an array", async () => {
    const handler = vi.fn().mockReturnValue({ decision: "allow" });
    const hooksSingle: AgentHooks = { onPreTool: handler };
    const hooksArray: AgentHooks = { onPreTool: [handler] };

    await runHooks(hooksSingle, "onPreTool", { name: "t", input: {}, ctx: {} as ToolContext });
    expect(handler).toHaveBeenCalledTimes(1);

    await runHooks(hooksArray, "onPreTool", { name: "t", input: {}, ctx: {} as ToolContext });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("runs handlers in registration order", async () => {
    const order: number[] = [];
    const h1 = () => { order.push(1); };
    const h2 = () => { order.push(2); };
    const h3 = () => { order.push(3); };

    await runHooks({ onTurnEnd: [h1, h2, h3] }, "onTurnEnd", {
      result: { assistantText: "hi", blocks: [], stopReason: "end_turn" },
      stopReason: "end_turn",
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it("first deny short-circuits", async () => {
    const h1 = vi.fn().mockReturnValue({ decision: "allow" });
    const h2 = vi.fn().mockReturnValue({ decision: "deny", reason: "blocked by h2" });
    const h3 = vi.fn().mockReturnValue({ decision: "allow" });

    const res = await runHooks({ onPreTool: [h1, h2, h3] }, "onPreTool", {
      name: "t",
      input: {},
      ctx: {} as ToolContext,
    });

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    expect(h3).toHaveBeenCalledTimes(0);
    expect(res).toEqual({ decision: "deny", reason: "blocked by h2", input: {} });
  });

  it("deny beats ask regardless of order", async () => {
    const askHandler = () => ({ decision: "ask" as const });
    const denyHandler = () => ({ decision: "deny" as const, reason: "no" });

    const res1 = await runHooks({ onPreTool: [askHandler, denyHandler] }, "onPreTool", {
      name: "t",
      input: {},
      ctx: {} as ToolContext,
    });
    expect(res1.decision).toBe("deny");

    const res2 = await runHooks({ onPreTool: [denyHandler, askHandler] }, "onPreTool", {
      name: "t",
      input: {},
      ctx: {} as ToolContext,
    });
    expect(res2.decision).toBe("deny");
  });

  it("ask beats allow", async () => {
    const h1 = () => ({ decision: "allow" as const });
    const h2 = () => ({ decision: "ask" as const });

    const res = await runHooks({ onPreTool: [h1, h2] }, "onPreTool", {
      name: "t",
      input: {},
      ctx: {} as ToolContext,
    });
    expect(res.decision).toBe("ask");
  });

  it("modifiedInput composes in order", async () => {
    const h1 = (p: PreToolPayload): PreToolResult => ({ modifiedInput: { ...p.input, val: 1 } });
    const h2 = (p: PreToolPayload): PreToolResult => ({ modifiedInput: { ...p.input, val2: 2 } });

    const res = await runHooks({ onPreTool: [h1, h2] }, "onPreTool", {
      name: "t",
      input: { orig: true },
      ctx: {} as ToolContext,
    });

    expect(res.input).toEqual({ orig: true, val: 1, val2: 2 });
  });

  it("a throwing handler is logged and skipped", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const h1 = () => { throw new Error("boom"); };
    const h2 = vi.fn().mockReturnValue({ decision: "allow" });

    const res = await runHooks({ onPreTool: [h1, h2] }, "onPreTool", {
      name: "t",
      input: { a: 1 },
      ctx: {} as ToolContext,
    });

    expect(errSpy).toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
    expect(res.decision).toBe("allow");
    errSpy.mockRestore();
  });

  it("onPostTool returns original outcome when no handler rewrites it", async () => {
    const outcome = { content: "original" };
    const res = await runHooks({ onPostTool: [() => {}] }, "onPostTool", {
      name: "t",
      input: {},
      outcome,
    });
    expect(res).toBe(outcome);
  });

  it("onPostTool rewrites compose in order", async () => {
    const h1 = () => ({ outcome: { content: "first" } });
    const h2 = (p: PostToolPayload): PostToolResult => ({ outcome: { content: p.outcome.content + "_second" } });

    const res = await runHooks({ onPostTool: [h1, h2] }, "onPostTool", {
      name: "t",
      input: {},
      outcome: { content: "orig" },
    });
    expect(res).toEqual({ content: "first_second" });
  });

  it("onUserPrompt passes sessionId, firstInChat, and displayText to handlers", async () => {
    const handler = vi.fn();
    const payload = { parts: [{ type: "text" as const, text: "hello" }], sessionId: "s1", firstInChat: true, displayText: "hello" };
    await runHooks({ onUserPrompt: handler }, "onUserPrompt", payload);
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it("onUserPrompt concatenates attachmentChips from multiple handlers in order", async () => {
    const chipA = { providerId: "image", label: "image.png" };
    const chipB = { providerId: "folder", label: "deck" };
    const res = await runHooks({ onUserPrompt: [
      () => ({ meta: attachmentChipsMeta([chipA]) }),
      () => ({ meta: attachmentChipsMeta([chipB]) }),
    ] }, "onUserPrompt", { parts: [] });
    expect(res.meta?.attachmentChips).toEqual([chipA, chipB]);
  });

  it("onUserPrompt merges parts, userDisplayText and meta", async () => {
    const h1 = () => ({ parts: [{ type: "text" as const, text: "h1" }], meta: { a: 1 } });
    const h2 = () => ({ userDisplayText: "custom display", meta: { b: 2 } });

    const res = await runHooks({ onUserPrompt: [h1, h2] }, "onUserPrompt", {
      parts: [{ type: "text" as const, text: "orig" }],
    });

    expect(res.parts).toEqual([{ type: "text", text: "h1" }]);
    expect(res.userDisplayText).toBe("custom display");
    expect(res.meta).toEqual({ a: 1, b: 2 });
  });

  it("onPreCompact vetoes if any handler vetoes, and runs every handler", async () => {
    const h1 = vi.fn().mockReturnValue({ veto: true });
    const h2 = vi.fn().mockReturnValue({ veto: false });

    const res = await runHooks({ onPreCompact: [h1, h2] }, "onPreCompact", {
      tokens: 1000,
      percent: 0.8,
    });

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    expect(res.veto).toBe(true);
  });

  it("onTurnEnd / onPostCompact / onSessionStart are observe-only", async () => {
    const s1 = vi.fn();
    await runHooks({ onSessionStart: s1 }, "onSessionStart", { sessionId: "s123" });
    expect(s1).toHaveBeenCalledWith({ sessionId: "s123" });

    const c1 = vi.fn();
    await runHooks({ onPostCompact: c1 }, "onPostCompact", { tokensBefore: 100, tokensAfter: 50 });
    expect(c1).toHaveBeenCalledWith({ tokensBefore: 100, tokensAfter: 50 });
  });

  it("awaits a slow handler with no timeout", async () => {
    let resolved = false;
    let finishHandler: () => void = () => {};

    const slowHandler = () => new Promise<void>((resolve) => {
      finishHandler = () => {
        resolved = true;
        resolve();
      };
    });

    const promise = runHooks({ onSessionStart: slowHandler }, "onSessionStart", { sessionId: "s1" });
    expect(resolved).toBe(false);

    finishHandler();
    await promise;
    expect(resolved).toBe(true);
  });
});
