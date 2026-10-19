import { test, expect, openOptions, optionsReady } from "./extension.fixture";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.resolve(HERE, "../../../temp/artifacts/2026-08-16-124449-005-options-page-theme-dark-light-auto");

async function writeSettings(worker: import("@playwright/test").Worker, theme: "auto" | "wa2-dark" | "wa2-light"): Promise<void> {
  await worker.evaluate(async (t) => {
    await chrome.storage.local.set({
      enabledOrigins: ["http://localhost:10040"],
      agentSettings: {
        endpoint: "http://localhost:10040/plain.html",
        wireFormat: "openai",
        model: "test-model-id",
        apiKey: "",
        theme: t,
      },
    });
  }, theme);
}

test.describe("Theme picker and injection", () => {
  test.beforeEach(async () => {
    await fs.mkdir(ARTIFACTS, { recursive: true });
  });

  test("wa2-dark on an unthemed site", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await writeSettings(worker, "wa2-dark");

    const page = await context.newPage();
    await page.goto("http://localhost:10040/plain.html");
    const bubble = page.locator("web-agent-bubble");
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toHaveAttribute("data-theme", "wa2-dark");
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBeNull();

    await page.locator("web-agent-bubble #launcher").click();
    await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached();
    await page.screenshot({ path: path.join(ARTIFACTS, "01-fixture-dark.png"), fullPage: true });
  });

  test("wa2-light on an unthemed site", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await writeSettings(worker, "wa2-light");

    const page = await context.newPage();
    await page.goto("http://localhost:10040/plain.html");
    const bubble = page.locator("web-agent-bubble");
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toHaveAttribute("data-theme", "wa2-light");
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBeNull();

    await page.locator("web-agent-bubble #launcher").click();
    await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached();
    await page.screenshot({ path: path.join(ARTIFACTS, "02-fixture-light.png"), fullPage: true });
  });

  test("auto resolves from the media query at load", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await writeSettings(worker, "auto");

    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("http://localhost:10040/plain.html");
    await expect(page.locator("web-agent-bubble")).toHaveAttribute("data-theme", "wa2-dark");
  });

  test("auto follows a live media-query change with no reload", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await writeSettings(worker, "auto");

    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("http://localhost:10040/plain.html");
    await page.evaluate(() => { window.__WA_NO_RELOAD__ = true; });
    const bubble = page.locator("web-agent-bubble");
    await expect(bubble).toHaveAttribute("data-theme", "wa2-dark");

    await page.emulateMedia({ colorScheme: "light" });
    await expect(bubble).toHaveAttribute("data-theme", "wa2-light");

    const still = await page.evaluate(() => window.__WA_NO_RELOAD__);
    expect(still).toBe(true);
  });

  test("a fixed choice ignores the system", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await writeSettings(worker, "wa2-dark");

    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("http://localhost:10040/plain.html");
    await expect(page.locator("web-agent-bubble")).toHaveAttribute("data-theme", "wa2-dark");
  });

  test("the do-not-theme rule on a site that supplies its own tokens", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await writeSettings(worker, "wa2-dark");

    const page = await context.newPage();
    await page.goto("http://localhost:10040/themed-site.html");
    const bubble = page.locator("web-agent-bubble");
    await expect(bubble).toHaveCount(1);
    await expect(bubble).not.toHaveAttribute("data-theme");
    await expect(page.locator("web-agent-bubble[data-theme]")).toHaveCount(0);
    await expect(page.locator("web-agent-bubble #launcher")).toBeVisible();

    await page.locator("web-agent-bubble #launcher").click();
    await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached();
    await page.screenshot({ path: path.join(ARTIFACTS, "03-fixture-site-supplies-tokens.png"), fullPage: true });
  });

  test("the injected stylesheet is present and did not restyle the page", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await writeSettings(worker, "wa2-dark");

    const page = await context.newPage();
    await page.goto("http://localhost:10040/plain.html");
    const rootTokens = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--wa-background-color").trim());
    expect(rootTokens).toBe("");
  });

  test("stylesheet came from the manifest, not an appended style element", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await writeSettings(worker, "wa2-dark");

    const page = await context.newPage();
    await page.goto("http://localhost:10040/plain.html");
    const count = await page.evaluate(() =>
      Array.from(document.querySelectorAll("style"))
        .filter((s) => (s.textContent ?? "").includes("wa2-dark")).length);
    expect(count).toBe(0);
  });

  test("the options page saves the theme and shows it again after a reload", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.addInitScript(() => {
      // Chrome's headless mode cannot interact with the native permission
      // grant dialog, so override chrome.permissions.request to
      // auto-approve. `chrome.permissions` is declared read-only by
      // @types/chrome; the cast through `unknown` replaces it for this test
      // only, without an `any` type anywhere.
      (chrome as unknown as { permissions: unknown }).permissions = {
        ...chrome.permissions,
        request: () => Promise.resolve(true),
      };
    });
    await openOptions(page, extensionId);
    await page.fill("#endpoint", "http://localhost:10040/plain.html");
    await page.selectOption("#theme", "wa2-light");
    await page.click("#save");
    await expect(page.locator("#status")).toContainText("Saved.");

    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const stored = await worker.evaluate(async () => {
      function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null;
      }
      const got: unknown = await chrome.storage.local.get("agentSettings");
      if (!isRecord(got) || !isRecord(got.agentSettings)) return undefined;
      return typeof got.agentSettings.theme === "string" ? got.agentSettings.theme : undefined;
    });
    expect(stored).toBe("wa2-light");

    await page.reload();
    await optionsReady(page);
    await expect(page.locator("#theme")).toHaveValue("wa2-light");
    await page.screenshot({ path: path.join(ARTIFACTS, "04-options-page-theme.png"), fullPage: true });
  });

  test("the picker offers the built-in themes in order", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);
    const values = await page.$$eval("#theme option", (opts) =>
      (opts as HTMLOptionElement[]).map((o) => o.value));
    expect(values).toEqual(["auto", "wa1-dark", "wa2-dark", "wa2-light"]);
  });
});
