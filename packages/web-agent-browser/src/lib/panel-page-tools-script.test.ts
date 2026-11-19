import { describe, it, expect, vi } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { createScriptPageTools } from "./panel-page-tools-script";
import { testVfs } from "./test-vfs";
import { createDebuggerSession } from "./debugger-session";

function toolCtx(): ToolContext {
  return { app: {}, signal: new AbortController().signal };
}

/** Mirrors debugger-session.test.ts:4-26 — the session is real, only the
 *  chrome.* boundary is faked. */
function fakeDebuggerApi(answers: Record<string, unknown> = {}) {
  let detachListener: (tabId: number, reason: string) => void = () => {};
  let eventListener: (tabId: number, method: string, params: unknown, sessionId?: string) => void = () => {};
  const api = {
    attach: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn((_tabId: number, method: string) =>
      Promise.resolve(
        method in answers ? answers[method] : method === "Runtime.evaluate" ? { result: { type: "string", value: "UA/1" } } : {},
      ),
    ),
    tabUrl: vi.fn().mockResolvedValue("http://localhost:10040/checkout.html"),
    onDetach: vi.fn((l: typeof detachListener) => {
      detachListener = l;
    }),
    onEvent: vi.fn((l: typeof eventListener) => {
      eventListener = l;
    }),
  };
  return {
    api,
    fireDetach: (t: number, r: string) => detachListener(t, r),
    fireEvent: (t: number, m: string, p: unknown, sessionId?: string) => eventListener(t, m, p, sessionId),
  };
}

async function debuggingSession(answers: Record<string, unknown> = {}) {
  const { api, fireDetach, fireEvent } = fakeDebuggerApi(answers);
  const session = createDebuggerSession(api);
  await session.start(1);
  vi.clearAllMocks();
  return { api, session, fireDetach, fireEvent };
}

