// collectAxFrames against a fake DebuggerSession whose `send`
// answers by (method, sessionId).
import { describe, it, expect, vi } from "vitest";
import { collectAxFrames } from "./panel-frame-snapshot";
import { createDebuggerFrames } from "./debugger-frames";
import type { DebuggerSession } from "./debugger-tools.types";

function fakeSession(
  answer: (method: string, sessionId: string | undefined, params: unknown) => unknown,
  frames = createDebuggerFrames(),
): DebuggerSession {
  return {
    send: vi.fn((_tabId: number, method: string, params?: Record<string, unknown>, sessionId?: string) => {
      const value = answer(method, sessionId, params);
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }),
    frames,
  } as unknown as DebuggerSession;
}

describe("collectAxFrames", () => {
  it("returns one frame for a page with no iframe", async () => {
    const session = fakeSession((method) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top", url: "http://a.test" }, childFrames: [] } };
      if (method === "Accessibility.getFullAXTree") return { nodes: [{ nodeId: "1" }] };
      return {};
    });

    const out = await collectAxFrames(session, 1);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ refPrefix: "", frameId: "top", origin: "http://a.test" });
    expect(out[0].owner).toBeUndefined();
    expect(out[0].unavailable).toBeUndefined();
  });

  it("adds a same-site frame with its owner and origin", async () => {
    const session = fakeSession((method, sessionId, params) => {
      if (method === "Page.getFrameTree") {
        return {
          frameTree: {
            frame: { id: "top", url: "http://a.test" },
            childFrames: [{ frame: { id: "child", url: "http://a.test/inner" }, childFrames: [] }],
          },
        };
      }
      if (method === "DOM.getFrameOwner") return { backendNodeId: 42 };
      if (method === "Accessibility.getFullAXTree") {
        const p = params as { frameId?: string } | undefined;
        return { nodes: [{ nodeId: p?.frameId === "child" ? "c1" : "t1" }] };
      }
      return {};
    });

    const out = await collectAxFrames(session, 1);

    expect(out).toHaveLength(2);
    const child = out.find((f) => f.frameId === "child")!;
    expect(child.refPrefix).toBe("");
    expect(child.origin).toBe("http://a.test");
    expect(child.owner).toEqual({ refPrefix: "", backendNodeId: 42 });
  });

  it("adds a child target with the f<k> prefix and asks its own session", async () => {
    const frames = createDebuggerFrames();
    frames.applyEvent(1, undefined, "Target.attachedToTarget", {
      sessionId: "S1",
      targetInfo: { type: "iframe", targetId: "pay-frame", url: "http://pay.test" },
    });
    const session = fakeSession((method, sessionId) => {
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: sessionId === "S1" ? "pay-frame" : "top", url: "http://a.test" }, childFrames: [] } };
      }
      if (method === "DOM.getFrameOwner") return { backendNodeId: 7 };
      if (method === "Accessibility.getFullAXTree") {
        return { nodes: [{ nodeId: sessionId === "S1" ? "pay1" : "top1" }] };
      }
      return {};
    }, frames);

    const out = await collectAxFrames(session, 1);

    const payFrame = out.find((f) => f.refPrefix === "f1:")!;
    expect(payFrame).toBeDefined();
    expect(payFrame.sessionId).toBe("S1");
    expect(payFrame.frameId).toBe("pay-frame");
    expect(payFrame.origin).toBe("http://pay.test");
    expect(payFrame.owner).toEqual({ refPrefix: "", backendNodeId: 7 });

    const axCalls = (session.send as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      (c) => c[1] === "Accessibility.getFullAXTree",
    );
    expect(axCalls.some((c) => c[3] === "S1")).toBe(true);
  });

  it("marks a frame unavailable when getFullAXTree throws", async () => {
    const session = fakeSession((method) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top", url: "http://a.test" }, childFrames: [] } };
      if (method === "Accessibility.getFullAXTree") return new Error("boom");
      return {};
    });

    const out = await collectAxFrames(session, 1);

    expect(out[0].unavailable).toBe(true);
    expect(out[0].nodes).toEqual([]);
  });

  it("recurses into a child of a child", async () => {
    const frames = createDebuggerFrames();
    frames.applyEvent(1, undefined, "Target.attachedToTarget", {
      sessionId: "S1",
      targetInfo: { type: "iframe", targetId: "payment", url: "http://pay.test" },
    });
    frames.applyEvent(1, "S1", "Target.attachedToTarget", {
      sessionId: "S2",
      targetInfo: { type: "iframe", targetId: "bank", url: "http://bank.test" },
    });
    const session = fakeSession((method, sessionId) => {
      if (method === "Page.getFrameTree") {
        const id = sessionId === "S2" ? "bank" : sessionId === "S1" ? "payment" : "top";
        return { frameTree: { frame: { id, url: "http://x.test" }, childFrames: [] } };
      }
      if (method === "DOM.getFrameOwner") return { backendNodeId: 1 };
      if (method === "Accessibility.getFullAXTree") return { nodes: [{ nodeId: "n" }] };
      return {};
    }, frames);

    const out = await collectAxFrames(session, 1);

    const bank = out.find((f) => f.frameId === "bank")!;
    expect(bank.refPrefix).toBe("f2:");
    expect(bank.owner?.refPrefix).toBe("f1:");
  });
});
