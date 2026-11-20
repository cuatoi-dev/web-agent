import { test, expect } from "./extension.fixture";
import { chromium, type BrowserContext, type Locator, type Page, type Worker } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, "../dist");
const TEMP_DIR = path.resolve(HERE, "../temp/e2e-extensions/skills");
const PATCHED = path.resolve(TEMP_DIR, "no-bridge");

const SITE_A = "http://localhost:10040/plain.html";
const SITE_B = "http://127.0.0.1:10040/plain.html";

const PIRATE_SKILL = {
  name: "pirate_speak",
  description: "Answer like a pirate",
  definition: "Say arr.",
};

test.describe("Extension shared skill storage", () => {
  test.beforeEach(async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        enabledOrigins: ["http://localhost:10040", "http://127.0.0.1:10040"],
        savedSkills: [],
      });
    });
  });

  test("create_skill is offered to the in-page agent", async ({ context }) => {
    const page = await context.newPage();
    await page.addInitScript(() => {
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
    await page.goto(SITE_A);

    await page.locator("web-agent-bubble #launcher").click();
    const inputArea = page.locator("web-agent-bubble #input");
    await inputArea.click();
    await page.keyboard.type("hi");
    await page.keyboard.press("Enter");

    await page.waitForFunction(() => window.__WA_TOOLS__ !== undefined, { timeout: 15_000 });
    const tools = await page.evaluate(() => window.__WA_TOOLS__);
    expect(tools).toContain("create_skill");
  });

  test("create_skill is offered to the side panel agent", async ({ context, extensionId }) => {
    const panelPage = await context.newPage();
    await panelPage.addInitScript(() => {
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
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("hi");
    await panelPage.keyboard.press("Enter");

    await panelPage.waitForFunction(() => window.__WA_TOOLS__ !== undefined, { timeout: 15_000 });
    const tools = await panelPage.evaluate(() => window.__WA_TOOLS__);
    expect(tools).toContain("create_skill");
  });

  // One story: a skill created on
  // site A is found on site B and in the panel, a skill created in the panel is
  // found on a site, storage holds one entry per name, and one save is one
  // write.
  test("a skill created on one origin is found everywhere, one entry per name, one write per save", async ({
    context,
    extensionId,
  }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    // Count chrome.storage.local writes from the service worker's own
    // listener.
    await worker.evaluate(() => {
      globalThis.__skillWrites = 0;
      chrome.storage.onChanged.addListener(() => {
        globalThis.__skillWrites = (globalThis.__skillWrites ?? 0) + 1;
      });
    });

    // --- Site A creates pirate_speak. -------------------------------------
    const pageA = await context.newPage();
    await pageA.addInitScript((skill: typeof PIRATE_SKILL) => {
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Skill" };
        }
        callCount++;
        if (callCount === 1) {
          return { toolCalls: [{ id: "tc_create", name: "create_skill", input: skill }] };
        }
        function outputText(output: unknown): string {
          if (typeof output === "string") return output;
          if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
            return output.content;
          }
          return JSON.stringify(output);
        }
        if (Array.isArray(lastMsg?.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "create_skill");
          if (part && part.type === "tool-result") window.__CREATE_SKILL_RESULT__ = outputText(part.output);
        }
        return { text: "Saved." };
      };
    }, PIRATE_SKILL);
    await pageA.goto(SITE_A);
    await pageA.locator("web-agent-bubble #launcher").click();
    await pageA.locator("web-agent-bubble #input").click();
    await pageA.keyboard.type("Create the pirate_speak skill.");

    await worker.evaluate(() => {
      globalThis.__skillWrites = 0;
    });
    await pageA.keyboard.press("Enter");

    const scrimA = pageA.locator("web-agent-bubble agent-chat-panel .wa-confirm-scrim");
    await expect(scrimA).toBeVisible({ timeout: 15_000 });
    await scrimA.locator("button:has-text('Allow'), md-filled-button:has-text('Allow')").first().click();

    await pageA.waitForFunction(() => window.__CREATE_SKILL_RESULT__ !== undefined, { timeout: 15_000 });
    expect(await pageA.evaluate(() => window.__CREATE_SKILL_RESULT__)).toContain("saved successfully");
    expect(await pageA.evaluate(() => localStorage.length)).toBe(0);

    // Exactly one write for the one save.
    expect(await worker.evaluate(() => globalThis.__skillWrites ?? 0)).toBe(1);

    // --- Site B (a different origin, same profile) finds it. --------------
    const pageB = await context.newPage();
    await pageB.addInitScript(() => {
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Search" };
        }
        callCount++;
        if (callCount === 1) {
          return { toolCalls: [{ id: "tc_search", name: "search_skills", input: { query: "pirate" } }] };
        }
        function outputText(output: unknown): string {
          if (typeof output === "string") return output;
          if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
            return output.content;
          }
          return JSON.stringify(output);
        }
        if (Array.isArray(lastMsg?.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "search_skills");
          if (part && part.type === "tool-result") window.__SEARCH_SKILLS_RESULT__ = outputText(part.output);
        }
        return { text: "Found it." };
      };
    });
    await pageB.goto(SITE_B);
    await pageB.locator("web-agent-bubble #launcher").click();
    await pageB.locator("web-agent-bubble #input").click();
    await pageB.keyboard.type("Search skills for pirate.");
    await pageB.keyboard.press("Enter");

    await pageB.waitForFunction(() => window.__SEARCH_SKILLS_RESULT__ !== undefined, { timeout: 15_000 });
    expect(await pageB.evaluate(() => window.__SEARCH_SKILLS_RESULT__)).toContain("pirate_speak — Answer like a pirate");
    expect(await pageB.evaluate(() => localStorage.length)).toBe(0);

    // --- The side panel finds it too. --------------------------------------
    const panelPage = await context.newPage();
    await panelPage.addInitScript(() => {
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Search" };
        }
        callCount++;
        if (callCount === 1) {
          return { toolCalls: [{ id: "tc_search", name: "search_skills", input: { query: "pirate" } }] };
        }
        function outputText(output: unknown): string {
          if (typeof output === "string") return output;
          if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
            return output.content;
          }
          return JSON.stringify(output);
        }
        if (Array.isArray(lastMsg?.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "search_skills");
          if (part && part.type === "tool-result") window.__SEARCH_SKILLS_RESULT__ = outputText(part.output);
        }
        return { text: "Found it." };
      };
    });
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panelPage.locator("agent-chat-panel #input").click();
    await panelPage.keyboard.type("Search skills for pirate.");
    await panelPage.keyboard.press("Enter");

    await panelPage.waitForFunction(() => window.__SEARCH_SKILLS_RESULT__ !== undefined, { timeout: 15_000 });
    expect(await panelPage.evaluate(() => window.__SEARCH_SKILLS_RESULT__)).toContain("pirate_speak — Answer like a pirate");

    // --- The panel creates panel_note; an in-page agent finds it. ----------
    const panelNote = { name: "panel_note", description: "A note from the panel", definition: "Note text." };
    const panelPage2 = await context.newPage();
    await panelPage2.addInitScript((skill: typeof panelNote) => {
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Skill" };
        }
        callCount++;
        if (callCount === 1) {
          return { toolCalls: [{ id: "tc_create", name: "create_skill", input: skill }] };
        }
        function outputText(output: unknown): string {
          if (typeof output === "string") return output;
          if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
            return output.content;
          }
          return JSON.stringify(output);
        }
        if (Array.isArray(lastMsg?.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "create_skill");
          if (part && part.type === "tool-result") window.__CREATE_SKILL_RESULT__ = outputText(part.output);
        }
        return { text: "Saved." };
      };
    }, panelNote);
    await panelPage2.setViewportSize({ width: 400, height: 700 });
    await panelPage2.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panelPage2.locator("agent-chat-panel #input").click();
    await panelPage2.keyboard.type("Create the panel_note skill.");
    await panelPage2.keyboard.press("Enter");

    const scrimPanel = panelPage2.locator("agent-chat-panel .wa-confirm-scrim");
    await expect(scrimPanel).toBeVisible({ timeout: 15_000 });
    await scrimPanel.locator("button:has-text('Allow'), md-filled-button:has-text('Allow')").first().click();
    await panelPage2.waitForFunction(() => window.__CREATE_SKILL_RESULT__ !== undefined, { timeout: 15_000 });
    expect(await panelPage2.evaluate(() => window.__CREATE_SKILL_RESULT__)).toContain("saved successfully");

    const pageC = await context.newPage();
    await pageC.addInitScript(() => {
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Search" };
        }
        callCount++;
        if (callCount === 1) {
          return { toolCalls: [{ id: "tc_search", name: "search_skills", input: { query: "panel_note" } }] };
        }
        function outputText(output: unknown): string {
          if (typeof output === "string") return output;
          if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
            return output.content;
          }
          return JSON.stringify(output);
        }
        if (Array.isArray(lastMsg?.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "search_skills");
          if (part && part.type === "tool-result") window.__SEARCH_SKILLS_RESULT__ = outputText(part.output);
        }
        return { text: "Found it." };
      };
    });
    await pageC.goto(SITE_A);
    await pageC.locator("web-agent-bubble #launcher").click();
    await pageC.locator("web-agent-bubble #input").click();
    await pageC.keyboard.type("Search skills for panel_note.");
    await pageC.keyboard.press("Enter");
    await pageC.waitForFunction(() => window.__SEARCH_SKILLS_RESULT__ !== undefined, { timeout: 15_000 });
    expect(await pageC.evaluate(() => window.__SEARCH_SKILLS_RESULT__)).toContain("panel_note — A note from the panel");

    // --- Storage shape -------------------------------------------------------
    let stored = await worker.evaluate(() => chrome.storage.local.get("savedSkills"));
    let savedSkills = (stored as { savedSkills: unknown }).savedSkills as { name: string; description: string; definition: string }[];
    expect(Array.isArray(savedSkills)).toBe(true);
    for (const s of savedSkills) {
      expect(typeof s.name).toBe("string");
      expect(typeof s.description).toBe("string");
      expect(typeof s.definition).toBe("string");
    }
    expect(savedSkills.filter((s) => s.name === "pirate_speak")).toHaveLength(1);
    expect(savedSkills.filter((s) => s.name === "panel_note")).toHaveLength(1);

    // --- Overwrite by name ----------------------------------------------------
    const updatedPirate = { ...PIRATE_SKILL, description: "Answer like an angry pirate" };
    await pageA.addInitScript((skill: typeof updatedPirate) => {
      let callCount = 0;
      window.__CREATE_SKILL_RESULT__ = undefined;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Skill" };
        }
        callCount++;
        if (callCount === 1) {
          return { toolCalls: [{ id: "tc_overwrite", name: "create_skill", input: skill }] };
        }
        function outputText(output: unknown): string {
          if (typeof output === "string") return output;
          if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
            return output.content;
          }
          return JSON.stringify(output);
        }
        if (Array.isArray(lastMsg?.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "create_skill");
          if (part && part.type === "tool-result") window.__CREATE_SKILL_RESULT__ = outputText(part.output);
        }
        return { text: "Overwritten." };
      };
    }, updatedPirate);
    await pageA.reload();
    await pageA.locator("web-agent-bubble #launcher").click();
    await pageA.locator("web-agent-bubble #input").click();
    await pageA.keyboard.type("Overwrite pirate_speak.");
    await pageA.keyboard.press("Enter");
    const scrimA2 = pageA.locator("web-agent-bubble agent-chat-panel .wa-confirm-scrim");
    await expect(scrimA2).toBeVisible({ timeout: 15_000 });
    await scrimA2.locator("button:has-text('Allow'), md-filled-button:has-text('Allow')").first().click();
    await pageA.waitForFunction(() => window.__CREATE_SKILL_RESULT__ !== undefined, { timeout: 15_000 });

    stored = await worker.evaluate(() => chrome.storage.local.get("savedSkills"));
    savedSkills = (stored as { savedSkills: unknown }).savedSkills as { name: string; description: string; definition: string }[];
    const pirateEntries = savedSkills.filter((s) => s.name === "pirate_speak");
    expect(pirateEntries).toHaveLength(1);
    expect(pirateEntries[0]?.description).toBe("Answer like an angry pirate");
  });

  // A skill saved mid-turn is loadable later in the
  // same turn, with no reload between the two tool calls.
  test("a skill saved mid-turn is returned by load_skill later in the same turn", async ({ context }) => {
    const page = await context.newPage();
    await page.addInitScript((skill: typeof PIRATE_SKILL) => {
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Skill" };
        }
        callCount++;
        if (callCount === 1) {
          return { toolCalls: [{ id: "tc_create", name: "create_skill", input: skill }] };
        }
        if (callCount === 2) {
          return { toolCalls: [{ id: "tc_load", name: "load_skill", input: { name: skill.name } }] };
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
        return { text: "Done." };
      };
    }, PIRATE_SKILL);
    await page.goto(SITE_A);
    await page.locator("web-agent-bubble #launcher").click();
    await page.locator("web-agent-bubble #input").click();
    await page.keyboard.type("Create pirate_speak, then load it.");
    await page.keyboard.press("Enter");

    const scrim = page.locator("web-agent-bubble agent-chat-panel .wa-confirm-scrim");
    await expect(scrim).toBeVisible({ timeout: 15_000 });
    await scrim.locator("button:has-text('Allow'), md-filled-button:has-text('Allow')").first().click();

    await page.waitForFunction(() => window.__LOAD_SKILL_RESULT__ !== undefined, { timeout: 15_000 });
    expect(await page.evaluate(() => window.__LOAD_SKILL_RESULT__)).toBe(PIRATE_SKILL.definition);
  });

  test("declining the confirm leaves storage unchanged", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const before = await worker.evaluate(() => chrome.storage.local.get("savedSkills"));

    const page = await context.newPage();
    await page.addInitScript((skill: typeof PIRATE_SKILL) => {
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Skill" };
        }
        callCount++;
        if (callCount === 1) {
          return { toolCalls: [{ id: "tc_create", name: "create_skill", input: skill }] };
        }
        function outputText(output: unknown): string {
          if (typeof output === "string") return output;
          if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
            return output.content;
          }
          return JSON.stringify(output);
        }
        if (Array.isArray(lastMsg?.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "create_skill");
          if (part && part.type === "tool-result") window.__CREATE_SKILL_RESULT__ = outputText(part.output);
        }
        return { text: "Not saved." };
      };
    }, PIRATE_SKILL);
    await page.goto(SITE_A);
    await page.locator("web-agent-bubble #launcher").click();
    await page.locator("web-agent-bubble #input").click();
    await page.keyboard.type("Create pirate_speak.");
    await page.keyboard.press("Enter");

    const scrim = page.locator("web-agent-bubble agent-chat-panel .wa-confirm-scrim");
    await expect(scrim).toBeVisible({ timeout: 15_000 });
    await scrim.locator("button:has-text('Reject'), md-outlined-button:has-text('Reject')").first().click();

    await page.waitForFunction(() => window.__CREATE_SKILL_RESULT__ !== undefined, { timeout: 15_000 });
    expect(await page.evaluate(() => window.__CREATE_SKILL_RESULT__)).toContain("was not confirmed by the user; not saved");

    const after = await worker.evaluate(() => chrome.storage.local.get("savedSkills"));
    expect(after).toEqual(before);
  });

  // With bridge.js prevented from running, the session
  // still starts and search_skills returns only the code-defined skills.
  test("with bridge.js prevented from running, the session still starts within the timeout", async () => {
    await fs.rm(PATCHED, { recursive: true, force: true });
    await fs.cp(EXTENSION, PATCHED, { recursive: true });
    const manifestPath = path.join(PATCHED, "manifest.json");
    const mf = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
      content_scripts?: { js?: string[] }[];
    };
    mf.content_scripts = (mf.content_scripts ?? []).filter((cs) => !(cs.js ?? []).includes("bridge.js"));
    await fs.writeFile(manifestPath, JSON.stringify(mf, null, 2));

    const ctx = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${PATCHED}`, `--load-extension=${PATCHED}`],
    });
    try {
      const page = await ctx.newPage();
      // No bridge.js means nothing posts wa-bridge-enable on its own; the page
      // does it itself. This is the same forgeable channel any page already
      // has — it is not a new exposure.
      await page.addInitScript(() => {
        window.addEventListener("load", () => {
          window.postMessage({ type: "wa-bridge-enable" }, "*");
        });
        let callCount = 0;
        window.__WA_MOCK_SCRIPT__ = (opts) => {
          const lastMsg = opts.messages[opts.messages.length - 1];
          const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
          if (lastText.includes("Summarize the following conversation as a short UI title")) {
            return { text: "Search" };
          }
          callCount++;
          if (callCount === 1) {
            return { toolCalls: [{ id: "tc_search", name: "search_skills", input: { query: "page" } }] };
          }
          function outputText(output: unknown): string {
            if (typeof output === "string") return output;
            if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
              return output.content;
            }
            return JSON.stringify(output);
          }
          if (Array.isArray(lastMsg?.content)) {
            const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "search_skills");
            if (part && part.type === "tool-result") window.__SEARCH_SKILLS_RESULT__ = outputText(part.output);
          }
          return { text: "Found it." };
        };
      });

      const t0 = Date.now();
      await page.goto(SITE_A);
      await expect(page.locator("web-agent-bubble #launcher")).toBeVisible({ timeout: 15_000 });
      await page.locator("web-agent-bubble #launcher").click();
      await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached({ timeout: 15_000 });

      await page.locator("web-agent-bubble #input").click();
      await page.keyboard.type("Search for page skills.");
      await page.keyboard.press("Enter");

      await page.waitForFunction(() => window.__SEARCH_SKILLS_RESULT__ !== undefined, { timeout: 15_000 });
      const elapsed = Date.now() - t0;
      expect(await page.evaluate(() => window.__SEARCH_SKILLS_RESULT__)).toContain("page_fetch");
      expect(elapsed).toBeLessThan(10_000);
    } finally {
      await ctx.close();
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Saved skill owner and the shared flag.
// ---------------------------------------------------------------------------

const OWNER_ARTIFACTS_DIR = path.resolve(
  HERE,
  "../../../temp/artifacts/saved-skill-owner-and-shared-flag",
);
const VISIBLE_PANEL = "#chat agent-chat-panel:not([hidden])";
const LOGIN_SMOKE = {
  name: "login_smoke",
  description: "Smoke test the login page",
  definition: "Open the login page, submit valid credentials, check the dashboard loads.",
};
const OWNED_LOGIN_SMOKE = { ...LOGIN_SMOKE, owner: "tesagent" };
const OWNER_ERROR =
  'Failed to save skill "login_smoke": A skill named "login_smoke" belongs to another agent. Choose another name.';

interface ScriptedCall {
  name: string;
  input: Record<string, unknown>;
}

/** Mock model for one turn: the first call records create_skill's schema and
 *  makes `call`; the next call records that tool's result. Self-contained —
 *  addInitScript serializes it. */
function installOwnerMock(page: Page, call: ScriptedCall): Promise<void> {
  return page.addInitScript((c: ScriptedCall) => {
    let callCount = 0;
    window.__WA_MOCK_SCRIPT__ = (opts) => {
      const lastMsg = opts.messages[opts.messages.length - 1];
      const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
      if (lastText.includes("Summarize the following conversation as a short UI title")) {
        return { text: "Skill" };
      }
      callCount++;
      if (callCount === 1) {
        const create = (opts.tools ?? []).find((t) => t.name === "create_skill");
        window.__OWNER_CREATE_SCHEMA__ = create ? create.input_schema : null;
        return { toolCalls: [{ id: "tc_owner", name: c.name, input: c.input }] };
      }
      if (Array.isArray(lastMsg?.content)) {
        const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === c.name);
        if (part && part.type === "tool-result") {
          const output: unknown = part.output;
          let text: string;
          if (typeof output === "string") text = output;
          else if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
            text = output.content;
          } else text = JSON.stringify(output);
          window.__OWNER_TOOL_RESULT__ = { text, isError: !!part.isError };
        }
      }
      return { text: "Done." };
    };
  }, call);
}

async function serviceWorker(context: BrowserContext): Promise<Worker> {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  return worker;
}

async function seedSkills(context: BrowserContext, skills: Record<string, unknown>[]): Promise<void> {
  const worker = await serviceWorker(context);
  await worker.evaluate((s) => chrome.storage.local.set({ savedSkills: s }), skills);
}

async function storedSkills(context: BrowserContext): Promise<Record<string, unknown>[]> {
  const worker = await serviceWorker(context);
  const got = await worker.evaluate(() => chrome.storage.local.get("savedSkills"));
  return (got as { savedSkills: Record<string, unknown>[] }).savedSkills;
}

/** A fresh side panel page on `agentId`, with `call` scripted, and the turn
 *  sent. The panel appends its agent panel after a storage read, so this waits
 *  for the visible panel before sending. */
async function panelTurn(
  context: BrowserContext,
  extensionId: string,
  agentId: "chromagent" | "tesagent",
  call: ScriptedCall,
): Promise<Page> {
  const page = await context.newPage();
  await installOwnerMock(page, call);
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.locator("#agent-combo")).toBeVisible();
  const current = await page.locator("#agent-combo .name").textContent();
  const wanted = agentId === "tesagent" ? "Tesagent" : "Chromagent";
  if (current !== wanted) {
    await page.locator("#agent-combo").click();
    await expect(page.locator("#agent-list")).toBeVisible();
    await page.locator(`#agent-option-${agentId}`).click();
  }
  await expect(page.locator("#agent-combo .name")).toHaveText(wanted);
  await expect(page.locator(VISIBLE_PANEL)).toBeAttached();
  await page.evaluate((selector) => {
    const panel = document.querySelector<HTMLElementTagNameMap["agent-chat-panel"]>(selector);
    if (!panel) throw new Error("no visible agent-chat-panel");
    void panel.send("Run the scripted tool.");
  }, VISIBLE_PANEL);
  return page;
}

