import { describe, it, expect, vi } from "vitest";
import { createDebuggerSession } from "./debugger-session";
import { createHelperWorlds, INVALID_REF, STALE_REF } from "./debugger-helper-world";

/** Mirrors panel-page-tools-script.test.ts's fake-DebuggerApi pattern: mock
 *  only `chrome.debugger`, run the real session. */
function fakeDebuggerApi(answers: Record<string, unknown> = {}) {
  let eventListener: (tabId: number, method: string, params: unknown) => void = () => {};
  const api = {
    attach: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn((_tabId: number, method: string, params?: Record<string, unknown>, sessionId?: string) => {
      if (method in answers) {
        const a = answers[method];
        return typeof a === "function" ? Promise.resolve((a as (p: unknown, s?: string) => unknown)(params, sessionId)) : Promise.resolve(a);
      }
      if (method === "Runtime.evaluate") return Promise.resolve({ result: { type: "string", value: "UA/1" } });
      return Promise.resolve({});
    }),
    tabUrl: vi.fn().mockResolvedValue("http://localhost:10040/checkout.html"),
    onDetach: vi.fn(),
    onEvent: vi.fn((l: typeof eventListener) => {
      eventListener = l;
    }),
  };
  return { api, fireEvent: (t: number, m: string, p: unknown) => eventListener(t, m, p) };
}

async function startedSession(answers: Record<string, unknown> = {}) {
  const { api, fireEvent } = fakeDebuggerApi(answers);
  const session = createDebuggerSession(api);
  await session.start(1);
  return { api, session, fireEvent };
}

describe("createHelperWorlds — parseRef", () => {
  it("accepts a positive integer", () => {
    const { session } = { session: createDebuggerSession(fakeDebuggerApi().api) };
    const helper = createHelperWorlds(session);
    expect(helper.parseRef("23")).toEqual({ ok: true, frame: "", backendNodeId: 23 });
  });

  it("parses a frame ref", () => {
    const session = createDebuggerSession(fakeDebuggerApi().api);
    const helper = createHelperWorlds(session);
    expect(helper.parseRef("f2:14")).toEqual({ ok: true, frame: "f2", backendNodeId: 14 });
    expect(helper.parseRef("f:14")).toEqual({ ok: false, error: INVALID_REF("f:14") });
    expect(helper.parseRef("f2:0")).toEqual({ ok: false, error: INVALID_REF("f2:0") });
  });

  it("rejects a non-number", () => {
    const session = createDebuggerSession(fakeDebuggerApi().api);
    const helper = createHelperWorlds(session);
    expect(helper.parseRef("abc")).toEqual({ ok: false, error: INVALID_REF("abc") });
  });

  it("rejects 0 and a negative", () => {
    const session = createDebuggerSession(fakeDebuggerApi().api);
    const helper = createHelperWorlds(session);
    expect(helper.parseRef("0").ok).toBe(false);
    expect(helper.parseRef("-1").ok).toBe(false);
  });
});

