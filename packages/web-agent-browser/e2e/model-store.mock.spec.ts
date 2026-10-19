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
