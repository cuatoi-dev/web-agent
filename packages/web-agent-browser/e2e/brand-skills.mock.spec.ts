import { test, expect } from "./extension.fixture";
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "../dist");
const TEMP_DIR = path.resolve(HERE, "../temp/e2e-extensions/brand-skills");
const SKILLS_DIR = path.resolve(TEMP_DIR, "skills");
const FLAGS_DIR = path.resolve(TEMP_DIR, "flags");
const PLAYWRIGHT_DIR = path.resolve(TEMP_DIR, "playwright");

const SITE = "http://localhost:10040/plain.html";

const CLAIMS_LOOKUP = {
  name: "claims_lookup",
  description: "Find a claim by number and explain its status.",
  definition: "Look up the claim and explain its status.",
};

/** Copies dist/ and rewrites brand.json, so a test can load a different brand
 *  without a rebuild. Same mechanism as options.mock.spec.ts:344-351 /
 *  skills.mock.spec.ts:464-471. Not exported from either — copied here. */
async function patchedBrand(dir: string, patch: Record<string, unknown>): Promise<string> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.cp(EXT, dir, { recursive: true });
  const file = path.join(dir, "brand.json");
  const brand = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  await fs.writeFile(file, JSON.stringify({ ...brand, ...patch }, null, 2));
  return dir;
}

/** Launches a patched-brand copy as its own extension context, with
 *  enabledOrigins already set on its service worker so the in-page bubble can
 *  mount without a reload. */
async function launchPatchedContext(dir: string) {
  const ctx = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  let [worker] = ctx.serviceWorkers();
  if (!worker) worker = await ctx.waitForEvent("serviceworker");
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
  });
  const extensionId = worker.url().split("/")[2];
  return { ctx, worker, extensionId };
}

async function bubbleSkillNames(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() =>
    (
      (document.querySelector("web-agent-bubble") as unknown as { skills: { name: string }[] }).skills ?? []
    ).map((s) => s.name),
  );
}

async function panelSkillNames(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() =>
    (
      (document.querySelector("agent-chat-panel") as unknown as { skills: { name: string }[] }).skills ?? []
    ).map((s) => s.name),
  );
}

/** The `window.__WA_MOCK_SCRIPT__` used by every tool-listing case: it answers
 *  the title-summary turn with a fixed title, and every other turn records the
 *  tool-def names it was called with on `window.__WA_TOOLS__`, matching
 *  todo-tools.mock.spec.ts and skills.mock.spec.ts. */
function installToolListingMock(page: import("@playwright/test").Page): Promise<void> {
  return page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = (opts) => {
      const lastMsg = opts.messages[opts.messages.length - 1];
      const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
      if (lastText.includes("Summarize the following conversation as a short UI title")) {
        return { text: "Tools" };
      }
      window.__WA_TOOLS__ = (opts.tools ?? []).map((t) => t.name);
      return { text: "ok" };
    };
  });
}

/** A mock model that answers the user's message with ONE call to `call.name`
 *  and records that tool's output text on `window.__SEARCH_SKILLS_RESULT__`
 *  (search_skills) or `window.__LOAD_SKILL_RESULT__` (load_skill). It reads
 *  only the last message, so it works for every panel on the page. */
function installSkillCallMock(
  page: import("@playwright/test").Page,
  call: { name: "search_skills" | "load_skill"; input: Record<string, string> },
): Promise<void> {
  return page.addInitScript((c) => {
    // A tool's output is a string or `{ content: string }`; the part's
    // `output` field is `unknown`, so narrow it (sidepanel.mock.spec.ts:731-741).
    function outputText(output: unknown): string {
      if (typeof output === "string") return output;
      if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
        return output.content;
      }
      return JSON.stringify(output);
    }
    window.__WA_MOCK_SCRIPT__ = (opts) => {
      const lastMsg = opts.messages[opts.messages.length - 1];
      if (typeof lastMsg?.content === "string") {
        if (lastMsg.content.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Skills" };
        }
        return { toolCalls: [{ id: "tc_skill", name: c.name, input: c.input }] };
      }
      if (Array.isArray(lastMsg?.content)) {
        const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === c.name);
        if (part && part.type === "tool-result") {
          const text = outputText(part.output);
          if (c.name === "search_skills") window.__SEARCH_SKILLS_RESULT__ = text;
          else window.__LOAD_SKILL_RESULT__ = text;
        }
      }
      return { text: "Done." };
    };
  }, call);
}