describe("createHelperWorlds — context install and cache", () => {
  it("creates the isolated world once and evaluates the source into it, and a second call on the same tab adds none of those three again", async () => {
    const { api, session } = await startedSession({
      "Page.getFrameTree": { frameTree: { frame: { id: "FRAME1" } } },
      "Page.createIsolatedWorld": { executionContextId: 2 },
      "DOM.resolveNode": { object: { objectId: "obj1" } },
      "Runtime.callFunctionOn": { result: { value: { connected: true } } },
    });
    const loadSource = vi.fn().mockResolvedValue("SOURCE");
    const helper = createHelperWorlds(session, loadSource);

    await helper.call(1, "7", "describe", ["7"]);
    const callsAfterFirst = api.sendCommand.mock.calls.map((c) => c[1]);
    expect(callsAfterFirst).toContain("Page.getFrameTree");
    expect(callsAfterFirst).toContain("Page.createIsolatedWorld");
    expect(callsAfterFirst).toContain("Runtime.evaluate");
    const createCallsBefore = callsAfterFirst.filter((m) => m === "Page.createIsolatedWorld").length;
    const evalCallsBefore = callsAfterFirst.filter((m) => m === "Runtime.evaluate").length;

    await helper.call(1, "7", "describe", ["7"]);
    const callsAfterSecond = api.sendCommand.mock.calls.map((c) => c[1]);
    expect(callsAfterSecond.filter((m) => m === "Page.createIsolatedWorld").length).toBe(createCallsBefore);
    expect(callsAfterSecond.filter((m) => m === "Runtime.evaluate").length).toBe(evalCallsBefore);
  });

  it("loads the helper source exactly once across tabs", async () => {
    const { session: s1 } = await startedSession({
      "Page.getFrameTree": { frameTree: { frame: { id: "F1" } } },
      "Page.createIsolatedWorld": { executionContextId: 2 },
      "DOM.resolveNode": { object: { objectId: "obj1" } },
      "Runtime.callFunctionOn": { result: { value: {} } },
    });
    await s1.start(2);
    const loadSource = vi.fn().mockResolvedValue("SOURCE");
    const helper = createHelperWorlds(s1, loadSource);

    await helper.call(1, "7", "describe", ["7"]);
    await helper.call(2, "8", "describe", ["8"]);
    expect(loadSource).toHaveBeenCalledTimes(1);
  });

  it("a main-frame navigation drops the cached context, so the next call re-runs createIsolatedWorld and Runtime.evaluate", async () => {
    const { api, session, fireEvent } = await startedSession({
      "Page.getFrameTree": { frameTree: { frame: { id: "F1" } } },
      "Page.createIsolatedWorld": { executionContextId: 2 },
      "DOM.resolveNode": { object: { objectId: "obj1" } },
      "Runtime.callFunctionOn": { result: { value: {} } },
    });
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));

    await helper.call(1, "7", "describe", ["7"]);
    const worldCallsBefore = api.sendCommand.mock.calls.filter(([, m]) => m === "Page.createIsolatedWorld").length;

    fireEvent(1, "Page.frameNavigated", { frame: {} });

    await helper.call(1, "7", "describe", ["7"]);
    const worldCallsAfter = api.sendCommand.mock.calls.filter(([, m]) => m === "Page.createIsolatedWorld").length;
    expect(worldCallsAfter).toBe(worldCallsBefore + 1);
  });

  it("a CHILD-frame navigation does not drop it", async () => {
    const { api, session, fireEvent } = await startedSession({
      "Page.getFrameTree": { frameTree: { frame: { id: "F1" } } },
      "Page.createIsolatedWorld": { executionContextId: 2 },
      "DOM.resolveNode": { object: { objectId: "obj1" } },
      "Runtime.callFunctionOn": { result: { value: {} } },
    });
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));

    await helper.call(1, "7", "describe", ["7"]);
    const worldCallsBefore = api.sendCommand.mock.calls.filter(([, m]) => m === "Page.createIsolatedWorld").length;

    fireEvent(1, "Page.frameNavigated", { frame: { parentId: "x" } });

    await helper.call(1, "7", "describe", ["7"]);
    const worldCallsAfter = api.sendCommand.mock.calls.filter(([, m]) => m === "Page.createIsolatedWorld").length;
    expect(worldCallsAfter).toBe(worldCallsBefore);
  });
});

