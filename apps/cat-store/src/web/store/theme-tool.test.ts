import { describe, it, expect, beforeEach } from "vitest";
import { registerTheme } from "@cuatoi/web-agent-lit/themes";
import { setThemeTool, getThemeTool } from "./theme-tool";
import { THEME_KEY } from "../theme";
import type { ToolContext } from "@cuatoi/web-agent-core";

const noCtx = {} as unknown as ToolContext;

describe("theme tools (set_theme & get_theme)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("sets theme to dark", async () => {
    const res = await setThemeTool.execute({ theme: "dark" }, noCtx);
    expect(res.isError).toBeFalsy();
    expect(localStorage.getItem(THEME_KEY)).toBe("wa2-dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("wa2-dark");
    expect(res.content).toBe("Theme set to WA v2 (Dark) (wa2-dark).");
  });

  it("sets theme to light", async () => {
    const res = await setThemeTool.execute({ theme: "light" }, noCtx);
    expect(res.isError).toBeFalsy();
    expect(localStorage.getItem(THEME_KEY)).toBe("wa2-light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("wa2-light");
    expect(res.content).toBe("Theme set to WA v2 (Light) (wa2-light).");
  });

  it("sets theme to wa1-dark", async () => {
    const res = await setThemeTool.execute({ theme: "wa1-dark" }, noCtx);
    expect(res.isError).toBeFalsy();
    expect(localStorage.getItem(THEME_KEY)).toBe("wa1-dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("wa1-dark");
    expect(res.content).toBe("Theme set to WA v1 (Dark) (wa1-dark).");
  });

  it("rejects invalid string theme value without modifying stored theme", async () => {
    await setThemeTool.execute({ theme: "light" }, noCtx);

    const res = await setThemeTool.execute({ theme: "nope" }, noCtx);
    expect(res.isError).toBe(true);
    expect(res.content).toBe("Unknown theme nope. Available: wa1-dark, wa2-dark, wa2-light.");
    expect(localStorage.getItem(THEME_KEY)).toBe("wa2-light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("wa2-light");
  });

  it("rejects non-string theme value without modifying stored theme", async () => {
    const res = await setThemeTool.execute({ theme: 42 }, noCtx);
    expect(res.isError).toBe(true);
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it("rejects missing theme key without modifying stored theme", async () => {
    const res = await setThemeTool.execute({}, noCtx);
    expect(res.isError).toBe(true);
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it("reads default theme (wa2-dark) when localStorage is empty", async () => {
    const res = await getThemeTool.execute({}, noCtx);
    expect(res.content).toBe("Current theme: WA v2 (Dark) (wa2-dark).");
  });

  it("reads wa2-light theme after set_theme light", async () => {
    await setThemeTool.execute({ theme: "light" }, noCtx);
    const res = await getThemeTool.execute({}, noCtx);
    expect(res.content).toBe("Current theme: WA v2 (Light) (wa2-light).");
  });

  it("reads wa1-dark after external localStorage write", async () => {
    localStorage.setItem(THEME_KEY, "wa1-dark");
    const res = await getThemeTool.execute({}, noCtx);
    expect(res.content).toBe("Current theme: WA v1 (Dark) (wa1-dark).");
  });

  it("the set_theme description lists the aliases and every theme id", async () => {
    expect(setThemeTool.description).toContain('"dark"');
    expect(setThemeTool.description).toContain('"light"');
    expect(setThemeTool.description).toContain("wa1-dark");
    expect(setThemeTool.description).toContain("wa2-dark");
    expect(setThemeTool.description).toContain("wa2-light");

    registerTheme({ id: "fixture-tool", label: "Fixture Tool", scheme: "dark" });
    expect(setThemeTool.description).toContain("fixture-tool");

    const res = await setThemeTool.execute({ theme: "fixture-tool" }, noCtx);
    expect(res.content).toBe("Theme set to Fixture Tool (fixture-tool).");
  });
});
