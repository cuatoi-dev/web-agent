import { test, expect, ask, normalizeBrandReply } from "./demo-helpers";
import { chromium } from "@playwright/test";
import { patchedExtension, removePatchedExtension } from "./fixtures/patched-extension";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PATCH_DIR_NAME = "brand-models-demo";

const PROOF_MODELS = [
  { id: "proof-anthropic", label: "Proof Anthropic", endpoint: "http://localhost:30000/api/anthropic", wireFormat: "anthropic", model: "sonnet", vision: true },
  { id: "proof-openai", label: "Proof OpenAI", endpoint: "http://localhost:30000/api/openai/v1", wireFormat: "openai", model: "sonnet", vision: true },
  { id: "proof-gemini", label: "Proof Gemini", endpoint: "http://localhost:30000/api/gemini", wireFormat: "gemini", model: "gemini-flash-lite-latest", vision: true },
];

/** Which bundled model.yml entry gives each proof model its key. */
const BUNDLED_ID: Record<string, string> = {
  "proof-anthropic": "anthropic-sonnet",
  "proof-openai": "openai-sonnet",
  "proof-gemini": "gemini-flash",
};

const PROMPT_TEXT = "Answer with exactly one word: BRAND002.";

test.describe("Brand models — live proof", () => {
  test.afterAll(async () => {
    await removePatchedExtension(PATCH_DIR_NAME);
  });

  test("three brand entries route to three live wire formats", async () => {
    test.setTimeout(300_000);

    // The gateway needs the brand key; take it from the built brand
    // so the literal stays only in model.yml.
    const bundled = JSON.parse(await fs.readFile(path.resolve(HERE, "../dist/brand.json"), "utf8")) as { models: { id: string; apiKey?: string }[] };
    const models = PROOF_MODELS.map((m) => ({ ...m, apiKey: bundled.models.find((b) => b.id === BUNDLED_ID[m.id])?.apiKey ?? "" }));
    expect(models.every((m) => m.apiKey !== "")).toBe(true);
    const extensionDir = await patchedExtension(PATCH_DIR_NAME, { models });

    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });

    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const extensionId = worker.url().split("/")[2];

    const setModel = (m: (typeof PROOF_MODELS)[number]) =>
      worker.evaluate((entry) => chrome.storage.local.set({
        modelStore: { providers: [], brandKeys: {}, disabled: [], defaultModel: `brand:${entry.id}` },
      }), m);

    const panel = await context.newPage();
    await panel.setViewportSize({ width: 400, height: 700 });

    // Anthropic wire.
    await setModel(PROOF_MODELS[0]);
    const anthropicRequests: { url: string; names: string[] }[] = [];
    panel.on("request", (req) => { if (req.url().includes("/api/")) anthropicRequests.push({ url: req.url(), names: Object.keys(req.headers()) }); });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panel.locator("#chat agent-chat-panel")).toBeAttached();
    const anthropic = await ask(panel, PROMPT_TEXT);
    expect(normalizeBrandReply(anthropic.reply)).toBe("BRAND002");
    expect(anthropicRequests.some((r) => r.url.startsWith("http://localhost:30000/api/anthropic"))).toBe(true);
    const anthropicReq = anthropicRequests.find((r) => r.url.startsWith("http://localhost:30000/api/anthropic"));
    expect(anthropicReq).toBeDefined();
    expect(anthropicReq!.names).toContain("x-api-key");
    expect(anthropicReq!.names).not.toContain("x-web-agent-token");
    console.log("LIVE-HEADERS", "anthropic", anthropicReq!.names.filter((n) => ["authorization", "x-api-key", "x-goog-api-key", "x-web-agent-token"].includes(n)).join(","));

    // OpenAI wire.
    panel.removeAllListeners("request");
    const openaiRequests: { url: string; names: string[] }[] = [];
    panel.on("request", (req) => { if (req.url().includes("/api/")) openaiRequests.push({ url: req.url(), names: Object.keys(req.headers()) }); });
    await setModel(PROOF_MODELS[1]);
    await panel.reload();
    await expect(panel.locator("#chat agent-chat-panel")).toBeAttached();
    const openai = await ask(panel, PROMPT_TEXT);
    expect(normalizeBrandReply(openai.reply)).toBe("BRAND002");
    expect(openaiRequests.some((r) => r.url.startsWith("http://localhost:30000/api/openai/v1"))).toBe(true);
    const openaiReq = openaiRequests.find((r) => r.url.startsWith("http://localhost:30000/api/openai/v1"));
    expect(openaiReq).toBeDefined();
    expect(openaiReq!.names).toContain("authorization");
    expect(openaiReq!.names).not.toContain("x-web-agent-token");
    console.log("LIVE-HEADERS", "openai", openaiReq!.names.filter((n) => ["authorization", "x-api-key", "x-goog-api-key", "x-web-agent-token"].includes(n)).join(","));

    // Gemini wire.
    panel.removeAllListeners("request");
    const geminiRequests: { url: string; names: string[] }[] = [];
    panel.on("request", (req) => { if (req.url().includes("/api/")) geminiRequests.push({ url: req.url(), names: Object.keys(req.headers()) }); });
    await setModel(PROOF_MODELS[2]);
    await panel.reload();
    await expect(panel.locator("#chat agent-chat-panel")).toBeAttached();
    const gemini = await ask(panel, PROMPT_TEXT);
    expect(normalizeBrandReply(gemini.reply)).toBe("BRAND002");
    expect(geminiRequests.some((r) => r.url.startsWith("http://localhost:30000/api/gemini"))).toBe(true);
    const geminiReq = geminiRequests.find((r) => r.url.startsWith("http://localhost:30000/api/gemini"));
    expect(geminiReq).toBeDefined();
    expect(geminiReq!.names).toContain("x-goog-api-key");
    expect(geminiReq!.names).not.toContain("x-web-agent-token");
    console.log("LIVE-HEADERS", "gemini", geminiReq!.names.filter((n) => ["authorization", "x-api-key", "x-goog-api-key", "x-web-agent-token"].includes(n)).join(","));

    await context.close();
  });
});
