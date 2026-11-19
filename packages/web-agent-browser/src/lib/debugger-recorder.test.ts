import { describe, expect, it, vi } from "vitest";
import { createDebuggerSession } from "./debugger-session";
import { createDebuggerRecorder, RECORDER_BINDING, RECORDER_WORLD_NAME } from "./debugger-recorder";
import type { HelperWorlds } from "./types";
import type { RecordedStep } from "./recorder.types";

/** Mirrors debugger-session.test.ts / debugger-helper-world.test.ts: mock only
 *  `chrome.debugger`, run the real session, so the real frames registry and
 *  the real onChildAttached/onBindingCalled/onNavigatedWithinDocument wiring
 *  are exercised. */
function fakeDebuggerApi(answers: Record<string, unknown> = {}) {
  let eventListener: (tabId: number, method: string, params: unknown, sessionId?: string) => void = () => {};
  const api = {
    attach: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn((_tabId: number, method: string, params?: Record<string, unknown>, sessionId?: string) => {
      if (method in answers) {
        const a = answers[method];
        return typeof a === "function"
          ? Promise.resolve().then(() => (a as (p?: Record<string, unknown>, s?: string) => unknown)(params, sessionId))
          : Promise.resolve(a);
      }
      if (method === "Runtime.evaluate") return Promise.resolve({ result: { type: "string", value: "UA/1" } });
      if (method === "Page.getFrameTree") return Promise.resolve({ frameTree: { frame: { id: "top-frame" } } });
      return Promise.resolve({});
    }),
    tabUrl: vi.fn().mockResolvedValue("http://localhost:10040/checkout.html"),
    onDetach: vi.fn(),
    onEvent: vi.fn((l: typeof eventListener) => {
      eventListener = l;
    }),
  };
  return {
    api,
    fireEvent: (t: number, m: string, p: unknown, sessionId?: string) => eventListener(t, m, p, sessionId),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function startedSession(answers: Record<string, unknown> = {}) {
  const { api, fireEvent } = fakeDebuggerApi(answers);
  const session = createDebuggerSession(api);
  await session.start(1);
  return { api, session, fireEvent };
}

function attachChild(fireEvent: (t: number, m: string, p: unknown, s?: string) => void, sessionId: string, targetId: string, url: string, tabId = 1) {
  fireEvent(tabId, "Target.attachedToTarget", { sessionId, targetInfo: { type: "iframe", targetId, url } });
}

function context(fireEvent: (t: number, m: string, p: unknown, s?: string) => void, tabId: number, sessionId: string | undefined, id: number, frameId: string, origin: string, isDefault: boolean, name: string) {
  fireEvent(tabId, "Runtime.executionContextCreated", { context: { id, auxData: { isDefault, frameId }, origin, name } }, sessionId);
}

function fakeHelper(frames: string[] = []): HelperWorlds {
  return {
    source: vi.fn().mockResolvedValue(""),
    parseRef: () => ({ ok: false, error: "not stubbed" }),
    resolve: () => ({ ok: false, error: "not stubbed" }),
    frameChain: vi.fn().mockResolvedValue([]),
    frameChainAt: vi.fn().mockResolvedValue(frames),
    call: vi.fn().mockRejectedValue(new Error("not stubbed")),
    callOnDocument: vi.fn().mockRejectedValue(new Error("not stubbed")),
    selectScreenshotTarget: vi.fn().mockRejectedValue(new Error("selectScreenshotTarget not stubbed")),
    highlightScreenshotRef: vi.fn().mockRejectedValue(new Error("highlightScreenshotRef not stubbed")),
    centre: vi.fn().mockRejectedValue(new Error("not stubbed")),
    box: vi.fn().mockRejectedValue(new Error("not stubbed")),
    forget: vi.fn(),
    forgetFrame: vi.fn(),
  };
}

function step(over: Partial<RecordedStep> = {}): RecordedStep {
  return { recordingId: "r1", seq: 0, kind: "click", line: "click button \"Pay\"", ...over };
}

describe("createDebuggerRecorder — install", () => {
  it("arms the top target: addBinding then addScriptToEvaluateOnNewDocument, with the start call baked in", async () => {
    const { api, session } = await startedSession({ "Page.addScriptToEvaluateOnNewDocument": { identifier: "1" } });
    const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve("/*recorder*/"));

    await recorder.install(1, "r1");

    expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.addBinding", { name: RECORDER_BINDING, executionContextName: RECORDER_WORLD_NAME });
    expect(api.sendCommand).toHaveBeenCalledWith(
      1,
      "Page.addScriptToEvaluateOnNewDocument",
      expect.objectContaining({
        source: expect.stringContaining('__waRec.start("r1")'),
        worldName: RECORDER_WORLD_NAME,
        runImmediately: true,
      }),
    );
  });

  it("arms every existing child, with that child's own sessionId", async () => {
    const { api, session, fireEvent } = await startedSession({ "Page.addScriptToEvaluateOnNewDocument": { identifier: "1" } });
    attachChild(fireEvent, "S1", "F1", "http://pay.test/");
    await flush();
    api.sendCommand.mockClear();

    const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve("/*recorder*/"));
    await recorder.install(1, "r1");

    expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.addBinding", { name: RECORDER_BINDING, executionContextName: RECORDER_WORLD_NAME }, "S1");
    expect(api.sendCommand).toHaveBeenCalledWith(
      1,
      "Page.addScriptToEvaluateOnNewDocument",
      expect.objectContaining({ worldName: RECORDER_WORLD_NAME }),
      "S1",
    );
  });

  it("a child attaching AFTER install is armed with the same recording id", async () => {
    const { api, session, fireEvent } = await startedSession({ "Page.addScriptToEvaluateOnNewDocument": { identifier: "1" } });
    const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve("/*recorder*/"));
    await recorder.install(1, "r1");
    api.sendCommand.mockClear();

    attachChild(fireEvent, "S2", "F2", "http://pay.test/");
    await flush();

    expect(api.sendCommand).toHaveBeenCalledWith(
      1,
      "Page.addScriptToEvaluateOnNewDocument",
      expect.objectContaining({ source: expect.stringContaining('__waRec.start("r1")') }),
      "S2",
    );
  });

  it("a send that rejects during arm does not fail install, and other sessions still arm", async () => {
    const { session, fireEvent, api } = await startedSession({
      "Runtime.addBinding": (_p?: Record<string, unknown>, sessionId?: string) => {
        // Only the TOP target's arm fails; the child session must still arm.
        if (sessionId === undefined) throw new Error("detached");
        return {};
      },
      "Page.addScriptToEvaluateOnNewDocument": { identifier: "1" },
    });
    attachChild(fireEvent, "S1", "F1", "http://pay.test/");
    await flush();
    const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve("/*recorder*/"));

    await expect(recorder.install(1, "r1")).resolves.toBeUndefined();
    expect(api.sendCommand).not.toHaveBeenCalledWith(1, "Page.addScriptToEvaluateOnNewDocument", expect.anything());
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Page.addScriptToEvaluateOnNewDocument", expect.anything(), "S1");
  });
});

