import { test, expect, ask } from "./demo-helpers";
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { patchedExtension, removePatchedExtension } from "./fixtures/patched-extension";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PATCH_DIR_NAME = "brand-skills-demo";
const SITE = "http://localhost:10040/plain.html";

const requireCjs = createRequire(import.meta.url);
const { compileSkill } = requireCjs("../tool/compile-brand.cjs") as {
  compileSkill: (file: string) => { name: string; description: string; definition: string; command: boolean; argumentHint?: string };
};
const PAGE_SUMMARY = compileSkill(path.resolve(HERE, "fixtures/brand/skills/page_summary.md"));

test.describe("Brand skills — live proof", () => {
  test.afterAll(async () => {
    await removePatchedExtension(PATCH_DIR_NAME);
  });

  test("the in-page /page_summary command runs the brand skill", async () => {
    test.setTimeout(300_000);
    const extensionDir = await patchedExtension(PATCH_DIR_NAME, { skillDefs: [PAGE_SUMMARY] });

    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });

    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] }));

    const page = await context.newPage();
    await page.goto(SITE);

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible({ timeout: 20_000 });
    await launcher.click();
    await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached({ timeout: 10_000 });

    const { reply } = await ask(page, "/page_summary");

    const occurrences = (reply.match(/PAGE003:/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(3);

    await page.close();
    await context.close();
  });
});