describe("createHelperWorlds — call", () => {
  it("resolveNode failure becomes the stale-ref text", async () => {
    const { session } = await startedSession({
      "Page.getFrameTree": { frameTree: { frame: { id: "F1" } } },
      "Page.createIsolatedWorld": { executionContextId: 2 },
      "DOM.resolveNode": () => {
        throw new Error("No node with given id found");
      },
    });
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    const result = await helper.call(1, "7", "describe", ["7"]);
    expect(result).toEqual({ ok: false, error: STALE_REF("7") });
  });

  it("callFunctionOn is given the plan's wrapper and the arguments in order", async () => {
    const { api, session } = await startedSession({
      "Page.getFrameTree": { frameTree: { frame: { id: "F1" } } },
      "Page.createIsolatedWorld": { executionContextId: 2 },
      "DOM.resolveNode": { object: { objectId: "obj1" } },
      "Runtime.callFunctionOn": { result: { value: { connected: true } } },
    });
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    await helper.call(1, "7", "describe", ["7"]);

    const call = api.sendCommand.mock.calls.find(([, m]) => m === "Runtime.callFunctionOn");
    expect(call?.[2]).toMatchObject({
      functionDeclaration: "function(fn, ...a) { return globalThis.__waHelper[fn](this, ...a) }",
      arguments: [{ value: "describe" }, { value: "7" }],
    });
  });

  it("releases the object handle even when the call throws", async () => {
    const { api, session } = await startedSession({
      "Page.getFrameTree": { frameTree: { frame: { id: "F1" } } },
      "Page.createIsolatedWorld": { executionContextId: 2 },
      "DOM.resolveNode": { object: { objectId: "obj1" } },
      "Runtime.callFunctionOn": () => {
        throw new Error("boom");
      },
    });
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    const result = await helper.call(1, "7", "describe", ["7"]);
    expect(result.ok).toBe(false);
    const release = api.sendCommand.mock.calls.find(([, m]) => m === "Runtime.releaseObject");
    expect(release?.[2]).toEqual({ objectId: "obj1" });
  });

  it("an exceptionDetails result becomes an error, not a value", async () => {
    const { session } = await startedSession({
      "Page.getFrameTree": { frameTree: { frame: { id: "F1" } } },
      "Page.createIsolatedWorld": { executionContextId: 2 },
      "DOM.resolveNode": { object: { objectId: "obj1" } },
      "Runtime.callFunctionOn": {
        exceptionDetails: { exception: { className: "Error", description: "Error: No option \"x\". Available: a, b.\n at <anonymous>" } },
      },
    });
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    const result = await helper.call(1, "7", "selectExecute", ["7", ["x"]]);
    expect(result).toEqual({ ok: false, error: 'No option "x". Available: a, b.' });
  });
});

describe("createHelperWorlds — a world Chrome no longer knows", () => {
  const GONE = "Cannot find context with specified id";

  /** The first call of `method` (that carries a contextId when `needsContext`)
   *  rejects with Chrome's text, as after an extension reload; later calls
   *  succeed. Each createIsolatedWorld hands out the next context id. */
  function goneOnce(method: string, ok: unknown, needsContext = false) {
    let failed = false;
    let nextContext = 1;
    return {
      "Page.getFrameTree": { frameTree: { frame: { id: "F1" } } },
      "Page.createIsolatedWorld": () => ({ executionContextId: ++nextContext }),
      "DOM.resolveNode": { object: { objectId: "obj1" } },
      "Runtime.callFunctionOn": { result: { value: { connected: true } } },
      [method]: (params: unknown) => {
        const hasContext = typeof params === "object" && params !== null && "contextId" in params;
        if (!failed && (!needsContext || hasContext)) {
          failed = true;
          throw new Error(GONE);
        }
        return ok;
      },
    };
  }

  const worldsCreated = (api: { sendCommand: { mock: { calls: unknown[][] } } }) =>
    api.sendCommand.mock.calls.filter(([, m]) => m === "Page.createIsolatedWorld").length;

  it("recreates the world and retries when installing the helper source is rejected", async () => {
    const { api, session } = await startedSession(goneOnce("Runtime.evaluate", { result: {} }, true));
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    const result = await helper.call(1, "7", "describe", ["7"]);
    expect(result).toEqual({ ok: true, value: { connected: true } });
    expect(worldsCreated(api)).toBe(2);
  });

  it("recreates the world and retries when resolveNode is rejected, instead of reporting a stale ref", async () => {
    const { api, session } = await startedSession(goneOnce("DOM.resolveNode", { object: { objectId: "obj1" } }));
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    const result = await helper.call(1, "7", "describe", ["7"]);
    expect(result).toEqual({ ok: true, value: { connected: true } });
    expect(worldsCreated(api)).toBe(2);
    const resolves = api.sendCommand.mock.calls.filter(([, m]) => m === "DOM.resolveNode");
    expect(resolves.map(([, , p]) => (p as { executionContextId: number }).executionContextId)).toEqual([2, 3]);
  });

  it("recreates the world and retries when callFunctionOn is rejected", async () => {
    const { api, session } = await startedSession(goneOnce("Runtime.callFunctionOn", { result: { value: 5 } }));
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    const result = await helper.call(1, "7", "describe", ["7"]);
    expect(result).toEqual({ ok: true, value: 5 });
    expect(worldsCreated(api)).toBe(2);
  });

  it("retries a document call the same way", async () => {
    const { api, session } = await startedSession(
      goneOnce("Runtime.evaluate", { result: { objectId: "doc1" } }, true),
    );
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    const result = await helper.callOnDocument(1, "describe", []);
    expect(result.ok).toBe(true);
    expect(worldsCreated(api)).toBe(2);
  });

  it("retries once only: a world that stays gone returns the error", async () => {
    const { api, session } = await startedSession({
      "Page.getFrameTree": { frameTree: { frame: { id: "F1" } } },
      "Page.createIsolatedWorld": { executionContextId: 2 },
      "DOM.resolveNode": () => {
        throw new Error(GONE);
      },
    });
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    const result = await helper.call(1, "7", "describe", ["7"]);
    expect(result).toEqual({ ok: false, error: GONE });
    expect(worldsCreated(api)).toBe(2);
  });

  it("does not retry any other error", async () => {
    const { api, session } = await startedSession({
      "Page.getFrameTree": { frameTree: { frame: { id: "F1" } } },
      "Page.createIsolatedWorld": { executionContextId: 2 },
      "DOM.resolveNode": { object: { objectId: "obj1" } },
      "Runtime.callFunctionOn": () => {
        throw new Error("boom");
      },
    });
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    const result = await helper.call(1, "7", "describe", ["7"]);
    expect(result).toEqual({ ok: false, error: "boom" });
    expect(worldsCreated(api)).toBe(1);
  });
});

