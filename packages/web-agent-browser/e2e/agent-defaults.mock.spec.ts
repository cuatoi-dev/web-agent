import { test, expect } from "./extension.fixture";
import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SITE = "http://localhost:10040/plain.html";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "../dist");
const NO_TOOLS_EXT = path.resolve(HERE, "../temp/e2e-extensions/agent-defaults-no-tools");

// 155400-001 — both extension agents start their session with 1000 steps.
// Reads the `config` each agent's element carries: the side panel's
// <agent-chat-panel> (sidepanel.ts sets it before connecting) and the
// in-page <web-agent-bubble> (content.ts; the MAIN-world content script, so
// the page can read the property).
test.describe("Extension agent defaults", () => {
  test.beforeEach(async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
    });
  });

  test("the side panel session config carries maxIterations 1000 and the scheduler", async ({ context, extensionId }) => {
    const panelPage = await context.newPage();
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    const config = await panelPage.evaluate(() => {
      const panel = document.querySelector("#chat agent-chat-panel:not([hidden])") as unknown as {
        config?: { maxIterations?: number; scheduler?: { enabled: boolean } };
      } | null;
      return { maxIterations: panel?.config?.maxIterations, scheduler: panel?.config?.scheduler };
    });
    expect(config.maxIterations).toBe(1000);
    expect(config.scheduler).toEqual({ enabled: true });
  });

  test("the in-page bubble config carries maxIterations 1000 and the sample brand scheduler", async ({ context }) => {
    const page = await context.newPage();
    await page.goto(SITE);
    await expect(page.locator("web-agent-bubble")).toBeAttached();
    const config = await page.evaluate(() => {
      const bubble = document.querySelector("web-agent-bubble") as unknown as {
        config?: { maxIterations?: number; scheduler?: { enabled: boolean } };
      } | null;
      return { maxIterations: bubble?.config?.maxIterations, scheduler: bubble?.config?.scheduler };
    });
    expect(config.maxIterations).toBe(1000);
    expect(config.scheduler).toEqual({ enabled: true });
  });

  test("the in-page bubble has no scheduler when the brand has no tools block", async () => {
    await fs.rm(NO_TOOLS_EXT, { recursive: true, force: true });
    await fs.cp(EXT, NO_TOOLS_EXT, { recursive: true });
    const brandFile = path.join(NO_TOOLS_EXT, "brand.json");
    const brand = JSON.parse(await fs.readFile(brandFile, "utf8")) as Record<string, unknown>;
    // Compiled brands represent an omitted source `tools` block as `{}`.
    brand.tools = {};
    await fs.writeFile(brandFile, JSON.stringify(brand, null, 2));

    const ctx = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${NO_TOOLS_EXT}`, `--load-extension=${NO_TOOLS_EXT}`],
    });
    try {
      let [worker] = ctx.serviceWorkers();
      if (!worker) worker = await ctx.waitForEvent("serviceworker");
      await worker.evaluate(async () => {
        await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
      });
      const page = await ctx.newPage();
      await page.goto(SITE);
      await expect(page.locator("web-agent-bubble")).toBeAttached();
      const config = await page.evaluate(() => {
        const bubble = document.querySelector("web-agent-bubble") as unknown as {
          config?: { maxIterations?: number; scheduler?: { enabled: boolean } };
        } | null;
        return bubble?.config;
      });
      expect(config?.maxIterations).toBe(1000);
      expect(config?.scheduler).toBeUndefined();
    } finally {
      await ctx.close();
    }
  });
});