describe("createDebuggerRecorder — onStep", () => {
  it("a binding call from the top frame carries no frames and no frameOrigin", async () => {
    const { session, fireEvent } = await startedSession();
    context(fireEvent, 1, undefined, 201, "top-frame", "", false, RECORDER_WORLD_NAME);
    const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
    const onStep = vi.fn();
    recorder.onStep(onStep);
    await recorder.install(1, "r1");

    fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: JSON.stringify(step()), executionContextId: 201 }, undefined);
    await flush();

    expect(onStep).toHaveBeenCalledTimes(1);
    const [tabId, s] = onStep.mock.calls[0] as [number, RecordedStep];
    expect(tabId).toBe(1);
    expect(s.frames).toBeUndefined();
    expect(s.frameOrigin).toBeUndefined();
  });

  it("a binding call from a same-site iframe whose recorder context reports origin \"\" reads the DEFAULT context's origin", async () => {
    const { session, fireEvent } = await startedSession();
    // The frame's own default (main-world) context — origin is the real one.
    context(fireEvent, 1, undefined, 101, "F1", "http://localhost:10040", true, "");
    // The recorder's isolated-world context for the SAME frame — measured
    // 2026-09-20: origin "" in almost every case.
    context(fireEvent, 1, undefined, 102, "F1", "", false, RECORDER_WORLD_NAME);
    const recorder = createDebuggerRecorder(session, fakeHelper(["#shipping"]), () => Promise.resolve(""));
    const onStep = vi.fn();
    recorder.onStep(onStep);
    await recorder.install(1, "r1");

    fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: JSON.stringify(step()), executionContextId: 102 }, undefined);
    await flush();

    const [, s] = onStep.mock.calls[0] as [number, RecordedStep];
    expect(s.frameOrigin).toBe("http://localhost:10040");
    expect(s.frames).toEqual(["#shipping"]);
  });

  it("a binding call from a child session carries the child's frames and origin", async () => {
    const { session, fireEvent } = await startedSession();
    attachChild(fireEvent, "S1", "F-pay", "http://pay.test/");
    await flush();
    const recorder = createDebuggerRecorder(session, fakeHelper(["#payment"]), () => Promise.resolve(""));
    const onStep = vi.fn();
    recorder.onStep(onStep);
    await recorder.install(1, "r1");

    fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: JSON.stringify(step()), executionContextId: 999 }, "S1");
    await flush();

    const [, s] = onStep.mock.calls[0] as [number, RecordedStep];
    expect(s.frames).toEqual(["#payment"]);
    expect(s.frameOrigin).toBe("http://pay.test");
  });

  it("a child session attached with about:blank picks up origin from later default context", async () => {
    const { session, fireEvent } = await startedSession();
    attachChild(fireEvent, "S1", "F-pay", "about:blank");
    await flush();
    context(fireEvent, 1, "S1", 301, "F-pay", "http://pay.test", true, "");
    const recorder = createDebuggerRecorder(session, fakeHelper(["#payment"]), () => Promise.resolve(""));
    const onStep = vi.fn();
    recorder.onStep(onStep);
    await recorder.install(1, "r1");
    fireEvent(1, "Runtime.bindingCalled", {
      name: RECORDER_BINDING, payload: JSON.stringify(step()), executionContextId: 301,
    }, "S1");
    await flush();
    expect(onStep).toHaveBeenCalledTimes(1);
    const [, recorded] = onStep.mock.calls[0] as [number, RecordedStep];
    expect(recorded.frameOrigin).toBe("http://pay.test");
    expect(recorded.frames).toEqual(["#payment"]);
  });

  it("a binding call with a stale recordingId does not fire", async () => {
    const { session, fireEvent } = await startedSession();
    const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
    const onStep = vi.fn();
    recorder.onStep(onStep);
    await recorder.install(1, "r1");

    fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: JSON.stringify(step({ recordingId: "stale" })), executionContextId: 1 }, undefined);
    await flush();

    expect(onStep).not.toHaveBeenCalled();
  });

  it("a binding call with unparsable JSON does not fire and does not throw", async () => {
    const { session, fireEvent } = await startedSession();
    const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
    const onStep = vi.fn();
    recorder.onStep(onStep);
    await recorder.install(1, "r1");

    expect(() =>
      fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: "not json", executionContextId: 1 }, undefined),
    ).not.toThrow();
    await flush();

    expect(onStep).not.toHaveBeenCalled();
  });

  it("a binding call for another binding name is ignored", async () => {
    const { session, fireEvent } = await startedSession();
    const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
    const onStep = vi.fn();
    recorder.onStep(onStep);
    await recorder.install(1, "r1");

    fireEvent(1, "Runtime.bindingCalled", { name: "__someOtherBinding", payload: JSON.stringify(step()), executionContextId: 1 }, undefined);
    await flush();

    expect(onStep).not.toHaveBeenCalled();
  });
});