/** Picks an agent in the side panel combo box and waits for its panel. Same
 *  steps as agent-switcher.mock.spec.ts:99-103. */
async function chooseAgent(page: import("@playwright/test").Page, id: string): Promise<void> {
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator(`#agent-option-${id}`).click();
  await expect(page.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
}

/** Sends `text` to the visible side panel. The mock answers at once. */
async function sendToPanel(page: import("@playwright/test").Page, text: string): Promise<void> {
  await page.evaluate((message) => {
    const panel = document.querySelector<HTMLElementTagNameMap["agent-chat-panel"]>("#chat agent-chat-panel:not([hidden])");
    if (!panel) throw new Error("no visible agent-chat-panel");
    void panel.send(message);
  }, text);
}

/** The visible side panel's skill names (`config.skills`, which
 *  `search_skills` reads). */
async function visiblePanelSkillNames(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() =>
    (
      (document.querySelector("#chat agent-chat-panel:not([hidden])") as unknown as { skills: { name: string }[] }).skills ?? []
    ).map((s) => s.name),
  );
}

test.describe("Brand skills and feature flags", () => {
  test.afterAll(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  // E1 / criterion 1's skill half.
  test("E1: default dist/ exposes exactly today's built-in skills", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
    });

    const page = await context.newPage();
    await page.goto(SITE);
    await page.locator("web-agent-bubble #launcher").click();
    await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached();

    const names = await bubbleSkillNames(page);
    expect(names).toContain("page_fetch");
    expect(names).toContain("multi_step_ui");
    expect(names.length).toBeGreaterThan(0);
  });

  // E2 / criterion 2 — both agents.
  test("E2: a brand skill reaches both the bubble and the side panel", async () => {
    const dir = await patchedBrand(SKILLS_DIR, { skillDefs: [CLAIMS_LOOKUP] });
    const { ctx, extensionId } = await launchPatchedContext(dir);
    try {
      const page = await ctx.newPage();
      await page.goto(SITE);
      await page.locator("web-agent-bubble #launcher").click();
      await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached();
      expect(await bubbleSkillNames(page)).toContain("claims_lookup");

      const panelPage = await ctx.newPage();
      await panelPage.setViewportSize({ width: 400, height: 700 });
      await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await expect(panelPage.locator("#chat agent-chat-panel")).toBeAttached();
      expect(await panelSkillNames(panelPage)).toContain("claims_lookup");
    } finally {
      await ctx.close();
    }
  });

  // E3 / criterion 3.
  test("E3: a brand skill named the same as a built-in replaces it, one entry, brand's body", async () => {
    const dir = await patchedBrand(SKILLS_DIR, {
      skillDefs: [{ name: "page_fetch", description: "Branded page fetch.", definition: "BRANDED" }],
    });
    const { ctx } = await launchPatchedContext(dir);
    try {
      const page = await ctx.newPage();
      await page.goto(SITE);
      await page.locator("web-agent-bubble #launcher").click();
      await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached();

      const skills = await page.evaluate(() =>
        (document.querySelector("web-agent-bubble") as unknown as { skills: { name: string; definition: string }[] }).skills ?? [],
      );
      const pageFetchEntries = skills.filter((s) => s.name === "page_fetch");
      expect(pageFetchEntries).toHaveLength(1);
      expect(pageFetchEntries[0].definition).toBe("BRANDED");
    } finally {
      await ctx.close();
    }
  });

  // E4 / criterion 4.
  test("E4: skills: { core: { enabled: false } } drops the core skills, keeps dom and brand", async () => {
    const dir = await patchedBrand(SKILLS_DIR, {
      skills: { core: { enabled: false } },
      skillDefs: [CLAIMS_LOOKUP],
    });
    const { ctx } = await launchPatchedContext(dir);
    try {
      const page = await ctx.newPage();
      await page.goto(SITE);
      await page.locator("web-agent-bubble #launcher").click();
      await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached();

      const names = await bubbleSkillNames(page);
      expect(names).toContain("multi_step_ui");
      expect(names).toContain("page_fetch");
      expect(names).toContain("claims_lookup");
      expect(names).not.toContain("query_data_advanced");
      expect(names).not.toContain("present_to_user");
    } finally {
      await ctx.close();
    }
  });

  // E5 / criterion 2's "invocable as /claims_lookup" half.
  test("E5: a brand skill with command: true shows up in the slash menu", async () => {
    const dir = await patchedBrand(SKILLS_DIR, {
      skillDefs: [{ ...CLAIMS_LOOKUP, command: true }],
    });
    const { ctx } = await launchPatchedContext(dir);
    try {
      const page = await ctx.newPage();
      await page.goto(SITE);
      await page.locator("web-agent-bubble #launcher").click();
      const inputArea = page.locator("web-agent-bubble #input");
      await inputArea.click();
      await page.keyboard.type("/claims");

      const slashMenu = page.locator("web-agent-bubble .wa-slash-menu");
      await expect(slashMenu).toBeVisible();
      await expect(slashMenu).toContainText("claims_lookup");
      // E5 trap: while the menu is open, Enter picks the row and runs nothing —
      // never press it here.
    } finally {
      await ctx.close();
    }
  });

  // E6 / criterion 5.
  test("E6: tools: { genui: { enabled: false } } removes show_generative_ui, keeps query_data", async () => {
    const dir = await patchedBrand(FLAGS_DIR, { tools: { genui: { enabled: false } } });
    const { ctx, extensionId } = await launchPatchedContext(dir);
    try {
      const panelPage = await ctx.newPage();
      await installToolListingMock(panelPage);
      await panelPage.setViewportSize({ width: 400, height: 700 });
      await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

      await panelPage.locator("agent-chat-panel #input").click();
      await panelPage.keyboard.type("hi");
      await panelPage.keyboard.press("Enter");

      await panelPage.waitForFunction(() => window.__WA_TOOLS__ !== undefined, { timeout: 15_000 });
      const tools = await panelPage.evaluate(() => window.__WA_TOOLS__);
      expect(tools).not.toContain("show_generative_ui");
      expect(tools).toContain("query_data");
    } finally {
      await ctx.close();
    }
  });

  // E7 / criterion 5's "removing the key restores it" half.
  test("E7: tools: {} restores show_generative_ui", async () => {
    const dir = await patchedBrand(FLAGS_DIR, { tools: {} });
    const { ctx, extensionId } = await launchPatchedContext(dir);
    try {
      const panelPage = await ctx.newPage();
      await installToolListingMock(panelPage);
      await panelPage.setViewportSize({ width: 400, height: 700 });
      await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

      await panelPage.locator("agent-chat-panel #input").click();
      await panelPage.keyboard.type("hi");
      await panelPage.keyboard.press("Enter");

      await panelPage.waitForFunction(() => window.__WA_TOOLS__ !== undefined, { timeout: 15_000 });
      const tools = await panelPage.evaluate(() => window.__WA_TOOLS__);
      expect(tools).toContain("show_generative_ui");
    } finally {
      await ctx.close();
    }
  });

  // E8 / criterion 6 — both agents.
  test("E8: tools: { todo: { enabled: false } } removes todo tools on both agents", async () => {
    const dir = await patchedBrand(FLAGS_DIR, { tools: { todo: { enabled: false } } });
    const { ctx, extensionId } = await launchPatchedContext(dir);
    try {
      const panelPage = await ctx.newPage();
      await installToolListingMock(panelPage);
      await panelPage.setViewportSize({ width: 400, height: 700 });
      await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await panelPage.locator("agent-chat-panel #input").click();
      await panelPage.keyboard.type("hi");
      await panelPage.keyboard.press("Enter");
      await panelPage.waitForFunction(() => window.__WA_TOOLS__ !== undefined, { timeout: 15_000 });
      const panelTools = await panelPage.evaluate(() => window.__WA_TOOLS__);
      expect(panelTools).not.toContain("todo_write");
      expect(panelTools).not.toContain("todo_read");

      const page = await ctx.newPage();
      await installToolListingMock(page);
      await page.goto(SITE);
      await page.locator("web-agent-bubble #launcher").click();
      const inputArea = page.locator("web-agent-bubble #input");
      await inputArea.click();
      await page.keyboard.type("hi");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => window.__WA_TOOLS__ !== undefined, { timeout: 15_000 });
      const pageTools = await page.evaluate(() => window.__WA_TOOLS__);
      expect(pageTools).not.toContain("todo_write");
      expect(pageTools).not.toContain("todo_read");
    } finally {
      await ctx.close();
    }
  });

  // A brand can turn the side panel's default scheduler off.
  test("E15: tools: { scheduler: { enabled: false } } removes the scheduler tools from the side panel", async () => {
    const dir = await patchedBrand(FLAGS_DIR, { tools: { scheduler: { enabled: false } } });
    const { ctx, extensionId } = await launchPatchedContext(dir);
    try {
      const panelPage = await ctx.newPage();
      await installToolListingMock(panelPage);
      await panelPage.setViewportSize({ width: 400, height: 700 });
      await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await panelPage.locator("agent-chat-panel #input").click();
      await panelPage.keyboard.type("hi");
      await panelPage.keyboard.press("Enter");
      await panelPage.waitForFunction(() => window.__WA_TOOLS__ !== undefined, { timeout: 15_000 });
      const panelTools = await panelPage.evaluate(() => window.__WA_TOOLS__);
      expect(panelTools).not.toContain("set_schedule");
      expect(panelTools).not.toContain("list_schedules");
      expect(panelTools).not.toContain("cancel_schedule");
      expect(panelTools).toContain("todo_write");
    } finally {
      await ctx.close();
    }
  });

  // E9 / criterion 1's tool half.
  test("E9: default dist/ still offers todo_write, todo_read and show_generative_ui", async ({ context, extensionId }) => {
    const panelPage = await context.newPage();
    await installToolListingMock(panelPage);
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panelPage.locator("agent-chat-panel #input").click();
    await panelPage.keyboard.type("hi");
    await panelPage.keyboard.press("Enter");
    await panelPage.waitForFunction(() => window.__WA_TOOLS__ !== undefined, { timeout: 15_000 });
    const tools = await panelPage.evaluate(() => window.__WA_TOOLS__);
    expect(tools).toContain("todo_write");
    expect(tools).toContain("todo_read");
    expect(tools).toContain("show_generative_ui");
    expect(tools).toContain("set_schedule");
    expect(tools).toContain("list_schedules");
    expect(tools).toContain("cancel_schedule");
  });

  // Criterion 12 — the saved-skill registry still wins a name clash over a
  // brand skill of the same name, even after this task's merge change.
  test("a saved skill still overrides a brand skill of the same name", async () => {
    const dir = await patchedBrand(SKILLS_DIR, {
      skillDefs: [{ ...CLAIMS_LOOKUP, definition: "BRAND BODY" }],
    });
    const { ctx, worker } = await launchPatchedContext(dir);
    try {
      await worker.evaluate(async () => {
        await chrome.storage.local.set({
          savedSkills: [{ name: "claims_lookup", description: "Saved version.", definition: "SAVED BODY" }],
        });
      });

      const page = await ctx.newPage();
      await page.addInitScript(() => {
        let callCount = 0;
        window.__WA_MOCK_SCRIPT__ = (opts) => {
          const lastMsg = opts.messages[opts.messages.length - 1];
          const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
          if (lastText.includes("Summarize the following conversation as a short UI title")) {
            return { text: "Skill" };
          }
          callCount++;
          if (callCount === 1) {
            return { toolCalls: [{ id: "tc_load", name: "load_skill", input: { name: "claims_lookup" } }] };
          }
          function outputText(output: unknown): string {
            if (typeof output === "string") return output;
            if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
              return output.content;
            }
            return JSON.stringify(output);
          }
          if (Array.isArray(lastMsg?.content)) {
            const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "load_skill");
            if (part && part.type === "tool-result") window.__LOAD_SKILL_RESULT__ = outputText(part.output);
          }
          return { text: "Loaded." };
        };
      });
      await page.goto(SITE);
      await page.locator("web-agent-bubble #launcher").click();
      await page.locator("web-agent-bubble #input").click();
      await page.keyboard.type("Load claims_lookup.");
      await page.keyboard.press("Enter");

      await page.waitForFunction(() => window.__LOAD_SKILL_RESULT__ !== undefined, { timeout: 15_000 });
      expect(await page.evaluate(() => window.__LOAD_SKILL_RESULT__)).toBe("SAVED BODY");
    } finally {
      await ctx.close();
    }
  });

  // Both default agents have the Playwright, website edit and tab skills.
  test("E10: default dist — both tesagent's and Chromagent's search_skills list playwright_script", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await installSkillCallMock(page, { name: "search_skills", input: { query: "playwright" } });
    await page.setViewportSize({ width: 400, height: 700 });
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(page.locator("#agent-combo .name")).toHaveText("Chromagent");
    await expect(page.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();

    const chromaSkills = await visiblePanelSkillNames(page);
    expect(chromaSkills).toContain("tab_management");
    expect(chromaSkills).toContain("page_agent");
    expect(chromaSkills).toContain("website_edit");
    expect(chromaSkills).toContain("playwright_script");
    expect(chromaSkills).toContain("test_plan");
    expect(chromaSkills).toContain("test_healer");

    await sendToPanel(page, "Which skills do you have for Playwright?");
    await page.waitForFunction(() => window.__SEARCH_SKILLS_RESULT__ !== undefined, { timeout: 15_000 });
    expect(await page.evaluate(() => window.__SEARCH_SKILLS_RESULT__)).toContain("playwright_script —");

    await page.evaluate(() => {
      window.__SEARCH_SKILLS_RESULT__ = undefined;
    });
    await chooseAgent(page, "tesagent");
    await expect(page.locator("#agent-combo .name")).toHaveText("Tesagent");

    const tesagentSkills = await visiblePanelSkillNames(page);
    expect(tesagentSkills).toContain("tab_management");
    expect(tesagentSkills).toContain("page_agent");
    expect(tesagentSkills).toContain("website_edit");
    expect(tesagentSkills).toContain("playwright_script");
    expect(tesagentSkills).toContain("test_plan");
    expect(tesagentSkills).toContain("test_healer");

    await sendToPanel(page, "Which skills do you have for Playwright?");
    await page.waitForFunction(() => window.__SEARCH_SKILLS_RESULT__ !== undefined, { timeout: 15_000 });
    expect(await page.evaluate(() => window.__SEARCH_SKILLS_RESULT__)).toContain("playwright_script —");
  });

  // 120/005 E11 — criterion 3.
  test("E11: skills: { playwright: { enabled: false } } — tesagent's search_skills does not list playwright_script", async () => {
    const dir = await patchedBrand(PLAYWRIGHT_DIR, {
      defaultAgent: "tesagent",
      skills: { playwright: { enabled: false } },
    });
    const { ctx, extensionId } = await launchPatchedContext(dir);
    try {
      const page = await ctx.newPage();
      await installSkillCallMock(page, { name: "search_skills", input: { query: "playwright" } });
      await page.setViewportSize({ width: 400, height: 700 });
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await expect(page.locator("#agent-combo .name")).toHaveText("Tesagent");
      await expect(page.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();

      const skills = await visiblePanelSkillNames(page);
      expect(skills).not.toContain("playwright_script");
      expect(skills).toContain("website_edit");

      await sendToPanel(page, "Which skills do you have for Playwright?");
      await page.waitForFunction(() => window.__SEARCH_SKILLS_RESULT__ !== undefined, { timeout: 15_000 });
      expect(await page.evaluate(() => window.__SEARCH_SKILLS_RESULT__)).not.toContain("playwright_script");
    } finally {
      await ctx.close();
    }
  });

  // 120/005 E12 — criterion 4 (run-time half; the build half is unit T3).
  test("E12: an agent with skills: [playwright_script] lists only playwright_script among built-in skills", async () => {
    const brand = JSON.parse(await fs.readFile(path.join(EXT, "brand.json"), "utf8")) as {
      agents: { id: string; skills: unknown }[];
    };
    const agents = brand.agents.map((a) => (a.id === "tesagent" ? { ...a, skills: ["playwright_script"] } : a));
    const dir = await patchedBrand(PLAYWRIGHT_DIR, { defaultAgent: "tesagent", agents });
    const { ctx, extensionId } = await launchPatchedContext(dir);
    try {
      const page = await ctx.newPage();
      // "_" matches every built-in side panel skill name.
      await installSkillCallMock(page, { name: "search_skills", input: { query: "_" } });
      await page.setViewportSize({ width: 400, height: 700 });
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await expect(page.locator("#agent-combo .name")).toHaveText("Tesagent");
      await expect(page.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();

      expect(await visiblePanelSkillNames(page)).toEqual(["playwright_script"]);

      await sendToPanel(page, "List your skills.");
      await page.waitForFunction(() => window.__SEARCH_SKILLS_RESULT__ !== undefined, { timeout: 15_000 });
      const result = (await page.evaluate(() => window.__SEARCH_SKILLS_RESULT__)) ?? "";
      expect(result).toContain("playwright_script —");
      expect(result).not.toContain("tab_management");
      expect(result).not.toContain("page_agent");
      expect(result).not.toContain("website_edit");
    } finally {
      await ctx.close();
    }
  });

  // 120/005 E13 — criterion 5. 124/004 extended playwright_script to survey with
  // page_snapshot, get locators from page_generate_locator, confirm checks with
  // page_verify, and build the file with export_test.
  test("E13: tesagent's load_skill for playwright_script returns the five steps", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await installSkillCallMock(page, { name: "load_skill", input: { name: "playwright_script" } });
    await page.setViewportSize({ width: 400, height: 700 });
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(page.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    await chooseAgent(page, "tesagent");
    await expect(page.locator("#agent-combo .name")).toHaveText("Tesagent");

    await sendToPanel(page, "Load playwright_script.");
    await page.waitForFunction(() => window.__LOAD_SKILL_RESULT__ !== undefined, { timeout: 15_000 });
    const def = (await page.evaluate(() => window.__LOAD_SKILL_RESULT__)) ?? "";

    // Step 1 — survey with page_snapshot / page_screenshot.
    expect(def).toContain("page_snapshot");
    expect(def).toContain("page_screenshot");
    // Step 2 — locators from page_generate_locator.
    expect(def).toContain("page_generate_locator");
    // Step 3 — confirm checks with page_verify.
    expect(def).toContain("page_verify");
    // Step 4 — build the file with export_test.
    expect(def).toContain("export_test");
    expect(def).toContain('format: "playwright"');
    // Step 5 — the run command.
    expect(def).toContain("npx playwright test");
  });

  // 120/005 E14 — criterion 6.
  test("E14: the in-page bubble's search_skills does not list playwright_script", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
    });

    const page = await context.newPage();
    await installSkillCallMock(page, { name: "search_skills", input: { query: "playwright" } });
    await page.goto(SITE);
    await page.locator("web-agent-bubble #launcher").click();
    await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached();
    expect(await bubbleSkillNames(page)).not.toContain("playwright_script");

    await page.locator("web-agent-bubble #input").click();
    await page.keyboard.type("Which skills do you have for Playwright?");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__SEARCH_SKILLS_RESULT__ !== undefined, { timeout: 15_000 });
    expect(await page.evaluate(() => window.__SEARCH_SKILLS_RESULT__)).not.toContain("playwright_script");
  });
});
