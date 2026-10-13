import { test as base, chromium, expect as baseExpect, type BrowserContext, type Page, type Worker } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, "../dist");

/** The tab id for a URL, read from the extension's service worker. Module
 *  code, not an `evaluate` callback, so importing it is safe — only the
 *  inner arrow passed to `worker.evaluate` is serialized. */
export async function getTabId(worker: Worker, url: string): Promise<number> {
  const id = await worker.evaluate(async (u: string) => {
    const tabs = await chrome.tabs.query({ url: u });
    return tabs[0]?.id;
  }, url);
  if (typeof id !== "number") throw new Error(`no tab found for ${url}`);
  return id;
}

/** Opens the options page and waits until its async init has finished.
 *
 *  116/002 made the page build its picker and fill its fields behind two
 *  awaits, one of them a round trip to the service worker. `#endpoint` is
 *  always filled with a non-empty string by the last synchronous block of
 *  `init()`, and `preset.value` is assigned in that same block, so a non-empty
 *  `#endpoint` means the whole form is ready. Without this wait a `fill()` or a
 *  value read that follows `goto()` races the init and is overwritten by it. */
export async function openOptions(page: Page, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await optionsReady(page);
}

/** The same wait, for a `page.reload()` that re-runs the init. */
export async function optionsReady(page: Page): Promise<void> {
  await baseExpect(page.locator("#endpoint")).not.toHaveValue("", { timeout: 15_000 });
}

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({ browserName }, use) => {
    // Playwright's own fixture registration reads the first parameter's
    // source text and requires it to look like a non-empty, non-rest
    // object-destructuring pattern (verified 2026-09-01 against
    // playwright/lib/common/fixtures.js — a bare `_` and a rest element
    // (`{ ...x }`) both fail its runtime check even though both type-check).
    // `browserName` is a real built-in worker fixture this test never reads;
    // destructuring it satisfies both that check and `no-empty-pattern`.
    void browserName;
    // `channel: "chromium"` is what allows an extension to run headless.
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await use(worker.url().split("/")[2]);
  },
});

export const expect = test.expect;
