import { test, expect, openOptions } from "./extension.fixture";
import { chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

// The extension's opt-in memory. Everything here is real: the real
// extension, real chrome.storage, a real side panel and the real vfs. Only the
// model is scripted, so the assertions are about what this code sends.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "../dist");
const TEMP_DIR = path.resolve(HERE, "../temp/e2e-extensions/memory-opt-in");
const ARTIFACTS_DIR = path.resolve(
  HERE,
  "../../../../../tasks/artifacts/2026-11-06-112108-003-extension-memory-opt-in",
);
const USER_PATH = "/home/shared/USER.md";
const MEMORY_HELP =
  "Remember things about you and this agent between chats. Saved in this browser.";

interface PlannedCall {
  name: string;
  input: Record<string, unknown>;
}

/** Records every user message and system prompt the model receives, then works
 *  through the scripted __PLAN__ queue (the pattern is the one
 *  e2e/seed-agents-md.mock.spec.ts uses). */
function installMockScript(): void {
  window.__WA_ENABLE_VFS_PROOF__ = true;
  window.__USER_TEXTS__ = [];
  window.__SYSTEM_PROMPTS__ = [];
  window.__WA_MOCK_SCRIPT__ = (opts) => {
    const lastMsg = opts.messages[opts.messages.length - 1];
    const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
    if (lastText.includes("Summarize the following conversation as a short UI title")) {
      return { text: "Memory chat" };
    }
    window.__WA_TOOLS__ = (opts.tools ?? []).map((t) => t.name);
    if (lastMsg?.role === "user" && lastText) {
      window.__USER_TEXTS__!.push(lastText);
      window.__SYSTEM_PROMPTS__!.push(opts.systemPrompt ?? "");
    }
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

async function launchPatched(dir: string, patch: Record<string, unknown>): Promise<{ ctx: BrowserContext; id: string; worker: Worker }> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.cp(EXT, dir, { recursive: true });
  const file = path.join(dir, "brand.json");
  const brand = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  await fs.writeFile(file, JSON.stringify({ ...brand, ...patch }, null, 2));
  const ctx = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  let [worker] = ctx.serviceWorkers();
  if (!worker) worker = await ctx.waitForEvent("serviceworker");
  return { ctx, id: worker.url().split("/")[2], worker };
}

async function workerOf(context: BrowserContext): Promise<Worker> {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  return worker;
}

/** Writes `agentSettings.memoryEnabled` straight into chrome.storage.local. */
async function seedMemoryEnabled(worker: Worker, memoryEnabled: Record<string, boolean>): Promise<void> {
  await worker.evaluate(async (map) => {
    const got = await chrome.storage.local.get("agentSettings");
    const stored = (got.agentSettings ?? {}) as Record<string, unknown>;
    await chrome.storage.local.set({ agentSettings: { ...stored, memoryEnabled: map } });
  }, memoryEnabled);
}

async function openAgentsTab(page: Page): Promise<void> {
  await page.locator("#tab-btn-agents").click();
  await expect(page.locator("#tab-agents")).toBeVisible();
  await expect(page.locator(".card").first()).toBeVisible();
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.locator("agent-chat-panel:not([hidden]) #input");
  await input.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

async function sendAndWait(page: Page, text: string, before: number): Promise<void> {
  await sendMessage(page, text);
  await page.waitForFunction((n) => (window.__USER_TEXTS__?.length ?? 0) > n, before, { timeout: 30_000 });
}

async function openPanel(context: BrowserContext, extensionId: string, agent = "tesagent"): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(installMockScript);
  await page.setViewportSize({ width: 420, height: 760 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.locator("#agent-row")).toBeVisible();
  if (agent !== "chromagent") {
    await page.locator("#agent-combo").click();
    await expect(page.locator("#agent-list")).toBeVisible();
    await page.locator(`#agent-option-${agent}`).click();
    await expect(page.locator("#agent-combo .name")).toHaveText("Tesagent");
  }
  await expect(page.locator("agent-chat-panel:not([hidden])")).toHaveCount(1);
  await page.waitForFunction((id) => window.__WA_VFS_PROOF__?.[id] !== undefined, agent);
  return page;
}

async function switchAgent(page: Page, agent: string, label: string): Promise<void> {
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator(`#agent-option-${agent}`).click();
  await expect(page.locator("#agent-combo .name")).toHaveText(label);
  await expect(page.locator("agent-chat-panel:not([hidden])")).toHaveCount(1);
  await page.waitForFunction((id) => window.__WA_VFS_PROOF__?.[id] !== undefined, agent);
}

async function newSession(page: Page): Promise<void> {
  await page.locator("agent-chat-panel:not([hidden])").getByRole("button", { name: "New session" }).click();
  await page.waitForFunction(() => {
    const panel = document.querySelector<HTMLElement>("agent-chat-panel:not([hidden])") as unknown as
      | { running?: boolean; messages?: unknown[] }
      | null;
    return panel != null && panel.running === false && (panel.messages ?? []).length === 0;
  });
}

async function userTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__USER_TEXTS__ ?? []);
}

async function systemPrompts(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__SYSTEM_PROMPTS__ ?? []);
}

