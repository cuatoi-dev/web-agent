import { beforeAll, describe, expect, it } from "vitest";
import { registerTheme } from "@cuatoi/web-agent-lit/themes";
import { frameThemeFor, syncFrameTheme } from "./genui-frame-theme";

beforeAll(() => {
  registerTheme({
    id: "fixture-custom",
    label: "Fixture Custom",
    scheme: "dark",
    base: "wa2-dark",
    css: '[data-theme="fixture-custom"] { --wa-font-size-xl: 21px; }',
  });
});

describe("genui-frame-theme", () => {
  it("resolves built-in themes", () => {
    expect(frameThemeFor("wa1-dark")).toBe("wa1-dark");
    expect(frameThemeFor("wa2-light")).toBe("wa2-light");
  });

  it("resolves custom theme to its base", () => {
    expect(frameThemeFor("fixture-custom")).toBe("wa2-dark");
  });

  it("falls back to default dark theme for null and unknown ids", () => {
    expect(frameThemeFor(null)).toBe("wa2-dark");
    expect(frameThemeFor("nope")).toBe("wa2-dark");
  });

  it("custom theme frame shows its base, with no base attribute and no CSS", () => {
    const frameDoc = document.implementation.createHTMLDocument("frame");
    frameDoc.documentElement.setAttribute("data-theme-base", "wa1-dark");
    syncFrameTheme(frameDoc, "fixture-custom");
    expect(frameDoc.documentElement.getAttribute("data-theme")).toBe("wa2-dark");
    expect(frameDoc.documentElement.hasAttribute("data-theme-base")).toBe(false);
    expect(frameDoc.querySelector("[data-wa-theme-css]")).toBeNull();
  });

  it("syncFrameTheme syncs built-in wa1-dark", () => {
    const frameDoc = document.implementation.createHTMLDocument("frame");
    syncFrameTheme(frameDoc, "wa1-dark");
    expect(frameDoc.documentElement.getAttribute("data-theme")).toBe("wa1-dark");
  });
});
