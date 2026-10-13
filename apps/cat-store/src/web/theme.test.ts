import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registerTheme } from "@cuatoi/web-agent-lit/themes";
import { getStoredTheme, setStoredTheme, THEME_KEY, THEME_CHANGE_EVENT } from "./theme";

describe("theme manager", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-base");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to wa2-dark when localStorage is empty", () => {
    expect(getStoredTheme()).toBe("wa2-dark");
  });

  it("reads every built-in id", () => {
    for (const id of ["wa1-dark", "wa2-dark", "wa2-light"]) {
      localStorage.setItem(THEME_KEY, id);
      expect(getStoredTheme()).toBe(id);
    }
  });

  it("falls back to wa2-dark for an id no theme is registered under", () => {
    localStorage.setItem(THEME_KEY, "dwf2-light");
    expect(getStoredTheme()).toBe("wa2-dark");
  });

  it("setStoredTheme applies, stores and announces a built-in theme", () => {
    let firedDetail: string | null = null;
    const listener = (e: Event) => {
      firedDetail = (e as CustomEvent<string>).detail;
    };
    window.addEventListener(THEME_CHANGE_EVENT, listener);
    setStoredTheme("wa1-dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("wa1-dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("wa1-dark");
    expect(firedDetail).toBe("wa1-dark");
    window.removeEventListener(THEME_CHANGE_EVENT, listener);
  });

  it("setStoredTheme with an unknown id changes nothing", () => {
    document.documentElement.setAttribute("data-theme", "wa2-dark");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let fired = false;
    const listener = () => { fired = true; };
    window.addEventListener(THEME_CHANGE_EVENT, listener);

    setStoredTheme("nope");

    expect(document.documentElement.getAttribute("data-theme")).toBe("wa2-dark");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(fired).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);

    window.removeEventListener(THEME_CHANGE_EVENT, listener);
  });

  it("setStoredTheme sets data-theme-base for a registered custom theme", () => {
    registerTheme({
      id: "fixture-store",
      label: "Fixture Store",
      scheme: "light",
      base: "wa2-light",
    });
    setStoredTheme("fixture-store");
    expect(document.documentElement.getAttribute("data-theme")).toBe("fixture-store");
    expect(document.documentElement.getAttribute("data-theme-base")).toBe("wa2-light");
    expect(getStoredTheme()).toBe("fixture-store");
  });

  it("does not trigger removed listener on subsequent theme change", () => {
    let count = 0;
    const listener = () => { count++; };
    window.addEventListener("cat-store:theme-change", listener);
    setStoredTheme("wa2-light");
    expect(count).toBe(1);
    window.removeEventListener("cat-store:theme-change", listener);
    setStoredTheme("wa2-dark");
    expect(count).toBe(1);
  });
});
