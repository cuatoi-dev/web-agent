import { test, expect, openOptions } from "./extension.fixture";
import { chromium, type Page, type BrowserContext } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "../dist");
// Every e2e copy of dist/ lives under temp/e2e-extensions/<spec>/, removed
// when the spec finishes (same rule as agent-switcher.mock.spec.ts:9-12).
const TEMP_DIR = path.resolve(HERE, "../temp/e2e-extensions/agent-editor");
const ARTIFACTS_DIR = path.resolve(HERE, "../../../temp/artifacts/2026-09-16-182426-003-agent-card-editor");

const TESAGENT = '#agent-cards .card[data-agent-id="tesagent"]';
const CHROMAGENT = '#agent-cards .card[data-agent-id="chromagent"]';
const VISIBLE_PANEL = "#chat agent-chat-panel:not([hidden])";

async function openAgents(page: Page, extensionId: string): Promise<void> {
  await openOptions(page, extensionId);
  await page.locator("#tab-btn-agents").click();
  await expect(page.locator("#agent-cards .card")).toHaveCount(2);
}

async function edit(page: Page, card: string): Promise<void> {
  await page.locator(`${card} .card-edit-btn`).click();
  await expect(page.locator(`${card} .edit-body`)).toBeVisible();
}

async function stored(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => chrome.storage.local.get(["agentEdits", "userAgents"]));
}

/** Opens a multi-select by clicking its box; `id` is e.g. "edit-tesagent-tools". */
async function openList(page: Page, id: string): Promise<void> {
  await page.locator(`#${id}-box`).click();
  await expect(page.locator(`#${id}-list`)).toBeVisible();
}

function option(page: Page, id: string, name: string) {
  return page.locator(`#${id}-list [role="option"][data-name="${name}"]`);
}

async function chips(page: Page, id: string): Promise<string[]> {
  return page.locator(`#${id}-box .chip`).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.name ?? ""));
}

async function launchPatched(dir: string, patch: Record<string, unknown>): Promise<{ ctx: BrowserContext; id: string }> {
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
  return { ctx, id: worker.url().split("/")[2] };
}