describe("createHelperWorlds — centre and box", () => {
  it("centre scrolls first, then reads the box, and returns the quad's centre", async () => {
    const { api, session } = await startedSession({
      "DOM.scrollIntoViewIfNeeded": {},
      "DOM.getBoxModel": { model: { content: [10, 20, 30, 20, 30, 40, 10, 40], width: 20, height: 20 } },
    });
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    const result = await helper.centre(1, "7");
    expect(result).toEqual({ ok: true, x: 20, y: 30 });

    const calls = api.sendCommand.mock.calls.map((c) => c[1]);
    expect(calls.indexOf("DOM.scrollIntoViewIfNeeded")).toBeLessThan(calls.indexOf("DOM.getBoxModel"));
  });

  it("centre reports the stale text when scrollIntoViewIfNeeded rejects", async () => {
    const { session } = await startedSession({
      "DOM.scrollIntoViewIfNeeded": () => {
        throw new Error("Node is detached from document");
      },
    });
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    const result = await helper.centre(1, "7");
    expect(result).toEqual({ ok: false, error: STALE_REF("7") });
  });

  it("centre reports the stale text when getBoxModel rejects", async () => {
    const { session } = await startedSession({
      "DOM.scrollIntoViewIfNeeded": {},
      "DOM.getBoxModel": () => {
        throw new Error("Could not compute box model.");
      },
    });
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    const result = await helper.centre(1, "7");
    expect(result).toEqual({ ok: false, error: STALE_REF("7") });
  });

  it("box adds the layout-viewport scroll to the quad's top-left", async () => {
    const { session } = await startedSession({
      "DOM.getBoxModel": { model: { content: [10, 20, 30, 20, 30, 40, 10, 40], width: 20, height: 20 } },
      "Page.getLayoutMetrics": { cssLayoutViewport: { pageX: 5, pageY: 8 } },
    });
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    const result = await helper.box(1, "7");
    expect(result).toEqual({ ok: true, x: 10, y: 20, width: 20, height: 20, scrollX: 5, scrollY: 8 });
  });
});

