import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let reg: typeof import("./registry.js");
beforeEach(async () => {
  vi.resetModules();
  reg = await import("./registry.js");
});
afterEach(() => {
  document.head.querySelectorAll("[data-wa-theme-css]").forEach((n) => n.remove());
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-base");
  vi.restoreAllMocks();
});

describe("theme registry", () => {
  it("lists the three built-in themes in order", () => {
    expect(reg.listThemes().map((t) => [t.id, t.label, t.scheme])).toEqual([
      ["wa1-dark", "WA v1 (Dark)", "dark"],
      ["wa2-dark", "WA v2 (Dark)", "dark"],
      ["wa2-light", "WA v2 (Light)", "light"],
    ]);
  });

  it("registerTheme appends a theme", () => {
    const res = reg.registerTheme({
      id: "acme-dense",
      label: "Acme Dense",
      scheme: "dark",
      base: "wa2-dark",
    });
    expect(res).toEqual({
      id: "acme-dense",
      label: "Acme Dense",
      scheme: "dark",
      base: "wa2-dark",
    });
    const list = reg.listThemes();
    expect(list).toHaveLength(4);
    expect(list[3].id).toBe("acme-dense");
    expect(reg.getTheme("acme-dense")?.label).toBe("Acme Dense");
  });

  it("rejects an invalid id", () => {
    expect(() => reg.registerTheme({ id: "Acme", label: "A", scheme: "dark" })).toThrowError(/invalid theme id: Acme/);
    expect(() => reg.registerTheme({ id: "1abc", label: "A", scheme: "dark" })).toThrowError(/invalid theme id: 1abc/);
    expect(() => reg.registerTheme({ id: "", label: "A", scheme: "dark" })).toThrowError(/invalid theme id: /);
  });

  it("rejects a duplicate id", () => {
    expect(() => reg.registerTheme({ id: "wa2-dark", label: "dup", scheme: "dark" })).toThrowError(
      "theme already registered: wa2-dark",
    );
    reg.registerTheme({ id: "acme-x", label: "X", scheme: "dark" });
    expect(() => reg.registerTheme({ id: "acme-x", label: "X2", scheme: "dark" })).toThrowError(
      "theme already registered: acme-x",
    );
  });

  it("rejects an invalid scheme", () => {
    expect(() => reg.registerTheme({ id: "acme-s", label: "S", scheme: "blue" as never })).toThrowError(
      "invalid scheme",
    );
  });

  it("rejects a base that is not built-in", () => {
    reg.registerTheme({ id: "acme-a", label: "A", scheme: "dark" });
    expect(() => reg.registerTheme({ id: "acme-b", label: "B", scheme: "dark", base: "acme-a" })).toThrowError(
      "base must be wa1-dark, wa2-dark or wa2-light",
    );
  });

  it("a failed registration leaves the list unchanged", () => {
    try { reg.registerTheme({ id: "Bad", label: "B", scheme: "dark" }); } catch (e) { void e; }
    try { reg.registerTheme({ id: "wa2-dark", label: "B", scheme: "dark" }); } catch (e) { void e; }
    try { reg.registerTheme({ id: "bad-scheme", label: "B", scheme: "other" as never }); } catch (e) { void e; }
    try { reg.registerTheme({ id: "bad-base", label: "B", scheme: "dark", base: "fake" }); } catch (e) { void e; }
    expect(reg.listThemes()).toHaveLength(3);
  });

  it("css text becomes one style element", () => {
    reg.registerTheme({
      id: "acme-css",
      label: "CSS",
      scheme: "dark",
      css: '[data-theme="acme-css"] { --wa-font-size-xl: 21px; }',
    });
    const styles = document.head.querySelectorAll('style[data-wa-theme-css="acme-css"]');
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toBe('[data-theme="acme-css"] { --wa-font-size-xl: 21px; }');
  });

  it("a URL becomes one link element", () => {
    reg.registerTheme({
      id: "acme-url",
      label: "URL",
      scheme: "dark",
      css: new URL("https://example.test/acme.css"),
    });
    const links = document.head.querySelectorAll('link[rel="stylesheet"][data-wa-theme-css="acme-url"]');
    expect(links).toHaveLength(1);
    expect((links[0] as HTMLLinkElement).href).toBe("https://example.test/acme.css");
  });

  it("register + apply twice adds exactly one stylesheet element", () => {
    reg.registerTheme({
      id: "acme-twice",
      label: "Twice",
      scheme: "dark",
      css: '[data-theme="acme-twice"] { --wa-font-size-xl: 21px; }',
    });
    reg.applyTheme(document.documentElement, "acme-twice");
    reg.applyTheme(document.documentElement, "acme-twice");
    expect(document.querySelectorAll('[data-wa-theme-css="acme-twice"]')).toHaveLength(1);
  });

  it("applyTheme with an unknown id warns and changes nothing", () => {
    document.documentElement.setAttribute("data-theme", "wa2-dark");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = reg.applyTheme(document.documentElement, "no-such-theme");
    expect(res).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[web-agent] unknown theme: no-such-theme");
    expect(document.documentElement.getAttribute("data-theme")).toBe("wa2-dark");
  });

  it("applyTheme sets data-theme-base for a theme with a base and removes it for one without", () => {
    reg.registerTheme({
      id: "acme-dense",
      label: "Acme Dense",
      scheme: "dark",
      base: "wa2-dark",
    });
    expect(reg.applyTheme(document.documentElement, "acme-dense")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("acme-dense");
    expect(document.documentElement.getAttribute("data-theme-base")).toBe("wa2-dark");

    expect(reg.applyTheme(document.documentElement, "wa1-dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("wa1-dark");
    expect(document.documentElement.hasAttribute("data-theme-base")).toBe(false);
  });

  it("applyTheme injects into the element's own document", () => {
    reg.registerTheme({
      id: "acme-other-doc",
      label: "Other Doc",
      scheme: "dark",
      css: '[data-theme="acme-other-doc"] { color: red; }',
    });
    const other = document.implementation.createHTMLDocument("frame");
    reg.applyTheme(other.documentElement, "acme-other-doc");
    expect(other.head.querySelectorAll('[data-wa-theme-css="acme-other-doc"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('[data-wa-theme-css="acme-other-doc"]')).toHaveLength(1);
  });

  it("defaultTheme maps each scheme", () => {
    expect(reg.defaultTheme("dark")).toBe("wa2-dark");
    expect(reg.defaultTheme("light")).toBe("wa2-light");
  });

  it("getTheme returns undefined for an unknown id", () => {
    expect(reg.getTheme("nope")).toBeUndefined();
  });
});
