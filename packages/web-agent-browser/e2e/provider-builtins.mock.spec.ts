import { test, expect, openOptions, optionsReady } from "./extension.fixture";
import { chromium, type BrowserContext, type Worker } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "../dist");
const TEMP_DIR = path.resolve(HERE, "../temp/e2e-extensions/built-in-providers");
const BRAND_EXT = path.resolve(TEMP_DIR, "extension");
const ARTIFACTS = process.env.E2E_ARTIFACTS_DIR ?? path.resolve(HERE, "../temp/e2e-artifacts/built-in-providers");
const SITE = "http://localhost:10040/plain.html";

/** Copies the extension build with the provider grid enabled. */
async function patchedBrand(): Promise<string> {
  await fs.rm(BRAND_EXT, { recursive: true, force: true });
  await fs.cp(EXT, BRAND_EXT, { recursive: true });
  const file = path.join(BRAND_EXT, "brand.json");
  const brand = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  await fs.writeFile(file, JSON.stringify({ ...brand, options: { builtInProviders: true } }, null, 2));
  return BRAND_EXT;
}

async function launch(): Promise<{ ctx: BrowserContext; id: string; worker: Worker }> {
  const ctx = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${BRAND_EXT}`, `--load-extension=${BRAND_EXT}`],
  });
  let [worker] = ctx.serviceWorkers();
  if (!worker) worker = await ctx.waitForEvent("serviceworker");
  return { ctx, id: worker.url().split("/")[2], worker };
}

test.beforeAll(async () => { await fs.mkdir(ARTIFACTS, { recursive: true }); await patchedBrand(); });
test.afterAll(async () => { await fs.rm(TEMP_DIR, { recursive: true, force: true }); });

test("B1: provider grid and Anthropic form in both themes", async () => {
  const { ctx, id } = await launch();
  try {
    const page = await ctx.newPage();
    await openOptions(page, id);
    await page.locator("#tab-btn-models").click();
    await page.locator("#add-model-btn").click();
    await expect(page.locator("dialog.provider-grid-dialog")).toBeVisible();
    await expect(page.locator(".provider-tile .tile-label")).toHaveText([
      "OpenRouter", "Anthropic", "OpenAI", "xAI", "Google AI", "DeepSeek", "Moonshot (Kimi)", "Custom",
    ]);
    await expect(page.locator(".provider-tile svg.logo path")).toHaveCount(8);
    const fallback = await page.locator('.provider-tile[data-built-in="custom"] svg').evaluate((e) => e.innerHTML);
    for (const logo of await page.locator('.provider-tile:not([data-built-in="custom"]) svg').all()) {
      expect(await logo.evaluate((e) => e.innerHTML)).not.toBe(fallback);
    }
    await expect(page.locator(".next-btn")).toBeDisabled();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({ path: path.join(ARTIFACTS, `grid-${colorScheme}.png`) });
    }
    await page.locator('.provider-tile[data-built-in="anthropic"]').click();
    await page.locator(".next-btn").click();
    await expect(page.locator("dialog.provider-dialog h2")).toHaveText("Add Anthropic");
    await expect(page.locator("#provider-endpoint")).toHaveValue("https://api.anthropic.com");
    await expect(page.locator('.format-opt[data-format="anthropic"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".form-model-row")).toHaveCount(4);
    for (const input of await page.locator(".form-model-vision").all()) await expect(input).toBeChecked();
    await expect(page.locator(".refresh-models-btn")).toBeHidden();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({ path: path.join(ARTIFACTS, `anthropic-form-${colorScheme}.png`) });
    }
    await page.locator(".cancel-btn").click();
  } finally { await ctx.close(); }
});

test("B2: Google switches endpoints and xAI has a fixed format", async () => {
  const { ctx, id } = await launch();
  try {
    const page = await ctx.newPage();
    await openOptions(page, id);
    await page.locator("#tab-btn-models").click();
    await page.locator("#add-model-btn").click();
    await page.locator('.provider-tile[data-built-in="google"]').click();
    await page.locator(".next-btn").click();
    await expect(page.locator(".format-opt")).toHaveCount(2);
    await expect(page.locator('.format-opt[data-format="gemini"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#provider-endpoint")).toHaveValue("https://generativelanguage.googleapis.com");
    await expect(page.locator(".form-model-row")).toHaveCount(7);
    await expect(page.locator(".refresh-models-btn")).toBeHidden();
    await page.locator('.format-opt[data-format="openai"]').click();
    await expect(page.locator("#provider-endpoint")).toHaveValue("https://generativelanguage.googleapis.com/v1beta/openai/");
    await expect(page.locator(".refresh-models-btn")).toBeVisible();
    await page.locator(".cancel-btn").click();
    await page.locator("#add-model-btn").click();
    await page.locator('.provider-tile[data-built-in="xai"]').click();
    await page.locator(".next-btn").click();
    await expect(page.locator(".format-fixed")).toHaveText("openai");
    await expect(page.locator(".format-opt")).toHaveCount(0);
    await expect(page.locator(".form-model-row")).toHaveCount(1);
    await expect(page.locator(".form-model-id")).toHaveValue("");
    await page.screenshot({ path: path.join(ARTIFACTS, "xai-form-light.png") });
    await page.locator(".cancel-btn").click();
  } finally { await ctx.close(); }
});

test("B3: saved built-in logos reach the table and both switchers", async () => {
  const { ctx, id, worker } = await launch();
  try {
    const page = await ctx.newPage();
    await openOptions(page, id);
    await page.locator("#tab-btn-models").click();
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        enabledOrigins: ["http://localhost:10040"],
        modelStore: {
          providers: [
            {
              id: "p1",
              name: "Anthropic",
              builtIn: "anthropic",
              wireFormat: "anthropic",
              endpoint: "https://api.anthropic.com",
              apiKey: "",
              headers: [],
              models: [{ model: "claude-sonnet-5-5", label: "Built-in Sonnet", vision: true }],
            },
          ],
          brandKeys: {},
          disabled: [],
          defaultModel: "p1/claude-sonnet-5-5",
        },
      });
    });
    await page.reload();
    await optionsReady(page);
    await page.locator("#tab-btn-models").click();
    const builtin = page.locator('tr.prov[data-provider-id="p1"] .prov-name svg.logo');
    await expect(builtin.locator("path")).toHaveCount(1);
    const generic = page.locator('tr.prov').first().locator(".prov-name svg.logo");
    expect(await builtin.evaluate((e) => e.outerHTML)).not.toBe(await generic.evaluate((e) => e.outerHTML));
    await page.screenshot({ path: path.join(ARTIFACTS, "table-logos-light.png") });
    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.locator("#menu-anchor button").click();
    await expect(panel.locator('[role="menuitem"]').filter({ hasText: /Built-in Sonnet$/ }).locator(".wa-menu-icon svg path")).toHaveCount(1);
    await panel.screenshot({ path: path.join(ARTIFACTS, "sidepanel-logo.png") });
    const site = await ctx.newPage();
    await site.goto(SITE);
    const bubble = site.locator("web-agent-bubble");
    await bubble.locator("#launcher").click();
    await bubble.locator("#menu-anchor button").click();
    await expect(bubble.locator('[role="menuitem"]').filter({ hasText: /Built-in Sonnet$/ }).locator(".wa-menu-icon svg path")).toHaveCount(1);
    await site.screenshot({ path: path.join(ARTIFACTS, "bubble-logo.png") });
  } finally { await ctx.close(); }
});

test("B4: the default brand opens the custom form directly", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await openOptions(page, extensionId);
  await page.locator("#tab-btn-models").click();
  await page.locator("#add-model-btn").click();
  await expect(page.locator("dialog.provider-dialog")).toBeVisible();
  await expect(page.locator("dialog.provider-dialog h2")).toHaveText("Add custom provider");
  await expect(page.locator("dialog.provider-grid-dialog")).toHaveCount(0);
});
