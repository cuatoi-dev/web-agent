import type { Page } from "@playwright/test";

/** 127/002 — the value of one `  <key>: <value>` line in a page_generate_locator
 *  or stop_recording result. Null when the line is absent. */
export function locatorField(text: string, key: string): string | null {
  const start = `  ${key}: `;
  for (const line of text.split("\n")) {
    if (line.startsWith(start)) return line.slice(start.length);
  }
  return null;
}

/** How many elements `css` and `xpath` match in the real page. */
export async function countMatches(page: Page, css: string, xpath: string): Promise<{ css: number; xpath: number }> {
  return page.evaluate(
    ([c, x]) => ({
      css: document.querySelectorAll(c).length,
      xpath: document.evaluate(x, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength,
    }),
    [css, xpath] as const,
  );
}
