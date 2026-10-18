import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { test, expect } from "./extension.fixture";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, "../dist");

const SITE_A = "http://localhost:10040/plain.html";
const SITE_B = "http://127.0.0.1:10040/plain.html";

interface PlannedCall {
  name: string;
  input: Record<string, unknown>;
}

async function getWorker(context: BrowserContext): Promise<Worker> {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  return worker;
}

async function chooseAgent(page: Page, id: string): Promise<void> {
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator(`#agent-option-${id}`).click();
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const inputArea = page.locator("agent-chat-panel:not([hidden]) #input");
  await inputArea.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

async function sendBubbleMessage(page: Page, text: string): Promise<void> {
  const inputArea = page.locator("web-agent-bubble #input");
  await inputArea.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

/** Self-contained: no free variables, so Playwright can serialize it for
 *  addInitScript. Copies the __PLAN__/__TOOL_RESULTS__ queue pattern from
 *  e2e/network-dialog.mock.spec.ts, with the tabId injection and the
 *  refFor/resolveRefs ref helpers dropped — no file tool takes a tabId or a
 *  ref. Also records opts.tools into __WA_TOOLS__, the skills.mock.spec.ts
 *  pattern, for the two tool-listing cases. */
function installMockScript(): void {
  window.__WA_MOCK_SCRIPT__ = (opts) => {
    const lastMsg = opts.messages[opts.messages.length - 1];
    const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
    if (lastText.includes("Summarize the following conversation as a short UI title")) {
      return { text: "VFS test" };
    }
    window.__WA_TOOLS__ = (opts.tools ?? []).map((t) => t.name);
    const queue = window.__PLAN__ ?? [];
    const results = window.__TOOL_RESULTS__ ?? [];
    const seen = window.__SEEN_TOOL_IDS__ ?? new Set();
    if (Array.isArray(lastMsg?.content)) {
      for (const part of lastMsg.content) {
        if (part && typeof part === "object" && part.type === "tool-result" && !seen.has(part.toolCallId)) {
          seen.add(part.toolCallId);
          const output = part.output;
          const text =
            typeof output === "string"
              ? output
              : typeof output === "object" && output !== null && typeof output.content === "string"
                ? output.content
                : JSON.stringify(output);
          results.push({ tool: part.toolName, text, isError: !!part.isError });
        }
      }
      window.__SEEN_TOOL_IDS__ = seen;
      window.__TOOL_RESULTS__ = results;
    }
    if (results.length < queue.length) {
      const next = queue[results.length];
      return { toolCalls: [{ id: `tc_${results.length}`, name: next.name, input: next.input }] };
    }
    return { text: results.map((r) => r.text).join("\n") };
  };
}

async function setPlan(page: Page, plan: PlannedCall[]): Promise<void> {
  await page.evaluate((p) => {
    window.__PLAN__ = p;
    window.__TOOL_RESULTS__ = [];
    window.__SEEN_TOOL_IDS__ = new Set();
  }, plan);
}

async function runPlanOnPanel(
  panelPage: Page,
  plan: PlannedCall[],
  prompt: string,
): Promise<{ tool: string; text: string; isError: boolean }[]> {
  await setPlan(panelPage, plan);
  await sendMessage(panelPage, prompt);
  await panelPage.waitForFunction((n: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= n, plan.length, {
    timeout: 30_000,
  });
  return panelPage.evaluate(() => window.__TOOL_RESULTS__ ?? []);
}

async function runBubblePlan(
  page: Page,
  plan: PlannedCall[],
  prompt: string,
): Promise<{ tool: string; text: string; isError: boolean }[]> {
  await setPlan(page, plan);
  await sendBubbleMessage(page, prompt);
  await page.waitForFunction((n: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= n, plan.length, {
    timeout: 30_000,
  });
  return page.evaluate(() => window.__TOOL_RESULTS__ ?? []);
}

async function openPanel(context: BrowserContext, extensionId: string): Promise<Page> {
  const panelPage = await context.newPage();
  await panelPage.addInitScript(installMockScript);
  await panelPage.setViewportSize({ width: 400, height: 700 });
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panelPage.locator("#agent-row")).toBeVisible();
  await expect(panelPage.locator("#agent-combo .name")).toHaveText("Chromagent");
  return panelPage;
}

const SETTINGS_KEYS = ["agentSettings", "savedSkills", "enabledOrigins"] as const;

test.describe("VFS extension wiring (069/003)", () => {
  test.beforeEach(async ({ context }) => {
    const worker = await getWorker(context);
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040", "http://127.0.0.1:10040"] });
    });
  });

  test("E1 the side panel agent is offered all ten file tools", async ({ context, extensionId }) => {
    const panelPage = await openPanel(context, extensionId);
    await sendMessage(panelPage, "hi");
    await panelPage.waitForFunction(() => window.__WA_TOOLS__ !== undefined, { timeout: 15_000 });
    const tools = await panelPage.evaluate(() => window.__WA_TOOLS__);
    for (const name of ["read_file", "write_file", "edit_file", "glob_files", "search_files", "delete_file", "move_file", "json_get", "json_edit", "bundle_html"]) {
      expect(tools).toContain(name);
    }
  });

  test("E2 the in-page agent is offered all ten file tools", async ({ context }) => {
    const page = await context.newPage();
    await page.addInitScript(installMockScript);
    await page.goto(SITE_A);
    await page.locator("web-agent-bubble #launcher").click();
    await sendBubbleMessage(page, "hi");
    await page.waitForFunction(() => window.__WA_TOOLS__ !== undefined, { timeout: 15_000 });
    const tools = await page.evaluate(() => window.__WA_TOOLS__);
    for (const name of ["read_file", "write_file", "edit_file", "glob_files", "search_files", "delete_file", "move_file", "json_get", "json_edit", "bundle_html"]) {
      expect(tools).toContain(name);
    }
  });

  test("E3,E4,E5,E6,E10 per-agent home isolation, shared file, exact storage keys, reload persistence, extension storage untouched", async ({
    context,
    extensionId,
  }) => {
    const worker = await getWorker(context);
    const before = await worker.evaluate(
      (keys) => chrome.storage.local.get(keys),
      SETTINGS_KEYS as unknown as string[],
    );

    const panelPage = await openPanel(context, extensionId);

    // E3 — chromagent writes its own /home/agent/SOUL.md.
    const chromaWrite = await runPlanOnPanel(
      panelPage,
      [{ name: "write_file", input: { file_path: "/home/agent/SOUL.md", content: "I am chromagent" } }],
      "Save 'I am chromagent' to /home/agent/SOUL.md.",
    );
    expect(chromaWrite[0].isError).toBe(false);

    // E4 — chromagent writes the shared file.
    const sharedWrite = await runPlanOnPanel(
      panelPage,
      [{ name: "write_file", input: { file_path: "/home/shared/USER.md", content: "Timezone: SGT" } }],
      "Save 'Timezone: SGT' to /home/shared/USER.md.",
    );
    expect(sharedWrite[0].isError).toBe(false);

    await chooseAgent(panelPage, "tesagent");

    // E3 — tesagent cannot read chromagent's file.
    const tesagentRead = await runPlanOnPanel(
      panelPage,
      [{ name: "read_file", input: { file_path: "/home/agent/SOUL.md" } }],
      "What is in /home/agent/SOUL.md?",
    );
    expect(tesagentRead[0].isError).toBe(true);

    // E4 — tesagent reads the shared file.
    const tesagentSharedRead = await runPlanOnPanel(
      panelPage,
      [{ name: "read_file", input: { file_path: "/home/shared/USER.md" } }],
      "What is in /home/shared/USER.md?",
    );
    expect(tesagentSharedRead[0].isError).toBe(false);
    expect(tesagentSharedRead[0].text).toContain("Timezone: SGT");

    // E5 — the exact storage keys.
    const keys = Object.keys(await worker.evaluate(() => chrome.storage.local.get(null)));
    expect(keys).toContain("web-agent-vfs:home:chromagent:f:/SOUL.md");
    expect(keys).toContain("web-agent-vfs:home:chromagent:index");
    expect(keys).toContain("web-agent-vfs:shared:f:/USER.md");
    expect(keys).toContain("web-agent-vfs:shared:index");
    // 127/004 — selecting tesagent seeds its starter AGENTS.md and nothing
    // else. It still cannot see chromagent's /SOUL.md (asserted above).
    expect(keys).toContain("web-agent-vfs:home:tesagent:f:/AGENTS.md");
    expect(keys).toContain("web-agent-vfs:home:tesagent:index");
    expect(keys.filter((k) => k.startsWith("web-agent-vfs:home:tesagent:f:")))
      .toEqual(["web-agent-vfs:home:tesagent:f:/AGENTS.md"]);

    // E6 — chromagent's /home/agent survives a panel reload.
    await chooseAgent(panelPage, "chromagent");
    await panelPage.reload();
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    const afterReload = await runPlanOnPanel(
      panelPage,
      [{ name: "read_file", input: { file_path: "/home/agent/SOUL.md" } }],
      "What is in /home/agent/SOUL.md?",
    );
    expect(afterReload[0].isError).toBe(false);
    expect(afterReload[0].text).toContain("I am chromagent");

    // E10 — settings, the agent store and saved skills are unchanged.
    const after = await worker.evaluate(
      (keys) => chrome.storage.local.get(keys),
      SETTINGS_KEYS as unknown as string[],
    );
    expect(after).toEqual(before);
  });

  test("E7 /tmp survives a panel reload and dies with the browser", async ({ context, extensionId }) => {
    const panelPage = await openPanel(context, extensionId);
    const write = await runPlanOnPanel(
      panelPage,
      [{ name: "write_file", input: { file_path: "/tmp/scratch.md", content: "scratch" } }],
      "Save 'scratch' to /tmp/scratch.md.",
    );
    expect(write[0].isError).toBe(false);

    await panelPage.reload();
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    const afterReload = await runPlanOnPanel(
      panelPage,
      [{ name: "read_file", input: { file_path: "/tmp/scratch.md" } }],
      "What is in /tmp/scratch.md?",
    );
    expect(afterReload[0].isError).toBe(false);
    expect(afterReload[0].text).toContain("scratch");

    await context.close();

    const newContext = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    try {
      let [newWorker] = newContext.serviceWorkers();
      if (!newWorker) newWorker = await newContext.waitForEvent("serviceworker");
      const newExtensionId = newWorker.url().split("/")[2];
      const newPanelPage = await openPanel(newContext, newExtensionId);
      const missing = await runPlanOnPanel(
        newPanelPage,
        [{ name: "read_file", input: { file_path: "/tmp/scratch.md" } }],
        "What is in /tmp/scratch.md?",
      );
      expect(missing[0].isError).toBe(true);

      const sessionKeys = Object.keys(await newWorker.evaluate(() => chrome.storage.session.get(null)));
      expect(sessionKeys.some((k) => k.startsWith("web-agent-vfs:tmp:"))).toBe(false);
    } finally {
      await newContext.close();
    }
  });

  test("E8,E9 in-page website isolation and the localStorage key prefix", async ({ context, extensionId }) => {
    const panelPage = await openPanel(context, extensionId);
    const sharedWrite = await runPlanOnPanel(
      panelPage,
      [{ name: "write_file", input: { file_path: "/home/shared/USER.md", content: "Timezone: SGT" } }],
      "Save 'Timezone: SGT' to /home/shared/USER.md.",
    );
    expect(sharedWrite[0].isError).toBe(false);

    const pageA = await context.newPage();
    await pageA.addInitScript(installMockScript);
    await pageA.goto(SITE_A);
    await pageA.locator("web-agent-bubble #launcher").click();
    const writeA = await runBubblePlan(
      pageA,
      [{ name: "write_file", input: { file_path: "/home/shared/USER.md", content: "site A" } }],
      "Save 'site A' to /home/shared/USER.md.",
    );
    expect(writeA[0].isError).toBe(false);

    const pageB = await context.newPage();
    await pageB.addInitScript(installMockScript);
    await pageB.goto(SITE_B);
    await pageB.locator("web-agent-bubble #launcher").click();
    const readB = await runBubblePlan(
      pageB,
      [{ name: "read_file", input: { file_path: "/home/shared/USER.md" } }],
      "What is in /home/shared/USER.md?",
    );
    expect(readB[0].isError).toBe(true);

    // The side panel's own /home/shared/USER.md is untouched by the in-page write.
    const panelRead = await runPlanOnPanel(
      panelPage,
      [{ name: "read_file", input: { file_path: "/home/shared/USER.md" } }],
      "What is in /home/shared/USER.md again?",
    );
    expect(panelRead[0].isError).toBe(false);
    expect(panelRead[0].text).toContain("Timezone: SGT");

    // E9 — the in-page key prefix.
    const keysA = await pageA.evaluate(() => Object.keys(localStorage));
    expect(keysA.every((k) => k.startsWith("web-agent-vfs:"))).toBe(true);
    expect(keysA).toContain("web-agent-vfs:shared:f:/USER.md");
    expect(keysA).toContain("web-agent-vfs:shared:index");
  });

  test("E11 the built manifest lists unlimitedStorage", async () => {
    const manifestPath = path.join(EXTENSION, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { permissions?: string[] };
    expect(manifest.permissions).toContain("unlimitedStorage");
  });
});