/** The in-page bubble on SITE_A with `call` scripted, and the turn sent. */
async function bubbleTurn(context: BrowserContext, call: ScriptedCall): Promise<Page> {
  const page = await context.newPage();
  await installOwnerMock(page, call);
  await page.goto(SITE_A);
  await page.locator("web-agent-bubble #launcher").click();
  await page.locator("web-agent-bubble #input").click();
  await page.keyboard.type("Run the scripted tool.");
  await page.keyboard.press("Enter");
  return page;
}

async function toolResult(page: Page): Promise<{ text: string; isError: boolean }> {
  await page.waitForFunction(() => window.__OWNER_TOOL_RESULT__ !== undefined, undefined, { timeout: 15_000 });
  const result = await page.evaluate(() => window.__OWNER_TOOL_RESULT__);
  if (!result) throw new Error("no tool result");
  return result;
}

/** The confirm scrim inside `root`; asserts the summary text exactly. */
async function expectSummary(page: Page, root: string, summary: string) {
  const scrim = page.locator(`${root} .wa-confirm-scrim`);
  await expect(scrim).toBeVisible({ timeout: 15_000 });
  await expect(scrim.locator(".wa-confirm-card strong").first()).toHaveText(summary);
  return scrim;
}

async function allow(scrim: Locator): Promise<void> {
  await scrim.locator("button:has-text('Allow'), md-filled-button:has-text('Allow')").first().click();
}

