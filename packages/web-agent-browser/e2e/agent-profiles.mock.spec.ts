import { test, expect } from "./extension.fixture";
import { chromium, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "../dist");
const TEMP_DIR = path.resolve(HERE, "../temp/e2e-extensions/agent-profiles");
const ARTIFACTS_DIR = path.resolve(
  HERE,
  "../../../temp/artifacts/2026-09-15-171940-001-brand-agent-files-and-single-agent-panel",
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
    window.__WA_MOCK_SCRIPT__ = (opts) => {
      const lastMsg = opts.messages[opts.messages.length - 1];
      const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
      if (lastText.includes("Summarize the following conversation as a short UI title")) {
        return { text: "Title" };
      }
      window.__WA_TOOLS__ = (opts.tools ?? []).map((t) => t.name);
      return { text: "Mock response." };
    };
  });
}

test.describe("Agent profiles mock e2e", () => {
  test.afterAll(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  test("default brand: header reads Chromagent, IndexedDB database exists, screenshots captured", async ({ context, extensionId }) => {
    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    const page = await context.newPage();
    await page.setViewportSize({ width: 400, height: 700 });
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const headerTitle = page.locator("agent-chat-panel").locator(".header-title");
    await expect(headerTitle).toHaveText("Chromagent");
    await expect(page.locator("agent-chat-panel")).toBeAttached();

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "01-header-chromagent-light.png") });

    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-dark"));
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "02-header-chromagent-dark.png") });

    const dbs = await page.evaluate(async () => {
      const list = await window.indexedDB.databases();
      return list.map((d) => d.name);
    });
    expect(dbs).toContain("web-agent-web-agent-extension-panel-chromagent");
  });

  test("defaultAgent: tesagent shows header tesagent", async () => {
    const dir = path.resolve(TEMP_DIR, "tesagent");
    await patchedBrand(dir, { defaultAgent: "tesagent" });
    const { ctx, extensionId } = await launchPatchedContext(dir);
    try {
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 400, height: 700 });
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      const headerTitle = page.locator("agent-chat-panel").locator(".header-title");
      await expect(headerTitle).toHaveText("Tesagent");
    } finally {
      await ctx.close();
    }
  });

  test("agent tools: [read_tabs, page_eval] offers exactly those two tools", async () => {
    const dir = path.resolve(TEMP_DIR, "two-tools");
    const brand = JSON.parse(await fs.readFile(path.join(EXT, "brand.json"), "utf8"));
    brand.agents = brand.agents.map((a: any) =>
      a.id === "chromagent" ? { ...a, tools: ["read_tabs", "page_eval"] } : a,
    );
    await patchedBrand(dir, brand);
    const { ctx, extensionId } = await launchPatchedContext(dir);
    try {
      const page = await ctx.newPage();
      await installToolListingMock(page);
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      // 120/002 — sidepanel.ts:main() now awaits one more storage round trip
      // (getLastAgentId) before it appends the panel, so this evaluate can no
      // longer assume the panel already exists right after goto() resolves.
      await page.waitForSelector("agent-chat-panel");
      await page.evaluate(() => {
        const panel = document.querySelector("agent-chat-panel") as any;
        void panel.send("hi");
      });
      await expect.poll(async () => {
        return page.evaluate(() => (window as any).__WA_TOOLS__);
      }).toEqual(["read_tabs", "page_eval"]);
    } finally {
      await ctx.close();
    }
  });

  test("no side panel agent offers show_generative_ui, even with tools: '*'", async () => {
    const dir = path.resolve(TEMP_DIR, "no-genui");
    const brand = JSON.parse(await fs.readFile(path.join(EXT, "brand.json"), "utf8"));
    brand.agents = brand.agents.map((a: any) => ({ ...a, tools: "*" }));
    await patchedBrand(dir, brand);
    const { ctx, extensionId } = await launchPatchedContext(dir);
    try {
      const page = await ctx.newPage();
      await installToolListingMock(page);
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await page.waitForSelector("agent-chat-panel");

      const visibleTools = async (): Promise<string[]> => {
        await page.evaluate(() => {
          delete (window as any).__WA_TOOLS__;
        });
        await page.evaluate(() => {
          const panels = [...document.querySelectorAll("agent-chat-panel:not([hidden])")];
          void (panels[panels.length - 1] as any).send("hi");
        });
        await expect
          .poll(() => page.evaluate(() => (window as any).__WA_TOOLS__ !== undefined))
          .toBe(true);
        return page.evaluate(() => (window as any).__WA_TOOLS__ as string[]);
      };

      const chromagent = await visibleTools();
      expect(chromagent).not.toContain("show_generative_ui");
      expect(chromagent).toContain("query_data");

      await page.locator("#agent-combo").click();
      await page.locator("#agent-option-tesagent").click();
      await expect(page.locator("agent-chat-panel")).toHaveCount(2);

      const tesagent = await visibleTools();
      expect(tesagent).not.toContain("show_generative_ui");
      expect(tesagent).toContain("query_data");
      // Proves the list really came from the Tesagent panel: its agent file
      // excludes the three page-agent tools (brand/agents/tesagent.yml:17-20).
      expect(tesagent).not.toContain("send_to_page_agent");
    } finally {
      await ctx.close();
    }
  });

  test("excludeTools: [close_tab] with tools: '*' does not offer close_tab, offers read_tabs", async () => {
    const dir = path.resolve(TEMP_DIR, "exclude-tool");
    const brand = JSON.parse(await fs.readFile(path.join(EXT, "brand.json"), "utf8"));
    brand.agents = brand.agents.map((a: any) =>
      a.id === "chromagent" ? { ...a, excludeTools: ["close_tab"] } : a,
    );
    await patchedBrand(dir, brand);
    const { ctx, extensionId } = await launchPatchedContext(dir);
    try {
      const page = await ctx.newPage();
      await installToolListingMock(page);
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      // 120/002 — see the note on the "two tools" test above.
      await page.waitForSelector("agent-chat-panel");
      await page.evaluate(() => {
        const panel = document.querySelector("agent-chat-panel") as any;
        void panel.send("hi");
      });
      await expect.poll(() => page.evaluate(() => (window as any).__WA_TOOLS__ !== undefined)).toBe(true);
      const tools = await page.evaluate(() => (window as any).__WA_TOOLS__ as string[]);
      expect(tools).not.toContain("close_tab");
      expect(tools).toContain("read_tabs");
    } finally {
      await ctx.close();
    }
  });

  test("skills: [website_edit] offers website_edit and no tab skills", async () => {
    const dir = path.resolve(TEMP_DIR, "one-skill");
    const brand = JSON.parse(await fs.readFile(path.join(EXT, "brand.json"), "utf8"));
    brand.agents = brand.agents.map((a: any) =>
      a.id === "chromagent" ? { ...a, skills: ["website_edit"] } : a,
    );
    await patchedBrand(dir, brand);
    const { ctx, extensionId } = await launchPatchedContext(dir);
    try {
      const page = await ctx.newPage();
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      // 120/002 — see the note on the "two tools" test above.
      await page.waitForSelector("agent-chat-panel");
      const skills = await page.evaluate(() => {
        const panel = document.querySelector("agent-chat-panel") as any;
        return (panel.skills ?? []).map((s: any) => s.name);
      });
      expect(skills).toEqual(["website_edit"]);
      expect(skills).not.toContain("tab_management");
      expect(skills).not.toContain("page_agent");
    } finally {
      await ctx.close();
    }
  });

  test("model: anthropic-sonnet-nonstream routes request to anthropic endpoint with model sonnet and non-streaming using options auth key", async () => {
    const dir = path.resolve(TEMP_DIR, "agent-model");
    const brand = JSON.parse(await fs.readFile(path.join(EXT, "brand.json"), "utf8"));
    brand.agents = brand.agents.map((a: any) =>
      a.id === "chromagent" ? { ...a, model: "anthropic-sonnet-nonstream" } : a,
    );
    await patchedBrand(dir, brand);
    const { ctx, worker, extensionId } = await launchPatchedContext(dir);
    try {
      await worker.evaluate(async () => {
        await chrome.storage.local.set({
          agentSettings: {
            endpoint: "https://other.example.com/api/other",
            wireFormat: "openai",
            model: "other-model",
            streaming: true,
            apiKey: "options-secret-key",
            theme: "auto",
          },
        });
      });

      const page = await ctx.newPage();
      let interceptedReq: any = null;
      await page.route("**/api/anthropic/**", async (route) => {
        const req = route.request();
        interceptedReq = {
          url: req.url(),
          headers: req.headers(),
          postData: JSON.parse(req.postData() ?? "{}"),
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            content: [{ type: "text", text: "Sonnet response." }],
            role: "assistant",
          }),
        });
      });

      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      // 120/002 — see the note on the "two tools" test above.
      await page.waitForSelector("agent-chat-panel");
      await page.evaluate(() => {
        const panel = document.querySelector("agent-chat-panel") as any;
        void panel.send("hi");
      });

      await expect.poll(() => interceptedReq).not.toBeNull();
      expect(interceptedReq.url).toBe("http://localhost:28780/api/anthropic/v1/messages");
      expect(interceptedReq.postData.model).toBe("sonnet");
      expect(interceptedReq.postData.stream).toBe(false);
      expect(interceptedReq.headers["x-api-key"]).toBe("options-secret-key");
    } finally {
      await ctx.close();
    }
  });

  test("page_screenshot is offered or hidden by effective agent model", async () => {
    // Non-vision agent: text-only-model
    const dirNonVision = path.resolve(TEMP_DIR, "nonvision");
    const brandNonVision = JSON.parse(await fs.readFile(path.join(EXT, "brand.json"), "utf8"));
    const textOnlyEntry = {
      id: "test-text-only",
      label: "Text-only",
      endpoint: "http://localhost:28780/api/anthropic",
      wireFormat: "anthropic",
      model: "text-only-model",
      streaming: false,
    };
    brandNonVision.models = [...brandNonVision.models, textOnlyEntry];
    brandNonVision.agents = brandNonVision.agents.map((a: any) =>
      a.id === "chromagent" ? { ...a, model: "test-text-only" } : a,
    );
    await patchedBrand(dirNonVision, brandNonVision);
    const { ctx: ctx1, extensionId: ext1 } = await launchPatchedContext(dirNonVision);
    try {
      const page1 = await ctx1.newPage();
      await installToolListingMock(page1);
      await page1.goto(`chrome-extension://${ext1}/sidepanel.html`);
      // 120/002 — see the note on the "two tools" test above.
      await page1.waitForSelector("agent-chat-panel");
      await page1.evaluate(() => {
        const panel = document.querySelector("agent-chat-panel") as any;
        void panel.send("hi");
      });
      await expect.poll(() => page1.evaluate(() => (window as any).__WA_TOOLS__ !== undefined)).toBe(true);
      const tools = await page1.evaluate(() => (window as any).__WA_TOOLS__ as string[]);
      expect(tools).not.toContain("page_screenshot");
    } finally {
      await ctx1.close();
    }

    // Vision agent: sonnet
    const dirVision = path.resolve(TEMP_DIR, "vision");
    const brandVision = JSON.parse(await fs.readFile(path.join(EXT, "brand.json"), "utf8"));
    brandVision.agents = brandVision.agents.map((a: any) =>
      a.id === "chromagent" ? { ...a, model: "anthropic-sonnet-stream" } : a,
    );
    await patchedBrand(dirVision, brandVision);
    const { ctx: ctx2, extensionId: ext2 } = await launchPatchedContext(dirVision);
    try {
      const page2 = await ctx2.newPage();
      await installToolListingMock(page2);
      await page2.goto(`chrome-extension://${ext2}/sidepanel.html`);
      // 120/002 — see the note on the "two tools" test above.
      await page2.waitForSelector("agent-chat-panel");
      await page2.evaluate(() => {
        const panel = document.querySelector("agent-chat-panel") as any;
        void panel.send("hi");
      });
      await expect.poll(() => page2.evaluate(() => (window as any).__WA_TOOLS__ !== undefined)).toBe(true);
      const tools = await page2.evaluate(() => (window as any).__WA_TOOLS__ as string[]);
      expect(tools).toContain("page_screenshot");
    } finally {
      await ctx2.close();
    }
  });

  test("brand with no agents shows the error and no chat", async () => {
    const dir = path.resolve(TEMP_DIR, "no-agents");
    await patchedBrand(dir, { agents: [] });
    const { ctx, extensionId } = await launchPatchedContext(dir);
    try {
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 400, height: 700 });
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      const alert = page.getByRole("alert");
      await expect(alert).toHaveText(
        "The brand did not load, so no agent is available. Reload the extension, then open the side panel again.",
      );
      await expect(page.locator("agent-chat-panel")).toHaveCount(0);
      // 120/002 — no agent, so no combo box either.
      // 120/003 manager override — the row itself, and the page-agent icon in
      // it, stay visible and usable even with no agent loaded.
      await expect(page.locator("#agent-combo")).toBeHidden();
      await expect(page.locator("#page-agent-toggle")).toBeVisible();
      const names = await page.evaluate(async () =>
        (await indexedDB.databases()).map((d) => d.name ?? ""),
      );
      expect(names.some((n) => n.startsWith("web-agent-web-agent-extension-panel"))).toBe(false);
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "03-no-agent-error-light.png") });

      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "wa2-dark"));
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "03-no-agent-error-dark.png") });
    } finally {
      await ctx.close();
    }
  });
});