async function plan(page: Page, queue: PlannedCall[]): Promise<void> {
  await page.evaluate((q) => {
    window.__PLAN__ = q;
    window.__TOOL_RESULTS__ = [];
    window.__SEEN_TOOL_IDS__ = new Set();
  }, queue);
}

function contrastRatioInPage(): string {
  // Runs inside the options page. Blends a translucent text colour over the
  // card background before measuring, so an `opacity: 0.82` help line is
  // measured as it actually looks.
  const parse = (value: string): number[] => {
    const nums = value.match(/[\d.]+/g) ?? [];
    return nums.slice(0, 3).map(Number);
  };
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (rgb: number[]): number =>
    0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  const measure = (selector: string): number => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`no element for ${selector}`);
    const card = el.closest(".card") as HTMLElement;
    const bg = parse(getComputedStyle(card).backgroundColor);
    const fg = parse(getComputedStyle(el).color);
    let opacity = 1;
    for (let node: HTMLElement | null = el; node && node !== card; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity);
    }
    const blended = fg.map((v, i) => v * opacity + bg[i] * (1 - opacity));
    const a = luminance(blended);
    const b = luminance(bg);
    const light = Math.max(a, b);
    const dark = Math.min(a, b);
    return (light + 0.05) / (dark + 0.05);
  };
  const cards = [...document.querySelectorAll<HTMLElement>(".card[data-agent-id]")];
  const card = cards.find((c) => c.querySelector(".card-memory")) ?? cards[0];
  const id = card.getAttribute("data-agent-id");
  return JSON.stringify({
    label: measure(`[data-agent-id="${id}"] .card-memory-label`),
    help: measure(`[data-agent-id="${id}"] .card-memory-help`),
  });
}

