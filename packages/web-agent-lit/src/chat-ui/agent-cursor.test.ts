import { describe, it, expect, beforeEach, vi } from "vitest";
import { agentCursor, getAgentCursor } from "./agent-cursor.js";

function layer(): HTMLElement | null {
  return document.querySelector(".wa-agent-cursor-layer");
}

function transientCount(): number {
  return (layer()?.querySelectorAll(".wa-cursor-pulse, .wa-cursor-flash").length) ?? 0;
}

function mockMatchMedia(reduce: boolean) {
  return ((q: string) => ({
    matches: reduce ? q.includes("reduce") : !q.includes("reduce"),
    media: q,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("AgentCursor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    agentCursor.clear();
  });

  it("T-C1 lazy layer — getAgentCursor() alone creates no layer; show() creates layer + pointer", () => {
    getAgentCursor();
    expect(layer()).toBeNull();

    agentCursor.show();
    expect(layer()).not.toBeNull();
    expect(layer()!.parentElement).toBe(document.body);
    expect(layer()!.getAttribute("aria-hidden")).toBe("true");
    expect(layer()!.querySelector(".wa-agent-cursor")).not.toBeNull();
  });

  it("themes the cursor stroke and flash from theme tokens", () => {
    agentCursor.show();
    const sheet = layer()!.querySelector('style[data-wa-styles="agent-cursor"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain("var(--wa-action-color-info-20opc");
    const pointer = layer()!.querySelector(".wa-agent-cursor") as HTMLElement;
    expect(pointer.innerHTML).toContain('stroke="var(--wa-text-color, white)"');
    expect(pointer.innerHTML).toContain('fill="var(--wa-action-color-info, #6750A4)"');
  });

  it("renders its stylesheet inside the cursor layer, with nothing in document.head", () => {
    agentCursor.show();
    const sheet = layer()!.querySelector('style[data-wa-styles="agent-cursor"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain(".wa-agent-cursor-layer");
    expect(sheet!.textContent).toContain("@keyframes wa-cursor-pulse");
    expect(document.getElementById("wa-agent-cursor-styles")).toBeNull();
    expect(document.head.querySelector('style[data-wa-styles="agent-cursor"]')).toBeNull();
  });

  it("clear() removes transients but keeps the stylesheet", () => {
    const orig = window.matchMedia?.bind(window);
    window.matchMedia = mockMatchMedia(false);
    try {
      agentCursor.show();
      agentCursor.clickPulse();
      agentCursor.flash({ x: 0, y: 0, width: 10, height: 10 });
      expect(layer()!.querySelectorAll(".wa-cursor-pulse").length).toBeGreaterThan(0);

      agentCursor.clear();

      expect(layer()!.querySelectorAll(".wa-cursor-pulse, .wa-cursor-flash").length).toBe(0);
      expect(layer()!.querySelector(".wa-agent-cursor")).not.toBeNull();
      expect(layer()!.querySelector('style[data-wa-styles="agent-cursor"]')).not.toBeNull();
    } finally {
      window.matchMedia = orig;
    }
  });

  it("a re-created layer gets a fresh stylesheet", () => {
    agentCursor.show();
    document.body.innerHTML = "";
    agentCursor.show();
    expect(layer()!.querySelectorAll('style[data-wa-styles="agent-cursor"]').length).toBe(1);
  });

  it("T-C2 show/hide visibility — show() adds --visible class; hide() removes it", () => {
    agentCursor.show();
    const pointer = layer()!.querySelector(".wa-agent-cursor") as HTMLElement;
    expect(pointer.classList.contains("wa-agent-cursor--visible")).toBe(true);

    agentCursor.hide();
    expect(pointer.classList.contains("wa-agent-cursor--visible")).toBe(false);
  });

  it("T-C3 reduced-motion jump — moveTo resolves immediately, sets transform, updates lastPos", async () => {
    const orig = window.matchMedia?.bind(window);
    window.matchMedia = mockMatchMedia(true);
    try {
      vi.useFakeTimers();
      const p = agentCursor.moveTo({ x: 200, y: 300 }, "fast");
      // Under reduced motion, no setTimeout — promise resolves as microtask
      await p;
      const pointer = layer()!.querySelector(".wa-agent-cursor") as HTMLElement;
      expect(pointer.style.transform).toBe("translate(200px, 300px)");
      // No timers should be pending
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      window.matchMedia = orig;
    }
  });

  it("T-C4 animated move updates lastPos & resolves — non-reduce, fake timers", async () => {
    vi.useFakeTimers();
    try {
      agentCursor.show();
      const p = agentCursor.moveTo({ x: 400, y: 300 }, "slow");

      // Promise should still be pending before timers advance
      let resolved = false;
      void p.then(() => { resolved = true; });
      // Flush microtasks without advancing timers
      await Promise.resolve();
      expect(resolved).toBe(false);

      // Advance past max duration
      vi.advanceTimersByTime(2000);
      await p;

      const pointer = layer()!.querySelector(".wa-agent-cursor") as HTMLElement;
      expect(pointer.style.transform).toBe("translate(400px, 300px)");
    } finally {
      vi.useRealTimers();
    }
  });

  it("T-C5 clear cancels in-flight motion — pending promise resolves, no timer leaks", async () => {
    vi.useFakeTimers();
    try {
      agentCursor.show();
      const p = agentCursor.moveTo({ x: 400, y: 300 }, "slow");
      agentCursor.clear();

      // clear() should settle the pending moveTo
      await p;

      // Advancing timers should trigger nothing
      vi.advanceTimersByTime(5000);
      expect(vi.getTimerCount()).toBe(0);

      // Layer transient children removed, cursor hidden
      expect(transientCount()).toBe(0);
      const pointer = document.querySelector(".wa-agent-cursor");
      expect(pointer?.classList.contains("wa-agent-cursor--visible")).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("T-C6 clickPulse + flash render and clear — transients appear then clear() removes them", () => {
    agentCursor.show();
    agentCursor.clickPulse();
    expect(layer()!.querySelector(".wa-cursor-pulse")).not.toBeNull();

    agentCursor.flash({ x: 10, y: 20, width: 100, height: 30 });
    expect(layer()!.querySelector(".wa-cursor-flash")).not.toBeNull();

    agentCursor.clear();
    expect(transientCount()).toBe(0);
  });

  it("T-C7 reduced-motion suppresses pulse/flash animation — no error, clear() empties layer", () => {
    const orig = window.matchMedia?.bind(window);
    window.matchMedia = mockMatchMedia(true);
    try {
      agentCursor.show();
      expect(() => agentCursor.clickPulse()).not.toThrow();
      expect(() => agentCursor.flash({ x: 0, y: 0, width: 50, height: 20 })).not.toThrow();
      // Under reduced motion, clickPulse/flash skip animation (return early)
      expect(transientCount()).toBe(0);
      expect(() => agentCursor.clear()).not.toThrow();
      expect(transientCount()).toBe(0);
    } finally {
      window.matchMedia = orig;
    }
  });

  // destroy() removes the layer; clear() still leaves it.
  describe("destroy()", () => {
    it("removes the layer from the document", () => {
      agentCursor.show();
      expect(layer()).not.toBeNull();

      agentCursor.destroy();
      expect(document.querySelector(".wa-agent-cursor-layer")).toBeNull();
    });

    it("cancels a pending move", async () => {
      vi.useFakeTimers();
      try {
        agentCursor.show();
        const p = agentCursor.moveTo({ x: 400, y: 300 }, "slow");
        agentCursor.destroy();
        // destroy() settles the pending moveTo
        await p;
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("a cue after destroy() rebuilds the layer", () => {
      agentCursor.show();
      agentCursor.destroy();
      expect(layer()).toBeNull();

      agentCursor.show();
      expect(layer()).not.toBeNull();
      expect(layer()!.querySelector(".wa-agent-cursor")).not.toBeNull();
      expect(layer()!.querySelector('style[data-wa-styles="agent-cursor"]')).not.toBeNull();
    });

    it("clear() still leaves the layer in place", () => {
      agentCursor.show();
      agentCursor.clickPulse();
      expect(layer()!.querySelector(".wa-cursor-pulse")).not.toBeNull();

      agentCursor.clear();
      expect(layer()).not.toBeNull();
      expect(layer()!.querySelector(".wa-agent-cursor")).not.toBeNull();
      expect(layer()!.querySelector('style[data-wa-styles="agent-cursor"]')).not.toBeNull();
    });
  });
});
