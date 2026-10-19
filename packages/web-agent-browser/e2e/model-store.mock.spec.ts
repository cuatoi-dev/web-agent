import { test, expect, openOptions, optionsReady } from "./extension.fixture";
import { chromium, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "../dist");
const TEMP_DIR = path.resolve(HERE, "../temp/e2e-extensions/model-store");
const ARTIFACTS = path.resolve(
  HERE,
  "../../../temp/artifacts/2026-10-19-133304-005-extension-model-store-relay-and-switchers",
);

async function patchedBrand(dir: string, patch: Record<string, unknown>): Promise<string> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.cp(EXT, dir, { recursive: true });
  const file = path.join(dir, "brand.json");
  const brand = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  await fs.writeFile(file, JSON.stringify({ ...brand, ...patch }, null, 2));
  return dir;
}

async function launchPatchedContext(dir: string) {
  const ctx = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  let [worker] = ctx.serviceWorkers();
  if (!worker) worker = await ctx.waitForEvent("serviceworker");
  const extensionId = worker.url().split("/")[2];
  return { ctx, worker, extensionId };
}

function installToolListingMock(page: Page): Promise<void> {
  return page.addInitScript(() => {
    (window as any).__WA_MOCK_SCRIPT__ = (opts: any) => {
      const lastMsg = opts.messages[opts.messages.length - 1];
      const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
      if (lastText.includes("Summarize the following conversation as a short UI title")) {
        return { text: "Title" };
      }
      (window as any).__WA_TOOLS__ = (opts.tools ?? []).map((t: any) => t.name);
      return { text: "Mock response." };
    };
  });
}

/** Opens the kebab menu of the panel or bubble that `root` scopes. */
async function openKebab(root: Locator): Promise<void> {
  await root.locator("#menu-anchor button").click();
}

/** The model items of an open kebab menu, by label. */
function modelItem(root: Locator, label: string): Locator {
  return root.locator('[role="menuitem"]').filter({ hasText: new RegExp(`${label}$`) });
}

const ANTHROPIC_REPLY = {
  content: [{ type: "text", text: "Anthropic reply." }],
  role: "assistant",
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
};

const OPENAI_REPLY = {
  choices: [{ index: 0, message: { role: "assistant", content: "OpenAI reply." }, finish_reason: "stop" }],
};

