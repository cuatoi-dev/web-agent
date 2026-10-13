import type { Theme, ThemeScheme } from "./registry.types.js";

export type { Theme, ThemeScheme } from "./registry.types.js";

const BUILT_IN: readonly Theme[] = [
  { id: "wa1-dark", label: "WA v1 (Dark)", scheme: "dark" },
  { id: "wa2-dark", label: "WA v2 (Dark)", scheme: "dark" },
  { id: "wa2-light", label: "WA v2 (Light)", scheme: "light" },
];
const BUILT_IN_IDS = new Set(BUILT_IN.map((t) => t.id));
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Registration order. A Map keeps insertion order, so listThemes() does too. */
const REGISTRY = new Map<string, Theme>(BUILT_IN.map((t) => [t.id, t]));

/** Adds the theme's stylesheet to `doc` once. */
function injectCss(doc: Document, t: Theme): void {
  if (t.css === undefined) return;
  if (doc.head.querySelector(`[data-wa-theme-css="${t.id}"]`)) return;
  if (t.css instanceof URL) {
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = t.css.href;
    link.setAttribute("data-wa-theme-css", t.id);
    doc.head.append(link);
  } else {
    const style = doc.createElement("style");
    style.textContent = t.css;
    style.setAttribute("data-wa-theme-css", t.id);
    doc.head.append(style);
  }
}

export function registerTheme(t: Theme): Theme {
  if (!ID_PATTERN.test(t.id)) throw new Error("invalid theme id: " + t.id);
  if (REGISTRY.has(t.id)) throw new Error("theme already registered: " + t.id);
  if (t.scheme !== "dark" && t.scheme !== "light") throw new Error("invalid scheme");
  if (t.base !== undefined && !BUILT_IN_IDS.has(t.base)) {
    throw new Error("base must be wa1-dark, wa2-dark or wa2-light");
  }
  REGISTRY.set(t.id, t);
  if (t.css !== undefined && typeof document !== "undefined") injectCss(document, t);
  return t;
}

export function applyTheme(el: Element, id: string): boolean {
  const t = REGISTRY.get(id);
  if (!t) {
    console.warn("[web-agent] unknown theme: " + id);
    return false;
  }
  if (t.css !== undefined) injectCss(el.ownerDocument, t);
  el.setAttribute("data-theme", id);
  if (t.base !== undefined) el.setAttribute("data-theme-base", t.base);
  else el.removeAttribute("data-theme-base");
  return true;
}

export function getTheme(id: string): Theme | undefined {
  return REGISTRY.get(id);
}

export function listThemes(): Theme[] {
  return [...REGISTRY.values()];
}

export function defaultTheme(scheme: ThemeScheme): string {
  return scheme === "dark" ? "wa2-dark" : "wa2-light";
}