describe("page_eval", () => {
  it("gate before anything else", async () => {
    const { api } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    vi.clearAllMocks();
    const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageEval.execute({ tabId: 1, code: "return 1" }, toolCtx());
    expect(result).toEqual({
      content: "Debugging is not started on tab #1. Call start_debugging first.",
      isError: true,
    });
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it("the Cancel gate", async () => {
    const { session, fireDetach } = await debuggingSession();
    fireDetach(1, "canceled_by_user");
    const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageEval.execute({ tabId: 1, code: "return 1" }, toolCtx());
    expect(result).toEqual({
      content: "Debugging stopped on tab #1: the user pressed Cancel on Chrome's bar. Call start_debugging to continue.",
      isError: true,
    });
  });

  it("wraps the code in an async IIFE and awaits it", async () => {
    const { api, session } = await debuggingSession({
      "Runtime.evaluate": { result: { type: "string", value: "Hello" } },
    });
    const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    await pageEval.execute({ tabId: 1, code: "return document.title" }, toolCtx());
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.evaluate", {
      expression: "(async () => {\nreturn document.title\n})()",
      awaitPromise: true,
      returnByValue: false,
    });
  });

  it("a string result is formatted", async () => {
    const { session } = await debuggingSession({
      "Runtime.evaluate": { result: { type: "string", value: "Hello" } },
    });
    const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageEval.execute({ tabId: 1, code: "return 'Hello'" }, toolCtx());
    expect(result).toEqual({ content: "Result type: string\n\nHello" });
  });

  it("an object result is described in the page", async () => {
    const { api, session } = await debuggingSession({
      "Runtime.evaluate": { result: { type: "object", className: "Foo", objectId: "OID" } },
      "Runtime.callFunctionOn": { result: { value: { kind: "Foo", text: "[Foo] …" } } },
    });
    const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageEval.execute({ tabId: 1, code: "return foo" }, toolCtx());
    expect(api.sendCommand).toHaveBeenCalledWith(
      1,
      "Runtime.callFunctionOn",
      expect.objectContaining({ objectId: "OID" }),
    );
    const call = api.sendCommand.mock.calls.find((c) => c[1] === "Runtime.callFunctionOn")!;
    expect(typeof call[2].functionDeclaration).toBe("string");
    expect(result).toEqual({ content: "Result type: Foo\n\n[Foo] …" });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.releaseObject", { objectId: "OID" });
  });

  it("falls back to the RemoteObject's own words when the handle is gone", async () => {
    const { session, api } = await debuggingSession({
      "Runtime.evaluate": { result: { type: "object", className: "Foo", objectId: "OID", description: "a Foo" } },
    });
    api.sendCommand.mockImplementation((_tabId: number, method: string) => {
      if (method === "Runtime.callFunctionOn") return Promise.reject(new Error("gone"));
      if (method === "Runtime.evaluate") {
        return Promise.resolve({ result: { type: "object", className: "Foo", objectId: "OID", description: "a Foo" } });
      }
      return Promise.resolve({});
    });
    const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageEval.execute({ tabId: 1, code: "return foo" }, toolCtx());
    expect(result).toEqual({ content: "Result type: Foo\n\na Foo" });
  });

  it("a primitive needs no callFunctionOn", async () => {
    const { api, session } = await debuggingSession({
      "Runtime.evaluate": { result: { type: "number", value: 7 } },
    });
    const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageEval.execute({ tabId: 1, code: "return 7" }, toolCtx());
    expect(result).toEqual({ content: "Result type: number\n\n7" });
    expect(api.sendCommand).not.toHaveBeenCalledWith(1, "Runtime.callFunctionOn", expect.anything());
  });

  it("undefined, null, NaN and a bigint", async () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ type: "undefined" }, "undefined", "undefined"],
      [{ type: "object", subtype: "null", value: null }, "null", "null"],
      [{ type: "number", value: NaN, description: "NaN" }, "number", "NaN"],
      [{ type: "bigint", unserializableValue: "10n" }, "bigint", "10n"],
    ];
    for (const [result, kind, text] of cases) {
      const { session } = await debuggingSession({ "Runtime.evaluate": { result } });
      const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });
      const out = await pageEval.execute({ tabId: 1, code: "return x" }, toolCtx());
      expect(out).toEqual({ content: `Result type: ${kind}\n\n${text}` });
    }
  });

  it("a thrown error uses the same wording as before", async () => {
    const { session } = await debuggingSession({
      "Runtime.evaluate": {
        exceptionDetails: { exception: { className: "TypeError", description: "TypeError: boom\n    at <anonymous>:1:1" } },
      },
    });
    const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageEval.execute({ tabId: 1, code: "throw new TypeError('boom')" }, toolCtx());
    expect(result).toEqual({ content: "The code threw TypeError: boom", isError: true });
  });

  it("a thrown non-Error", async () => {
    const { session } = await debuggingSession({
      "Runtime.evaluate": { exceptionDetails: { exception: { type: "string", value: "nope" } } },
    });
    const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageEval.execute({ tabId: 1, code: "throw 'nope'" }, toolCtx());
    expect(result).toEqual({ content: "The code threw Error: nope", isError: true });
  });

  it("stops a script past its timeout", async () => {
    vi.useFakeTimers();
    try {
      const { api, session } = await debuggingSession();
      // Matches the External-facts-verified behaviour: the pending
      // Runtime.evaluate REJECTS only once Runtime.terminateExecution lands.
      let rejectEvaluate: (err: unknown) => void = () => {};
      api.sendCommand.mockImplementation((_tabId: number, method: string) => {
        if (method === "Runtime.evaluate") {
          return new Promise((_resolve, reject) => {
            rejectEvaluate = reject;
          });
        }
        if (method === "Runtime.terminateExecution") {
          rejectEvaluate(new Error("Execution was terminated"));
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });
      const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

      const exec = pageEval.execute({ tabId: 1, code: "while (true) {}", timeoutMs: 2000 }, toolCtx());
      await vi.advanceTimersByTimeAsync(2000);
      const result = await exec;

      expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.terminateExecution", undefined);
      expect(result).toEqual({
        content: "page_eval stopped the script after 2000 ms: it was still running. The tab is responsive again.",
        isError: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a rejection that is not a stop reports the tab", async () => {
    const { api, session } = await debuggingSession();
    api.sendCommand.mockImplementation((_tabId: number, method: string) => {
      if (method === "Runtime.evaluate") return Promise.reject(new Error("boom"));
      return Promise.resolve({});
    });
    const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageEval.execute({ tabId: 1, code: "return 1" }, toolCtx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("page_eval could not run on tab #1:");
  });

  it("timeoutMs out of range runs nothing", async () => {
    const { api, session } = await debuggingSession();
    const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageEval.execute({ tabId: 1, code: "return 1", timeoutMs: 900000 }, toolCtx());
    expect(result).toEqual({
      content: "Invalid timeoutMs: 900000. Must be between 1000 and 300000.",
      isError: true,
    });
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it("empty code runs nothing", async () => {
    const { api, session } = await debuggingSession();
    const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageEval.execute({ tabId: 1, code: "   " }, toolCtx());
    expect(result).toEqual({ content: "No code provided to page_eval.", isError: true });
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it("truncates a long result", async () => {
    const long = "Y".repeat(10000);
    const { session } = await debuggingSession({ "Runtime.evaluate": { result: { type: "string", value: long } } });
    const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageEval.execute({ tabId: 1, code: "return x" }, toolCtx());
    expect(result.content?.endsWith("…(output truncated)")).toBe(true);
  });

  describe("frame", () => {
    it("leaves page_eval without frame exactly as it is", async () => {
      const { api, session } = await debuggingSession({
        "Runtime.evaluate": { result: { type: "string", value: "Hello" } },
      });
      const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

      await pageEval.execute({ tabId: 1, code: "return 1" }, toolCtx());

      expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.evaluate", {
        expression: "(async () => {\nreturn 1\n})()",
        awaitPromise: true,
        returnByValue: false,
      });
    });

    it("runs page_eval in a child session for a cross-site iframe ref", async () => {
      const { api, session, fireEvent } = await debuggingSession({
        "DOM.describeNode": { node: { nodeName: "IFRAME", frameId: "pay-frame" } },
        "Runtime.evaluate": { result: { type: "string", value: "http://pay.test" } },
      });
      fireEvent(1, "Target.attachedToTarget", {
        sessionId: "S1",
        targetInfo: { type: "iframe", targetId: "pay-frame", url: "http://pay.test" },
      });
      const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

      const result = await pageEval.execute({ tabId: 1, code: "return location.origin", frame: "5" }, toolCtx());

      expect(result).toEqual({ content: "Result type: string\n\nhttp://pay.test" });
      expect(api.sendCommand).toHaveBeenCalledWith(
        1,
        "Runtime.evaluate",
        { expression: "(async () => {\nreturn location.origin\n})()", awaitPromise: true, returnByValue: false },
        "S1",
      );
    });

    it("runs page_eval in the frame's context for a same-site iframe ref", async () => {
      const { api, session, fireEvent } = await debuggingSession({
        "DOM.describeNode": { node: { nodeName: "IFRAME", frameId: "same-site-frame" } },
        "Runtime.evaluate": { result: { type: "string", value: "Shipping" } },
      });
      fireEvent(1, "Runtime.executionContextCreated", {
        context: { id: 55, origin: "http://localhost:10040", auxData: { isDefault: true, frameId: "same-site-frame" } },
      });
      const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

      const result = await pageEval.execute({ tabId: 1, code: "return document.title", frame: "6" }, toolCtx());

      expect(result).toEqual({ content: "Result type: string\n\nShipping" });
      // No sessionId: the same-site frame's world is reached by contextId
      // alone, on the TOP target — so this call carries only 3 arguments.
      expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.evaluate", {
        expression: "(async () => {\nreturn document.title\n})()",
        awaitPromise: true,
        returnByValue: false,
        contextId: 55,
      });
    });

    it("rejects a frame ref that is not an iframe", async () => {
      const { session } = await debuggingSession({
        "DOM.describeNode": { node: { nodeName: "BUTTON" } },
      });
      const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

      const result = await pageEval.execute({ tabId: 1, code: "return 1", frame: "5" }, toolCtx());

      expect(result).toEqual({
        content: "frame must be the ref of an iframe from page_snapshot.",
        isError: true,
      });
    });

    it("terminates in the frame's own session on timeout", async () => {
      vi.useFakeTimers();
      try {
        const { api, session, fireEvent } = await debuggingSession({
          "DOM.describeNode": { node: { nodeName: "IFRAME", frameId: "pay-frame" } },
        });
        fireEvent(1, "Target.attachedToTarget", {
          sessionId: "S1",
          targetInfo: { type: "iframe", targetId: "pay-frame", url: "http://pay.test" },
        });
        let rejectEvaluate: (err: unknown) => void = () => {};
        api.sendCommand.mockImplementation((_tabId: number, method: string) => {
          if (method === "DOM.describeNode") return Promise.resolve({ node: { nodeName: "IFRAME", frameId: "pay-frame" } });
          if (method === "Runtime.evaluate") {
            return new Promise((_resolve, reject) => {
              rejectEvaluate = reject;
            });
          }
          if (method === "Runtime.terminateExecution") {
            rejectEvaluate(new Error("Execution was terminated"));
            return Promise.resolve({});
          }
          return Promise.resolve({});
        });
        const [pageEval] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

        const exec = pageEval.execute({ tabId: 1, code: "while (true) {}", timeoutMs: 2000, frame: "5" }, toolCtx());
        await vi.advanceTimersByTimeAsync(2000);
        const result = await exec;

        expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.terminateExecution", undefined, "S1");
        expect(result).toEqual({
          content: "page_eval stopped the script after 2000 ms: it was still running. The tab is responsive again.",
          isError: true,
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("page_fetch", () => {
  it("sends one evaluate carrying the JSON arguments", async () => {
    const { api, session } = await debuggingSession({
      "Runtime.evaluate": {
        result: { value: { kind: "response", status: 200, statusText: "OK", contentType: "application/json", body: "{}" } },
      },
    });
    const [, pageFetch] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    await pageFetch.execute({ tabId: 1, url: "/api/items" }, toolCtx());
    const call = api.sendCommand.mock.calls.find((c) => c[1] === "Runtime.evaluate")!;
    expect((call[2].expression as string).startsWith("(")).toBe(true);
    expect(call[2].expression as string).toContain('{"url":"/api/items","method":"GET"}');
    expect(call[2].awaitPromise).toBe(true);
    expect(call[2].returnByValue).toBe(true);
  });

  it("a 200 response keeps today's text", async () => {
    const { session } = await debuggingSession({
      "Runtime.evaluate": {
        result: { value: { kind: "response", status: 200, statusText: "OK", contentType: "application/json", body: '{"ok":true}' } },
      },
    });
    const [, pageFetch] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageFetch.execute({ tabId: 1, url: "/api/items" }, toolCtx());
    expect(result).toEqual({ content: 'Status: 200 OK\nContent-Type: application/json\n\n{"ok":true}' });
  });

  it("cross-origin keeps today's text", async () => {
    const { session } = await debuggingSession({
      "Runtime.evaluate": {
        result: { value: { kind: "cross-origin", requested: "https://other.test", pageOrigin: "http://localhost:10040" } },
      },
    });
    const [, pageFetch] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageFetch.execute({ tabId: 1, url: "https://other.test/x" }, toolCtx());
    expect(result.isError).toBe(true);
    expect(result.content?.endsWith("The page_fetch tool only allows same-origin requests.")).toBe(true);
  });

  it("invalid-url and throw", async () => {
    const { session: s1 } = await debuggingSession({
      "Runtime.evaluate": { result: { value: { kind: "invalid-url", url: "bad", message: 'Invalid URL "bad": boom' } } },
    });
    const [, invalidTool] = createScriptPageTools({ vfs: testVfs(), debuggerSession: s1 });
    const invalid = await invalidTool.execute({ tabId: 1, url: "bad" }, toolCtx());
    expect(invalid).toEqual({ content: 'Invalid URL "bad": boom', isError: true });

    const { session: s2 } = await debuggingSession({
      "Runtime.evaluate": { result: { value: { kind: "throw", name: "TypeError", message: "boom" } } },
    });
    const [, throwTool] = createScriptPageTools({ vfs: testVfs(), debuggerSession: s2 });
    const thrown = await throwTool.execute({ tabId: 1, url: "/x" }, toolCtx());
    expect(thrown).toEqual({ content: "The request failed: TypeError: boom", isError: true });
  });

  it("an empty url sends nothing", async () => {
    const { api, session } = await debuggingSession();
    const [, pageFetch] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageFetch.execute({ tabId: 1, url: "  " }, toolCtx());
    expect(result).toEqual({ content: "No URL or path provided to page_fetch.", isError: true });
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it("the deadline reports today's timeout text", async () => {
    vi.useFakeTimers();
    try {
      const { api, session } = await debuggingSession();
      api.sendCommand.mockImplementation((_tabId: number, method: string) => {
        if (method === "Runtime.evaluate") return new Promise(() => {});
        return Promise.resolve({});
      });
      const [, pageFetch] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

      const exec = pageFetch.execute({ tabId: 1, url: "/api/items" }, toolCtx());
      await vi.advanceTimersByTimeAsync(10000);
      const result = await exec;
      expect(result).toEqual({
        content: "page_fetch timed out after 10000 ms waiting for tab #1.",
        isError: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("truncates over maxChars", async () => {
    const long = "z".repeat(10000);
    const { session } = await debuggingSession({
      "Runtime.evaluate": {
        result: { value: { kind: "response", status: 200, statusText: "OK", contentType: "text/plain", body: long } },
      },
    });
    const [, pageFetch] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageFetch.execute({ tabId: 1, url: "/x" }, toolCtx());
    expect(result.content?.endsWith("…(output truncated)")).toBe(true);
  });
});

describe("page_console", () => {
  it("reads the session buffer, not the page", async () => {
    const { session, fireEvent } = await debuggingSession();
    fireEvent(1, "Runtime.consoleAPICalled", { type: "error", args: [{ type: "string", value: "boom" }] });
    fireEvent(1, "Runtime.consoleAPICalled", { type: "warning", args: [{ type: "string", value: "careful" }] });
    const [, , pageConsole] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageConsole.execute({ tabId: 1 }, toolCtx());
    expect(result).toEqual({ content: "Console (2 matching):\n[error] boom\n[warn] careful" });
  });

  it("filters by level", async () => {
    const { session, fireEvent } = await debuggingSession();
    fireEvent(1, "Runtime.consoleAPICalled", { type: "error", args: [{ type: "string", value: "boom" }] });
    fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "info line" }] });
    const [, , pageConsole] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageConsole.execute({ tabId: 1, level: "error" }, toolCtx());
    expect(result).toEqual({ content: "Console (1 matching):\n[error] boom" });
  });

  it("limits to the newest N", async () => {
    const { session, fireEvent } = await debuggingSession();
    for (let i = 0; i < 5; i++) {
      fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: `m${i}` }] });
    }
    const [, , pageConsole] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageConsole.execute({ tabId: 1, limit: 2 }, toolCtx());
    expect(result).toEqual({ content: "Console (5 matching):\n[log] m3\n[log] m4" });
  });

  it("reports dropped entries", async () => {
    const { session, fireEvent } = await debuggingSession();
    for (let i = 0; i < 205; i++) {
      fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: `m${i}` }] });
    }
    const [, , pageConsole] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageConsole.execute({ tabId: 1, limit: 1 }, toolCtx());
    expect(result.content?.startsWith("5 earlier entries fell out of the 200-entry buffer.")).toBe(true);
  });

  it("reports a reload once", async () => {
    const { session, fireEvent } = await debuggingSession();
    fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "before" }] });
    const lastSeenDocumentId = new Map<number, string>();
    const [, , pageConsole] = createScriptPageTools({ debuggerSession: session, lastSeenDocumentId });

    const first = await pageConsole.execute({ tabId: 1 }, toolCtx());
    expect(first.content?.startsWith("The page reloaded")).toBe(false);

    fireEvent(1, "Page.frameNavigated", { frame: { url: "http://localhost:10040/next.html" } });
    fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "after" }] });

    const second = await pageConsole.execute({ tabId: 1 }, toolCtx());
    expect(second.content?.startsWith("The page reloaded since the last read; entries below start from that load.")).toBe(
      true,
    );
    expect(second.content).toContain("after");
    expect(second.content).not.toContain("before");
  });

  it("an iframe navigation does not clear the buffer", async () => {
    const { session, fireEvent } = await debuggingSession();
    fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "before" }] });
    fireEvent(1, "Page.frameNavigated", { frame: { parentId: "main", url: "http://localhost:10040/iframe.html" } });
    const [, , pageConsole] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const result = await pageConsole.execute({ tabId: 1 }, toolCtx());
    expect(result.content).toContain("before");
  });

  it("invalid level and invalid limit", async () => {
    const { session } = await debuggingSession();
    const [, , pageConsole] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const badLevel = await pageConsole.execute({ tabId: 1, level: "verbose" }, toolCtx());
    expect(badLevel).toEqual({
      content: "Invalid level: verbose. Use log, info, warn or error, or omit it for all.",
      isError: true,
    });

    const badLimit = await pageConsole.execute({ tabId: 1, limit: 0 }, toolCtx());
    expect(badLimit).toEqual({
      content: "Invalid limit: 0. Must be between 1 and 200.",
      isError: true,
    });
  });

  it("an empty buffer names why", async () => {
    const { session } = await debuggingSession();
    const [, , pageConsole] = createScriptPageTools({ vfs: testVfs(), debuggerSession: session });

    const plain = await pageConsole.execute({ tabId: 1 }, toolCtx());
    expect(plain).toEqual({ content: "No console output captured for this document." });

    const filtered = await pageConsole.execute({ tabId: 1, level: "warn" }, toolCtx());
    expect(filtered).toEqual({ content: "No console output captured for this document at level warn." });
  });
});