test.describe("Extension memory opt-in", () => {
  test.afterAll(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  test("1: an agent without memory: true shows no switch and never loads memory", async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const dir = path.resolve(TEMP_DIR, "no-memory");
    // brand.json is written by the patched launch below; read the shipped one
    // first so this test keeps both agents and only clears their memory flag.
    const shipped = JSON.parse(await fs.readFile(path.join(EXT, "brand.json"), "utf8")) as {
      agents: { id: string; memory?: boolean }[];
    };
    const agents = shipped.agents.map((a) => {
      const copy: Record<string, unknown> = { ...a };
      delete copy.memory;
      if (copy.id === "tesagent") copy.memory = false;
      return copy;
    });
    const { ctx, id: extensionId, worker } = await launchPatched(dir, { agents });
    try {
      const userAgent = {
        id: "analyst",
        displayName: "Data Analyst",
        description: "Added by the user",
        instructions: "Analyse data.",
        model: null,
        tools: "*",
        excludeTools: [],
        skills: "*",
        excludeSkills: [],
      };
      await worker.evaluate(async (u) => {
        await chrome.storage.local.set({ userAgents: [u] });
      }, userAgent);
      await seedMemoryEnabled(worker, { chromagent: true, tesagent: true, analyst: true });

      const options = await ctx.newPage();
      await openOptions(options, extensionId);
      await openAgentsTab(options);
      await expect(options.locator(".card[data-agent-id='chromagent']")).toBeVisible();
      await expect(options.locator(".card[data-agent-id='tesagent']")).toBeVisible();
      await expect(options.locator(".card[data-agent-id='analyst']")).toBeVisible();
      await expect(options.locator(".card-memory")).toHaveCount(0);

      const panel = await openPanel(ctx, extensionId, "tesagent");
      expect(await panel.evaluate(() => window.__WA_VFS_PROOF__!.tesagent.provider.memory)).toBeNull();
      await sendAndWait(panel, "hi", 0);
      const texts = await userTexts(panel);
      expect(texts).toHaveLength(1);
      expect(texts[0]).not.toContain("<memory");
      const [prompt] = await systemPrompts(panel);
      expect(prompt).not.toContain("- remember —");
      expect(prompt).not.toContain("- onboarding —");
      expect(prompt).not.toContain("You have two memory files");
    } finally {
      await ctx.close();
    }
  });

  test("2: the default brand ships the switch off, and a chat loads no memory", async ({ context, extensionId }) => {
    const options = await context.newPage();
    await openOptions(options, extensionId);
    await openAgentsTab(options);
    for (const id of ["chromagent", "tesagent"]) {
      const toggle = options.locator(`#agent-memory-${id}`);
      await expect(toggle).toBeVisible();
      await expect(toggle).not.toBeChecked();
      await expect(options.locator(`#agent-memory-help-${id}`)).toHaveText(MEMORY_HELP);
    }
    await expect(options.locator(".card-memory")).toHaveCount(2);

    const panel = await openPanel(context, extensionId, "tesagent");
    await sendAndWait(panel, "hi", 0);
    const texts = await userTexts(panel);
    expect(texts[0]).not.toContain("<memory");
    const [prompt] = await systemPrompts(panel);
    expect(prompt).not.toContain("- remember —");
    expect(prompt).not.toContain("- onboarding —");
  });

  test("3: switching on applies from the next chat, and Theme save keeps the switch", async ({ context, extensionId }) => {
    const panel = await openPanel(context, extensionId, "tesagent");
    await sendAndWait(panel, "first message", 0);
    expect((await userTexts(panel))[0]).not.toContain("<memory");

    const options = await context.newPage();
    await openOptions(options, extensionId);
    await openAgentsTab(options);
    await options.locator("#agent-memory-tesagent").check();
    const worker = await workerOf(context);
    await expect.poll(async () =>
      worker.evaluate(async () => {
        const got = await chrome.storage.local.get("agentSettings");
        return (got.agentSettings as { memoryEnabled?: Record<string, boolean> } | undefined)?.memoryEnabled?.tesagent;
      })).toBe(true);

    await options.locator("#tab-btn-general").click();
    await options.locator("#theme").selectOption("wa2-light");
    await options.locator("#save").click();
    await expect(options.locator("#status")).toContainText("Saved.");
    const kept = await worker.evaluate(async () => {
      const got = await chrome.storage.local.get("agentSettings");
      const stored = got.agentSettings as { theme?: string; memoryEnabled?: Record<string, boolean> };
      return { theme: stored.theme, tesagent: stored.memoryEnabled?.tesagent };
    });
    expect(kept).toEqual({ theme: "wa2-light", tesagent: true });

    // The current chat keeps the files and skills it started with.
    await sendAndWait(panel, "second message", 1);
    const keptTexts = await userTexts(panel);
    expect(keptTexts[1]).not.toContain("<memory");
    expect((await systemPrompts(panel))[1]).not.toContain("- remember —");

    await newSession(panel);
    await panel.waitForFunction(
      () => window.__WA_VFS_PROOF__?.tesagent.provider.memory?.userPath === "/home/shared/USER.md",
    );
    const before = (await userTexts(panel)).length;
    await sendAndWait(panel, "third message", before);
    const texts = await userTexts(panel);
    expect(texts[before]).toContain('<memory path="/home/shared/USER.md" missing="true">');
    const prompts = await systemPrompts(panel);
    expect(prompts[before]).toContain("- remember —");
    expect(prompts[before]).toContain("- onboarding —");
    expect(prompts[before]).toContain("You have two memory files");
    await panel.locator("agent-chat-panel:not([hidden])").screenshot({
      path: path.join(ARTIFACTS_DIR, "mock-03-tesagent-memory-on.png"),
    });
  });

  test("4: USER.md is shared across agents, MEMORY.md is per agent", async ({ context, extensionId }) => {
    const options = await context.newPage();
    await openOptions(options, extensionId);
    await openAgentsTab(options);
    await options.locator("#agent-memory-tesagent").check();
    await options.locator("#agent-memory-chromagent").check();
    const worker = await workerOf(context);
    await expect.poll(async () =>
      worker.evaluate(async () => {
        const got = await chrome.storage.local.get("agentSettings");
        const map = (got.agentSettings as { memoryEnabled?: Record<string, boolean> } | undefined)?.memoryEnabled;
        return `${String(map?.tesagent)}/${String(map?.chromagent)}`;
      })).toBe("true/true");

    const panel = await openPanel(context, extensionId, "tesagent");
    await plan(panel, [
      { name: "write_file", input: { file_path: USER_PATH, content: "Name: Alex" } },
      { name: "write_file", input: { file_path: "/home/agent/MEMORY.md", content: "Tesagent private note" } },
    ]);
    await sendAndWait(panel, "remember that my name is Alex", 0);
    await panel.waitForFunction(() => (window.__TOOL_RESULTS__?.length ?? 0) >= 2, undefined, { timeout: 30_000 });
    expect(await panel.evaluate(async () => {
      const f = await window.__WA_VFS_PROOF__!.tesagent.provider.vfs.get("/home/shared/USER.md");
      return f?.content;
    })).toBe("Name: Alex");

    await switchAgent(panel, "chromagent", "Chromagent");
    const beforeChrom = (await userTexts(panel)).length;
    await sendAndWait(panel, "hello", beforeChrom);
    const chromTexts = await userTexts(panel);
    expect(chromTexts[beforeChrom]).toContain(`<memory path="${USER_PATH}">\nName: Alex\n</memory>`);
    expect(chromTexts[beforeChrom]).not.toContain("Tesagent private note");

    await plan(panel, [
      { name: "write_file", input: { file_path: "/home/agent/MEMORY.md", content: "Chromagent private note" } },
    ]);
    const beforeWrite = (await userTexts(panel)).length;
    await sendAndWait(panel, "note this for later", beforeWrite);
    await panel.waitForFunction(() => (window.__TOOL_RESULTS__?.length ?? 0) >= 1, undefined, { timeout: 30_000 });

    await switchAgent(panel, "tesagent", "Tesagent");
    await newSession(panel);
    const beforeTes = (await userTexts(panel)).length;
    await sendAndWait(panel, "what do you know?", beforeTes);
    const tesTexts = await userTexts(panel);
    expect(tesTexts[beforeTes]).toContain("Name: Alex");
    expect(tesTexts[beforeTes]).toContain("Tesagent private note");
    expect(tesTexts[beforeTes]).not.toContain("Chromagent private note");

    // Off again: the next chat carries no memory block and no memory skills.
    await openAgentsTab(options);
    await options.locator("#agent-memory-tesagent").uncheck();
    await expect.poll(async () =>
      worker.evaluate(async () => {
        const got = await chrome.storage.local.get("agentSettings");
        return (got.agentSettings as { memoryEnabled?: Record<string, boolean> } | undefined)?.memoryEnabled?.tesagent;
      })).toBe(false);
    await newSession(panel);
    await panel.waitForFunction(
      () => window.__WA_VFS_PROOF__?.tesagent.provider.memory === null,
    );
    const beforeOff = (await userTexts(panel)).length;
    await sendAndWait(panel, "what is my name?", beforeOff);
    const offTexts = await userTexts(panel);
    expect(offTexts[beforeOff]).not.toContain("<memory");
    expect((await systemPrompts(panel))[beforeOff]).not.toContain("- remember —");
  });

  test("5: the in-page agent never loads memory", async ({ context }, testInfo) => {
    const worker = await workerOf(context);
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        enabledOrigins: ["http://localhost:10040"],
        agentSettings: { theme: "auto", memoryEnabled: { chromagent: true, tesagent: true } },
      });
    });
    const page = await context.newPage();
    await page.addInitScript(installMockScript);
    await page.goto("http://localhost:10040/plain.html");
    const bubble = page.locator("web-agent-bubble");
    await expect(bubble).toHaveCount(1);
    await bubble.locator("#launcher").click();
    await expect(bubble.locator("agent-chat-panel")).toBeAttached();
    await sendAndWait(page, "hi", 0);

    const texts = await userTexts(page);
    expect(texts[0]).not.toContain("<memory");
    const [prompt] = await systemPrompts(page);
    expect(prompt).not.toContain("- remember —");
    expect(prompt).not.toContain("- onboarding —");
    const keys = await page.evaluate(() => Object.keys(window.localStorage));
    expect(keys.filter((k) => k.includes("USER.md") || k.includes("MEMORY.md"))).toEqual([]);
    // The page agent DOES offer the file tools; only memory is absent.
    expect(await page.evaluate(() => window.__WA_TOOLS__ ?? [])).toContain("write_file");
    await page.screenshot({ path: testInfo.outputPath("mock-05-page-agent-no-memory.png") });
  });

  test("6: the Options switch renders, measures and photographs in both themes", async ({ context, extensionId }, testInfo) => {
    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    const page = await context.newPage();
    await page.setViewportSize({ width: 900, height: 900 });
    await openOptions(page, extensionId);
    await openAgentsTab(page);
    await page.locator("#agent-memory-tesagent").check();

    const card = page.locator(".card[data-agent-id='tesagent']");
    const row = page.locator(".card[data-agent-id='tesagent'] .card-memory");
    await expect(row).toBeVisible();
    await expect(page.locator(".card[data-agent-id='tesagent'] .card-memory-label")).toHaveText("Memory");
    await expect(page.locator(".card[data-agent-id='tesagent'] .card-memory-help")).toHaveText(MEMORY_HELP);

    const geometry = async (): Promise<{ card: number[]; row: number[]; clipped: number[] }> =>
      page.evaluate(() => {
        const c = document.querySelector<HTMLElement>(".card[data-agent-id='tesagent']")!;
        const r = c.querySelector<HTMLElement>(".card-memory")!;
        const cb = c.getBoundingClientRect();
        const rb = r.getBoundingClientRect();
        const clipped = [...c.querySelectorAll<HTMLElement>(".card-memory-label, .card-memory-help, .card-memory .sw")]
          .map((el) => el.scrollWidth - el.clientWidth);
        return {
          card: [cb.left, cb.right, cb.top, cb.bottom],
          row: [rb.left, rb.right, rb.top, rb.bottom],
          clipped,
        };
      });

    const knobLeft = async (): Promise<number> =>
      page.evaluate(() => {
        const track = document.querySelector<HTMLElement>(".card[data-agent-id='tesagent'] .card-memory .track")!;
        return Number.parseFloat(getComputedStyle(track, "::after").left);
      });

    const checks: Record<string, unknown> = {};
    for (const [name, theme, expectedKnob] of [
      ["light", "wa2-light", 15],
      ["dark", "wa2-dark", 15],
    ] as const) {
      await page.locator("#tab-btn-general").click();
      await page.locator("#theme").selectOption(theme);
      await page.locator("#save").click();
      await expect(page.locator("#status")).toContainText("Saved.");
      await openAgentsTab(page);

      const box = await geometry();
      expect(box.clipped.every((n) => n <= 0)).toBe(true);
      expect(box.row[0]).toBeGreaterThanOrEqual(box.card[0]);
      expect(box.row[1]).toBeLessThanOrEqual(box.card[1]);
      expect(box.row[2]).toBeGreaterThanOrEqual(box.card[2]);
      expect(box.row[3]).toBeLessThanOrEqual(box.card[3] + 0.5);

      const contrast = JSON.parse(await page.evaluate(contrastRatioInPage)) as { label: number; help: number };
      expect(contrast.label).toBeGreaterThanOrEqual(3);
      expect(contrast.help).toBeGreaterThanOrEqual(3);

      // The knob position marks the state without colour.
      await page.locator("#agent-memory-tesagent").check();
      expect(await knobLeft()).toBe(expectedKnob);
      await page.locator("#agent-memory-tesagent").uncheck();
      expect(await knobLeft()).toBe(1);
      await page.locator("#agent-memory-tesagent").check();

      await card.screenshot({ path: path.join(ARTIFACTS_DIR, `mock-06-options-memory-${name}.png`) });
      await page.screenshot({ path: testInfo.outputPath(`mock-06-options-agents-${name}.png`) });
      checks[name] = { geometry: box, contrast };
    }
    await fs.writeFile(
      path.join(ARTIFACTS_DIR, "mock-06-options-memory-checks.json"),
      JSON.stringify(checks, null, 2),
      "utf8",
    );
  });
});
