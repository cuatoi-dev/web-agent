import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect } from "./extension.fixture";
import type { BrowserContext, Page, Worker } from "@playwright/test";

// 127/004 — the brand's starter AGENTS.md. The real extension, real
// chrome.storage, a real panel build and a real seed. Only the model is
// scripted, so nothing about the seed or the vfs is faked.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STARTER_PATH = path.resolve(HERE, "../brand/agents/tesagent.home/AGENTS.md");
const HOME_MD = "/home/agent/AGENTS.md";

interface PlannedCall {
  name: string;
  input: Record<string, unknown>;
}

async function getWorker(context: BrowserContext): Promise<Worker> {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  return worker;
}

/** Records every user message the model receives into __USER_TEXTS__, then
 *  works through the scripted __PLAN__ queue. The queue pattern is the one
 *  e2e/vfs-extension.mock.spec.ts uses. */
function installMockScript(): void {
  window.__WA_ENABLE_VFS_PROOF__ = true;
  window.__USER_TEXTS__ = [];
  window.__WA_MOCK_SCRIPT__ = (opts) => {
    const lastMsg = opts.messages[opts.messages.length - 1];
    const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
    if (lastText.includes("Summarize the following conversation as a short UI title")) {
      return { text: "Starter AGENTS.md" };
    }
    window.__WA_TOOLS__ = (opts.tools ?? []).map((t) => t.name);
    if (lastMsg?.role === "user" && lastText) window.__USER_TEXTS__!.push(lastText);
    const queue = window.__PLAN__ ?? [];
    const results = window.__TOOL_RESULTS__ ?? [];
    const seen = window.__SEEN_TOOL_IDS__ ?? new Set();
    if (Array.isArray(lastMsg?.content)) {
      for (const part of lastMsg.content as { type?: string; toolCallId?: string; toolName?: string; isError?: boolean; output?: unknown }[]) {
        if (part && part.type === "tool-result" && part.toolCallId && !seen.has(part.toolCallId)) {
          seen.add(part.toolCallId);
          const output = part.output as { content?: unknown } | string | null;
          const text =
            typeof output === "string"
              ? output
              : typeof output === "object" && output !== null && typeof output.content === "string"
                ? output.content
                : JSON.stringify(output);
          results.push({ tool: part.toolName ?? "", text, isError: !!part.isError });
        }
      }
      window.__SEEN_TOOL_IDS__ = seen;
      window.__TOOL_RESULTS__ = results;
    }
    if (results.length < queue.length) {
      const next = queue[results.length];
      return { toolCalls: [{ id: `tc_${results.length}`, name: next.name, input: next.input }] };
    }
    return { text: "ok" };
  };
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.locator("agent-chat-panel:not([hidden]) #input");
  await input.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

async function openPanel(context: BrowserContext, extensionId: string, agent = "tesagent"): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(installMockScript);
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.locator("#agent-row")).toBeVisible();
  if (agent !== "chromagent") {
    await page.locator("#agent-combo").click();
    await expect(page.locator("#agent-list")).toBeVisible();
    await page.locator(`#agent-option-${agent}`).click();
    await expect(page.locator("#agent-combo .name")).toHaveText("Tesagent");
  }
  await page.waitForFunction((id) => window.__WA_VFS_PROOF__?.[id] !== undefined, agent);
  return page;
}

function seededFile(page: Page) {
  return page.evaluate(async (p: string) => {
    const f = await window.__WA_VFS_PROOF__!.tesagent.provider.vfs.get(p);
    return f ? { content: f.content, encoding: f.encoding } : null;
  }, HOME_MD);
}

async function openFiles(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Menu options" }).click();
  await page.getByRole("menuitem", { name: "Files" }).click();
  await expect(page.locator("agent-files-screen")).toBeVisible();
}

const rowNamed = (page: Page, name: string) =>
  page.locator("agent-files-screen .wa-ftree-row")
    .filter({ has: page.locator(`.wa-ftree-row-name:text-is("${name}")`) });

async function previewText(page: Page): Promise<string> {
  return page.locator("agent-files-screen pre.wa-file-text").textContent() ?? "";
}