describe("createDebuggerRecorder — pause / resume", () => {
  it("evaluates .pause() / .resume() once per context named web-agent-recorder", async () => {
    const { api, session, fireEvent } = await startedSession();
    context(fireEvent, 1, undefined, 201, "top-frame", "", false, RECORDER_WORLD_NAME);
    attachChild(fireEvent, "S1", "F-pay", "http://pay.test/");
    await flush();
    context(fireEvent, 1, "S1", 301, "F-pay", "", false, RECORDER_WORLD_NAME);
    const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
    await recorder.install(1, "r1");
    api.sendCommand.mockClear();

    await recorder.pause(1);
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.evaluate", { expression: expect.stringContaining(".pause()"), contextId: 201 });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.evaluate", { expression: expect.stringContaining(".pause()"), contextId: 301 }, "S1");

    api.sendCommand.mockClear();
    await recorder.resume(1);
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.evaluate", { expression: expect.stringContaining(".resume()"), contextId: 201 });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.evaluate", { expression: expect.stringContaining(".resume()"), contextId: 301 }, "S1");
  });
});

describe("createDebuggerRecorder — uninstall", () => {
  it("stops every context, then removes the script and the binding per session", async () => {
    const { api, session, fireEvent } = await startedSession({
      "Page.addScriptToEvaluateOnNewDocument": { identifier: "id-1" },
    });
    context(fireEvent, 1, undefined, 201, "top-frame", "", false, RECORDER_WORLD_NAME);
    attachChild(fireEvent, "S1", "F-pay", "http://pay.test/");
    await flush();
    const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
    await recorder.install(1, "r1");
    api.sendCommand.mockClear();

    await recorder.uninstall(1);

    expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.evaluate", { expression: expect.stringContaining(".stop()"), contextId: 201 });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Page.removeScriptToEvaluateOnNewDocument", { identifier: "id-1" });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.removeBinding", { name: RECORDER_BINDING });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Page.removeScriptToEvaluateOnNewDocument", { identifier: "id-1" }, "S1");
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.removeBinding", { name: RECORDER_BINDING }, "S1");
  });

  it("uninstall on an unknown tab resolves and sends nothing", async () => {
    const { api, session } = await startedSession();
    const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
    api.sendCommand.mockClear();

    await expect(recorder.uninstall(99)).resolves.toBeUndefined();
    expect(api.sendCommand).not.toHaveBeenCalled();
  });
});

