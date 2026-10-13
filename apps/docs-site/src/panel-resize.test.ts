// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  clampPanelSize,
  resizeFromGrip,
  enablePanelResize,
  MIN_WIDTH,
  MIN_HEIGHT,
  VIEWPORT_MARGIN_X,
  VIEWPORT_MARGIN_Y,
} from "./panel-resize";

const VIEWPORT = { width: 1280, height: 800 };

describe("resizeFromGrip (003)", () => {
  it("a zero-distance drag returns the start size", () => {
    expect(resizeFromGrip({ width: 500, height: 600 }, 0, 0, VIEWPORT)).toEqual({
      width: 500,
      height: 600,
    });
  });

  it("dragging up and left grows the box by the pointer distance", () => {
    expect(resizeFromGrip({ width: 480, height: 640 }, -100, -40, VIEWPORT)).toEqual({
      width: 580,
      height: 680,
    });
  });

  it("dragging down and right shrinks the box by the pointer distance", () => {
    expect(resizeFromGrip({ width: 480, height: 640 }, 60, 40, VIEWPORT)).toEqual({
      width: 420,
      height: 600,
    });
  });

  it("the result never goes below the minimum", () => {
    expect(resizeFromGrip({ width: 480, height: 640 }, 400, 400, VIEWPORT)).toEqual({
      width: MIN_WIDTH,
      height: MIN_HEIGHT,
    });
  });

  it("the result never goes past the window less its margins", () => {
    expect(resizeFromGrip({ width: 480, height: 640 }, -5000, -5000, VIEWPORT)).toEqual({
      width: VIEWPORT.width - VIEWPORT_MARGIN_X,
      height: VIEWPORT.height - VIEWPORT_MARGIN_Y,
    });
  });

  it("width and height clamp independently", () => {
    expect(resizeFromGrip({ width: 480, height: 640 }, -5000, 400, VIEWPORT)).toEqual({
      width: VIEWPORT.width - VIEWPORT_MARGIN_X,
      height: MIN_HEIGHT,
    });
  });

  it("the minimum wins when the window is too small for it", () => {
    const tinyViewport = { width: 320, height: 300 };
    for (const [dx, dy] of [[0, 0], [100, 100], [-100, -100], [500, 500]] as const) {
      const size = resizeFromGrip({ width: 480, height: 640 }, dx, dy, tinyViewport);
      expect(size.width).toBe(MIN_WIDTH);
      expect(size.height).toBe(MIN_HEIGHT);
      expect(size.width).toBeGreaterThanOrEqual(MIN_WIDTH);
      expect(size.height).toBeGreaterThanOrEqual(MIN_HEIGHT);
    }
  });

  it("a fractional start size is rounded to whole pixels", () => {
    const size = resizeFromGrip({ width: 480, height: 614.4 }, -0.5, -0.5, VIEWPORT);
    expect(Number.isInteger(size.width)).toBe(true);
    expect(Number.isInteger(size.height)).toBe(true);
  });
});

describe("clampPanelSize (003)", () => {
  it("a size already inside the bounds is returned unchanged", () => {
    expect(clampPanelSize({ width: 500, height: 500 }, VIEWPORT)).toEqual({
      width: 500,
      height: 500,
    });
  });

  it("the returned size is always inside the bounds", () => {
    for (const size of [
      { width: 0, height: 0 },
      { width: 99999, height: 99999 },
      { width: 360, height: 99999 },
      { width: 99999, height: 420 },
    ]) {
      const clamped = clampPanelSize(size, VIEWPORT);
      expect(clamped.width).toBeGreaterThanOrEqual(MIN_WIDTH);
      expect(clamped.height).toBeGreaterThanOrEqual(MIN_HEIGHT);
      expect(clamped.width).toBeLessThanOrEqual(VIEWPORT.width - VIEWPORT_MARGIN_X);
      expect(clamped.height).toBeLessThanOrEqual(VIEWPORT.height - VIEWPORT_MARGIN_Y);
    }
  });
});

describe("enablePanelResize (002)", () => {
  function stubBubble(): HTMLElement {
    const bubble = document.createElement("web-agent-bubble");
    // 003: enablePanelResize reads and writes the bubble's OPEN shadow root.
    const root = bubble.attachShadow({ mode: "open" });
    const container = document.createElement("div");
    container.id = "panel-container";
    root.appendChild(container);
    document.body.appendChild(bubble);
    return bubble;
  }

  it("the grip carries its own stylesheet, with nothing in document.head", () => {
    const bubble = stubBubble();
    enablePanelResize(bubble);
    const grip = bubble.shadowRoot!.querySelector(".wa-resize-grip")!;
    const sheets = grip.querySelectorAll('style[data-wa-styles="resize-grip"]');
    expect(sheets.length).toBe(1);
    expect(sheets[0].textContent).toContain(":host([data-wa-resized]) #panel-container");
    expect(sheets[0].textContent).not.toContain("web-agent-bubble ");
    expect(sheets[0].textContent).toContain("--wa-text-color");
    expect(document.getElementById("wa-resize-grip-style")).toBeNull();
    expect(document.head.querySelector("style")).toBeNull();
    bubble.remove();
  });

  it("the grip keeps its arrow svg alongside the stylesheet", () => {
    const bubble = stubBubble();
    enablePanelResize(bubble);
    const grip = bubble.shadowRoot!.querySelector(".wa-resize-grip")!;
    expect(grip.querySelectorAll("svg").length).toBe(1);
    bubble.remove();
  });

  it("puts the grip inside the bubble's shadow root, not its light DOM", () => {
    const bubble = stubBubble();
    enablePanelResize(bubble);
    expect(bubble.shadowRoot!.querySelector(".wa-resize-grip")).not.toBeNull();
    expect(bubble.querySelector(".wa-resize-grip")).toBeNull();
    bubble.remove();
  });

  it("does nothing when the bubble has no shadow root", () => {
    const bare = document.createElement("web-agent-bubble");
    document.body.appendChild(bare);
    enablePanelResize(bare);
    expect(bare.querySelector(".wa-resize-grip")).toBeNull();
    expect(document.head.querySelector("style")).toBeNull();
    bare.remove();
  });
});