test.describe("Tesagent starter AGENTS.md (127/004)", () => {
  test("1 a fresh profile shows the exact brand text in the Files screen", async ({ context, extensionId }, testInfo) => {
    const starter = await fs.readFile(STARTER_PATH, "utf8");
    const page = await openPanel(context, extensionId);
    await page.waitForFunction(
      async (p) => (await window.__WA_VFS_PROOF__!.tesagent.provider.vfs.get(p)) !== undefined,
      HOME_MD,
    );
    expect(await seededFile(page)).toMatchObject({ content: starter, encoding: "utf8" });
    await openFiles(page);
    await expect(rowNamed(page, "AGENTS.md").first()).toBeVisible();
    await rowNamed(page, "AGENTS.md").first().click();
    expect(await previewText(page)).toBe(starter);
    await page.screenshot({ path: testInfo.outputPath("mock-01-files-seeded.png") });
  });

  test("2 an edit survives a panel reload and is not overwritten", async ({ context, extensionId }, testInfo) => {
    const starter = await fs.readFile(STARTER_PATH, "utf8");
    const edited = starter.replace("# Tesagent workspace", "# Tesagent workspace (edited)");
    const page = await openPanel(context, extensionId);
    await page.waitForFunction(
      async (p) => (await window.__WA_VFS_PROOF__!.tesagent.provider.vfs.get(p)) !== undefined,
      HOME_MD,
    );
    await page.evaluate((plan) => {
      window.__PLAN__ = plan;
      window.__TOOL_RESULTS__ = [];
      window.__SEEN_TOOL_IDS__ = new Set();
    }, [
      { name: "read_file", input: { file_path: HOME_MD } },
      { name: "edit_file", input: { file_path: HOME_MD, old_string: "# Tesagent workspace", new_string: "# Tesagent workspace (edited)" } },
    ] as PlannedCall[]);
    await sendMessage(page, "Edit the first line of /home/agent/AGENTS.md.");
    await page.waitForFunction(() => (window.__TOOL_RESULTS__?.length ?? 0) >= 2, undefined, { timeout: 30_000 });
    expect(await seededFile(page)).toMatchObject({ content: edited });

    await page.reload();
    await expect(page.locator("#agent-row")).toBeVisible();
    await page.waitForFunction(() => window.__WA_VFS_PROOF__?.tesagent !== undefined);
    expect(await seededFile(page)).toMatchObject({ content: edited });
    await openFiles(page);
    await rowNamed(page, "AGENTS.md").first().click();
    expect(await previewText(page)).toBe(edited);
    await page.screenshot({ path: testInfo.outputPath("mock-02-files-edit-after-reload.png") });
  });

  test("3 Chromagent has no starter file", async ({ context, extensionId }, testInfo) => {
    const page = await openPanel(context, extensionId, "chromagent");
    await page.waitForFunction(() => window.__WA_VFS_PROOF__?.chromagent !== undefined);
    expect(await page.evaluate(async () => {
      const vfs = window.__WA_VFS_PROOF__!.chromagent.provider.vfs;
      return (await vfs.list("/home/agent")).map((e) => e.abs);
    })).toEqual([]);
    await openFiles(page);
    await expect(page.locator("agent-files-screen .wa-ftree-row-name").filter({ hasText: "AGENTS.md" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("mock-03-chromagent-empty-home.png") });
  });

  test("4 the first prompt carries the <agents-md> block", async ({ context, extensionId }) => {
    const starter = await fs.readFile(STARTER_PATH, "utf8");
    const page = await openPanel(context, extensionId);
    await page.waitForFunction(
      async (p) => (await window.__WA_VFS_PROOF__!.tesagent.provider.vfs.get(p)) !== undefined,
      HOME_MD,
    );
    await sendMessage(page, "hi");
    await page.waitForFunction(() => (window.__USER_TEXTS__?.length ?? 0) >= 1, undefined, { timeout: 30_000 });
    const texts = await page.evaluate(() => window.__USER_TEXTS__ ?? []);
    const withBlock = texts.filter((t) => t.includes('<agents-md path="/home/agent/AGENTS.md">'));
    expect(withBlock).toHaveLength(1);
    expect(withBlock[0]).toContain(`<agents-md path="/home/agent/AGENTS.md">\n${starter}\n</agents-md>`);
  });

  test("5 a failed seed warns and the chat still starts", async ({ context, extensionId }, testInfo) => {
    // A stored index row under /AGENTS.md makes the path an existing folder,
    // so vfs.write refuses it: a real failure through the real storage layer,
    // with no monkeypatching of chrome.storage.
    const worker = await getWorker(context);
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        "web-agent-vfs:home:tesagent:index": {
          "/AGENTS.md/placeholder.md": {
            path: "/AGENTS.md/placeholder.md",
            mimeType: "text/markdown",
            encoding: "utf8",
            mtimeMs: Date.now(),
            size: 0,
          },
        },
      });
    });
    const page = await context.newPage();
    const warnings: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "warning") warnings.push(m.text());
    });
    await page.addInitScript(installMockScript);
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(page.locator("#agent-row")).toBeVisible();
    await page.locator("#agent-combo").click();
    await page.locator("#agent-option-tesagent").click();
    await expect(page.locator("#agent-combo .name")).toHaveText("Tesagent");
    await expect.poll(() => warnings.find((w) => w.startsWith("[web-agent] could not seed AGENTS.md: ")))
      .toContain("/home/agent/AGENTS.md is a folder");
    await sendMessage(page, "hi");
    await expect(page.locator("agent-chat-panel:not([hidden])").getByText("ok")).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => window.__WA_TOOLS__)).toContain("read_file");
    await fs.writeFile(
      testInfo.outputPath("mock-05-seed-failure-warning.txt"),
      warnings.join("\n"),
      "utf8",
    );
  });
});
