import {
  registerTheme,
  applyTheme as registryApplyTheme,
  getTheme,
  listThemes,
  defaultTheme,
} from "@cuatoi/web-agent-lit/themes";
import type { BrandTheme, ThemeBinding, ThemeEnv, ThemePreference, TokenSet } from "./types";

export type { ThemeBinding, ThemeEnv } from "./types";
export { listThemes, getTheme };

/**
 * Registers a brand's custom themes with the central theme registry.
 *
 * When `linkCss` is false (the content script), CSS link injection is skipped,
 * because the manifest's content_scripts already injected the CSS.
 *
 * `registerTheme` throws on a duplicate id, so this checks first. A theme that
 * is already registered is left alone.
 */
export function registerBrandThemes(
  themes: BrandTheme[] | undefined,
  options: { linkCss?: boolean } = {},
): void {
  if (!Array.isArray(themes)) return;
  for (const t of themes) {
    if (!getTheme(t.id)) {
      registerTheme({
        id: t.id,
        label: t.label,
        scheme: t.scheme,
        base: t.base,
        css: options.linkCss !== false && typeof chrome !== "undefined" && chrome.runtime?.getURL
          ? new URL(chrome.runtime.getURL(t.css))
          : undefined,
      });
    }
  }
}

/**
 * Resolves a preference to a registered theme id.
 *
 * `"auto"` follows the system scheme. A stored id that is no longer registered
 * falls back to `"auto"`, so an uninstalled brand theme does not leave the
 * element unthemed.
 */
export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): string {
  if (pref === "auto") {
    return defaultTheme(systemPrefersDark ? "dark" : "light");
  }
  if (getTheme(pref)) {
    return pref;
  }
  return resolveTheme("auto", systemPrefersDark);
}

/**
 * Which token set a preference resolves to. Retained for backward
 * compatibility; `applyTheme` uses the registry directly.
 */
export function resolveTokenSet(pref: ThemePreference, systemPrefersDark: boolean): TokenSet {
  const resolved = resolveTheme(pref, systemPrefersDark);
  return resolved === "wa2-light" ? "wa2-light" : "wa2-dark";
}

/** The real browser. `--wa-background-color` is declared in all three
 *  blocks of wa-tokens.css (lines 101, 538 and 972), so one read of the
 *  root element answers whether the site owns the theme. */
export function browserThemeEnv(win: Window = window): ThemeEnv {
  return {
    siteSuppliesTokens: () =>
      win
        .getComputedStyle(win.document.documentElement)
        .getPropertyValue("--wa-background-color")
        .trim() !== "",
    darkQuery: () => win.matchMedia("(prefers-color-scheme: dark)"),
  };
}

/**
 * Sets `data-theme` (and `data-theme-base` for a custom theme) on `el` from
 * the user's choice.
 *
 * The do-not-theme rule comes first: when the visited page already supplies the
 * `--wa-*` tokens, this writes nothing and removes any attributes it wrote
 * before, so the element inherits the site's own theme.
 *
 * With "auto" the returned binding holds a `change` listener on the media
 * query, so an operating-system switch rewrites the attribute with no page
 * reload. Call `dispose()` when the element goes away.
 */
export function applyTheme(
  el: Element,
  pref: ThemePreference,
  env: ThemeEnv = browserThemeEnv(),
): ThemeBinding {
  if (env.siteSuppliesTokens()) {
    el.removeAttribute("data-theme");
    el.removeAttribute("data-theme-base");
    return { dispose() {} };
  }

  const query = env.darkQuery();
  const write = () => {
    registryApplyTheme(el, resolveTheme(pref, query.matches));
  };
  write();

  if (pref !== "auto") return { dispose() {} };

  query.addEventListener("change", write);
  return {
    dispose() {
      query.removeEventListener("change", write);
    },
  };
}