test.describe("Model store, relay and switchers", () => {
  test.beforeAll(async () => {
    await fs.mkdir(ARTIFACTS, { recursive: true });
  });

  test.afterAll(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  test("K1: Key dialog, then the side panel request carries the key; clearing it brings the token back", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);

    const provRow = page.locator('#model-table tr.prov[data-provider-id="brand:anthropic:http://localhost:28780/api/anthropic"]');
    await provRow.locator(".key-btn").click();

    const dialog = page.locator("#brand-key-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("h2")).toHaveText("Key for Gateway (anthropic)");
    const keyInput = dialog.locator('input[type="password"]');
    await expect(keyInput).toHaveCount(1);
    await expect(keyInput).toHaveAttribute("placeholder", "Leave empty to use the shared Token");

    await dialog.screenshot({ path: path.join(ARTIFACTS, "key-dialog-light.png") });

    await keyInput.fill("k-test-1234");
    await dialog.locator(".dialog-save-btn").click();
    await expect(dialog).toBeHidden();
    await expect(provRow.locator(".prov-sub")).toContainText("key ••••1234");

    const panelPage = await context.newPage();
    let interceptedReq: any = null;
    await panelPage.route("**/api/anthropic/**", async (route) => {
      const req = route.request();
      interceptedReq = {
        url: req.url(),
        headers: req.headers(),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ANTHROPIC_REPLY),
      });
    });

    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panelPage.waitForSelector("agent-chat-panel");
    await panelPage.evaluate(() => {
      const panel = document.querySelector("agent-chat-panel") as any;
      void panel.send("hi");
    });

    await expect.poll(() => interceptedReq).not.toBeNull();
    expect(interceptedReq.headers["x-api-key"]).toBe("k-test-1234");
    expect(interceptedReq.headers["x-web-agent-token"]).toBeUndefined();
    expect(interceptedReq.headers["anthropic-version"]).toBe("2023-06-01");
    expect(interceptedReq.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");

    // Back on options: reopen dialog, see stored key, clear it, save.
    await provRow.locator(".key-btn").click();
    await expect(dialog).toBeVisible();
    await expect(keyInput).toHaveValue("k-test-1234");
    await keyInput.fill("");
    await dialog.locator(".dialog-save-btn").click();
    await expect(dialog).toBeHidden();
    await expect(provRow.locator(".prov-sub")).toContainText("shared Token");

    // Reload side panel and send again: token returns, key absent.
    interceptedReq = null;
    await panelPage.reload();
    await panelPage.waitForSelector("agent-chat-panel");
    await panelPage.evaluate(() => {
      const panel = document.querySelector("agent-chat-panel") as any;
      void panel.send("hi");
    });

    await expect.poll(() => interceptedReq).not.toBeNull();
    expect(interceptedReq.headers["x-web-agent-token"]).toBeDefined();
    expect(interceptedReq.headers["x-api-key"]).toBeUndefined();
  });

  test("S1: Side panel switcher: 3 items with icons; a switch mid-chat goes to the new endpoint and keeps history", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    const anthropicRequests: any[] = [];
    const openaiRequests: any[] = [];

    const panelPage = await context.newPage();
    await panelPage.route("**/api/anthropic/**", async (route) => {
      const req = route.request();
      const post = JSON.parse(req.postData() ?? "{}");
      if (JSON.stringify(post).includes("Summarize the following conversation as a short UI title")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ content: [{ type: "text", text: "Title" }], role: "assistant", stop_reason: "end_turn" }),
        });
        return;
      }
      anthropicRequests.push({ url: req.url(), postData: post });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ANTHROPIC_REPLY),
      });
    });
    await panelPage.route("**/api/openai/**", async (route) => {
      const req = route.request();
      const post = JSON.parse(req.postData() ?? "{}");
      if (JSON.stringify(post).includes("Summarize the following conversation as a short UI title")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: "Title" }, finish_reason: "stop" }] }),
        });
        return;
      }
      openaiRequests.push({ url: req.url(), postData: post });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(OPENAI_REPLY),
      });
    });

    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panelPage.waitForSelector("agent-chat-panel");

    await panelPage.evaluate(() => {
      const panel = document.querySelector("agent-chat-panel") as any;
      void panel.send("first question");
    });

    await expect.poll(() => anthropicRequests.length).toBe(1);

    const panelLoc = panelPage.locator("agent-chat-panel");
    await openKebab(panelLoc);

    for (const label of ["Sonnet", "Sonnet OpenAI", "Gemini Flash"]) {
      const item = modelItem(panelLoc, label);
      await expect(item.locator(".wa-menu-icon svg")).toHaveCount(1);
    }
    await expect(modelItem(panelLoc, "Sonnet")).toContainText("✓");

    await panelPage.screenshot({ path: path.join(ARTIFACTS, "sidepanel-kebab.png") });

    await modelItem(panelLoc, "Sonnet OpenAI").click();

    await panelPage.evaluate(() => {
      const panel = document.querySelector("agent-chat-panel") as any;
      void panel.send("second question");
    });

    await expect.poll(() => openaiRequests.length).toBe(1);
    const req = openaiRequests[0];
    expect(req.url).toBe("http://localhost:28780/api/openai/v1/chat/completions");
    expect(req.postData.model).toBe("sonnet");
    const msgsStr = JSON.stringify(req.postData.messages);
    expect(msgsStr).toContain("first question");
    expect(msgsStr).toContain("Anthropic reply.");

    // Panel still shows first question in its thread
    await expect(panelLoc).toContainText("first question");

    // Storage modelStore is still undefined
    const stored = await worker.evaluate(async () => (await chrome.storage.local.get("modelStore")).modelStore);
    expect(stored).toBeUndefined();
  });

  test("S2: Turning a model off removes it from the side panel switcher, the bubble switcher and the agent editor select after each is reopened", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    const page = await context.newPage();
    await openOptions(page, extensionId);

    // Switch off Gemini Flash
    await page.locator('#model-table tr.model-row[data-ref="brand:gemini-flash"] input.model-enabled').click();
    await expect(page.locator("#model-count")).toHaveText("2 of 3 models enabled");

    // Side panel switcher
    const panelPage = await context.newPage();
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panelPage.waitForSelector("agent-chat-panel");
    const panelLoc = panelPage.locator("agent-chat-panel");
    await openKebab(panelLoc);
    const panelItems = panelLoc.locator('[role="menuitem"]:has(.wa-menu-icon)');
    await expect(panelItems).toHaveCount(2);
    await expect(panelItems.nth(0)).toContainText("Sonnet");
    await expect(panelItems.nth(1)).toContainText("Sonnet OpenAI");

    // Agents tab editor select (after options page is reopened)
    await page.reload();
    await page.locator("#tab-btn-agents").click();
    await page.locator('#agent-cards .card[data-agent-id="chromagent"] .card-edit-btn').click();
    const opts = await page.locator("#edit-chromagent-model option").allTextContents();
    expect(opts).toEqual(["Use the options page model", "Sonnet — Gateway", "Sonnet OpenAI — Gateway"]);

    // Bubble switcher
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
    });
    const bubblePage = await context.newPage();
    await bubblePage.goto("http://localhost:10040/plain.html");
    await expect(bubblePage.locator("web-agent-bubble #launcher")).toBeVisible();
    await bubblePage.locator("web-agent-bubble #launcher").click();
    const bubbleLoc = bubblePage.locator("web-agent-bubble agent-chat-panel");
    await openKebab(bubbleLoc);
    const bubbleItems = bubbleLoc.locator('[role="menuitem"]:has(.wa-menu-icon)');
    await expect(bubbleItems).toHaveCount(2);
    await expect(bubbleItems.nth(0)).toContainText("Sonnet");
    await expect(bubbleItems.nth(1)).toContainText("Sonnet OpenAI");
  });

  test("S3: Agent card fallback", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        agentEdits: {
          tesagent: {
            description: "Tesagent custom",
            instructions: "Custom inst",
            model: "brand:gemini-flash",
            tools: "*",
            excludeTools: [],
            skills: "*",
            excludeSkills: [],
          },
        },
      });
    });

    const page = await context.newPage();
    await openOptions(page, extensionId);

    // Switch off Gemini Flash
    await page.locator('#model-table tr.model-row[data-ref="brand:gemini-flash"] input.model-enabled').click();
    await page.reload();
    await optionsReady(page);

    await page.locator("#tab-btn-agents").click();
    const tesagentCard = page.locator("#agent-cards .card").nth(1);
    await expect(tesagentCard.locator(".facts")).toContainText("Model Options page model (its model is off or deleted)");

    // Open side panel with tesagent selected
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ sidePanelAgent: "tesagent" });
    });
    const panelPage = await context.newPage();
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panelPage.waitForSelector("agent-chat-panel");
    const selModel = await panelPage.evaluate(() => (document.querySelector("agent-chat-panel") as any)?.selectedModel);
    expect(selModel).toBe("brand:anthropic-sonnet");
  });

  test("V1: Vision: page_screenshot and image attach appear only when a vision model is active", async () => {
    const dir = path.resolve(TEMP_DIR, "vision");
    const brandVision = {
      models: [
        { id: "text-only", label: "Text only", endpoint: "http://localhost:28780/api/anthropic", wireFormat: "anthropic", model: "text-only-model", vision: false },
        { id: "seeing", label: "Seeing", endpoint: "http://localhost:28780/api/openai/v1", wireFormat: "openai", model: "sonnet", vision: true },
      ],
    };
    await patchedBrand(dir, brandVision);
    const { ctx, extensionId } = await launchPatchedContext(dir);
    try {
      const panelPage = await ctx.newPage();
      await installToolListingMock(panelPage);
      await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await panelPage.waitForSelector("agent-chat-panel");

      // Send hi with text-only model
      await panelPage.evaluate(() => {
        const panel = document.querySelector("agent-chat-panel") as any;
        void panel.send("hi");
      });
      await expect.poll(() => panelPage.evaluate(() => (window as any).__WA_TOOLS__)).toBeDefined();
      const tools1 = await panelPage.evaluate(() => (window as any).__WA_TOOLS__);
      expect(tools1).not.toContain("page_screenshot");
      await expect(panelPage.locator('agent-chat-panel [data-attachment-provider="image"]')).toHaveCount(0);
      await panelPage.screenshot({ path: path.join(ARTIFACTS, "vision-off.png") });

      // Switch to Seeing model via kebab
      const panelLoc = panelPage.locator("agent-chat-panel");
      await openKebab(panelLoc);
      await modelItem(panelLoc, "Seeing").click();

      // Send again
      await panelPage.evaluate(() => {
        const panel = document.querySelector("agent-chat-panel") as any;
        void panel.send("again");
      });
      await expect.poll(async () => {
        const tools = await panelPage.evaluate(() => (window as any).__WA_TOOLS__);
        return Array.isArray(tools) && tools.includes("page_screenshot");
      }).toBe(true);
      await expect(panelPage.locator('agent-chat-panel [data-attachment-provider="image"]')).toHaveCount(1);
      await panelPage.screenshot({ path: path.join(ARTIFACTS, "vision-on.png") });
    } finally {
      await ctx.close();
    }
  });

  test("R1: Bubble switch through the relay keeps the history", async () => {
    const RUN = "r" + Date.now();
    const dir = path.resolve(TEMP_DIR, `relay-${RUN}`);
    const brandRelay = {
      models: [
        { id: "stub-anthropic", label: "Stub Anthropic", endpoint: `http://localhost:10040/api/llm/${RUN}/anthropic`, wireFormat: "anthropic", model: "stub-a", vision: true, provider: "Stub" },
        { id: "stub-openai", label: "Stub OpenAI", endpoint: `http://localhost:10040/api/llm/${RUN}/openai/v1`, wireFormat: "openai", model: "stub-o", vision: false, provider: "Stub" },
      ],
    };
    await patchedBrand(dir, brandRelay);
    const { ctx, worker } = await launchPatchedContext(dir);
    try {
      await worker.evaluate(async () => {
        await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
      });

      const bubblePage = await ctx.newPage();
      await bubblePage.goto("http://localhost:10040/plain.html");
      await expect(bubblePage.locator("web-agent-bubble #launcher")).toBeVisible();
      await bubblePage.locator("web-agent-bubble #launcher").click();

      const bubbleLoc = bubblePage.locator("web-agent-bubble agent-chat-panel");
      await expect(bubbleLoc).toBeVisible();

      await bubblePage.evaluate(() => {
        const bubble: any = document.querySelector("web-agent-bubble");
        void bubble.send("first question");
      });

      await expect.poll(async () => {
        const res = await bubblePage.request.get(`http://localhost:10040/api/llm/${RUN}/requests`);
        const logs = await res.json();
        return logs.some((l: any) => l.path === "anthropic/v1/messages" && JSON.stringify(l.body).includes("first question"));
      }).toBe(true);

      await openKebab(bubbleLoc);
      await expect(bubbleLoc.locator('[role="menuitem"]:has(.wa-menu-icon)')).toHaveCount(2);
      await bubblePage.screenshot({ path: path.join(ARTIFACTS, "bubble-kebab.png") });

      await modelItem(bubbleLoc, "Stub OpenAI").click();

      await bubblePage.evaluate(() => {
        const bubble: any = document.querySelector("web-agent-bubble");
        void bubble.send("second question");
      });

      await expect.poll(async () => {
        const res = await bubblePage.request.get(`http://localhost:10040/api/llm/${RUN}/requests`);
        const logs = await res.json();
        const o = logs.find((l: any) => l.path === "openai/v1/chat/completions");
        if (!o) return false;
        const bodyStr = JSON.stringify(o.body);
        return o.body?.model === "stub-o"
          && bodyStr.includes("first question")
          && bodyStr.includes("Stub reply from anthropic.")
          && bodyStr.includes("second question");
      }).toBe(true);

      const res = await bubblePage.request.get(`http://localhost:10040/api/llm/${RUN}/requests`);
      const logs = await res.json();
      const a = logs.find((l: any) => l.path === "anthropic/v1/messages");
      expect(a.headers["x-web-agent-token"]).toBeDefined();
      expect(a.headers["anthropic-version"]).toBe("2023-06-01");
    } finally {
      await ctx.close();
    }
  });

  test("L1: Key leak: credentials never reach the web page realm", async () => {
    const RUN_LEAK = "rleak" + Date.now();
    const dir = path.resolve(TEMP_DIR, `leak-${RUN_LEAK}`);
    const brandRelay = {
      models: [
        { id: "stub-anthropic", label: "Stub Anthropic", endpoint: `http://localhost:10040/api/llm/${RUN_LEAK}/anthropic`, wireFormat: "anthropic", model: "stub-a", vision: true, provider: "Stub" },
      ],
    };
    await patchedBrand(dir, brandRelay);
    const { ctx, worker } = await launchPatchedContext(dir);
    try {
      await worker.evaluate(async ({ run }) => {
        await chrome.storage.local.set({
          token: "leak-token-7788",
          modelStore: {
            providers: [],
            brandKeys: {
              [`brand:anthropic:http://localhost:10040/api/llm/${run}/anthropic`]: "leak-key-5150",
            },
            disabled: [],
            defaultModel: "brand:stub-anthropic",
          },
          enabledOrigins: ["http://localhost:10040"],
        });
      }, { run: RUN_LEAK });

      const page = await ctx.newPage();
      await page.addInitScript(() => {
        (window as any).__WA_SEEN__ = [];
        window.addEventListener("message", (event) => {
          try {
            (window as any).__WA_SEEN__.push(JSON.stringify(event.data));
          } catch {
            // Ignore non-serializable message
          }
        });
      });

      await page.goto("http://localhost:10040/plain.html");
      await expect(page.locator("web-agent-bubble #launcher")).toBeVisible();
      await page.locator("web-agent-bubble #launcher").click();

      await page.evaluate(() => {
        const bubble: any = document.querySelector("web-agent-bubble");
        void bubble.send("hi");
      });

      await expect.poll(async () => {
        const res = await page.request.get(`http://localhost:10040/api/llm/${RUN_LEAK}/requests`);
        const logs = await res.json();
        return logs.length;
      }).toBeGreaterThanOrEqual(1);

      await expect.poll(async () => {
        return page.evaluate(() => {
          const bubble: any = document.querySelector("web-agent-bubble");
          return bubble?.messages?.some((m: any) => m.role === "assistant");
        });
      }).toBe(true);

      const seen: string[] = await page.evaluate(() => (window as any).__WA_SEEN__);
      for (const item of seen) {
        expect(item).not.toContain("leak-key-5150");
        expect(item).not.toContain("leak-token-7788");
      }
      expect(seen.some((s) => s.includes('"type":"wa-bridge-enable"') && s.includes('"models"'))).toBe(true);

      const res = await page.request.get(`http://localhost:10040/api/llm/${RUN_LEAK}/requests`);
      const logs = await res.json();
      expect(logs[0].headers["x-api-key"]).toBe("leak-key-5150");
    } finally {
      await ctx.close();
    }
  });
});

