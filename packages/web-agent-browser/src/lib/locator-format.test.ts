import { describe, it, expect } from "vitest";
import { locatorLines, stepLocatorLines } from "./locator-format";
import type { LocatorSet } from "./types";

describe("locator-format", () => {
  it("1. A light set with every form", () => {
    const lines = locatorLines({
      role: "button",
      name: "Add to cart",
      roleMatches: 3,
      id: "add-1",
      testId: "add-to-cart-1",
      css: "#add-1",
      xpath: "//*[@id='add-1']",
    });
    expect(lines).toEqual([
      '  role+name: button "Add to cart" (matches 3)',
      "  id: add-1",
      "  data-testid: add-to-cart-1",
      "  name: —",
      "  css: #add-1",
      "  xpath: //*[@id='add-1']",
    ]);
  });

  it("2. Nothing but role and name → the five other lines all end in —", () => {
    const lines = locatorLines({ role: "button", name: "Submit", roleMatches: 1 });
    expect(lines).toEqual([
      '  role+name: button "Submit" (matches 1)',
      "  id: —",
      "  data-testid: —",
      "  name: —",
      "  css: —",
      "  xpath: —",
    ]);
  });

  it("3. frames handling", () => {
    const withFrames = locatorLines({
      role: "button",
      name: "Pay",
      roleMatches: 1,
      frames: ["#outer", "#pay"],
    });
    expect(withFrames.at(-1)).toBe("  frames: #outer >> #pay");

    const emptyFrames = locatorLines({
      role: "button",
      name: "Pay",
      roleMatches: 1,
      frames: [],
    });
    expect(emptyFrames.some((l) => l.startsWith("  frames:"))).toBe(false);
  });

  it("4. shadow handling", () => {
    const lines = locatorLines({
      role: "button",
      name: "Buy",
      roleMatches: 1,
      shadow: ["app-root:nth-of-type(1)", "#buy"],
    });
    expect(lines.some((l) => l.startsWith("  css:"))).toBe(false);
    expect(lines.some((l) => l.startsWith("  xpath:"))).toBe(false);
    expect(lines.at(-1)).toBe("  shadow: app-root:nth-of-type(1) >> #buy");
  });

  it("5. With both frames and shadow → frames comes before shadow", () => {
    const lines = locatorLines({
      role: "button",
      name: "Buy",
      roleMatches: 1,
      frames: ["#frame1"],
      shadow: ["app-root:nth-of-type(1)", "#buy"],
    });
    const framesIndex = lines.findIndex((l) => l.startsWith("  frames:"));
    const shadowIndex = lines.findIndex((l) => l.startsWith("  shadow:"));
    expect(framesIndex).toBeGreaterThan(-1);
    expect(shadowIndex).toBeGreaterThan(-1);
    expect(framesIndex).toBeLessThan(shadowIndex);
  });

  it("6. stepLocatorLines", () => {
    expect(stepLocatorLines({})).toEqual([]);

    const set: LocatorSet = {
      role: "button",
      name: "Pay",
      roleMatches: 1,
      id: "pay",
      css: "#pay",
      xpath: "//*[@id='pay']",
    };
    const lines = stepLocatorLines({ locators: set, frames: ["#payment"] });
    expect(lines).toContain("  frames: #payment");
  });

  it('7. stepLocatorLines prints dropLocators after "  drop target:"', () => {
    const src: LocatorSet = {
      role: "",
      name: "Drag me",
      roleMatches: 0,
      id: "drag",
      css: "#drag",
      xpath: "//*[@id='drag']",
    };
    const dest: LocatorSet = {
      role: "region",
      name: "Drop zone",
      roleMatches: 1,
      id: "drop",
      css: "#drop",
      xpath: "//*[@id='drop']",
    };
    expect(stepLocatorLines({ locators: src, dropLocators: dest, frames: ["#board"] })).toEqual([
      '  role+name:  "Drag me" (matches 0)',
      "  id: drag",
      "  data-testid: —",
      "  name: —",
      "  css: #drag",
      "  xpath: //*[@id='drag']",
      "  frames: #board",
      "  drop target:",
      '  role+name: region "Drop zone" (matches 1)',
      "  id: drop",
      "  data-testid: —",
      "  name: —",
      "  css: #drop",
      "  xpath: //*[@id='drop']",
      "  frames: #board",
    ]);
  });

  it("8. stepLocatorLines prints closed shadow root offset line", () => {
    const set: LocatorSet = {
      role: "button",
      name: "Pay",
      roleMatches: 1,
      id: "pay",
      css: "#pay",
      xpath: "//*[@id='pay']",
    };
    const lines = stepLocatorLines({ locators: set, closedShadow: { offsetX: 12, offsetY: 7 } });
    expect(lines.at(-1)).toBe("  closed shadow root: click the host at position (12, 7)");
    expect(lines.slice(0, -1)).toEqual(stepLocatorLines({ locators: set }));
    expect(stepLocatorLines({ closedShadow: { offsetX: 1, offsetY: 1 } })).toEqual([
      "  closed shadow root: click the host at position (1, 1)",
    ]);
  });
});