test.describe("Agent card editor", () => {
  test.afterAll(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  test("ED1: Edit on tesagent expands it; Chromagent dimmed; Add agent disabled; brand note", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId);
    await edit(page, TESAGENT);

    const tesagent = page.locator(TESAGENT);
    await expect(tesagent).toHaveClass(/editing/);
    await expect(tesagent.locator(".card-edit-btn")).toHaveText("Editing");
    await expect(tesagent.locator(".card-edit-btn")).toBeDisabled();
    await expect(tesagent.locator(".card-title .n")).toContainText("Tesagent");
    await expect(tesagent.locator(".card-title .d")).toHaveText("Display name and id are provided and cannot be changed.");
    await expect(page.locator("#edit-tesagent-displayName")).toHaveCount(0);
    await expect(page.locator("#edit-tesagent-description")).toHaveValue("Test agent — explores a website, writes and runs test cases");
    await expect(page.locator("#edit-tesagent-instructions")).toHaveValue(/^You are Tesagent, a manual tester\./);
    await expect(page.locator("#edit-tesagent-model")).toHaveValue("");
    expect(await chips(page, "edit-tesagent-skills")).toEqual(["*"]);
    expect(await chips(page, "edit-tesagent-tools")).toEqual(["*"]);

    await expect(page.locator(CHROMAGENT)).toHaveClass(/dim/);
    await expect(page.locator(`${CHROMAGENT} .card-edit-btn`)).toBeDisabled();
    await expect(page.locator("#add-agent-btn")).toBeDisabled();
  });

  test("ED2: All tools leaves one chip and saves tools '*'", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId);
    await edit(page, TESAGENT);
    await page.locator("#edit-tesagent-description").fill("Edited tesagent");
    await openList(page, "edit-tesagent-tools");
    await option(page, "edit-tesagent-tools", "read_tabs").click();
    expect(await chips(page, "edit-tesagent-tools")).toEqual(["read_tabs"]);
    await option(page, "edit-tesagent-tools", "*").click();
    expect(await chips(page, "edit-tesagent-tools")).toEqual(["*"]);
    await expect(page.locator("#edit-tesagent-tools-box .chip")).toContainText("All tools (*)");
    await page.locator(`${TESAGENT} .save-btn`).click();
    await expect(page.locator(`${TESAGENT} .edit-body`)).toHaveCount(0);
    const s = await stored(page);
    expect((s.agentEdits as Record<string, { tools: unknown }>).tesagent.tools).toBe("*");
  });

  test("ED3: with '*' set, picking read_tabs replaces the All chip", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId);
    await edit(page, TESAGENT);
    await openList(page, "edit-tesagent-tools");
    await option(page, "edit-tesagent-tools", "read_tabs").click();
    expect(await chips(page, "edit-tesagent-tools")).toEqual(["read_tabs"]);
    await expect(option(page, "edit-tesagent-tools", "*")).toHaveAttribute("aria-selected", "false");
    await expect(option(page, "edit-tesagent-tools", "read_tabs")).toHaveAttribute("aria-selected", "true");
  });

  test("ED4: read_tabs then page_eval saves the list in pick order", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId);
    await edit(page, TESAGENT);
    await openList(page, "edit-tesagent-tools");
    await option(page, "edit-tesagent-tools", "read_tabs").click();
    await option(page, "edit-tesagent-tools", "page_eval").click();
    await page.locator(`${TESAGENT} .save-btn`).click();
    await expect(page.locator(`${TESAGENT} .edit-body`)).toHaveCount(0);
    const s = await stored(page);
    expect((s.agentEdits as Record<string, { tools: unknown }>).tesagent.tools).toEqual(["read_tabs", "page_eval"]);
  });

  test("ED5: picking a selected name unselects it; chip × removes it", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId);
    await edit(page, TESAGENT);
    await openList(page, "edit-tesagent-tools");
    await option(page, "edit-tesagent-tools", "read_tabs").click();
    await option(page, "edit-tesagent-tools", "page_eval").click();
    await option(page, "edit-tesagent-tools", "read_tabs").click();
    expect(await chips(page, "edit-tesagent-tools")).toEqual(["page_eval"]);
    await page.locator('#edit-tesagent-tools-box .chip[data-name="page_eval"] .x').click();
    expect(await chips(page, "edit-tesagent-tools")).toEqual([]);
  });

  test("ED6-ED7: filter 'tab' hides Page and Core headings, keeps All; 'zzz' shows No matching names", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId);
    await edit(page, TESAGENT);
    await openList(page, "edit-tesagent-tools");
    await page.locator("#edit-tesagent-tools-filter").fill("tab");

    const names = await page.locator('#edit-tesagent-tools-list [role="option"]:visible').evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).dataset.name ?? ""));
    expect(names).toEqual(["*", "read_tabs", "open_tab", "navigate_tab", "refresh_tab", "close_tab"]);
    await expect(page.locator("#edit-tesagent-tools-list .ms-group:visible")).toHaveText(["Tabs"]);
    await expect(page.locator("#edit-tesagent-tools-list .ms-empty")).toBeHidden();

    await page.locator("#edit-tesagent-tools-filter").fill("zzz");
    await expect(page.locator("#edit-tesagent-tools-list .ms-empty")).toBeVisible();
    await expect(page.locator("#edit-tesagent-tools-list .ms-empty")).toHaveText("No matching names");
    await expect(page.locator('#edit-tesagent-tools-list [role="option"]:visible')).toHaveCount(1);
    await expect(page.locator("#edit-tesagent-tools-list .ms-group:visible")).toHaveCount(0);
  });

  test("ED8-ED9: keyboard only selects the second tool; aria-selected matches the tick", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId);
    await edit(page, TESAGENT);

    // tesagent skills are "*", so Excluded skills is enabled and holds no chip:
    // the next Tab stop after it is the Tools box.
    await page.locator("#edit-tesagent-exclude-skills-box").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#edit-tesagent-tools-box")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#edit-tesagent-tools-list")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    expect(await chips(page, "edit-tesagent-tools")).toEqual(["open_tab"]);

    const mismatches = await page.locator('#edit-tesagent-tools-list [role="option"]').evaluateAll((els) =>
      els.filter((e) => (e.getAttribute("aria-selected") === "true") !== e.querySelector(".tick")!.classList.contains("on")).length);
    expect(mismatches).toBe(0);
    await expect(option(page, "edit-tesagent-tools", "open_tab")).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Escape");
    await expect(page.locator("#edit-tesagent-tools-list")).toBeHidden();
    await expect(page.locator("#edit-tesagent-tools-box")).toBeFocused();
  });

  test("ED10-ED12: Chromagent exclude skills follows Skills", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId);
    await edit(page, CHROMAGENT);

    expect(await chips(page, "edit-chromagent-skills")).toEqual(["*"]);
    expect(await chips(page, "edit-chromagent-exclude-skills")).toEqual([]);
    await expect(page.locator("#edit-chromagent-exclude-skills-box")).toHaveAttribute("aria-disabled", "false");

    await openList(page, "edit-chromagent-skills");
    await option(page, "edit-chromagent-skills", "tab_management").click();
    await expect(page.locator("#edit-chromagent-exclude-skills-box")).toHaveAttribute("aria-disabled", "true");
    expect(await chips(page, "edit-chromagent-exclude-skills")).toEqual([]);

    await option(page, "edit-chromagent-skills", "*").click();
    await expect(page.locator("#edit-chromagent-exclude-skills-box")).toHaveAttribute("aria-disabled", "false");
    expect(await chips(page, "edit-chromagent-exclude-skills")).toEqual([]);

    // Back to a single skill, then save: excludeSkills is stored empty.
    await option(page, "edit-chromagent-skills", "tab_management").click();
    await page.locator(`${CHROMAGENT} .save-btn`).click();
    await expect(page.locator(`${CHROMAGENT} .edit-body`)).toHaveCount(0);
    const s = await stored(page);
    const e = (s.agentEdits as Record<string, { skills: unknown; excludeSkills: unknown }>).chromagent;
    expect(e.skills).toEqual(["tab_management"]);
    expect(e.excludeSkills).toEqual([]);
  });

  test("ED13: All tools except page_eval saves and summarises as All except 4", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId);
    await edit(page, TESAGENT);
    await openList(page, "edit-tesagent-exclude-tools");
    await option(page, "edit-tesagent-exclude-tools", "page_eval").click();
    await page.locator(`${TESAGENT} .save-btn`).click();
    await expect(page.locator(`${TESAGENT} .edit-body`)).toHaveCount(0);
    const s = await stored(page);
    const e = (s.agentEdits as Record<string, { tools: unknown; excludeTools: unknown }>).tesagent;
    expect(e.tools).toBe("*");
    // tesagent's brand already excludes the three in-page agent tools (122/003);
    // picking page_eval stores all four.
    expect(e.excludeTools).toEqual(["toggle_page_agent", "send_to_page_agent", "read_page_agent", "page_eval"]);
    await expect(page.locator(`${TESAGENT} .facts`)).toContainText("Tools All except 4");
  });

  test("ED14: description and Sonnet model save; card shows Edited, description and model", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId);
    await edit(page, TESAGENT);
    await page.locator("#edit-tesagent-description").fill("Custom tesagent tester");
    await page.selectOption("#edit-tesagent-model", "brand:anthropic-sonnet");
    await expect(page.locator("#edit-tesagent-model option:checked")).toHaveText("Sonnet — Gateway");
    await page.locator(`${TESAGENT} .save-btn`).click();

    await expect(page.locator(`${TESAGENT} .edit-body`)).toHaveCount(0);
    await expect(page.locator(`${TESAGENT} .pill`)).toContainText(["Provided", "Edited"]);
    await expect(page.locator(`${TESAGENT} .card-title .d`)).toHaveText("Custom tesagent tester");
    await expect(page.locator(`${TESAGENT} .facts`)).toContainText("Model Sonnet");
    const s = await stored(page);
    expect((s.agentEdits as Record<string, { model: unknown }>).tesagent.model).toBe("brand:anthropic-sonnet");
    await expect(page.locator(`${CHROMAGENT} .card-edit-btn`)).toBeEnabled();
  });

  test("ED15: Cancel after a change collapses the card and writes nothing", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId);
    await edit(page, TESAGENT);
    await page.locator("#edit-tesagent-description").fill("Not saved");
    await page.locator(`${TESAGENT} .cancel-btn`).click();
    await expect(page.locator(`${TESAGENT} .edit-body`)).toHaveCount(0);
    await expect(page.locator(`${TESAGENT} .card-title .d`)).toHaveText("Test agent — explores a website, writes and runs test cases");
    const s = await stored(page);
    expect(s.agentEdits).toBeUndefined();
  });

  test("ED16: saving values equal to the brand stores no edit and shows no Edited", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId);
    await edit(page, TESAGENT);
    await page.locator(`${TESAGENT} .save-btn`).click();
    await expect(page.locator(`${TESAGENT} .edit-body`)).toHaveCount(0);
    const s = await stored(page);
    expect(s.agentEdits).toEqual({});
    await expect(page.locator(`${TESAGENT} .pill`)).toHaveText(["Provided"]);
  });

  test("ED17-ED19: validation messages; card stays open; storage unchanged", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId);
    await edit(page, TESAGENT);

    await page.locator("#edit-tesagent-instructions").fill("");
    await page.locator(`${TESAGENT} .save-btn`).click();
    await expect(page.locator("#edit-tesagent-instructions-error")).toHaveText("Enter the system instructions.");
    await expect(page.locator("#edit-tesagent-instructions-error")).toHaveAttribute("role", "alert");
    await expect(page.locator("#edit-tesagent-instructions")).toBeFocused();
    await expect(page.locator(`${TESAGENT} .edit-body`)).toBeVisible();
    expect((await stored(page)).agentEdits).toBeUndefined();

    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "03-validation-light.png"), fullPage: true });

    await page.locator("#edit-tesagent-instructions").fill("Restored.");
    await page.locator("#edit-tesagent-description").fill("   ");
    await page.locator(`${TESAGENT} .save-btn`).click();
    await expect(page.locator("#edit-tesagent-description-error")).toHaveText("Enter a description.");
    await expect(page.locator("#edit-tesagent-instructions-error")).toBeHidden();
    await page.locator("#edit-tesagent-description").fill("Restored.");

    await page.locator("#edit-tesagent-tools-box .chip .x").click();
    await page.locator(`${TESAGENT} .save-btn`).click();
    await expect(page.locator("#edit-tesagent-tools-error")).toHaveText("Choose at least one tool or All tools (*)");

    await page.locator("#edit-tesagent-skills-box .chip .x").click();
    await page.locator(`${TESAGENT} .save-btn`).click();
    await expect(page.locator("#edit-tesagent-skills-error")).toHaveText("Choose at least one skill or All skills (*)");
    await expect(page.locator("#edit-tesagent-skills-error")).toHaveAttribute("role", "alert");
    await expect(page.locator("#edit-tesagent-skills-box")).toBeFocused();
    expect((await stored(page)).agentEdits).toBeUndefined();

    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "04-validation-dark.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "light" });
  });

  test("ED20: Reset removes the stored edit and shows the brand description", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        agentEdits: {
          tesagent: { description: "Custom tesagent tester", instructions: "Custom.", model: null, tools: "*", excludeTools: [], skills: "*", excludeSkills: [] },
        },
      });
    });
    const page = await context.newPage();
    await openAgents(page, extensionId);
    await expect(page.locator(`${TESAGENT} .pill`)).toContainText(["Provided", "Edited"]);
    await edit(page, TESAGENT);
    await page.locator(`${TESAGENT} .reset-btn`).click();
    await expect(page.locator(`${TESAGENT} .edit-body`)).toHaveCount(0);
    await expect(page.locator(`${TESAGENT} .pill`)).toHaveText(["Provided"]);
    await expect(page.locator(`${TESAGENT} .card-title .d`)).toHaveText("Test agent — explores a website, writes and runs test cases");
    const s = await stored(page);
    expect(s.agentEdits).toEqual({});
  });

  test("ED21: lockModel true disables the Model select on every card", async () => {
    const { ctx, id } = await launchPatched(path.resolve(TEMP_DIR, "lock-model"), { options: { lockModel: true } });
    try {
      const page = await ctx.newPage();
      await openAgents(page, id);
      await edit(page, TESAGENT);
      await expect(page.locator("#edit-tesagent-model")).toBeDisabled();
      await page.locator(`${TESAGENT} .cancel-btn`).click();
      await edit(page, CHROMAGENT);
      await expect(page.locator("#edit-chromagent-model")).toBeDisabled();
    } finally {
      await ctx.close();
    }
  });

  test("ED22: saved tools read_tabs and page_eval reach tesagent in the side panel", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId);
    await edit(page, TESAGENT);
    await openList(page, "edit-tesagent-tools");
    await option(page, "edit-tesagent-tools", "read_tabs").click();
    await option(page, "edit-tesagent-tools", "page_eval").click();
    await page.locator(`${TESAGENT} .save-btn`).click();
    await expect(page.locator(`${TESAGENT} .edit-body`)).toHaveCount(0);

    const panelPage = await context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await panelPage.locator("#agent-combo").click();
    await panelPage.locator("#agent-option-tesagent").click();
    await expect(panelPage.locator(`${VISIBLE_PANEL} .header-title`)).toHaveText("Tesagent");

    const offered = await panelPage.evaluate(async (selector) => {
      const panel = document.querySelector<HTMLElementTagNameMap["agent-chat-panel"]>(selector);
      const fromProviders = (await Promise.all((panel?.toolProviders ?? []).map((p) => p.load()))).flat().map((t) => t.name);
      const config = panel?.config as unknown as { tools: (ctx: object) => { name: string }[] };
      const fromCore = config.tools({}).map((t) => t.name);
      return [...fromProviders, ...fromCore].sort();
    }, VISIBLE_PANEL);
    expect(offered).toEqual(["page_eval", "read_tabs"]);
  });

  test("ED23: screenshots — tesagent editing with the tools list open, light and dark", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 800, height: 1200 });
    await openAgents(page, extensionId);
    await edit(page, TESAGENT);
    await openList(page, "edit-tesagent-tools");
    for (const name of ["read_tabs", "navigate_tab", "page_eval", "page_screenshot"]) {
      await option(page, "edit-tesagent-tools", name).click();
    }
    await expect(page.locator("#edit-tesagent-tools-list .ms-group")).toHaveText(["Tabs", "Page", "Page agent", "Core"]);
    await expect(page.locator("#edit-tesagent-tools-filter")).toBeVisible();
    await expect(option(page, "edit-tesagent-tools", "*")).toBeVisible();

    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "01-editing-tools-open-light.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "02-editing-tools-open-dark.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "light" });
  });
});