// Screenshots go to E2E_ARTIFACTS_DIR when set, else to the package's temp folder.
const ARTIFACTS_006 = process.env.E2E_ARTIFACTS_DIR ?? path.resolve(HERE, "../temp/e2e-artifacts/custom-providers");
const ENDPOINT_006 = "http://localhost:10040/v1";

async function openAddDialog(page: Page): Promise<Locator> {
  await page.locator("#add-model-btn").click();
  const dialog = page.locator("dialog.provider-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Stores a custom provider with models m1..mN (all enabled) and reloads the options page. */
async function seedProvider(page: Page, worker: import("@playwright/test").Worker, models: string[], extra: Record<string, unknown> = {}): Promise<void> {
  await worker.evaluate(
    async ({ models, extra }) => {
      await chrome.storage.local.set({
        modelStore: {
          providers: [
            {
              id: "p1",
              name: "Local",
              wireFormat: "openai",
              endpoint: "http://localhost:10040/v1",
              apiKey: "",
              headers: [],
              models: models.map((m) => ({ model: m, label: m.toUpperCase(), vision: false })),
            },
          ],
          disabled: [],
          brandKeys: {},
          defaultModel: null,
          ...extra,
        },
      });
    },
    { models, extra },
  );
  await page.reload();
  await optionsReady(page);
}

test.describe("Custom providers, multi-select delete and Refresh from /models (136/006)", () => {
  test.beforeAll(async () => {
    await fs.mkdir(ARTIFACTS_006, { recursive: true });
  });

  test("P1: Add form validates, toggles Refresh by format, and saves a provider with two models", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    const dialog = await openAddDialog(page);
    await expect(dialog.locator(".form-model-row")).toHaveCount(1);
    await expect(dialog.locator(".header-row")).toHaveCount(0);
    await expect(dialog.locator(".refresh-models-btn svg")).toHaveCount(1);
    await dialog.screenshot({ path: path.join(ARTIFACTS_006, "provider-form-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await dialog.screenshot({ path: path.join(ARTIFACTS_006, "provider-form-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });

    // Errors.
    await dialog.locator("#provider-endpoint").fill("ftp://x");
    await dialog.locator(".save-provider-btn").click();
    await expect(dialog.locator(".provider-endpoint-error")).toHaveText("Enter an endpoint URL that starts with http:// or https://.");
    await expect(dialog.locator(".provider-models-error")).toHaveText("Add at least one model.");

    await dialog.locator("#provider-endpoint").fill(ENDPOINT_006);
    await dialog.locator(".form-model-id").first().fill("m1");
    await dialog.locator(".add-model-row-btn").click();
    await dialog.locator(".form-model-id").nth(1).fill("m1");
    await dialog.locator(".save-provider-btn").click();
    await expect(dialog.locator(".provider-models-error")).toHaveText("Each model ID can appear only once.");
    await expect(dialog.locator(".provider-endpoint-error")).toBeHidden();

    // Refresh follows the format.
    await dialog.locator("#provider-format").selectOption("anthropic");
    await expect(dialog.locator(".refresh-models-btn")).toBeHidden();
    await dialog.locator("#provider-format").selectOption("openai");
    await expect(dialog.locator(".refresh-models-btn")).toBeVisible();

    // Save a (vision) and b.
    await dialog.locator("#provider-name").fill("Mine");
    await dialog.locator(".form-model-id").nth(0).fill("a");
    await dialog.locator(".form-model-label").nth(0).fill("Alpha");
    await dialog.locator(".form-model-vision").nth(0).check();
    await dialog.locator(".form-model-id").nth(1).fill("b");
    await dialog.locator("#provider-api-key").fill("sk-test-9876");
    await dialog.locator(".add-header-btn").click();
    await dialog.locator(".header-name").fill("X-Team");
    await dialog.locator(".header-value").fill("web");
    await dialog.locator(".save-provider-btn").click();
    await expect(dialog).toBeHidden();

    const prov = page.locator("#model-table tr.prov").filter({ hasText: "Mine" });
    await expect(prov.locator(".prov-sub")).toHaveText(`${ENDPOINT_006} · key ••••9876 · 1 custom header`);
    const rows = page.locator("#model-table tr.model-row").filter({ has: page.locator(".model-select") });
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator(".pill.vision")).toHaveText("Vision");
    await expect(rows.nth(1).locator("td").nth(3)).toHaveText("—");
    await expect(rows.nth(0).locator("input.model-enabled")).toBeChecked();
    await expect(rows.nth(1).locator("input.model-enabled")).toBeChecked();
    await page.screenshot({ path: path.join(ARTIFACTS_006, "table-with-custom.png") });

    // Side panel: both in the switcher; the request carries the header and the key.
    const panelPage = await context.newPage();
    const seen: Record<string, string>[] = [];
    await panelPage.route("http://localhost:10040/v1/**", async (route) => {
      seen.push(route.request().headers());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(OPENAI_REPLY) });
    });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panelPage.waitForSelector("agent-chat-panel");
    const panelLoc = panelPage.locator("agent-chat-panel");
    await openKebab(panelLoc);
    await expect(modelItem(panelLoc, "Alpha")).toHaveCount(1);
    await expect(modelItem(panelLoc, "b")).toHaveCount(1);
    await modelItem(panelLoc, "Alpha").click();
    await panelPage.evaluate(() => {
      void (document.querySelector("agent-chat-panel") as any).send("hi");
    });
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    expect(seen[0]["x-team"]).toBe("web");
    expect(seen[0]["authorization"]).toBe("Bearer sk-test-9876");
    expect(seen[0]["x-web-agent-token"]).toBeUndefined();

    // Edit: values come back; a new label reaches the table and the switcher.
    await prov.locator(".edit-btn").click();
    const edit = page.locator("dialog.provider-dialog");
    await expect(edit.locator("#provider-name")).toHaveValue("Mine");
    await expect(edit.locator("#provider-endpoint")).toHaveValue(ENDPOINT_006);
    await expect(edit.locator("#provider-api-key")).toHaveValue("sk-test-9876");
    await expect(edit.locator(".header-name")).toHaveValue("X-Team");
    await expect(edit.locator(".form-model-id")).toHaveCount(2);
    await expect(edit.locator(".form-model-vision").nth(0)).toBeChecked();
    await edit.locator(".form-model-label").nth(0).fill("Alpha2");
    await edit.locator(".save-provider-btn").click();
    await expect(edit).toBeHidden();
    await expect(page.locator("#model-table")).toContainText("Alpha2");
    await panelPage.reload();
    await panelPage.waitForSelector("agent-chat-panel");
    await openKebab(panelPage.locator("agent-chat-panel"));
    await expect(modelItem(panelPage.locator("agent-chat-panel"), "Alpha2")).toHaveCount(1);
  });

  test("R1: Refresh compares /models with the form; Cancel keeps it, Apply merges", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    let mode: "ok" | "401" | "empty" = "ok";
    await page.route(`${ENDPOINT_006}/models`, async (route) => {
      if (mode === "401") {
        await route.fulfill({ status: 401, body: "{}" });
      } else {
        const body = mode === "empty" ? {} : { data: [{ id: "a" }, { id: "b" }, { id: "c" }] };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      }
    });
    const dialog = await openAddDialog(page);
    await dialog.locator("#provider-endpoint").fill(ENDPOINT_006);
    await dialog.locator(".form-model-id").first().fill("b");
    await dialog.locator(".form-model-vision").first().check();
    await dialog.locator(".add-model-row-btn").click();
    await dialog.locator(".form-model-id").nth(1).fill("x");
    const ids = () => dialog.locator(".form-model-id").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

    // Errors change nothing.
    mode = "401";
    await dialog.locator(".refresh-models-btn").click();
    const err = page.locator("dialog.refresh-error-dialog");
    await expect(err).toContainText("The endpoint answered 401");
    await expect(err).toContainText("Nothing was changed.");
    await err.locator(".close-btn").click();
    mode = "empty";
    await dialog.locator(".refresh-models-btn").click();
    await expect(err).toContainText("The endpoint did not return a model list.");
    await expect(err).toContainText("Nothing was changed.");
    await err.locator(".close-btn").click();
    expect(await ids()).toEqual(["b", "x"]);

    // Compare, Cancel.
    mode = "ok";
    await dialog.locator(".refresh-models-btn").click();
    const diff = page.locator("dialog.diff-dialog");
    await expect(diff).toBeVisible();
    await expect(diff.locator(".diff-add")).toContainText("Add 2");
    await expect(diff.locator(".diff-add li")).toHaveText(["a", "c"]);
    await expect(diff.locator(".diff-remove")).toContainText("Remove 1");
    await expect(diff.locator(".diff-remove")).toContainText("not returned by the endpoint");
    await expect(diff.locator(".diff-remove li")).toHaveText(["x"]);
    await expect(diff.locator(".diff-keep")).toContainText("Keep 1");
    await expect(diff.locator(".diff-keep li")).toHaveText(["b"]);
    await diff.screenshot({ path: path.join(ARTIFACTS_006, "compare-dialog-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await diff.screenshot({ path: path.join(ARTIFACTS_006, "compare-dialog-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
    await diff.locator(".cancel-btn").click();
    expect(await ids()).toEqual(["b", "x"]);

    // Apply.
    await dialog.locator(".refresh-models-btn").click();
    await diff.locator(".apply-btn").click();
    expect(await ids()).toEqual(["b", "a", "c"]);
    const vision = await dialog.locator(".form-model-vision").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).checked));
    expect(vision).toEqual([true, false, false]);
  });

  test("D1: Ticking a provider selects its models; Delete asks first, then removes them", async ({ context, extensionId, }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    await seedProvider(page, worker, ["m1", "m2", "m3"]);

    const del = page.locator("#delete-models-btn");
    await expect(del).toBeDisabled();
    await page.locator('#model-table tr.prov[data-provider-id="p1"] .prov-select').check();
    await expect(page.locator(".model-select:checked")).toHaveCount(3);
    await expect(del).toHaveText("Delete selected (3)");
    await del.click();
    const confirm = page.locator("dialog.model-delete-dialog");
    await expect(confirm).toContainText("Delete 3 models?");
    await expect(confirm).toContainText("This removes M1, M2, and M3 (and the Local provider with them). You cannot undo this.");
    await confirm.screenshot({ path: path.join(ARTIFACTS_006, "delete-confirm-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await confirm.screenshot({ path: path.join(ARTIFACTS_006, "delete-confirm-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
    await confirm.locator(".cancel-btn").click();
    await expect(page.locator('#model-table tr.prov[data-provider-id="p1"]')).toHaveCount(1);
    await expect(page.locator("#model-table tr.model-row .model-select")).toHaveCount(3);

    await del.click();
    await confirm.locator(".confirm-delete-btn").click();
    await expect(page.locator('#model-table tr.prov[data-provider-id="p1"]')).toHaveCount(0);
    await expect(del).toBeDisabled();
    await expect(del).toHaveText("Delete selected");
  });

  test("D2: Deleting the default moves it; deleting every enabled model is refused", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await seedProvider(page, worker, ["m1", "m2"], { defaultModel: "p1/m1" });
    await expect(page.locator('tr.model-row[data-ref="p1/m1"] input.model-default')).toBeChecked();

    await page.locator('tr.model-row[data-ref="p1/m1"] .model-select').check();
    await page.locator("#delete-models-btn").click();
    await page.locator("dialog.model-delete-dialog .confirm-delete-btn").click();
    await expect(page.locator('tr.model-row[data-ref="p1/m1"]')).toHaveCount(0);
    await expect(page.locator('tr.model-row[data-ref="brand:anthropic-sonnet"] input.model-default')).toBeChecked();

    // Turn every brand model off so only p1/m2 stays on, then try to delete it.
    const brandRefs = await page.locator('tr.model-row[data-ref^="brand:"]').evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.ref!));
    await seedProvider(page, worker, ["m2"], { disabled: brandRefs, defaultModel: "p1/m2" });
    await page.locator('tr.model-row[data-ref="p1/m2"] .model-select').check();
    await page.locator("#delete-models-btn").click();
    await expect(page.locator("#model-table-hint")).toHaveText("At least one model must stay on.");
    await expect(page.locator("dialog.model-delete-dialog")).toHaveCount(0);
    await expect(page.locator('tr.model-row[data-ref="p1/m2"]')).toHaveCount(1);
  });
});
