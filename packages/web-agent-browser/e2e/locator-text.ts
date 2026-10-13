import type { Locator, Page } from "@playwright/test";

const LOCATOR_RE =
  /page\.(getByRole|getByLabel|getByText|getByPlaceholder|getByAltText|getByTitle|getByTestId)\('((?:[^'\\]|\\.)*)'(?:, \{ name: '((?:[^'\\]|\\.)*)' \})?\)(?:\.nth\((\d+)\))?/;

const unescape = (s: string): string => s.replace(/\\(.)/g, "$1");

/** The first `page.getBy…(…)[.nth(i)]` in `text`, or null. */
export function findLocatorText(text: string): string | null {
  const m = LOCATOR_RE.exec(text);
  return m ? m[0] : null;
}

/** Builds the same locator on a real Playwright page. Throws on unknown text. */
export function locatorFromText(page: Page, text: string): Locator {
  const m = LOCATOR_RE.exec(text);
  if (!m) throw new Error(`not a generated locator: ${text}`);
  const [, method, arg, name, nth] = m;
  const a = unescape(arg);
  let loc: Locator;
  switch (method) {
    case "getByRole":
      loc = page.getByRole(a as Parameters<Page["getByRole"]>[0], name === undefined ? {} : { name: unescape(name) });
      break;
    case "getByLabel": loc = page.getByLabel(a); break;
    case "getByText": loc = page.getByText(a); break;
    case "getByPlaceholder": loc = page.getByPlaceholder(a); break;
    case "getByAltText": loc = page.getByAltText(a); break;
    case "getByTitle": loc = page.getByTitle(a); break;
    default: loc = page.getByTestId(a);
  }
  return nth === undefined ? loc : loc.nth(Number(nth));
}
