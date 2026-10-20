import { test, expect, openOptions, optionsReady } from "./extension.fixture";
import type { BrowserContext, Locator, Page, Worker } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = process.env.E2E_ARTIFACTS_DIR ?? path.resolve(HERE, "../temp/e2e-artifacts/model-test");
const RUN = `mt${Date.now()}`;
const BASE = `http://localhost:10040/api/mtest/${RUN}`;

async function worker(context: BrowserContext): Promise<Worker> {
  let [w] = context.serviceWorkers();
  if (!w) w = await context.waitForEvent("serviceworker");
  return w;
}

async function storeSnapshot(w: Worker): Promise<string> {
  return w.evaluate(async () => JSON.stringify((await chrome.storage.local.get("modelStore")).modelStore ?? null));
}

async function requests(page: Page): Promise<{ path: string; model: string; headers: Record<string, string>; body: any }[]> {
  return (await page.request.get(`${BASE}/requests`)).json();
}

function row(dialog: Locator, i: number): Locator {
  return dialog.locator(".form-model-row").nth(i);
}

test.describe("Model Test button (138/001)", () => {
  test("M1: pass, 404, disabled, screenshots, nothing saved", async ({ context, extensionId }) => {
    await fs.mkdir(ARTIFACTS, { recursive: true });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    await optionsReady(page);
    await page.locator("#tab-btn-models").click();
    await page.locator("#add-model-btn").click();
    const dialog = page.locator("dialog.provider-dialog");
    await expect(dialog).toBeVisible();

    const w = await worker(context);
    const beforeStore = await storeSnapshot(w);

    await page.locator("#provider-name").fill("Stub");
    await page.locator("#provider-format").selectOption("openai");
    await page.locator("#provider-endpoint").fill(`${BASE}/openai/v1`);
    await page.locator("#provider-api-key").fill("k1");

    await row(dialog, 0).locator(".form-model-id").fill("pass");
    await dialog.locator(".add-model-row-btn").click();
    await row(dialog, 1).locator(".form-model-id").fill("e404");
    await dialog.locator(".add-model-row-btn").click();
    // row 2 left empty

    for (let i = 0; i < 3; i++) {
      const btn = row(dialog, i).locator(".test-model-btn");
      await expect(btn.locator("svg path")).toHaveCount(1);
      expect(await btn.textContent()).toBe("");
    }

    const row2Btn = row(dialog, 2).locator(".test-model-btn");
    await expect(row2Btn).toBeDisabled();
    await expect(row2Btn).toHaveAttribute("title", "Enter a model ID first");

    await row(dialog, 0).locator(".test-model-btn").click();
    const r0Result = row(dialog, 0).locator(".form-model-result");
    await expect(r0Result).toHaveText(/^✓ OK · (\d+ ms|\d+\.\d+ s)$/);
    await expect(r0Result).toHaveClass(/ok/);

    await row(dialog, 1).locator(".test-model-btn").click();
    const r1Result = row(dialog, 1).locator(".form-model-result");
    await expect(r1Result).toHaveText("✗ 404 Not Found. Check the model ID.");
    await expect(r1Result).toHaveClass(/fail/);

    const reqs = await requests(page);
    expect(reqs).toHaveLength(2);
    for (const req of reqs) {
      expect(req.path).toBe("openai/v1/chat/completions");
      expect(req.body.max_tokens).toBe(256);
      expect(req.body.stream).toBe(false);
      expect(req.body.messages).toHaveLength(1);
      expect(req.body.messages[0]).toEqual({ role: "user", content: "Reply with OK" });
      expect(req.body.tools).toBeUndefined();
      expect(JSON.stringify(req.body)).not.toContain("image");
      expect(req.headers.authorization).toBe("Bearer k1");
    }

    await dialog.screenshot({ path: path.join(ARTIFACTS, "form-light.png") });

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "wa2-dark");
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await dialog.screenshot({ path: path.join(ARTIFACTS, "form-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });

    await row(dialog, 2).locator(".form-model-id").fill("m3");
    await expect(row2Btn).toBeEnabled();
    await expect(row2Btn).toHaveAttribute("title", "Test key and model");

    const afterStore = await storeSnapshot(w);
    expect(afterStore).toBe(beforeStore);

    await dialog.locator(".cancel-btn").click();
    await expect(dialog).toBeHidden();
  });

  test("M2: every failure line", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    await optionsReady(page);
    await page.locator("#tab-btn-models").click();
    await page.locator("#add-model-btn").click();
    const dialog = page.locator("dialog.provider-dialog");
    await expect(dialog).toBeVisible();

    await page.locator("#provider-endpoint").fill(`${BASE}/openai/v1`);
    await page.locator("#provider-api-key").fill("k");

    const cases = [
      ["e401", "✗ 401 Unauthorized. Check the API key."],
      ["e403", "✗ 403 Forbidden. Check the API key."],
      ["e500", "✗ 500 Internal Server Error: boom"],
      ["e502", "✗ 502 Bad Gateway: " + ("<html><body>" + "x".repeat(200) + "</body></html>").slice(0, 120) + "…"],
      ["okay", '✗ The reply did not contain OK: "Okay, done…"'],
      ["token", '✗ The reply did not contain OK: "token…"'],
    ];

    for (let i = 0; i < cases.length; i++) {
      if (i > 0) await dialog.locator(".add-model-row-btn").click();
      const [id, expected] = cases[i];
      const r = row(dialog, i);
      await r.locator(".form-model-id").fill(id);
      await r.locator(".test-model-btn").click();
      await expect(r.locator(".form-model-result")).toHaveText(expected);
      await expect(r.locator(".form-model-result")).toHaveClass(/fail/);
    }

    // Unreachable endpoint
    await dialog.locator(".add-model-row-btn").click();
    const unreachableRow = row(dialog, cases.length);
    await unreachableRow.locator(".form-model-id").fill("pass");
    await page.locator("#provider-endpoint").fill("http://localhost:10049/v1");
    await unreachableRow.locator(".test-model-btn").click();
    await expect(unreachableRow.locator(".form-model-result")).toHaveText("✗ The endpoint could not be reached.");
    await expect(unreachableRow.locator(".form-model-result")).toHaveClass(/fail/);

    await dialog.locator(".cancel-btn").click();
  });

  test("M3: anthropic and gemini", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    await optionsReady(page);
    await page.locator("#tab-btn-models").click();
    await page.locator("#add-model-btn").click();
    const dialog = page.locator("dialog.provider-dialog");
    await expect(dialog).toBeVisible();

    await page.locator("#provider-api-key").fill("k1");
    await page.locator("#provider-format").selectOption("anthropic");
    await page.locator("#provider-endpoint").fill(`${BASE}/anthropic`);
    await row(dialog, 0).locator(".form-model-id").fill("pass");
    await row(dialog, 0).locator(".test-model-btn").click();
    await expect(row(dialog, 0).locator(".form-model-result")).toHaveText(/^✓ OK · /);

    let reqs = await requests(page);
    const anthropicReq = reqs[reqs.length - 1];
    expect(anthropicReq.path).toBe("anthropic/v1/messages");
    expect(anthropicReq.body.max_tokens).toBe(256);
    expect(anthropicReq.headers["x-api-key"]).toBe("k1");
    expect(anthropicReq.headers["anthropic-version"]).toBe("2023-06-01");
    expect(anthropicReq.body.tools).toBeUndefined();
    expect(JSON.stringify(anthropicReq.body.messages)).toContain("Reply with OK");

    await page.locator("#provider-format").selectOption("gemini");
    await page.locator("#provider-endpoint").fill(`${BASE}/gemini`);
    await row(dialog, 0).locator(".form-model-id").fill("pass");
    await row(dialog, 0).locator(".test-model-btn").click();
    await expect(row(dialog, 0).locator(".form-model-result")).toHaveText(/^✓ OK · /);

    reqs = await requests(page);
    const geminiReq = reqs[reqs.length - 1];
    expect(geminiReq.path).toBe("gemini/v1beta/models/pass:generateContent");
    expect(geminiReq.body.generationConfig.maxOutputTokens).toBe(256);
    expect(geminiReq.headers["x-goog-api-key"]).toBe("k1");
    expect(geminiReq.body.tools).toBeUndefined();
    expect(JSON.stringify(geminiReq.body.contents)).toContain("Reply with OK");

    await dialog.locator(".cancel-btn").click();
  });

  test("M4: running state, timeout, no retry", async ({ context, extensionId }) => {
    test.setTimeout(90_000);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    await optionsReady(page);
    await page.locator("#tab-btn-models").click();
    await page.locator("#add-model-btn").click();
    const dialog = page.locator("dialog.provider-dialog");
    await expect(dialog).toBeVisible();

    await page.locator("#provider-endpoint").fill(`${BASE}/openai/v1`);
    await page.locator("#provider-api-key").fill("k");
    const r0 = row(dialog, 0);
    await r0.locator(".form-model-id").fill("hang");

    const btn = r0.locator(".test-model-btn");
    await btn.click();

    await expect(btn).toBeDisabled();
    await expect(btn).toHaveAttribute("aria-label", "Testing key and model");
    await expect(btn.locator(".test-spinner")).toHaveCount(1);
    await expect(btn.locator("svg")).toHaveCount(0);
    await expect(page.getByText("Testing…")).toHaveCount(0);

    const result = r0.locator(".form-model-result");
    await expect(result).toHaveText("✗ No answer after 30 s.", { timeout: 40_000 });
    await expect(result).toHaveClass(/fail/);
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveAttribute("aria-label", "Test key and model");
    await expect(btn.locator("svg")).toHaveCount(1);

    const reqs = await requests(page);
    const hangs = reqs.filter((r) => r.model === "hang");
    expect(hangs).toHaveLength(1);

    await dialog.locator(".cancel-btn").click();
  });

  test("M5: unsaved values in Edit provider, clear rules, stale result", async ({ context, extensionId }) => {
    const w = await worker(context);
    await w.evaluate(async (base) => {
      await chrome.storage.local.set({
        modelStore: {
          providers: [
            {
              id: "p1",
              name: "Stub",
              wireFormat: "openai",
              endpoint: `${base}/openai/v1`,
              apiKey: "old-key",
              headers: [],
              models: [
                { model: "pass", label: "Pass 1", vision: false },
                { model: "pass2", label: "Pass 2", vision: false },
              ],
            },
          ],
          brandKeys: {},
          disabled: [],
          defaultModel: null,
        },
      });
    }, BASE);

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    await optionsReady(page);
    await page.locator("#tab-btn-models").click();

    await page.locator('tr.prov[data-provider-id="p1"] .edit-btn').click();
    const dialog = page.locator("dialog.provider-dialog");
    await expect(dialog).toBeVisible();

    const beforeStore = await storeSnapshot(w);

    // Unsaved key used
    await page.locator("#provider-api-key").fill("new-key");
    await row(dialog, 0).locator(".test-model-btn").click();
    await expect(row(dialog, 0).locator(".form-model-result")).toHaveText(/^✓ OK · /);
    const reqs = await requests(page);
    expect(reqs[reqs.length - 1].headers.authorization).toBe("Bearer new-key");

    const passBoth = async () => {
      await row(dialog, 0).locator(".test-model-btn").click();
      await row(dialog, 1).locator(".test-model-btn").click();
      await expect(row(dialog, 0).locator(".form-model-result")).toHaveText(/^✓ OK · /);
      await expect(row(dialog, 1).locator(".form-model-result")).toHaveText(/^✓ OK · /);
    };

    // Row 0 ID edit clears only row 0
    await passBoth();
    await row(dialog, 0).locator(".form-model-id").fill("pass-edited");
    await expect(row(dialog, 0).locator(".form-model-result")).toBeHidden();
    await expect(row(dialog, 1).locator(".form-model-result")).toBeVisible();
    await row(dialog, 0).locator(".form-model-id").fill("pass");

    // Endpoint edit clears both
    await passBoth();
    const ep = page.locator("#provider-endpoint");
    await ep.fill(`${BASE}/openai/v1/`);
    await ep.fill(`${BASE}/openai/v1`);
    await expect(row(dialog, 0).locator(".form-model-result")).toBeHidden();
    await expect(row(dialog, 1).locator(".form-model-result")).toBeHidden();

    // Key edit clears both
    await passBoth();
    await page.locator("#provider-api-key").fill("new-key-2");
    await expect(row(dialog, 0).locator(".form-model-result")).toBeHidden();
    await expect(row(dialog, 1).locator(".form-model-result")).toBeHidden();

    // Add header button clears both
    await passBoth();
    await dialog.locator(".add-header-btn").click();
    await expect(row(dialog, 0).locator(".form-model-result")).toBeHidden();
    await expect(row(dialog, 1).locator(".form-model-result")).toBeHidden();

    // Header name fill clears both
    await passBoth();
    await dialog.locator(".header-row .header-name").first().fill("X-Team");
    await expect(row(dialog, 0).locator(".form-model-result")).toBeHidden();
    await expect(row(dialog, 1).locator(".form-model-result")).toBeHidden();

    // Remove header button clears both
    await passBoth();
    await dialog.locator(".header-row .remove-header-btn").first().click();
    await expect(row(dialog, 0).locator(".form-model-result")).toBeHidden();
    await expect(row(dialog, 1).locator(".form-model-result")).toBeHidden();

    // Format select clears both
    await passBoth();
    await page.locator("#provider-format").selectOption("anthropic");
    await expect(row(dialog, 0).locator(".form-model-result")).toBeHidden();
    await expect(row(dialog, 1).locator(".form-model-result")).toBeHidden();
    await page.locator("#provider-format").selectOption("openai");

    // Stale result: slow model, edit key while running
    await row(dialog, 0).locator(".form-model-id").fill("slow");
    await row(dialog, 0).locator(".test-model-btn").click();
    await page.locator("#provider-api-key").fill("other-key");
    await page.waitForTimeout(3000);
    await expect(row(dialog, 0).locator(".form-model-result")).toBeHidden();
    await expect(row(dialog, 0).locator(".test-model-btn")).toBeEnabled();
    await expect(row(dialog, 0).locator(".test-model-btn svg")).toHaveCount(1);

    const duringStore = await storeSnapshot(w);
    expect(duringStore).toBe(beforeStore);
    await dialog.locator(".cancel-btn").click();
    const afterCancelStore = await storeSnapshot(w);
    expect(afterCancelStore).toBe(beforeStore);
  });
});
