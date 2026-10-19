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

/** Copies the extension build with the built-in providers enabled. */
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

test("B1: one-form Add model starts on OpenRouter and applies Anthropic", async () => {
  const { ctx, id } = await launch();
  try {
    const page = await ctx.newPage();
    await openOptions(page, id);
    await page.locator("#tab-btn-models").click();
    await page.locator("#add-model-btn").click();
    const form = page.locator("dialog.provider-dialog");
    const select = page.locator("#provider-select");
    await expect(form).toBeVisible();
    await expect(page.locator("dialog")).toHaveCount(1);
    await expect(select.locator("option")).toHaveText([
      "OpenRouter", "Anthropic", "OpenAI", "xAI", "Google AI", "DeepSeek", "Moonshot (Kimi)", "Custom",
    ]);
    await expect(select).toHaveValue("openrouter");
    await expect(page.locator("dialog.provider-dialog h2")).toHaveText("Add model");
    await expect(page.locator("dialog.provider-dialog h2 svg.logo path")).toHaveCount(1);
    await expect(page.locator(".prov-select svg.logo path")).toHaveCount(1);
    await expect(page.locator("#provider-name")).toHaveValue("OpenRouter");
    await expect(page.locator("#provider-endpoint")).toHaveValue("https://openrouter.ai/api/v1");
    await expect(page.locator('.format-opt[data-format="openai"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".form-model-row")).toHaveCount(1);
    await expect(page.locator(".refresh-models-btn")).toBeVisible();

    await select.selectOption("custom");
    const fallback = await page.locator(".prov-select svg.logo").evaluate((e) => e.innerHTML);
    for (const provider of ["openrouter", "anthropic", "openai", "xai", "google", "deepseek", "moonshot"]) {
      await select.selectOption(provider);
      expect(await page.locator(".prov-select svg.logo").evaluate((e) => e.innerHTML)).not.toBe(fallback);
    }

    await select.selectOption("anthropic");
    await expect(page.locator("#provider-name")).toHaveValue("Anthropic");
    await expect(page.locator("#provider-endpoint")).toHaveValue("https://api.anthropic.com");
    await expect(page.locator('.format-opt[data-format="anthropic"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".form-model-row")).toHaveCount(4);
    for (const input of await page.locator(".form-model-vision").all()) await expect(input).toBeChecked();
    await expect(page.locator(".refresh-models-btn")).toBeHidden();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      const heights = await page.locator(".form-model-row").first().evaluate((row) => ({
        id: row.querySelector(".form-model-id")!.getBoundingClientRect().height,
        label: row.querySelector(".form-model-label")!.getBoundingClientRect().height,
      }));
      expect(Math.abs(heights.id - heights.label)).toBeLessThanOrEqual(1);
      await form.screenshot({ path: path.join(ARTIFACTS, `anthropic-form-${colorScheme}.png`) });
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
    const select = page.locator("#provider-select");
    await select.selectOption("google");
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
    await select.selectOption("xai");
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
  await expect(page.locator("#provider-select")).toHaveCount(0);
});

test("B5: switching provider keeps the key and headers and Custom clears the preset", async () => {
  const { ctx, id } = await launch();
  try {
    const page = await ctx.newPage();
    await openOptions(page, id);
    await page.locator("#tab-btn-models").click();
    await page.locator("#add-model-btn").click();
    const select = page.locator("#provider-select");
    await page.locator("#provider-api-key").fill("sk-keep-me");
    await page.locator(".add-header-btn").click();
    await page.locator(".header-name").fill("X-Team");
    await page.locator(".header-value").fill("web");

    await select.selectOption("anthropic");
    await expect(page.locator("#provider-api-key")).toHaveValue("sk-keep-me");
    await expect(page.locator(".header-name")).toHaveValue("X-Team");
    await expect(page.locator(".header-value")).toHaveValue("web");
    await page.screenshot({ path: path.join(ARTIFACTS, "switching-keeps-key-light.png") });

    await select.selectOption("custom");
    await expect(page.locator("#provider-name")).toHaveValue("");
    await expect(page.locator("#provider-endpoint")).toHaveValue("");
    await expect(page.locator(".form-model-id")).toHaveCount(1);
    await expect(page.locator(".form-model-id")).toHaveValue("");
    await expect(page.locator("#provider-format")).toHaveValue("openai");
    await expect(page.locator("#provider-api-key")).toHaveValue("sk-keep-me");
    await expect(page.locator(".header-name")).toHaveValue("X-Team");
    const customLogo = await page.locator(".prov-select svg.logo").evaluate((e) => e.innerHTML);
    await select.selectOption("openrouter");
    expect(await page.locator(".prov-select svg.logo").evaluate((e) => e.innerHTML)).not.toBe(customLogo);
    await page.locator(".cancel-btn").click();
  } finally { await ctx.close(); }
});

test("B6: Edit shows the Provider select locked and keeps builtIn", async () => {
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
              name: "DeepSeek",
              builtIn: "deepseek",
              wireFormat: "openai",
              endpoint: "http://localhost:10040/v1",
              apiKey: "",
              headers: [],
              models: [{ model: "deepseek-flash", label: "DeepSeek V4.1 Flash", vision: true }],
            },
            {
              id: "p2",
              name: "Local",
              wireFormat: "openai",
              endpoint: "http://localhost:10040/v1",
              apiKey: "",
              headers: [],
              models: [{ model: "m1", label: "M1", vision: false }],
            },
          ],
          brandKeys: {},
          disabled: [],
          defaultModel: "p1/deepseek-flash",
        },
      });
    });
    await page.reload();
    await optionsReady(page);
    await page.locator("#tab-btn-models").click();

    await page.locator('tr.prov[data-provider-id="p1"] .edit-btn').click();
    const form = page.locator("dialog.provider-dialog");
    const select = page.locator("#provider-select");
    await expect(form).toBeVisible();
    await expect(select).toHaveValue("deepseek");
    await expect(select).toBeDisabled();
    await expect(form.locator("h2")).toHaveText("Edit DeepSeek");
    await expect(form.locator(".prov-select svg.logo path")).toHaveCount(1);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await form.screenshot({ path: path.join(ARTIFACTS, `edit-deepseek-${colorScheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: "light" });
    await form.locator("#provider-name").fill("DeepSeek kept");
    await form.locator(".save-provider-btn").click();
    await expect(form).toHaveCount(0);
    const saved = await worker.evaluate(async () =>
      (await chrome.storage.local.get("modelStore")).modelStore.providers.find(
        (p: { id: string }) => p.id === "p1",
      ),
    );
    expect(saved.name).toBe("DeepSeek kept");
    expect(saved.builtIn).toBe("deepseek");

    await page.locator('tr.prov[data-provider-id="p2"] .edit-btn').click();
    await expect(page.locator("#provider-select")).toHaveValue("custom");
    await expect(page.locator("#provider-select")).toBeDisabled();
    await expect(page.locator("dialog.provider-dialog h2")).toHaveText("Edit provider — Local");
    await page.locator(".cancel-btn").click();
  } finally { await ctx.close(); }
});
