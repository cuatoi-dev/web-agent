import { test, expect, ask, normalizeBrandReply } from "./demo-helpers";
import { chromium } from "@playwright/test";
import { patchedExtension, removePatchedExtension } from "./fixtures/patched-extension";

const PATCH_DIR_NAME = "brand-models-demo";

const PROOF_MODELS = [
  { id: "proof-anthropic", label: "Proof Anthropic", endpoint: "http://localhost:28780/api/anthropic", wireFormat: "anthropic", model: "sonnet", streaming: true },
  { id: "proof-openai", label: "Proof OpenAI", endpoint: "http://localhost:28780/api/openai/v1", wireFormat: "openai", model: "sonnet", streaming: false },
];

const PROMPT_TEXT = "Answer with exactly one word: BRAND002.";

test.describe("Brand models — live proof", () => {
  test.afterAll(async () => {
    await removePatchedExtension(PATCH_DIR_NAME);
  });

  test("two brand entries route to two live wire formats", async () => {
    test.setTimeout(300_000);
    const extensionDir = await patchedExtension(PATCH_DIR_NAME, { models: PROOF_MODELS });

    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });

    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const extensionId = worker.url().split("/")[2];

    const setModel = (m: (typeof PROOF_MODELS)[number]) =>
      worker.evaluate((entry) => chrome.storage.local.set({
        agentSettings: { endpoint: entry.endpoint, wireFormat: entry.wireFormat, model: entry.model, streaming: entry.streaming, apiKey: "", theme: "auto" },
      }), m);

    const panel = await context.newPage();
    await panel.setViewportSize({ width: 400, height: 700 });

    // Anthropic wire.
    await setModel(PROOF_MODELS[0]);
    const anthropicUrls: string[] = [];
    panel.on("request", (req) => { if (req.url().includes("/api/")) anthropicUrls.push(req.url()); });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panel.locator("#chat agent-chat-panel")).toBeAttached();
    const anthropic = await ask(panel, PROMPT_TEXT);
    expect(normalizeBrandReply(anthropic.reply)).toBe("BRAND002");
    expect(anthropicUrls.some((u) => u.startsWith("http://localhost:28780/api/anthropic"))).toBe(true);
    expect(anthropicUrls.some((u) => u.includes("/api/openai") || u.includes("/api/gemini"))).toBe(false);

    // OpenAI wire.
    panel.removeAllListeners("request");
    const openaiUrls: string[] = [];
    panel.on("request", (req) => { if (req.url().includes("/api/")) openaiUrls.push(req.url()); });
    await setModel(PROOF_MODELS[1]);
    await panel.reload();
    await expect(panel.locator("#chat agent-chat-panel")).toBeAttached();
    const openai = await ask(panel, PROMPT_TEXT);
    expect(normalizeBrandReply(openai.reply)).toBe("BRAND002");
    expect(openaiUrls.some((u) => u.startsWith("http://localhost:28780/api/openai/v1"))).toBe(true);
    expect(openaiUrls.some((u) => u.startsWith("http://localhost:28780/api/anthropic"))).toBe(false);

    await context.close();
  });
});
