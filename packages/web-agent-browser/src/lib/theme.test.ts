import { beforeAll, describe, it, expect } from "vitest";
import { applyTheme, getTheme, registerBrandThemes, resolveTheme, resolveTokenSet } from "./theme";

function fakeQuery(matches: boolean) {
  const listeners = new Set<() => void>();
  return {
    matches,
    addEventListener(_type: string, fn: () => void) { listeners.add(fn); },
    removeEventListener(_type: string, fn: () => void) { listeners.delete(fn); },
    /** Test-only: change the system preference and notify listeners. */
    fire(next: boolean) { this.matches = next; for (const fn of [...listeners]) fn(); },
    get listenerCount() { return listeners.size; },
  };
}

function env(siteSupplies: boolean, query: ReturnType<typeof fakeQuery>) {
  return { siteSuppliesTokens: () => siteSupplies, darkQuery: () => query as unknown as MediaQueryList };
}

beforeAll(() => {
  registerBrandThemes(
    [{ id: "acme-dense", label: "Acme Dense", scheme: "dark", base: "wa2-dark", css: "brand-themes/acme-dense.css" }],
    { linkCss: false },
  );
});

describe("registerBrandThemes", () => {
  it("registers a brand theme by id and is idempotent", () => {
    expect(getTheme("acme-dense")?.label).toBe("Acme Dense");
    // A second call must not throw on the already-registered id.
    expect(() => registerBrandThemes(
      [{ id: "acme-dense", label: "Acme Dense", scheme: "dark", base: "wa2-dark", css: "x.css" }],
      { linkCss: false },
    )).not.toThrow();
  });
});

describe("resolveTheme", () => {
  it("follows the system for auto", () => {
    expect(resolveTheme("auto", true)).toBe("wa2-dark");
    expect(resolveTheme("auto", false)).toBe("wa2-light");
  });

  it("returns a registered theme id unchanged", () => {
    expect(resolveTheme("wa1-dark", false)).toBe("wa1-dark");
    expect(resolveTheme("acme-dense", false)).toBe("acme-dense");
  });

  it("falls back to auto for an unknown id", () => {
    expect(resolveTheme("dark", false)).toBe("wa2-light");
    expect(resolveTheme("light", true)).toBe("wa2-dark");
    expect(resolveTheme("gone", false)).toBe("wa2-light");
  });
});

describe("resolveTokenSet", () => {
  it("maps a registered id to its token set", () => {
    expect(resolveTokenSet("wa2-light", false)).toBe("wa2-light");
    expect(resolveTokenSet("wa2-dark", true)).toBe("wa2-dark");
    expect(resolveTokenSet("acme-dense", false)).toBe("wa2-dark");
  });

  it("falls back to auto for an unknown id", () => {
    expect(resolveTokenSet("dark", false)).toBe("wa2-light");
    expect(resolveTokenSet("auto", true)).toBe("wa2-dark");
  });
});

describe("applyTheme", () => {
  it("the do-not-theme rule wins and writes nothing", () => {
    const el = document.createElement("web-agent-bubble");
    const query = fakeQuery(false);
    const binding = applyTheme(el, "wa2-dark", env(true, query));
    expect(el.hasAttribute("data-theme")).toBe(false);
    expect(query.listenerCount).toBe(0);
    expect(() => binding.dispose()).not.toThrow();
  });

  it("the do-not-theme rule clears a stale attribute", () => {
    const el = document.createElement("web-agent-bubble");
    el.setAttribute("data-theme", "wa2-dark");
    el.setAttribute("data-theme-base", "wa2-dark");
    applyTheme(el, "wa2-dark", env(true, fakeQuery(false)));
    expect(el.hasAttribute("data-theme")).toBe(false);
    expect(el.hasAttribute("data-theme-base")).toBe(false);
  });

  it("a fixed built-in choice writes the attribute and registers no listener", () => {
    const el = document.createElement("web-agent-bubble");
    const query = fakeQuery(true);
    applyTheme(el, "wa2-light", env(false, query));
    expect(el.getAttribute("data-theme")).toBe("wa2-light");
    expect(el.hasAttribute("data-theme-base")).toBe(false);
    expect(query.listenerCount).toBe(0);
  });

  it("a custom theme writes data-theme and data-theme-base", () => {
    const el = document.createElement("web-agent-bubble");
    applyTheme(el, "acme-dense", env(false, fakeQuery(true)));
    expect(el.getAttribute("data-theme")).toBe("acme-dense");
    expect(el.getAttribute("data-theme-base")).toBe("wa2-dark");
  });

  it("auto writes from the query and follows a live change", () => {
    const el = document.createElement("web-agent-bubble");
    const query = fakeQuery(false);
    applyTheme(el, "auto", env(false, query));
    expect(el.getAttribute("data-theme")).toBe("wa2-light");

    query.fire(true);
    expect(el.getAttribute("data-theme")).toBe("wa2-dark");

    query.fire(false);
    expect(el.getAttribute("data-theme")).toBe("wa2-light");
  });

  it("dispose() drops the auto listener and stops further changes", () => {
    const el = document.createElement("web-agent-bubble");
    const query = fakeQuery(false);
    const binding = applyTheme(el, "auto", env(false, query));
    expect(query.listenerCount).toBe(1);

    binding.dispose();
    expect(query.listenerCount).toBe(0);

    query.fire(true);
    expect(el.getAttribute("data-theme")).toBe("wa2-light");
  });

  it("dispose() on a fixed choice and on a themed site is safe to call twice", () => {
    const fixedEl = document.createElement("web-agent-bubble");
    const fixedBinding = applyTheme(fixedEl, "wa2-dark", env(false, fakeQuery(false)));
    expect(() => { fixedBinding.dispose(); fixedBinding.dispose(); }).not.toThrow();

    const themedEl = document.createElement("web-agent-bubble");
    const themedBinding = applyTheme(themedEl, "wa2-light", env(true, fakeQuery(false)));
    expect(() => { themedBinding.dispose(); themedBinding.dispose(); }).not.toThrow();
  });
});
