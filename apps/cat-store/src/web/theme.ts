import { applyTheme, getTheme } from "@cuatoi/web-agent-lit/themes";

export const THEME_KEY = "cat-store:theme";
/** Fired on `window` after every theme write, with `detail` = the new theme id.
 *  Lets the header menu track a change made by anything other than a click
 *  (e.g. the `set_theme` agent tool) without a second copy of the state. */
export const THEME_CHANGE_EVENT = "cat-store:theme-change";
/** The theme a first-time visitor gets, and the fallback for a stored id that
 *  no registered theme has. */
const DEFAULT_THEME_ID = "wa2-dark";

export function getStoredTheme(): string {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored !== null && getTheme(stored)) {
      return stored;
    }
  } catch (e) {
    void e; // localStorage unavailable (private mode, disabled) — fall back to default.
  }
  return DEFAULT_THEME_ID;
}

/** Applies a registered theme, stores it and announces it. An unknown id
 *  changes nothing (applyTheme logs the warning). */
export function setStoredTheme(id: string): void {
  if (!applyTheme(document.documentElement, id)) return;
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch (e) {
    void e; // localStorage unavailable (private mode, disabled) — theme still applies to the DOM.
  }
  window.dispatchEvent(new CustomEvent<string>(THEME_CHANGE_EVENT, { detail: id }));
}