const SEARCH = (query: string): ScriptedCall => ({ name: "search_skills", input: { query } });

/** Posts one wa-skills-* request from the page's MAIN world and resolves the
 *  bridge's reply, or null after 5 s. */
function askBridge(page: Page, request: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  return page.evaluate(
    (req) =>
      new Promise<Record<string, unknown> | null>((resolve) => {
        const onReply = (event: MessageEvent) => {
          const data: unknown = event.data;
          if (typeof data !== "object" || data === null) return;
          const rec = data as Record<string, unknown>;
          if (rec.type !== "wa-skills-result" || rec.id !== req.id) return;
          clearTimeout(timer);
          window.removeEventListener("message", onReply);
          resolve(rec);
        };
        const timer = setTimeout(() => {
          window.removeEventListener("message", onReply);
          resolve(null);
        }, 5_000);
        window.addEventListener("message", onReply);
        window.postMessage(req, "*");
      }),
    request,
  );
}

test.describe("Saved skill owner and the shared flag", () => {
  test.beforeAll(async () => {
    await fs.mkdir(OWNER_ARTIFACTS_DIR, { recursive: true });
  });

  test.beforeEach(async ({ context }) => {
    const worker = await serviceWorker(context);
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        enabledOrigins: ["http://localhost:10040", "http://127.0.0.1:10040"],
        savedSkills: [],
      });
    });
  });

  test("tesagent saves a private skill; summary, schema and stored owner", async ({ context, extensionId }) => {
    const page = await panelTurn(context, extensionId, "tesagent", {
      name: "create_skill",
      input: { ...LOGIN_SMOKE, shared: false },
    });
    const scrim = await expectSummary(page, VISIBLE_PANEL, 'Create skill "login_smoke" for Tesagent only');

    const fits = await scrim.locator(".wa-confirm-card").evaluate((card) => {
      const desc = card.querySelector("p");
      const strong = card.querySelector("strong");
      const c = card.getBoundingClientRect();
      const s = strong?.getBoundingClientRect();
      return (
        !!desc &&
        !!s &&
        desc.scrollWidth <= desc.clientWidth &&
        s.left >= c.left &&
        s.right <= c.right &&
        c.left >= 0 &&
        c.right <= 400
      );
    });
    expect(fits).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
    ).toBe(false);

    await page.screenshot({ path: path.join(OWNER_ARTIFACTS_DIR, "01-confirm-tesagent-only.png") });

    const schema = await page.evaluate(() => window.__OWNER_CREATE_SCHEMA__);
    expect(schema).not.toBeNull();
    expect((schema as { properties: Record<string, { type?: string }> }).properties.shared?.type).toBe("boolean");
    expect((schema as { required: string[] }).required).toEqual(["name", "description", "definition"]);

    await allow(scrim);
    const result = await toolResult(page);
    expect(result.isError).toBe(false);
    expect(result.text).toContain("saved successfully");

    const stored = await storedSkills(context);
    expect(stored.filter((s) => s.name === "login_smoke")).toEqual([{ ...LOGIN_SMOKE, owner: "tesagent" }]);
  });

  test("a private skill is listed only by its owner; the bubble has no shared", async ({
    context,
    extensionId,
  }) => {
    await seedSkills(context, [OWNED_LOGIN_SMOKE]);

    const chroma = await panelTurn(context, extensionId, "chromagent", SEARCH("login_smoke"));
    expect((await toolResult(chroma)).text).toBe("No skills matched the query.");

    const tesagent = await panelTurn(context, extensionId, "tesagent", SEARCH("login_smoke"));
    expect((await toolResult(tesagent)).text).toContain("login_smoke — Smoke test the login page");

    const bubble = await bubbleTurn(context, SEARCH("login_smoke"));
    expect((await toolResult(bubble)).text).toBe("No skills matched the query.");

    const schema = await bubble.evaluate(() => window.__OWNER_CREATE_SCHEMA__);
    expect(schema).not.toBeNull();
    expect(Object.keys((schema as { properties: Record<string, unknown> }).properties)).not.toContain("shared");
    expect((schema as { required: string[] }).required).toEqual(["name", "description", "definition"]);
  });

  test("Chromagent saves a shared skill; tesagent and the bubble list it", async ({ context, extensionId }) => {
    const WEEKLY = { name: "weekly_report", description: "Weekly status report", definition: "Collect the week's changes." };
    const page = await panelTurn(context, extensionId, "chromagent", { name: "create_skill", input: WEEKLY });

    const scrim = await expectSummary(page, VISIBLE_PANEL, 'Create skill "weekly_report" for all agents');
    await page.screenshot({ path: path.join(OWNER_ARTIFACTS_DIR, "02-confirm-all-agents.png") });

    await allow(scrim);
    expect((await toolResult(page)).isError).toBe(false);

    const stored = (await storedSkills(context)).find((s) => s.name === "weekly_report");
    expect(stored).toEqual(WEEKLY);
    expect(stored && "owner" in stored).toBe(false);

    const tesagent = await panelTurn(context, extensionId, "tesagent", SEARCH("weekly_report"));
    expect((await toolResult(tesagent)).text).toContain("weekly_report — Weekly status report");

    const bubble = await bubbleTurn(context, SEARCH("weekly_report"));
    expect((await toolResult(bubble)).text).toContain("weekly_report — Weekly status report");
  });

  test("a skill stored with no owner before load is listed by all three", async ({ context, extensionId }) => {
    const LEGACY = { name: "legacy_note", description: "Saved before owners", definition: "Old." };
    await seedSkills(context, [LEGACY]);

    const chroma = await panelTurn(context, extensionId, "chromagent", SEARCH("legacy_note"));
    expect((await toolResult(chroma)).text).toContain("legacy_note — Saved before owners");

    const tesagent = await panelTurn(context, extensionId, "tesagent", SEARCH("legacy_note"));
    expect((await toolResult(tesagent)).text).toContain("legacy_note — Saved before owners");

    const bubble = await bubbleTurn(context, SEARCH("legacy_note"));
    expect((await toolResult(bubble)).text).toContain("legacy_note — Saved before owners");
  });

  test("Chromagent cannot save a name tesagent owns", async ({ context, extensionId }) => {
    await seedSkills(context, [OWNED_LOGIN_SMOKE]);
    const page = await panelTurn(context, extensionId, "chromagent", {
      name: "create_skill",
      input: { ...LOGIN_SMOKE, definition: "Overwrite attempt." },
    });
    const scrim = await expectSummary(page, VISIBLE_PANEL, 'Create skill "login_smoke" for all agents');
    await allow(scrim);

    const result = await toolResult(page);
    expect(result.isError).toBe(true);
    expect(result.text).toBe(OWNER_ERROR);
    expect(await storedSkills(context)).toEqual([OWNED_LOGIN_SMOKE]);
  });

  test("the in-page bubble cannot save a name tesagent owns", async ({ context }) => {
    await seedSkills(context, [OWNED_LOGIN_SMOKE]);
    const page = await bubbleTurn(context, { name: "create_skill", input: { ...LOGIN_SMOKE, definition: "Page attempt." } });
    const scrim = await expectSummary(page, "web-agent-bubble agent-chat-panel", 'Create skill "login_smoke"');
    await allow(scrim);

    const result = await toolResult(page);
    expect(result.isError).toBe(true);
    expect(result.text).toBe(OWNER_ERROR);
    expect(await storedSkills(context)).toEqual([OWNED_LOGIN_SMOKE]);
  });

  test("tesagent overwrites its own skill as shared; Chromagent then lists it", async ({ context, extensionId }) => {
    await seedSkills(context, [OWNED_LOGIN_SMOKE]);
    const page = await panelTurn(context, extensionId, "tesagent", { name: "create_skill", input: { ...LOGIN_SMOKE, shared: true } });
    const scrim = await expectSummary(page, VISIBLE_PANEL, 'Overwrite existing skill "login_smoke"');
    await allow(scrim);
    expect((await toolResult(page)).isError).toBe(false);

    expect(await storedSkills(context)).toEqual([LOGIN_SMOKE]);
    expect(Object.keys((await storedSkills(context))[0])).not.toContain("owner");

    const chroma = await panelTurn(context, extensionId, "chromagent", SEARCH("login_smoke"));
    expect((await toolResult(chroma)).text).toContain("login_smoke — Smoke test the login page");
  });

  test("a page message with owner and no agentId stores a shared skill", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(SITE_A);
    await expect(page.locator("web-agent-bubble #launcher")).toBeVisible();

    const PAGE_SKILL = { name: "page_saved", description: "Saved by a page script", definition: "Page text." };
    const reply = await askBridge(page, { type: "wa-skills-save", id: "m8-save", skill: { ...PAGE_SKILL, owner: "tesagent" } });
    expect(reply?.result).toBe(true);

    const stored = (await storedSkills(context)).find((s) => s.name === "page_saved");
    expect(stored).toEqual(PAGE_SKILL);
    expect(Object.keys(stored ?? {})).not.toContain("owner");

    const chroma = await panelTurn(context, extensionId, "chromagent", SEARCH("page_saved"));
    expect((await toolResult(chroma)).text).toContain("page_saved — Saved by a page script");
    const tesagent = await panelTurn(context, extensionId, "tesagent", SEARCH("page_saved"));
    expect((await toolResult(tesagent)).text).toContain("page_saved — Saved by a page script");
    const bubble = await bubbleTurn(context, SEARCH("page_saved"));
    expect((await toolResult(bubble)).text).toContain("page_saved — Saved by a page script");
  });

  test("a page that forges agentId cannot list, read, save for or delete a private skill", async ({ context }) => {
    await seedSkills(context, [OWNED_LOGIN_SMOKE]);
    const page = await context.newPage();
    await page.goto(SITE_A);
    await expect(page.locator("web-agent-bubble #launcher")).toBeVisible();

    const list = await askBridge(page, { type: "wa-skills-list", id: "m9-list", agentId: "tesagent" });
    expect(list?.result).toEqual([]);

    const got = await askBridge(page, { type: "wa-skills-get", id: "m9-get", agentId: "tesagent", name: "login_smoke" });
    expect(got).not.toBeNull();
    expect(got?.result).toBeUndefined();

    const FORGED = { name: "forged_skill", description: "Forged", definition: "Forged." };
    const saved = await askBridge(page, {
      type: "wa-skills-save",
      id: "m9-save",
      agentId: "tesagent",
      skill: { ...FORGED, owner: "tesagent" },
    });
    expect(saved?.result).toBe(true);
    const forged = (await storedSkills(context)).find((s) => s.name === "forged_skill");
    expect(Object.keys(forged ?? {})).not.toContain("owner");

    const over = await askBridge(page, {
      type: "wa-skills-save",
      id: "m9-over",
      agentId: "tesagent",
      skill: { ...LOGIN_SMOKE, definition: "Forged." },
    });
    expect(over?.error).toBe('A skill named "login_smoke" belongs to another agent. Choose another name.');

    const removed = await askBridge(page, { type: "wa-skills-remove", id: "m9-remove", agentId: "tesagent", name: "login_smoke" });
    expect(removed?.result).toBe(true);

    expect((await storedSkills(context)).find((s) => s.name === "login_smoke")).toEqual(OWNED_LOGIN_SMOKE);
  });

  test("Chromagent's delete_skill cannot remove tesagent's skill; the options page lists and deletes it", async ({
    context,
    extensionId,
  }) => {
    const WEEKLY = { name: "weekly_report", description: "Weekly status report", definition: "Collect the week's changes." };
    await seedSkills(context, [OWNED_LOGIN_SMOKE, WEEKLY]);

    // Chromagent's delete_skill: not found, no confirm, nothing removed.
    const page = await panelTurn(context, extensionId, "chromagent", { name: "delete_skill", input: { name: "login_smoke" } });
    const result = await toolResult(page);
    expect(result.isError).toBe(true);
    expect(result.text).toBe('Skill "login_smoke" not found. Use search_skills to see available skills.');
    await expect(page.locator(`${VISIBLE_PANEL} .wa-confirm-scrim`)).toHaveCount(0);
    expect(await storedSkills(context)).toEqual([OWNED_LOGIN_SMOKE, WEEKLY]);

    // The options page lists the private skill and deletes it.
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator("#tab-btn-skills").click();
    await expect(options.locator("#skill-list .skill-row")).toHaveCount(2);
    expect(await options.locator("#skill-list .skill-name").allTextContents()).toEqual(["login_smoke", "weekly_report"]);
    // fullPage: the saved-skills list sits below the fold on a default
    // viewport, and a viewport-only capture cuts off the second row.
    await options.screenshot({ path: path.join(OWNER_ARTIFACTS_DIR, "04-options-private-and-shared.png"), fullPage: true });
    await options.locator("#skill-list .skill-row").nth(0).locator("button.skill-del").click();
    await expect(options.locator("#skill-list .skill-row")).toHaveCount(1);
    expect(await storedSkills(context)).toEqual([WEEKLY]);
  });
});
