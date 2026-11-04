import type { Page } from "@playwright/test";
import { expect } from "./extension.fixture";

/** Logs the life of a side-panel page and waits for `#agent-row` with a clear
 *  failure reason.
 *
 *  Why: Playwright reports ANY non-timeout error inside `toBeVisible` — a closed
 *  page, a crashed page, a destroyed execution context, a navigation — as
 *  `Received: undefined` with no cause (playwright-core `Frame.expect` catch
 *  branch). A panel that vanished 856 ms into `M12` showed only that. This
 *  helper records the close, crash and main-frame navigation events and, when
 *  the page is closed, crashed or no longer on `sidepanel.html`, fails with that
 *  reason and the event list instead of the bare assertion.
 *
 *  Call it BEFORE `goto`, and call the returned function after `goto`. It adds
 *  no retry and changes no timeout. */
export function watchPanel(page: Page): () => Promise<void> {
  const started = Date.now();
  const events: string[] = [];
  let crashed = false;
  const note = (what: string): void => {
    const line = `+${Date.now() - started}ms ${what}`;
    events.push(line);
    console.log("PANEL EVENT:", line);
  };
  page.on("close", () => note("page closed"));
  page.on("crash", () => {
    crashed = true;
    note("page crashed");
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) note(`main frame navigated to ${frame.url()}`);
  });

  /** The reason the panel is not usable, or "" when it still looks alive. */
  const gone = (): string => {
    if (page.isClosed()) return "the panel page was closed";
    if (crashed) return "the panel page crashed";
    const url = page.url();
    if (!url.endsWith("/sidepanel.html")) return `the panel page navigated away to ${url}`;
    return "";
  };

  return async () => {
    const before = gone();
    if (before) throw new Error(`${before} before #agent-row was awaited. Events: ${events.join("; ")}`);
    try {
      await expect(page.locator("#agent-row")).toBeVisible();
    } catch (error) {
      const after = gone();
      if (after) {
        throw new Error(`${after} while #agent-row was awaited. Events: ${events.join("; ")}`, { cause: error });
      }
      throw error;
    }
  };
}
