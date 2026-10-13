import { describe, it, expect, vi, type Mock } from "vitest";
import { createActionCue } from "./cue-actions.js";
import { type AgentCursor } from "./agent-cursor.js";

function makeEl(rect = { x: 10, y: 20, width: 100, height: 30 }): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON() { return {}; }
    });
  return el;
}

/** Every member is a `vi.fn`, so tests can assert on calls without an
 *  `unbound-method` warning (a plain `AgentCursor`-typed mock's methods read
 *  as real interface methods, not mocks). `destroy` was missing from this
 *  mock — a gap this typing pass surfaced, since `AgentCursor` requires it. */
type MockCursor = { [K in keyof AgentCursor]: Mock };

function createMockCursor(): MockCursor {
  return {
    moveTo: vi.fn().mockImplementation(() => Promise.resolve()),
    clickPulse: vi.fn(),
    flash: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    clear: vi.fn(),
    reset: vi.fn(),
    destroy: vi.fn(),
  };
}

describe("cue-actions", () => {
  it("T-A1 click -> move then pulse", async () => {
    const cursor = createMockCursor();
    const speed = vi.fn().mockReturnValue("slow");
    const cue = createActionCue({ getCursor: () => cursor, speed });

    const el = makeEl();
    const callOrder: string[] = [];

    cursor.moveTo.mockImplementation(() => {
      callOrder.push("moveTo");
      return Promise.resolve();
    });
    cursor.clickPulse.mockImplementation(() => {
      callOrder.push("clickPulse");
    });

    await cue(el, "click", { point: { x: 50, y: 60 } });

    expect(cursor.moveTo).toHaveBeenCalledWith({ x: 50, y: 60 }, "slow");
    expect(cursor.clickPulse).toHaveBeenCalled();
    expect(callOrder).toEqual(["moveTo", "clickPulse"]);
  });

  it("T-A2 see -> move to rect center then flash", async () => {
    const cursor = createMockCursor();
    const speed = vi.fn().mockReturnValue("slow");
    const cue = createActionCue({ getCursor: () => cursor, speed });

    const rect = { x: 20, y: 30, width: 80, height: 40 };
    await cue(undefined, "see", { rect });

    expect(cursor.moveTo).toHaveBeenCalledWith({ x: 60, y: 50 }, "slow");
    expect(cursor.flash).toHaveBeenCalledWith(rect);
  });

  it("T-A3 fill -> move only, no typing", async () => {
    const cursor = createMockCursor();
    const speed = vi.fn().mockReturnValue("slow");
    const cue = createActionCue({ getCursor: () => cursor, speed });

    const el = makeEl({ x: 10, y: 10, width: 100, height: 40 });
    const focusSpy = vi.spyOn(el, "focus");

    await cue(el, "fill", { value: "test" });

    expect(cursor.moveTo).toHaveBeenCalledWith({ x: 60, y: 30 }, "slow");
    expect(cursor.clickPulse).not.toHaveBeenCalled();
    expect(cursor.flash).not.toHaveBeenCalled();
    expect(focusSpy).toHaveBeenCalled();
  });

  it("T-A4 select -> move only", async () => {
    const cursor = createMockCursor();
    const speed = vi.fn().mockReturnValue("slow");
    const cue = createActionCue({ getCursor: () => cursor, speed });

    const el = makeEl({ x: 5, y: 5, width: 20, height: 10 });
    await cue(el, "select", { value: "val" });

    expect(cursor.moveTo).toHaveBeenCalledWith({ x: 15, y: 10 }, "slow");
    expect(cursor.clickPulse).not.toHaveBeenCalled();
    expect(cursor.flash).not.toHaveBeenCalled();
  });

  it("T-A5 speed honored", async () => {
    const cursor = createMockCursor();
    const speed = vi.fn().mockReturnValue("fast");
    const cue = createActionCue({ getCursor: () => cursor, speed });

    const el = makeEl();
    await cue(el, "click", { point: { x: 1, y: 2 } });

    expect(cursor.moveTo).toHaveBeenCalledWith({ x: 1, y: 2 }, "fast");
  });

  it("T-A6 cue errors are swallowed", async () => {
    const cursor = createMockCursor();
    cursor.moveTo.mockRejectedValue(new Error("Move failed"));
    const speed = vi.fn().mockReturnValue("slow");
    const cue = createActionCue({ getCursor: () => cursor, speed });

    const el = makeEl();
    await expect(cue(el, "click", { point: { x: 1, y: 2 } })).resolves.not.toThrow();
  });

  it("T-A7 point precedence", async () => {
    const cursor = createMockCursor();
    const speed = vi.fn().mockReturnValue("slow");
    const cue = createActionCue({ getCursor: () => cursor, speed });

    const el = makeEl({ x: 0, y: 0, width: 10, height: 10 });
    await cue(el, "click", { point: { x: 500, y: 600 }, rect: { x: 100, y: 100, width: 200, height: 200 } });

    expect(cursor.moveTo).toHaveBeenCalledWith({ x: 500, y: 600 }, "slow");
  });

  // 007: moveTo()'s animation is not interruptible, so a stop can land while
  // it is still resolving. clickPulse/flash/focus each call ensureElements()
  // too, and running one on a straggler whose owning run already ended would
  // resurrect the cursor layer right after destroy() removed it (measured
  // 2026-08-18) — so the step after moveTo is skipped once aborted.
  it("T-A8 click skips clickPulse when the signal aborts while moveTo is in flight", async () => {
    const cursor = createMockCursor();
    const speed = vi.fn().mockReturnValue("slow");
    const cue = createActionCue({ getCursor: () => cursor, speed });
    const el = makeEl();
    const controller = new AbortController();
    cursor.moveTo.mockImplementation(() => {
      controller.abort();
      return Promise.resolve();
    });

    await cue(el, "click", { point: { x: 1, y: 2 } }, controller.signal);

    expect(cursor.moveTo).toHaveBeenCalled();
    expect(cursor.clickPulse).not.toHaveBeenCalled();
  });

  it("T-A9 click still pulses when the signal never aborts", async () => {
    const cursor = createMockCursor();
    const speed = vi.fn().mockReturnValue("slow");
    const cue = createActionCue({ getCursor: () => cursor, speed });
    const el = makeEl();
    const controller = new AbortController();

    await cue(el, "click", { point: { x: 1, y: 2 } }, controller.signal);

    expect(cursor.clickPulse).toHaveBeenCalled();
  });

  it("T-A10 fill skips focus() when the signal aborts while moveTo is in flight", async () => {
    const cursor = createMockCursor();
    const speed = vi.fn().mockReturnValue("slow");
    const cue = createActionCue({ getCursor: () => cursor, speed });
    const el = makeEl();
    const focusSpy = vi.spyOn(el, "focus");
    const controller = new AbortController();
    cursor.moveTo.mockImplementation(() => {
      controller.abort();
      return Promise.resolve();
    });

    await cue(el, "fill", { point: { x: 1, y: 2 } }, controller.signal);

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("T-A12 suppresses moveTo and pulse when element has zero bounding rect", async () => {
    const cursor = createMockCursor();
    const speed = vi.fn().mockReturnValue("slow");
    const cue = createActionCue({ getCursor: () => cursor, speed });
    const el = makeEl({ x: 0, y: 0, width: 0, height: 0 });

    await cue(el, "click");

    expect(cursor.moveTo).not.toHaveBeenCalled();
    expect(cursor.clickPulse).not.toHaveBeenCalled();
  });

  it("T-A11 see also skips flash() on an already-aborted signal, for symmetry", async () => {
    // "see" never actually receives a signal in production today
    // (web-agent-dom's screenshot.ts see path passes no 4th argument), but the
    // guard is written once, generically, for every cue kind — this proves
    // it behaves the same way here rather than being click-only by accident.
    const cursor = createMockCursor();
    const speed = vi.fn().mockReturnValue("slow");
    const cue = createActionCue({ getCursor: () => cursor, speed });
    const el = makeEl();
    const controller = new AbortController();
    controller.abort();

    await cue(el, "see", { rect: { x: 5, y: 5, width: 20, height: 10 } }, controller.signal);

    expect(cursor.flash).not.toHaveBeenCalled();
  });
});