describe("createHelperWorlds — resolve and multi-frame", () => {
  it("resolves a frame ref to its child session", async () => {
    const { session } = await startedSession();
    session.frames.applyEvent(1, undefined, "Target.attachedToTarget", {
      sessionId: "S1",
      targetInfo: { targetId: "T1", type: "iframe", url: "http://pay.test" },
    });
    session.frames.applyEvent(1, "S1", "Page.frameNavigated", {
      frame: { id: "F1", url: "http://pay.test" },
    });
    session.frames.rememberRefs(1, [{ ref: "f1:14", sessionId: "S1", frameId: "F1" }]);

    const helper = createHelperWorlds(session);
    const res = helper.resolve(1, "f1:14");
    expect(res).toEqual({
      ok: true,
      at: { sessionId: "S1", frameId: "F1", backendNodeId: 14, refPrefix: "f1:" },
    });
  });

  it("fails a frame ref whose child has detached", async () => {
    const { session } = await startedSession();
    session.frames.applyEvent(1, undefined, "Target.attachedToTarget", {
      sessionId: "S1",
      targetInfo: { targetId: "T1", type: "iframe", url: "http://pay.test" },
    });
    session.frames.rememberRefs(1, [{ ref: "f1:14", sessionId: "S1", frameId: "F1" }]);
    session.frames.applyEvent(1, undefined, "Target.detachedFromTarget", { sessionId: "S1" });

    const helper = createHelperWorlds(session);
    expect(helper.resolve(1, "f1:14")).toEqual({ ok: false, error: STALE_REF("f1:14") });
  });

  it("resolves a bare ref to the frame the snapshot recorded", async () => {
    const { session } = await startedSession();
    session.frames.rememberRefs(1, [{ ref: "23", frameId: "top" }]);
    const helper = createHelperWorlds(session);
    expect(helper.resolve(1, "23")).toEqual({
      ok: true,
      at: { frameId: "top", backendNodeId: 23, refPrefix: "" },
    });
  });

  it("creates one isolated world per frame", async () => {
    const { api, session } = await startedSession({
      "Page.createIsolatedWorld": { executionContextId: 2 },
      "DOM.resolveNode": { object: { objectId: "obj1" } },
      "Runtime.callFunctionOn": { result: { value: { ok: true } } },
    });
    session.frames.applyEvent(1, undefined, "Target.attachedToTarget", {
      sessionId: "S1",
      targetInfo: { targetId: "T1", type: "iframe", url: "http://pay.test" },
    });
    session.frames.applyEvent(1, "S1", "Page.frameNavigated", { frame: { id: "F1", url: "http://pay.test" } });
    session.frames.rememberRefs(1, [
      { ref: "1", frameId: "top" },
      { ref: "f1:2", sessionId: "S1", frameId: "F1" },
    ]);
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    await helper.call(1, "1", "describe");
    await helper.call(1, "f1:2", "describe");
    await helper.call(1, "1", "describe");

    const worldCalls = api.sendCommand.mock.calls.filter(([, m]) => m === "Page.createIsolatedWorld");
    expect(worldCalls.length).toBe(2);
    expect(worldCalls[0][3]).toBeUndefined();
    expect(worldCalls[1][3]).toBe("S1");
  });

  it("adds the owner offset once per out-of-process hop", async () => {
    const { session } = await startedSession({
      "DOM.scrollIntoViewIfNeeded": {},
      "DOM.getFrameOwner": { backendNodeId: 100 },
      "DOM.getBoxModel": (p?: unknown, sId?: string) => {
        if (sId === "S1") {
          return { model: { content: [50, 60, 69, 60, 69, 81, 50, 81], width: 19, height: 21 } };
        }
        return { model: { content: [80, 150, 380, 150, 380, 450, 80, 450], width: 300, height: 300 } };
      },
    });
    session.frames.applyEvent(1, undefined, "Target.attachedToTarget", {
      sessionId: "S1",
      targetInfo: { targetId: "T1", type: "iframe", url: "http://pay.test" },
    });
    session.frames.applyEvent(1, "S1", "Page.frameNavigated", { frame: { id: "F1", url: "http://pay.test" } });
    session.frames.rememberRefs(1, [{ ref: "f1:7", sessionId: "S1", frameId: "F1" }]);

    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    const res = await helper.centre(1, "f1:7");
    expect(res).toEqual({ ok: true, x: 139.5, y: 220.5 });
  });

  it("adds no offset for a same-process frame", async () => {
    const { api, session } = await startedSession({
      "DOM.scrollIntoViewIfNeeded": {},
      "DOM.getBoxModel": { model: { content: [10, 20, 30, 20, 30, 40, 10, 40], width: 20, height: 20 } },
    });
    session.frames.rememberRefs(1, [{ ref: "7", frameId: "SAME_FRAME" }]);
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    const res = await helper.centre(1, "7");
    expect(res).toEqual({ ok: true, x: 20, y: 30 });
    const ownerCalls = api.sendCommand.mock.calls.filter(([, m]) => m === "DOM.getFrameOwner");
    expect(ownerCalls.length).toBe(0);
  });

  it("builds a frameLocator chain top-down", async () => {
    const { session } = await startedSession({
      "Page.createIsolatedWorld": { executionContextId: 2 },
      "DOM.resolveNode": { object: { objectId: "obj1" } },
      "DOM.getFrameOwner": (p: unknown) => {
        const frameId = (p as { frameId?: string })?.frameId;
        return { backendNodeId: frameId === "T2" ? 20 : 10 };
      },
      "Runtime.callFunctionOn": (p: unknown, sessionId?: string) => {
        const args = (p as { arguments?: { value?: unknown }[] })?.arguments;
        const fn = args?.[0]?.value;
        if (fn === "iframeSelector") {
          const selector = sessionId === "S1" ? "iframe#bank" : "iframe#payment";
          return { result: { value: { selector } } };
        }
        return { result: { value: {} } };
      },
    });
    session.frames.applyEvent(1, undefined, "Target.attachedToTarget", {
      sessionId: "S1",
      targetInfo: { targetId: "T1", type: "iframe", url: "http://pay.test" },
    });
    session.frames.applyEvent(1, "S1", "Page.frameNavigated", { frame: { id: "F1", url: "http://pay.test" } });
    session.frames.applyEvent(1, "S1", "Target.attachedToTarget", {
      sessionId: "S2",
      targetInfo: { targetId: "T2", type: "iframe", url: "http://bank.test" },
    });
    session.frames.applyEvent(1, "S2", "Page.frameNavigated", { frame: { id: "F2", url: "http://bank.test" } });

    session.frames.rememberRefs(1, [
      { ref: "10", frameId: "top" },
      { ref: "f1:20", sessionId: "S1", frameId: "F1" },
      { ref: "f2:99", sessionId: "S2", frameId: "F2" },
    ]);

    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    const chain = await helper.frameChain(1, "f2:99");
    expect(chain).toEqual(["iframe#payment", "iframe#bank"]);
  });

  it("returns an empty chain for a top-frame ref", async () => {
    const { api, session } = await startedSession();
    session.frames.rememberRefs(1, [{ ref: "7", frameId: "top" }]);
    const helper = createHelperWorlds(session);
    const chain = await helper.frameChain(1, "7");
    expect(chain).toEqual([]);
    const cdpCallsAfter = api.sendCommand.mock.calls.filter(([, m]) => m.startsWith("DOM.") || m.startsWith("Page."));
    expect(cdpCallsAfter.filter(([, m]) => m === "DOM.resolveNode").length).toBe(0);
  });

  it("forgetFrame drops only that frame's world", async () => {
    const { api, session } = await startedSession({
      "Page.createIsolatedWorld": { executionContextId: 2 },
      "DOM.resolveNode": { object: { objectId: "obj1" } },
      "Runtime.callFunctionOn": { result: { value: { ok: true } } },
    });
    session.frames.rememberRefs(1, [{ ref: "7", frameId: "F1" }]);
    const helper = createHelperWorlds(session, vi.fn().mockResolvedValue("SOURCE"));
    await helper.call(1, "7", "describe");
    const countBefore = api.sendCommand.mock.calls.filter(([, m]) => m === "Page.createIsolatedWorld").length;

    helper.forgetFrame(1, undefined, "OTHER_FRAME");
    await helper.call(1, "7", "describe");
    expect(api.sendCommand.mock.calls.filter(([, m]) => m === "Page.createIsolatedWorld").length).toBe(countBefore);

    helper.forgetFrame(1, undefined, "F1");
    await helper.call(1, "7", "describe");
    expect(api.sendCommand.mock.calls.filter(([, m]) => m === "Page.createIsolatedWorld").length).toBe(countBefore + 1);
  });
});