describe("createDebuggerRecorder — onRoute", () => {
  it("Page.navigatedWithinDocument in the top frame fires onRoute with the path and a pre-assigned seq", async () => {
    const { session, fireEvent } = await startedSession();
    const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
    const onRoute = vi.fn();
    recorder.onRoute(onRoute);
    await recorder.install(1, "r1");

    fireEvent(1, "Page.navigatedWithinDocument", { frameId: "top-frame", url: "http://h/cart?x=1#y" }, undefined);

    expect(onRoute).toHaveBeenCalledWith(1, "/cart?x=1#y", expect.any(Number));
  });

  it("the same event in a child frame does not fire onRoute", async () => {
    const { session, fireEvent } = await startedSession();
    const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
    const onRoute = vi.fn();
    recorder.onRoute(onRoute);
    await recorder.install(1, "r1");

    fireEvent(1, "Page.navigatedWithinDocument", { frameId: "F-pay", url: "http://pay.test/checkout" }, undefined);

    expect(onRoute).not.toHaveBeenCalled();
  });

  it("a route step's seq never collides with a step's own seq, however they interleave", async () => {
    const { session, fireEvent } = await startedSession({
      "Page.addScriptToEvaluateOnNewDocument": { identifier: "1" },
    });
    context(fireEvent, 1, undefined, 201, "top-frame", "http://h", true, "");
    context(fireEvent, 1, undefined, 202, "top-frame", "", false, RECORDER_WORLD_NAME);
    const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
    const onStep = vi.fn();
    const onRoute = vi.fn();
    recorder.onStep(onStep);
    recorder.onRoute(onRoute);
    await recorder.install(1, "r1");

    // The route event is delivered (synchronously) BEFORE the step's own
    // async frame-chain lookup resolves and reaches its listeners — the
    // exact race that once overwrote a step in the mock e2e run.
    fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: JSON.stringify(step({ seq: 0 })), executionContextId: 202 }, undefined);
    fireEvent(1, "Page.navigatedWithinDocument", { frameId: "top-frame", url: "http://h/cart" }, undefined);
    await flush();

    const stepSeq = (onStep.mock.calls[0] as [number, RecordedStep])[1].seq;
    const routeSeq = (onRoute.mock.calls[0] as [number, string, number])[2];
    expect(stepSeq).not.toBe(routeSeq);
  });

  describe("createDebuggerRecorder — closed shadow click", () => {
    function pendingClosed(seq: number, x: number, y: number, recordingId = "r1") {
      return JSON.stringify({ recordingId, seq, pendingClosed: { x, y } });
    }

    it("D1 top frame, scrolled", async () => {
      const { api, session, fireEvent } = await startedSession({
        "Page.getLayoutMetrics": { cssLayoutViewport: { pageX: 0, pageY: 25 } },
        "DOM.getNodeForLocation": { backendNodeId: 9 },
        "DOM.resolveNode": { object: { objectId: "obj" } },
      });
      context(fireEvent, 1, undefined, 202, "top-frame", "", false, RECORDER_WORLD_NAME);
      const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
      const onStep = vi.fn();
      recorder.onStep(onStep);
      await recorder.install(1, "r1");

      fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: pendingClosed(4, 57.5, 33), executionContextId: 202 }, undefined);
      await flush();

      expect(onStep).not.toHaveBeenCalled();
      expect(api.sendCommand).toHaveBeenCalledWith(1, "DOM.getNodeForLocation", {
        x: 57,
        y: 58,
        includeUserAgentShadowDOM: false,
        ignorePointerEventsNone: true,
      });
      expect(api.sendCommand).toHaveBeenCalledWith(1, "DOM.resolveNode", {
        backendNodeId: 9,
        executionContextId: 202,
      });
      expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.callFunctionOn", expect.objectContaining({
        objectId: "obj",
        functionDeclaration: expect.stringContaining("finishClosed(this, 4)"),
      }));
      expect(api.sendCommand).not.toHaveBeenCalledWith(1, "DOM.getFrameOwner", expect.anything());
    });

    it("D2 same-process frame", async () => {
      const { api, session, fireEvent } = await startedSession({
        "Page.getLayoutMetrics": { cssLayoutViewport: { pageX: 0, pageY: 25 } },
        "DOM.getFrameOwner": { backendNodeId: 7 },
        "DOM.getBoxModel": { model: { content: [309, 84, 0, 0, 0, 0, 0, 0] } },
        "DOM.getNodeForLocation": { backendNodeId: 9 },
        "DOM.resolveNode": { object: { objectId: "obj" } },
      });
      context(fireEvent, 1, undefined, 203, "F-ship", "", false, RECORDER_WORLD_NAME);
      const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
      await recorder.install(1, "r1");

      fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: pendingClosed(0, 57, 58), executionContextId: 203 }, undefined);
      await flush();

      expect(api.sendCommand).toHaveBeenCalledWith(1, "DOM.getFrameOwner", { frameId: "F-ship" });
      expect(api.sendCommand).toHaveBeenCalledWith(1, "DOM.getNodeForLocation", {
        x: 366,
        y: 167,
        includeUserAgentShadowDOM: false,
        ignorePointerEventsNone: true,
      });
    });

    it("D3 child session", async () => {
      const { api, session, fireEvent } = await startedSession({
        "Page.getLayoutMetrics": { cssLayoutViewport: { pageX: 0, pageY: 0 } },
        "DOM.getNodeForLocation": { backendNodeId: 9 },
        "DOM.resolveNode": { object: { objectId: "obj" } },
      });
      attachChild(fireEvent, "S1", "F-pay", "http://pay.test/");
      await flush();
      context(fireEvent, 1, "S1", 302, "F-pay", "", false, RECORDER_WORLD_NAME);
      const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
      await recorder.install(1, "r1");

      fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: pendingClosed(0, 10, 10), executionContextId: 302 }, "S1");
      await flush();

      expect(api.sendCommand).toHaveBeenCalledWith(1, "Page.getLayoutMetrics", undefined, "S1");
      expect(api.sendCommand).toHaveBeenCalledWith(1, "DOM.getNodeForLocation", expect.anything(), "S1");
      expect(api.sendCommand).toHaveBeenCalledWith(1, "DOM.resolveNode", expect.anything(), "S1");
      expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.callFunctionOn", expect.anything(), "S1");
      expect(api.sendCommand).not.toHaveBeenCalledWith(1, "DOM.getFrameOwner", expect.anything(), expect.anything());
    });

    it("D4 lookup rejects", async () => {
      const { api, session, fireEvent } = await startedSession({
        "Page.getLayoutMetrics": { cssLayoutViewport: { pageX: 0, pageY: 0 } },
        "DOM.getNodeForLocation": () => { throw new Error("No node found at given location"); },
      });
      context(fireEvent, 1, undefined, 202, "top-frame", "", false, RECORDER_WORLD_NAME);
      const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
      await recorder.install(1, "r1");

      fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: pendingClosed(4, 10, 10), executionContextId: 202 }, undefined);
      await expect(flush()).resolves.not.toThrow();

      expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.evaluate", {
        expression: expect.stringContaining("finishClosed(null, 4)"),
        contextId: 202,
      });
    });

    it("D4b Page.getLayoutMetrics rejects", async () => {
      const { api, session, fireEvent } = await startedSession({
        "Page.getLayoutMetrics": () => { throw new Error("Metrics failed"); },
      });
      context(fireEvent, 1, undefined, 202, "top-frame", "", false, RECORDER_WORLD_NAME);
      const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
      await recorder.install(1, "r1");

      fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: pendingClosed(4, 10, 10), executionContextId: 202 }, undefined);
      await expect(flush()).resolves.not.toThrow();

      expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.evaluate", {
        expression: expect.stringContaining("finishClosed(null, 4)"),
        contextId: 202,
      });
    });

    it("D4c the fallback rejects too", async () => {
      const { session, fireEvent } = await startedSession({
        "Page.getLayoutMetrics": () => { throw new Error("Metrics failed"); },
        "Runtime.evaluate": (p?: Record<string, unknown>) => {
          if (typeof p?.expression === "string" && p.expression.includes("finishClosed(null")) {
            throw new Error("fallback failed");
          }
          return { result: { type: "string", value: "UA/1" } };
        },
      });
      context(fireEvent, 1, undefined, 202, "top-frame", "", false, RECORDER_WORLD_NAME);
      const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
      await recorder.install(1, "r1");

      fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: pendingClosed(4, 10, 10), executionContextId: 202 }, undefined);
      await expect(flush()).resolves.not.toThrow();
    });

    it("D5 uninstall during a lookup", async () => {
      let resolveLookup!: (v: unknown) => void;
      const lookupPromise = new Promise((resolve) => {
        resolveLookup = resolve;
      });
      const { api, session, fireEvent } = await startedSession({
        "Page.getLayoutMetrics": { cssLayoutViewport: { pageX: 0, pageY: 0 } },
        "DOM.getNodeForLocation": () => lookupPromise,
      });
      context(fireEvent, 1, undefined, 202, "top-frame", "", false, RECORDER_WORLD_NAME);
      const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
      await recorder.install(1, "r1");

      fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: pendingClosed(4, 10, 10), executionContextId: 202 }, undefined);
      await recorder.uninstall(1);
      resolveLookup({ backendNodeId: 9 });
      await flush();

      expect(api.sendCommand).not.toHaveBeenCalledWith(1, "DOM.resolveNode", expect.anything());
      expect(api.sendCommand).not.toHaveBeenCalledWith(1, "Runtime.callFunctionOn", expect.anything());
      expect(api.sendCommand).not.toHaveBeenCalledWith(1, "Runtime.evaluate", expect.objectContaining({
        expression: expect.stringContaining("finishClosed"),
      }));
    });

    it("D6 lateness and route", async () => {
      const { session, fireEvent } = await startedSession({
        "Page.addScriptToEvaluateOnNewDocument": { identifier: "1" },
        "Page.getLayoutMetrics": { cssLayoutViewport: { pageX: 0, pageY: 0 } },
        "DOM.getNodeForLocation": { backendNodeId: 9 },
        "DOM.resolveNode": { object: { objectId: "obj" } },
      });
      context(fireEvent, 1, undefined, 201, "top-frame", "http://h", true, "");
      context(fireEvent, 1, undefined, 202, "top-frame", "", false, RECORDER_WORLD_NAME);
      const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
      const onStep = vi.fn();
      const onRoute = vi.fn();
      recorder.onStep(onStep);
      recorder.onRoute(onRoute);
      await recorder.install(1, "r1");

      fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: pendingClosed(5, 1, 1), executionContextId: 202 }, undefined);
      fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: JSON.stringify(step({ seq: 6 })), executionContextId: 202 }, undefined);
      fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: JSON.stringify(step({ seq: 5 })), executionContextId: 202 }, undefined);
      fireEvent(1, "Page.navigatedWithinDocument", { frameId: "top-frame", url: "http://h/cart" }, undefined);
      await flush();

      const step6Seq = (onStep.mock.calls[0] as [number, RecordedStep])[1].seq;
      const step5Seq = (onStep.mock.calls[1] as [number, RecordedStep])[1].seq;
      const routeSeq = (onRoute.mock.calls[0] as [number, string, number])[2];

      const base = step6Seq - 6;
      expect(step6Seq - step5Seq).toBe(1);
      expect(routeSeq).toBeGreaterThan(base + 6);
    });

    it("D7 ordinary step", async () => {
      const { api, session, fireEvent } = await startedSession();
      context(fireEvent, 1, undefined, 202, "top-frame", "", false, RECORDER_WORLD_NAME);
      const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
      await recorder.install(1, "r1");

      fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: JSON.stringify(step({ seq: 0 })), executionContextId: 202 }, undefined);
      await flush();

      expect(api.sendCommand).not.toHaveBeenCalledWith(1, "DOM.getNodeForLocation", expect.anything());
      expect(api.sendCommand).not.toHaveBeenCalledWith(1, "Page.getLayoutMetrics", expect.anything());
    });

    it("D8 stale reservation", async () => {
      const { api, session, fireEvent } = await startedSession();
      context(fireEvent, 1, undefined, 202, "top-frame", "", false, RECORDER_WORLD_NAME);
      const recorder = createDebuggerRecorder(session, fakeHelper(), () => Promise.resolve(""));
      await recorder.install(1, "r1");

      fireEvent(1, "Runtime.bindingCalled", { name: RECORDER_BINDING, payload: pendingClosed(0, 1, 1, "stale"), executionContextId: 202 }, undefined);
      await flush();

      expect(api.sendCommand).not.toHaveBeenCalledWith(1, "Page.getLayoutMetrics", expect.anything());
      expect(api.sendCommand).not.toHaveBeenCalledWith(1, "DOM.getNodeForLocation", expect.anything());
    });
  });
});
