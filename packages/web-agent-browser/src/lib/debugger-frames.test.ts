// 131/003 — the per-tab frame registry: auto-attached iframe targets,
// execution contexts and the ref → frame map. No chrome API involved.
import { describe, it, expect } from "vitest";
import { createDebuggerFrames, originOf } from "./debugger-frames";

describe("createDebuggerFrames (131/003)", () => {
  it("numbers children 1, 2, 3 in attach order", () => {
    const frames = createDebuggerFrames();
    frames.applyEvent(1, undefined, "Target.attachedToTarget", { sessionId: "S1", targetInfo: { type: "iframe", targetId: "F1", url: "http://a.test" } });
    frames.applyEvent(1, undefined, "Target.attachedToTarget", { sessionId: "S2", targetInfo: { type: "iframe", targetId: "F2", url: "http://b.test" } });
    frames.applyEvent(1, undefined, "Target.attachedToTarget", { sessionId: "S3", targetInfo: { type: "iframe", targetId: "F3", url: "http://c.test" } });

    expect(frames.children(1).map((c) => c.k)).toEqual([1, 2, 3]);
  });

  it("ignores a non-iframe target", () => {
    const frames = createDebuggerFrames();
    const result = frames.applyEvent(1, undefined, "Target.attachedToTarget", {
      sessionId: "S1",
      targetInfo: { type: "worker", targetId: "W1", url: "http://a.test" },
    });

    expect(result).toBeUndefined();
    expect(frames.children(1)).toEqual([]);
  });

  it("returns the new child so the caller can enable its domains", () => {
    const frames = createDebuggerFrames();
    const result = frames.applyEvent(1, undefined, "Target.attachedToTarget", {
      sessionId: "S1",
      targetInfo: { type: "iframe", targetId: "F1", url: "http://a.test" },
    });

    expect(result?.sessionId).toBe("S1");
  });

  it("records the parent session of a nested child", () => {
    const frames = createDebuggerFrames();
    const top = frames.applyEvent(1, undefined, "Target.attachedToTarget", {
      sessionId: "S1",
      targetInfo: { type: "iframe", targetId: "F1", url: "http://a.test" },
    });
    const nested = frames.applyEvent(1, "S1", "Target.attachedToTarget", {
      sessionId: "S2",
      targetInfo: { type: "iframe", targetId: "F2", url: "http://b.test" },
    });

    expect(top?.parentSessionId).toBeUndefined();
    expect("parentSessionId" in (top ?? {})).toBe(false);
    expect(nested?.parentSessionId).toBe("S1");
  });

  it("drops a child and its contexts on detach, and does not reuse its k", () => {
    const frames = createDebuggerFrames();
    frames.applyEvent(1, undefined, "Target.attachedToTarget", { sessionId: "A", targetInfo: { type: "iframe", targetId: "FA", url: "http://a.test" } });
    frames.applyEvent(1, undefined, "Target.attachedToTarget", { sessionId: "B", targetInfo: { type: "iframe", targetId: "FB", url: "http://b.test" } });
    frames.applyEvent(1, "A", "Runtime.executionContextCreated", { context: { id: 5, origin: "http://a.test", auxData: { isDefault: true, frameId: "FA" } } });

    frames.applyEvent(1, undefined, "Target.detachedFromTarget", { sessionId: "A" });
    frames.applyEvent(1, undefined, "Target.attachedToTarget", { sessionId: "C", targetInfo: { type: "iframe", targetId: "FC", url: "http://c.test" } });

    expect(frames.childByNumber(1, 1)).toBeUndefined();
    expect(frames.childBySession(1, "A")).toBeUndefined();
    expect(frames.contextById(1, "A", 5)).toBeUndefined();
    expect(frames.childByNumber(1, 3)?.sessionId).toBe("C");
  });

  it("keeps only the default context per frame", () => {
    const frames = createDebuggerFrames();
    frames.applyEvent(1, undefined, "Runtime.executionContextCreated", {
      context: { id: 1, origin: "http://a.test", auxData: { isDefault: true, frameId: "F1" } },
    });
    frames.applyEvent(1, undefined, "Runtime.executionContextCreated", {
      context: { id: 2, origin: "http://a.test", auxData: { isDefault: false, frameId: "F1" } },
    });

    expect(frames.defaultContext(1, undefined, "F1")?.contextId).toBe(1);
    expect(frames.contextById(1, undefined, 1)?.contextId).toBe(1);
    expect(frames.contextById(1, undefined, 2)?.contextId).toBe(2);
  });

  it("updates child origin from its main frame default context", () => {
    const frames = createDebuggerFrames();
    frames.applyEvent(1, undefined, "Target.attachedToTarget", {
      sessionId: "S1", targetInfo: { type: "iframe", targetId: "F-pay", url: "about:blank" },
    });
    frames.applyEvent(1, "S1", "Runtime.executionContextCreated", {
      context: { id: 1, origin: "http://pay.test", auxData: { isDefault: true, frameId: "F-pay" } },
    });
    expect(frames.childBySession(1, "S1")?.origin).toBe("http://pay.test");
  });

  it("does not update child origin when frameId does not match child targetId", () => {
    const frames = createDebuggerFrames();
    frames.applyEvent(1, undefined, "Target.attachedToTarget", {
      sessionId: "S1", targetInfo: { type: "iframe", targetId: "F-pay", url: "http://old.test/" },
    });
    frames.applyEvent(1, "S1", "Runtime.executionContextCreated", {
      context: { id: 1, origin: "http://nested.test", auxData: { isDefault: true, frameId: "F-nested" } },
    });
    expect(frames.childBySession(1, "S1")?.origin).toBe("http://old.test");
  });

  it("does not update child origin for non-default context", () => {
    const frames = createDebuggerFrames();
    frames.applyEvent(1, undefined, "Target.attachedToTarget", {
      sessionId: "S1", targetInfo: { type: "iframe", targetId: "F-pay", url: "http://old.test/" },
    });
    frames.applyEvent(1, "S1", "Runtime.executionContextCreated", {
      context: { id: 1, origin: "http://new.test", auxData: { isDefault: false, frameId: "F-pay" } },
    });
    expect(frames.childBySession(1, "S1")?.origin).toBe("http://old.test");
  });

  it("does not update child origin when context origin is empty", () => {
    const frames = createDebuggerFrames();
    frames.applyEvent(1, undefined, "Target.attachedToTarget", {
      sessionId: "S1", targetInfo: { type: "iframe", targetId: "F-pay", url: "http://old.test/" },
    });
    frames.applyEvent(1, "S1", "Runtime.executionContextCreated", {
      context: { id: 1, origin: "", auxData: { isDefault: true, frameId: "F-pay" } },
    });
    expect(frames.childBySession(1, "S1")?.origin).toBe("http://old.test");
  });

  it("updates child origin on later navigation to a new default context", () => {
    const frames = createDebuggerFrames();
    frames.applyEvent(1, undefined, "Target.attachedToTarget", {
      sessionId: "S1", targetInfo: { type: "iframe", targetId: "F-pay", url: "about:blank" },
    });
    frames.applyEvent(1, "S1", "Runtime.executionContextCreated", {
      context: { id: 1, origin: "http://pay.test", auxData: { isDefault: true, frameId: "F-pay" } },
    });
    expect(frames.childBySession(1, "S1")?.origin).toBe("http://pay.test");
    frames.applyEvent(1, "S1", "Runtime.executionContextCreated", {
      context: { id: 2, origin: "http://next.test", auxData: { isDefault: true, frameId: "F-pay" } },
    });
    expect(frames.childBySession(1, "S1")?.origin).toBe("http://next.test");
  });

  it("clears a session's contexts on executionContextsCleared", () => {
    const frames = createDebuggerFrames();
    frames.applyEvent(1, "S1", "Runtime.executionContextCreated", {
      context: { id: 1, origin: "http://a.test", auxData: { isDefault: true, frameId: "F1" } },
    });
    frames.applyEvent(1, "S1", "Runtime.executionContextsCleared", {});

    expect(frames.contextById(1, "S1", 1)).toBeUndefined();
  });

  it("remembers a ref's frame and merges across snapshots", () => {
    const frames = createDebuggerFrames();
    frames.rememberRefs(1, [{ ref: "23", frameId: "F1" }]);
    frames.rememberRefs(1, [{ ref: "24", sessionId: "S1", frameId: "F2" }]);

    expect(frames.refFrame(1, "23")).toEqual({ frameId: "F1" });
    expect(frames.refFrame(1, "24")).toEqual({ sessionId: "S1", frameId: "F2" });

    frames.rememberRefs(1, [{ ref: "23", frameId: "F3" }]);
    expect(frames.refFrame(1, "23")).toEqual({ frameId: "F3" });
  });

  it("forgetRefs clears refs but keeps children", () => {
    const frames = createDebuggerFrames();
    frames.applyEvent(1, undefined, "Target.attachedToTarget", { sessionId: "A", targetInfo: { type: "iframe", targetId: "FA", url: "http://a.test" } });
    frames.rememberRefs(1, [{ ref: "23", frameId: "F1" }]);

    frames.forgetRefs(1);

    expect(frames.refFrame(1, "23")).toBeUndefined();
    expect(frames.childBySession(1, "A")).toBeDefined();
  });

  it("forget drops the whole tab", () => {
    const frames = createDebuggerFrames();
    frames.applyEvent(1, undefined, "Target.attachedToTarget", { sessionId: "A", targetInfo: { type: "iframe", targetId: "FA", url: "http://a.test" } });
    frames.rememberRefs(1, [{ ref: "23", frameId: "F1" }]);

    frames.forget(1);

    expect(frames.children(1)).toEqual([]);
    expect(frames.refFrame(1, "23")).toBeUndefined();
  });
});

describe("originOf", () => {
  it("parses a URL's origin", () => {
    expect(originOf("http://pay.test/checkout?x=1")).toBe("http://pay.test");
  });

  it("returns '' for an unparseable or missing URL", () => {
    expect(originOf("not a url")).toBe("");
    expect(originOf(undefined)).toBe("");
    expect(originOf("")).toBe("");
  });
});
