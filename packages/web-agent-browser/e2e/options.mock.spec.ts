import { test, expect, openOptions, optionsReady } from "./extension.fixture";
import { chromium, type Locator, type Page, type Worker } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(HERE, "../../../temp/artifacts/2026-08-16-124449-002-web-agent-browser-extension-package");
const ARTIFACTS_004 = path.resolve(HERE, "../../../temp/artifacts/2026-08-16-124449-004-options-page-endpoint-model-and-key");
const ARTIFACTS_005 = path.resolve(HERE, "../../../temp/artifacts/2026-09-08-204122-005-saved-skills-list-on-options-page");

test.describe("Options page", () => {
  test("has no Token field; Save stores the theme", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    const page = await context.newPage();

    await openOptions(page, extensionId);
    await expect(page.locator("#token")).toHaveCount(0);
    await expect(page.getByText("Token", { exact: true })).toHaveCount(0);
    await expect(page.locator("#theme")).toBeVisible();
    await expect(page.locator("#save")).toBeVisible();

    await page.locator("#theme").selectOption({ index: 1 });
    const picked = await page.locator("#theme").inputValue();

    const saveBtn = page.locator("#save");
    const status = page.locator("#status");
    await saveBtn.click();
    await expect(status).toContainText("Saved.");

    // Screenshot artifact
    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "02-options-page.png") });

    // Reopen page and check value
    await page.reload();
    await optionsReady(page);
    await expect(page.locator("#theme")).toHaveValue(picked);

    const storedSettings = await worker.evaluate(async () => {
      const got = await chrome.storage.local.get("agentSettings");
      return got.agentSettings as { theme?: string } | undefined;
    });
    expect(storedSettings?.theme).toBe(picked);
  });

  test("dark colour scheme renders the page from the same tokens", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: "dark" });
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-models").click();
    await expect(page.locator("#model-table")).toBeVisible();
    await fs.mkdir(ARTIFACTS_004, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACTS_004, "02-options-page-dark.png"), fullPage: true });
  });

  test("the default model reaches the bubble on a page", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    const options = await context.newPage();
    await openOptions(options, extensionId);
    await options.click("#tab-btn-models");
    await options.click('#model-table tr.model-row[data-ref="brand:gemini-flash"] input.model-default');

    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
    });

    const page = await context.newPage();
    await page.goto("http://localhost:10040/plain.html");
    await expect(page.locator("web-agent-bubble #launcher")).toBeVisible();

    const applied = await page.evaluate(() => {
      const el = document.querySelector("web-agent-bubble") as any;
      return {
        path: el?.path,
        type: el?.type,
        model: el?.model,
        selectedModel: el?.selectedModel,
        dataTheme: el?.getAttribute("data-theme"),
      };
    });
    expect(applied).toEqual({
      path: "http://localhost:28780/api/gemini",
      type: "gemini",
      model: "gemini-flash-lite-latest",
      selectedModel: "brand:gemini-flash",
      dataTheme: "wa2-light",
    });
  });
});

const SEED_SKILLS = [
  { name: "pirate_speak", description: "Answer like a pirate", definition: "Say arr." },
  { name: "panel_note", description: "A note", definition: "Note text." },
];
const EMPTY_TEXT = "No skills saved yet. Ask the agent to create one and it appears here.";

test.describe("Saved skills", () => {
  test("E1-E3: seeds two skills under light and renders them; dark screenshot", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const sw = worker;

    await sw.evaluate(async (skills) => {
      await chrome.storage.local.set({ savedSkills: skills });
    }, SEED_SKILLS);

    const page = await context.newPage();
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-skills").click();

    await expect(page.locator("#skill-list .skill-row")).toHaveCount(2);
    const rowNames = await page.locator("#skill-list .skill-name").allTextContents();
    expect(rowNames).toEqual(["pirate_speak", "panel_note"]);
    await expect(page.locator("#skill-list .empty-note")).toHaveCount(0);

    await fs.mkdir(ARTIFACTS_005, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACTS_005, "01-list-light.png"), fullPage: true });

    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await optionsReady(page);
    await page.locator("#tab-btn-skills").click();
    await expect(page.locator("#skill-list .skill-row")).toHaveCount(2);
    await page.screenshot({ path: path.join(ARTIFACTS_005, "02-list-dark.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "light" });
  });

  test("E4-E6: deleting one row removes it from the page and from storage", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const sw = worker;

    await sw.evaluate(async (skills) => {
      await chrome.storage.local.set({ savedSkills: skills });
    }, SEED_SKILLS);

    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: "light" });
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-skills").click();

    const rows = page.locator("#skill-list .skill-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1).locator(".skill-name")).toHaveText("panel_note");
    await rows.nth(1).locator("button.skill-del").click();

    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0).locator(".skill-name")).toHaveText("pirate_speak");

    const stored: unknown = await sw.evaluate(async () => {
      const got: unknown = await chrome.storage.local.get("savedSkills");
      return (got as { savedSkills?: unknown }).savedSkills;
    });
    expect(Array.isArray(stored)).toBe(true);
    const arr = stored as { name: string; definition: string }[];
    expect(arr).toHaveLength(1);
    expect(arr[0].name).toBe("pirate_speak");
    expect(arr[0].definition).toBe("Say arr.");

    await fs.mkdir(ARTIFACTS_005, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACTS_005, "03-after-delete-light.png"), fullPage: true });
  });

  test("E7: deleting the last row shows the empty note and storage holds an empty array", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const sw = worker;

    await sw.evaluate(async (skills) => {
      await chrome.storage.local.set({ savedSkills: skills });
    }, SEED_SKILLS);

    const page = await context.newPage();
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-skills").click();

    const rows = page.locator("#skill-list .skill-row");
    await expect(rows).toHaveCount(2);
    await rows.nth(1).locator("button.skill-del").click();
    await expect(rows).toHaveCount(1);
    await rows.nth(0).locator("button.skill-del").click();

    await expect(rows).toHaveCount(0);
    await expect(page.locator("#skill-list p.empty-note")).toHaveText(EMPTY_TEXT);

    const stored: unknown = await sw.evaluate(async () => {
      const got: unknown = await chrome.storage.local.get("savedSkills");
      return (got as { savedSkills?: unknown }).savedSkills;
    });
    expect(stored).toEqual([]);

    await fs.mkdir(ARTIFACTS_005, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACTS_005, "04-empty-light.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await optionsReady(page);
    await page.locator("#tab-btn-skills").click();
    await expect(page.locator("#skill-list p.empty-note")).toHaveText(EMPTY_TEXT);
    await page.screenshot({ path: path.join(ARTIFACTS_005, "05-empty-dark.png"), fullPage: true });
  });

  test("E8: the settings path is untouched by the new section", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);

    await page.selectOption("#theme", "wa2-dark");
    await page.click("#save");
    await expect(page.locator("#status")).toContainText("Saved.");

    await page.reload();
    await optionsReady(page);
    await expect(page.locator("#theme")).toHaveValue("wa2-dark");
  });

  test("T1: tab bar displays General, Models, Skills, Agents; keyboard cycles all four and reload returns to General", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);

    await expect(page.locator(".tab")).toHaveText(["General", "Models", "Skills", "Agents"]);
    await expect(page.locator("#tab-btn-general")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tab-btn-models")).toHaveAttribute("aria-selected", "false");
    await expect(page.locator("#tab-btn-skills")).toHaveAttribute("aria-selected", "false");
    await expect(page.locator("#tab-btn-agents")).toHaveAttribute("aria-selected", "false");
    await expect(page.locator('.tab[aria-selected="true"]')).toHaveCount(1);
    await expect(page.locator('.tab[aria-selected="true"]')).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#tab-general")).toBeVisible();
    await expect(page.locator("#tab-models")).toBeHidden();
    await expect(page.locator("#tab-skills")).toBeHidden();
    await expect(page.locator("#tab-agents")).toBeHidden();

    await page.locator("#tab-btn-models").click();
    await expect(page.locator("#tab-btn-models")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tab-models")).toBeVisible();
    await expect(page.locator("#tab-general")).toBeHidden();

    await page.locator("#tab-btn-models").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tab-btn-skills")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tab-btn-skills")).toBeFocused();
    await expect(page.locator("#tab-skills")).toBeVisible();
    await expect(page.locator("#tab-models")).toBeHidden();

    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tab-btn-agents")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tab-agents")).toBeVisible();

    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tab-btn-general")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tab-general")).toBeVisible();

    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#tab-btn-agents")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(page.locator("#tab-btn-general")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(page.locator("#tab-btn-agents")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tab-general")).toBeHidden();

    await page.reload();
    await optionsReady(page);
    await expect(page.locator("#tab-btn-general")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tab-general")).toBeVisible();
    await expect(page.locator("#tab-models")).toBeHidden();
  });

  test("A1: Agents tab renders default brand cards, tags, facts; Add agent enabled, Edit enabled", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-agents").click();

    await expect(page.locator("#add-agent-btn")).toBeEnabled();

    const cardsLoc = page.locator("#agent-cards .card");
    await expect(cardsLoc).toHaveCount(2);

    const firstCard = cardsLoc.nth(0);
    await expect(firstCard.locator(".card-title .n")).toContainText("Chromagent");
    await expect(firstCard.locator(".pill.def")).toHaveText("Default");
    await expect(firstCard.locator(".pill").nth(1)).toHaveText("Provided");
    await expect(firstCard.locator(".card-title .d")).toHaveText("Your Personal Assistant");
    await expect(firstCard.locator(".card-edit-btn")).toBeEnabled();
    await expect(firstCard.locator(".facts")).toContainText("Model Options page model");
    await expect(firstCard.locator(".facts")).toContainText("Tools All");
    await expect(firstCard.locator(".facts")).toContainText("Skills All");
    await expect(firstCard.locator(".facts")).not.toContainText("except");

    const secondCard = cardsLoc.nth(1);
    await expect(secondCard.locator(".card-title .n")).toContainText("Tesagent");
    await expect(secondCard.locator(".pill.def")).toHaveCount(0);
    await expect(secondCard.locator(".pill")).toHaveText("Provided");
    await expect(secondCard.locator(".card-edit-btn")).toBeEnabled();
  });

  // 121/002 — manager-required gap closure: the plan's own e2e code only
  // spelled out T1 and A1; these three prove the rest of the "Agents tab"
  // acceptance criteria the plan lists but leaves to unit tests C7-C8.
  test("A2: a stored edit shows Edited, the stored description, resolved model, and tool count", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        agentEdits: {
          tesagent: {
            description: "Custom tesagent tester",
            instructions: "Custom tesagent instructions.",
            model: "brand:anthropic-sonnet",
            tools: ["read_tabs", "page_eval"],
            excludeTools: [],
            skills: "*",
            excludeSkills: [],
          },
        },
      });
    });

    const page = await context.newPage();
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-agents").click();

    const tesagentCard = page.locator("#agent-cards .card").nth(1);
    await expect(tesagentCard.locator(".pill")).toContainText(["Provided", "Edited"]);
    await expect(tesagentCard.locator(".card-title .d")).toHaveText("Custom tesagent tester");
    await expect(tesagentCard.locator(".facts")).toContainText("Model Sonnet");
    await expect(tesagentCard.locator(".facts")).toContainText("Tools 2 selected");
  });

  test("A3: an unknown stored model id shows Options page model", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        agentEdits: {
          tesagent: {
            description: "d",
            instructions: "i",
            model: "not-a-real-model-id",
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
    await page.locator("#tab-btn-agents").click();

    const tesagentCard = page.locator("#agent-cards .card").nth(1);
    await expect(tesagentCard.locator(".facts")).toContainText("Model Options page model (its model is off or deleted)");
  });

  test("A4: a stored user agent shows Added by you and no Default tag", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        userAgents: [
          {
            id: "analyst",
            displayName: "Data Analyst",
            description: "Analyzes table data",
            instructions: "You analyze tables.",
            model: null,
            tools: "*",
            excludeTools: [],
            skills: "*",
            excludeSkills: [],
          },
        ],
      });
    });

    const page = await context.newPage();
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-agents").click();

    const cardsLoc = page.locator("#agent-cards .card");
    await expect(cardsLoc).toHaveCount(3);
    // Chromagent (default), then Data Analyst, then tesagent — display-name order.
    const userCard = cardsLoc.nth(1);
    await expect(userCard.locator(".card-title .n")).toContainText("Data Analyst");
    await expect(userCard.locator(".pill")).toHaveText("Added by you");
    await expect(userCard.locator(".pill.def")).toHaveCount(0);
  });
});

// --- Brand model list (change 17) -------------------------------------------

const EXT = path.resolve(HERE, "../dist");
const TEMP_DIR = path.resolve(HERE, "../temp/e2e-extensions/options");
const TWO_MODELS = path.resolve(TEMP_DIR, "two-models");
const LOCKED = path.resolve(TEMP_DIR, "lock-model");

const TWO_ENTRIES = [
  { id: "acme-sonnet", label: "Acme Assistant", endpoint: "http://localhost:10040/api/anthropic", wireFormat: "anthropic", model: "sonnet", vision: false },
  { id: "acme-fast", label: "Acme Fast", endpoint: "http://localhost:10040/api/openai/v1", wireFormat: "openai", model: "fast", vision: false },
];

/** Copies dist/ and rewrites brand.json, so a test can load a different brand
 *  without a rebuild. Same mechanism as skills.mock.spec.ts:464-471. */
async function patchedBrand(dir: string, patch: Record<string, unknown>): Promise<string> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.cp(EXT, dir, { recursive: true });
  const file = path.join(dir, "brand.json");
  const brand = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  await fs.writeFile(file, JSON.stringify({ ...brand, ...patch }, null, 2));
  return dir;
}

async function launchExtensionContext(dir: string) {
  return chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
}

test.describe("Brand model list", () => {
  test.afterAll(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  test("G2: fresh profile shows the three brand rows and defaults to the first", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-models").click();
    await expect(page.locator("#model-table tr.model-row .model-label")).toHaveText(["Sonnet", "Sonnet OpenAI", "Gemini Flash"]);
    await expect(page.locator('#model-table tr.model-row[data-ref="brand:anthropic-sonnet"] input.model-default')).toBeChecked();
    await expect(page.locator("#model-count")).toHaveText("Enabled 3/3");
    await expect(page.locator("#tab-models #theme")).toHaveCount(0);
    await expect(page.locator("#tab-models #theme-hint")).toHaveCount(0);
    await expect(page.locator("#tab-models #save")).toHaveCount(0);
    await expect(page.locator("#tab-models #status")).toHaveCount(0);
    await expect(page.locator("#tab-general > label")).toHaveText(["Theme"]);
    await expect(page.locator("#token")).toHaveCount(0);
    await expect(page.locator("#preset")).toHaveCount(0);
    await expect(page.locator("#endpoint")).toHaveCount(0);
    await expect(page.locator("#wireFormat")).toHaveCount(0);
    await expect(page.locator("#model")).toHaveCount(0);
    await expect(page.locator("#apiKey")).toHaveCount(0);
  });

  test("B1: two-entry brand shows exactly those two model rows", async () => {
    const dir = await patchedBrand(TWO_MODELS, { models: TWO_ENTRIES });
    const ctx = await launchExtensionContext(dir);
    try {
      let [worker] = ctx.serviceWorkers();
      if (!worker) worker = await ctx.waitForEvent("serviceworker");
      const id = worker.url().split("/")[2];
      const page = await ctx.newPage();
      await openOptions(page, id);
      await page.locator("#tab-btn-models").click();
      await expect(page.locator("#model-table tr.model-row .model-label")).toHaveText(["Acme Assistant", "Acme Fast"]);
    } finally {
      await ctx.close();
    }
  });

  test("B2: a model.yml entry without provider names its row by host and path", async () => {
    const dir = await patchedBrand(TWO_MODELS, { models: TWO_ENTRIES });
    const ctx = await launchExtensionContext(dir);
    try {
      let [worker] = ctx.serviceWorkers();
      if (!worker) worker = await ctx.waitForEvent("serviceworker");
      const id = worker.url().split("/")[2];
      const page = await ctx.newPage();
      await openOptions(page, id);
      await page.locator("#tab-btn-models").click();
      await expect(page.locator("#model-table tr.prov .prov-label")).toHaveText([
        "localhost:10040/api/anthropic",
        "localhost:10040/api/openai/v1",
      ]);
    } finally {
      await ctx.close();
    }
  });

  test("B3: the repo brand's provider rows read Gateway", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-models").click();
    await expect(page.locator("#model-table tr.prov .prov-label")).toHaveText(["Gateway", "Gateway", "Gateway"]);
  });

  test("L1: lockModel hides the checkbox column; switches, radios and Key work", async () => {
    const dir = await patchedBrand(LOCKED, { options: { lockModel: true } });
    const ctx = await launchExtensionContext(dir);
    try {
      let [worker] = ctx.serviceWorkers();
      if (!worker) worker = await ctx.waitForEvent("serviceworker");
      const id = worker.url().split("/")[2];
      const page = await ctx.newPage();
      await openOptions(page, id);
      await page.locator("#tab-btn-models").click();
      await expect(page.locator("#add-model-btn")).toBeHidden();
      await expect(page.locator("#delete-models-btn")).toBeHidden();
      await expect(page.locator('#model-table input[type="checkbox"]:not([role="switch"])')).toHaveCount(0);
      await expect(page.locator("#model-table th")).toHaveCount(6);
      await expect(page.locator("#model-table .key-btn")).toHaveCount(3);
      for (let i = 0; i < 3; i++) {
        await expect(page.locator("#model-table .key-btn").nth(i)).toBeEnabled();
      }
      await expect(page.locator("#model-table input.model-enabled")).toHaveCount(3);
      for (let i = 0; i < 3; i++) {
        await expect(page.locator("#model-table input.model-enabled").nth(i)).toBeEnabled();
      }
      await page.click('#model-table tr.model-row[data-ref="brand:openai-sonnet"] input.model-enabled');
      await expect(page.locator("#model-count")).toHaveText("Enabled 2/3");
    } finally {
      await ctx.close();
    }
  });

  test("L2: lockModel does not disable theme", async () => {
    const dir = await patchedBrand(LOCKED, { options: { lockModel: true } });
    const ctx = await launchExtensionContext(dir);
    try {
      let [worker] = ctx.serviceWorkers();
      if (!worker) worker = await ctx.waitForEvent("serviceworker");
      const id = worker.url().split("/")[2];
      const page = await ctx.newPage();
      await openOptions(page, id);
      await expect(page.locator("#theme")).not.toBeDisabled();
    } finally {
      await ctx.close();
    }
  });

  test("L4: lockModel absent shows one disabled checkbox per brand provider row", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-models").click();
    const cbs = page.locator('#model-table tr.prov input[type="checkbox"]');
    await expect(cbs).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(cbs.nth(i)).toBeDisabled();
      await expect(cbs.nth(i)).toHaveAttribute("title", "Brand models cannot be deleted");
    }
    await expect(page.locator('#model-table button:has-text("Edit")')).toHaveCount(0);
  });
});

const ARTIFACTS_005_LAYOUT = path.resolve(
  HERE,
  "../../../temp/artifacts/2026-09-16-195740-005-options-page-full-width-flex",
);

/** The ids of the tab panels that are currently laid out (display is not none). */
function visiblePanels(page: Page): Promise<string[]> {
  return page
    .locator('section[role="tabpanel"]')
    .evaluateAll((els) =>
      els.filter((el) => getComputedStyle(el).display !== "none").map((el) => el.id),
    );
}

test.describe("Options page full-width flex layout", () => {
  test.beforeAll(async () => {
    await fs.mkdir(ARTIFACTS_005_LAYOUT, { recursive: true });
  });

  test("page fills window width with 24px gutter at 1280x800 and 1024x768 without horizontal scroll", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);

    // 1280x800 viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    const pageBox1280 = await page.locator(".page").evaluate((el) => el.getBoundingClientRect());
    expect(pageBox1280.width).toBe(1280);
    const h1Box1280 = await page.locator("h1").evaluate((el) => el.getBoundingClientRect());
    expect(h1Box1280.left).toBe(24);
    const tabsBox1280 = await page.locator(".tabs").evaluate((el) => el.getBoundingClientRect());
    expect(tabsBox1280.left).toBe(24);
    expect(tabsBox1280.right).toBe(1256);
    expect(tabsBox1280.width).toBe(1232);

    const hasHScroll1280 = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHScroll1280).toBe(false);

    // 1024x768 viewport
    await page.setViewportSize({ width: 1024, height: 768 });
    const pageBox1024 = await page.locator(".page").evaluate((el) => el.getBoundingClientRect());
    expect(pageBox1024.width).toBe(1024);
    const h1Box1024 = await page.locator("h1").evaluate((el) => el.getBoundingClientRect());
    expect(h1Box1024.left).toBe(24);
    const tabsBox1024 = await page.locator(".tabs").evaluate((el) => el.getBoundingClientRect());
    expect(tabsBox1024.left).toBe(24);
    expect(tabsBox1024.right).toBe(1000);
    expect(tabsBox1024.width).toBe(976);

    const hasHScroll1024 = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHScroll1024).toBe(false);
  });

  test("General tab fields, hint, save button and status align left at 560px maximum width", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);

    const fieldIds = ["#theme"];
    for (const id of fieldIds) {
      const box = await page.locator(id).evaluate((el) => el.getBoundingClientRect());
      expect(box.width).toBe(560);
      expect(box.left).toBe(24);
    }

    const themeHintBox = await page.locator("#theme-hint").evaluate((el) => el.getBoundingClientRect());
    expect(themeHintBox.width).toBeLessThanOrEqual(560);
    expect(themeHintBox.left).toBe(24);

    const saveBox = await page.locator("#save").evaluate((el) => el.getBoundingClientRect());
    expect(saveBox.left).toBe(24);
    expect(saveBox.width).toBeLessThanOrEqual(560);

    const statusBox = await page.locator("#status").evaluate((el) => el.getBoundingClientRect());
    expect(statusBox.left).toBe(24);
    expect(statusBox.width).toBeLessThanOrEqual(560);

    // The table is on the Models tab, which fills the width and scrolls
    // inside its wrapper.
    await page.locator("#tab-btn-models").click();
    const tableBox = await page.locator("#tab-models > .table-wrap").evaluate((el) => el.getBoundingClientRect());
    expect(tableBox.left).toBe(24);

    await page.locator("#tab-btn-general").click();
    await page.click("#save");
    await expect(page.locator("#status")).toContainText("Saved.");
  });

  test("skills tab rows stretch to full width with delete and owner at the right edge", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async (skills) => {
      await chrome.storage.local.set({ savedSkills: skills });
    }, SEED_SKILLS);

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-skills").click();

    const rows = page.locator("#skill-list .skill-row");
    const count = await rows.count();
    expect(count).toBe(2);

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const rowBox = await row.evaluate((el) => el.getBoundingClientRect());
      expect(rowBox.left).toBe(24);
      expect(rowBox.right).toBe(1256);

      const delBox = await row.locator(".skill-del").evaluate((el) => el.getBoundingClientRect());
      expect(rowBox.right - delBox.right).toBeLessThanOrEqual(16);

      const ownerBox = await row.locator(".owner").evaluate((el) => el.getBoundingClientRect());
      expect(delBox.left).toBeGreaterThan(ownerBox.right - 1);
    }
  });

  test("agents tab toolbar and cards stretch across the page with right-aligned action buttons", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-agents").click();

    const toolbarBox = await page.locator("#tab-agents .toolbar").evaluate((el) => el.getBoundingClientRect());
    expect(toolbarBox.left).toBe(24);
    expect(toolbarBox.right).toBe(1256);

    const addBtnBox = await page.locator("#add-agent-btn").evaluate((el) => el.getBoundingClientRect());
    expect(Math.abs(addBtnBox.right - toolbarBox.right)).toBeLessThanOrEqual(2);

    const cards = page.locator("#agent-cards .card");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const cardBox = await card.evaluate((el) => el.getBoundingClientRect());
      expect(cardBox.left).toBe(24);
      expect(cardBox.right).toBe(1256);

      const editBtnBox = await card.locator(".card-edit-btn").evaluate((el) => el.getBoundingClientRect());
      expect(cardBox.right - editBtnBox.right).toBeLessThanOrEqual(20);
    }

    // Card in edit mode stretches full width
    await cards.nth(0).locator(".card-edit-btn").click();
    const editCardBox = await cards.nth(0).evaluate((el) => el.getBoundingClientRect());
    expect(editCardBox.left).toBe(24);
    expect(editCardBox.right).toBe(1256);
    const editBodyBox = await cards.nth(0).locator(".edit-body").evaluate((el) => el.getBoundingClientRect());
    expect(editBodyBox.left).toBe(25);
    expect(editBodyBox.right).toBe(1255);
    await cards.nth(0).locator(".cancel-btn").click();

    // New agent card stretches full width
    await page.locator("#add-agent-btn").click();
    const newCard = page.locator('#agent-cards .card[data-agent-id="_new"]');
    const newCardBox = await newCard.evaluate((el) => el.getBoundingClientRect());
    expect(newCardBox.left).toBe(24);
    expect(newCardBox.right).toBe(1256);
    await newCard.locator(".cancel-btn").click();
  });

  test("tab panels display flex when active and display none when hidden", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);

    // Initial state: General active, the other three hidden.
    expect(await page.locator("#tab-general").evaluate((el) => getComputedStyle(el).display)).toBe("flex");
    expect(await page.locator("#tab-models").evaluate((el) => getComputedStyle(el).display)).toBe("none");
    expect(await page.locator("#tab-skills").evaluate((el) => getComputedStyle(el).display)).toBe("none");
    expect(await page.locator("#tab-agents").evaluate((el) => getComputedStyle(el).display)).toBe("none");
    expect(await visiblePanels(page)).toEqual(["tab-general"]);

    // Switch to Models
    await page.locator("#tab-btn-models").click();
    expect(await page.locator("#tab-general").evaluate((el) => getComputedStyle(el).display)).toBe("none");
    expect(await page.locator("#tab-models").evaluate((el) => getComputedStyle(el).display)).toBe("flex");
    expect(await visiblePanels(page)).toEqual(["tab-models"]);

    // Switch to Skills
    await page.locator("#tab-btn-skills").click();
    expect(await page.locator("#tab-models").evaluate((el) => getComputedStyle(el).display)).toBe("none");
    expect(await page.locator("#tab-skills").evaluate((el) => getComputedStyle(el).display)).toBe("flex");
    expect(await page.locator("#tab-agents").evaluate((el) => getComputedStyle(el).display)).toBe("none");
    expect(await visiblePanels(page)).toEqual(["tab-skills"]);

    // Switch to Agents via keyboard
    await page.locator("#tab-btn-skills").focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.locator("#tab-models").evaluate((el) => getComputedStyle(el).display)).toBe("none");
    expect(await page.locator("#tab-skills").evaluate((el) => getComputedStyle(el).display)).toBe("none");
    expect(await page.locator("#tab-agents").evaluate((el) => getComputedStyle(el).display)).toBe("flex");
    expect(await visiblePanels(page)).toEqual(["tab-agents"]);
  });

  test("full-window screenshots of all four tabs at 1280 and 1024 in light and dark", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async (skills) => {
      await chrome.storage.local.set({ savedSkills: skills });
    }, SEED_SKILLS);

    const page = await context.newPage();

    for (const vp of [{ width: 1280, height: 800, name: "1280" }, { width: 1024, height: 768, name: "1024" }]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await openOptions(page, extensionId);

        // General tab screenshot (the tab the page opens on)
        await page.screenshot({
          path: path.join(ARTIFACTS_005_LAYOUT, `general-${scheme}-${vp.name}.png`),
          fullPage: true,
        });

        // Models tab screenshot
        await page.locator("#tab-btn-models").click();
        await page.screenshot({
          path: path.join(ARTIFACTS_005_LAYOUT, `models-${scheme}-${vp.name}.png`),
          fullPage: true,
        });

        // Skills tab screenshot
        await page.locator("#tab-btn-skills").click();
        await page.screenshot({
          path: path.join(ARTIFACTS_005_LAYOUT, `skills-${scheme}-${vp.name}.png`),
          fullPage: true,
        });

        // Agents tab screenshot (collapsed)
        await page.locator("#tab-btn-agents").click();
        await page.screenshot({
          path: path.join(ARTIFACTS_005_LAYOUT, `agents-${scheme}-${vp.name}.png`),
          fullPage: true,
        });

        // Agents tab screenshot with first card in edit mode
        if (vp.name === "1280") {
          await page.locator("#agent-cards .card").nth(0).locator(".card-edit-btn").click();
          await page.screenshot({
            path: path.join(ARTIFACTS_005_LAYOUT, `agents-edit-${scheme}-${vp.name}.png`),
            fullPage: true,
          });
          await page.locator("#agent-cards .card").nth(0).locator(".cancel-btn").click();
        }
      }
    }
  });
});

// --- 137/002: General tab, toolbar count and shared dialog spacing ----------

const ARTIFACTS_137_002 =
  process.env.E2E_ARTIFACTS_DIR ?? path.resolve(HERE, "../../../temp/e2e-artifacts/options-general-tab");
const TEMP_137_002 = path.resolve(HERE, "../temp/e2e-extensions/options-137-002");

const THEME_HINT_TEXT =
  "Applies to the agent bubble, not the website. If a website sets its own theme, the bubble uses it.";

const ENDPOINT_137_002 = "http://localhost:10040/v1";

/** Nine custom models in the real modelStore shape, all enabled. Nine plus the
 *  three brand models is the twelve-entry count case. The endpoint is the local
 *  fixture; these rows are never sent. */
const NINE_MODELS = Array.from({ length: 9 }, (_, i) => ({
  model: `custom-${i + 1}`,
  label: `Custom ${i + 1}`,
  vision: false,
}));

async function seedNineCustom(page: Page, worker: Worker): Promise<void> {
  await worker.evaluate(async (models) => {
    await chrome.storage.local.set({
      modelStore: {
        providers: [
          {
            id: "p9",
            name: "Fixture",
            wireFormat: "openai",
            endpoint: "http://localhost:10040/v1",
            apiKey: "",
            headers: [],
            models,
          },
        ],
        disabled: [],
        brandKeys: {},
        defaultModel: null,
      },
    });
  }, NINE_MODELS);
  await page.reload();
  await optionsReady(page);
}

async function storedTheme(worker: Worker): Promise<string | undefined> {
  return worker.evaluate(async () => {
    const got = await chrome.storage.local.get("agentSettings");
    const settings = got.agentSettings as { theme?: string } | undefined;
    return settings?.theme;
  });
}

type Rect = { x: number; y: number; width: number; height: number };

async function rectOf(locator: Locator): Promise<Rect> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

const centreY = (r: Rect): number => r.y + r.height / 2;

/** Overlapping area of two rectangles; zero means they do not touch. */
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return Math.max(0, w) * Math.max(0, h);
}

/** Every measured property of the shared `.dialog-actions` row. */
async function actionRowMetrics(dialog: Locator) {
  return dialog.evaluate((el) => {
    const actions = el.querySelector(".dialog-actions") as HTMLElement;
    const style = getComputedStyle(actions);
    const probe = document.createElement("div");
    probe.style.borderTop = "1px solid var(--wa-border-color)";
    document.body.append(probe);
    const tokenBorder = getComputedStyle(probe).borderTopColor;
    probe.remove();
    const previous = actions.previousElementSibling as HTMLElement | null;
    const buttons = Array.from(actions.querySelectorAll("button"));
    const actionsRect = actions.getBoundingClientRect();
    const dialogRect = el.getBoundingClientRect();
    return {
      display: style.display,
      justifyContent: style.justifyContent,
      columnGap: style.columnGap,
      marginTop: style.marginTop,
      paddingTop: style.paddingTop,
      borderTopWidth: style.borderTopWidth,
      borderTopStyle: style.borderTopStyle,
      borderTopColor: style.borderTopColor,
      tokenBorder,
      previousBottom: previous ? previous.getBoundingClientRect().bottom : null,
      actionsTop: actionsRect.top,
      lastButtonRight: buttons.length > 0 ? buttons[buttons.length - 1].getBoundingClientRect().right : null,
      actionsRight: actionsRect.right,
      dialogRight: dialogRect.right,
      buttons: buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height };
      }),
    };
  });
}

/** The spacing every dialog shares (137/002 C4). Returns the metrics so a
 *  caller can assert the per-dialog details. */
async function expectSharedActionRow(dialog: Locator) {
  const m = await actionRowMetrics(dialog);
  expect(m.display).toBe("flex");
  expect(m.justifyContent).toBe("flex-end");
  expect(m.columnGap).toBe("8px");
  expect(m.marginTop).toBe("24px");
  expect(m.paddingTop).toBe("16px");
  expect(m.borderTopWidth).toBe("1px");
  expect(m.borderTopStyle).toBe("solid");
  expect(m.borderTopColor).toBe(m.tokenBorder);
  if (m.previousBottom !== null) {
    expect(m.actionsTop - m.previousBottom).toBeGreaterThanOrEqual(24);
  }
  if (m.lastButtonRight !== null) {
    expect(Math.abs(m.actionsRight - m.lastButtonRight)).toBeLessThanOrEqual(2);
  }
  if (m.buttons.length === 2) {
    expect(Math.abs(m.buttons[1].left - m.buttons[0].right - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.buttons[0].top - m.buttons[1].top)).toBeLessThanOrEqual(2);
  }
  return m;
}

test.describe("Options page 137/002: General tab and shared spacing", () => {
  test.beforeAll(async () => {
    await fs.mkdir(ARTIFACTS_137_002, { recursive: true });
  });

  test.afterAll(async () => {
    await fs.rm(TEMP_137_002, { recursive: true, force: true });
  });

  test("G1: General holds Theme, the exact hint, Save and status; Models holds none of them", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);

    await expect(page.locator("#tab-btn-general")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tab-general > label")).toHaveText(["Theme"]);
    await expect(page.locator("#tab-general #theme")).toHaveCount(1);
    await expect(page.locator("#theme-hint")).toHaveText(THEME_HINT_TEXT);
    await expect(page.locator("#tab-general #save")).toHaveCount(1);
    await expect(page.locator("#tab-general #status")).toHaveCount(1);

    for (const inner of ["#theme", "#theme-hint", "#save", "#status"]) {
      await expect(page.locator(`#tab-models ${inner}`)).toHaveCount(0);
    }

    // Save keeps its 20px gap above it now that the global margin is gone.
    const hint = await rectOf(page.locator("#theme-hint"));
    const save = await rectOf(page.locator("#save"));
    expect(save.y - (hint.y + hint.height)).toBeGreaterThanOrEqual(20);

    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({
        path: path.join(ARTIFACTS_137_002, `general-${scheme}.png`),
        fullPage: true,
      });
    }
  });

  test("G2: an unsaved theme change does not reach a new side panel; Save stores it", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ agentSettings: { theme: "wa2-light" } });
    });

    const page = await context.newPage();
    await openOptions(page, extensionId);
    await expect(page.locator("#theme")).toHaveValue("wa2-light");

    const panelTheme = async (name: string): Promise<string | null> => {
      const panel = await context.newPage();
      await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await expect(panel.locator("agent-chat-panel")).toBeAttached();
      await panel.screenshot({ path: path.join(ARTIFACTS_137_002, name) });
      const value = await panel.evaluate(() => document.documentElement.getAttribute("data-theme"));
      await panel.close();
      return value;
    };

    // Selected but not saved: the options page previews it, the store does not.
    await page.selectOption("#theme", "wa2-dark");
    expect(await storedTheme(worker)).toBe("wa2-light");
    expect(await panelTheme("panel-before-save.png")).toBe("wa2-light");

    await page.click("#save");
    await expect(page.locator("#status")).toContainText("Saved.");
    expect(await storedTheme(worker)).toBe("wa2-dark");
    expect(await panelTheme("panel-after-save.png")).toBe("wa2-dark");

    await page.reload();
    await optionsReady(page);
    await expect(page.locator("#tab-btn-general")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#theme")).toHaveValue("wa2-dark");
  });

  test("M1: twelve models read Enabled 12/12, one switch off reads Enabled 11/12 after reload", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    await seedNineCustom(page, worker);
    await page.emulateMedia({ colorScheme: "light" });
    await page.locator("#tab-btn-models").click();

    await expect(page.locator("#model-table tr.model-row")).toHaveCount(12);
    await expect(page.locator("#model-count")).toHaveText("Enabled 12/12");
    await page.screenshot({ path: path.join(ARTIFACTS_137_002, "models-twelve-light.png"), fullPage: true });

    // Turn one non-default custom row off through its real switch.
    await page.locator('tr.model-row[data-ref="p9/custom-9"] input.model-enabled').click();
    await expect(page.locator("#model-count")).toHaveText("Enabled 11/12");

    await page.reload();
    await optionsReady(page);
    await page.locator("#tab-btn-models").click();
    await expect(page.locator("#model-count")).toHaveText("Enabled 11/12");
    await page.screenshot({ path: path.join(ARTIFACTS_137_002, "models-disabled-light.png"), fullPage: true });
  });

  test("M2: the toolbar buttons share a top edge and the count sits right-aligned in both themes", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const page = await context.newPage();
    await openOptions(page, extensionId);
    await seedNineCustom(page, worker);

    const measured: Record<string, unknown> = {};
    for (const vp of [{ width: 1280, height: 800, name: "1280" }, { width: 1024, height: 768, name: "1024" }]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.reload();
        await optionsReady(page);
        await page.locator("#tab-btn-models").click();

        const add = await rectOf(page.locator("#add-model-btn"));
        const del = await rectOf(page.locator("#delete-models-btn"));
        const count = await rectOf(page.locator("#model-count"));
        const toolbar = await rectOf(page.locator("#model-toolbar"));
        measured[`${scheme}-${vp.name}`] = { add, del, count, toolbar };

        expect(Math.abs(add.y - del.y)).toBeLessThanOrEqual(2);
        expect(Math.abs(centreY(count) - centreY(add))).toBeLessThanOrEqual(2);
        expect(Math.abs(centreY(count) - centreY(del))).toBeLessThanOrEqual(2);
        expect(Math.abs(count.x + count.width - (toolbar.x + toolbar.width))).toBeLessThanOrEqual(2);
        expect(add.x).toBeLessThanOrEqual(count.x);

        await page.screenshot({
          path: path.join(ARTIFACTS_137_002, `models-${scheme}-${vp.name}.png`),
          fullPage: true,
        });
      }
    }

    // Narrow viewport: nothing overlaps when the toolbar wraps.
    await page.setViewportSize({ width: 400, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.reload();
    await optionsReady(page);
    await page.locator("#tab-btn-models").click();
    const add = await rectOf(page.locator("#add-model-btn"));
    const del = await rectOf(page.locator("#delete-models-btn"));
    const count = await rectOf(page.locator("#model-count"));
    measured["narrow-400"] = { add, del, count };
    expect(overlapArea(add, del)).toBe(0);
    expect(overlapArea(add, count)).toBe(0);
    expect(overlapArea(del, count)).toBe(0);
    await page.screenshot({ path: path.join(ARTIFACTS_137_002, "models-narrow-400.png"), fullPage: true });

    await fs.writeFile(path.join(ARTIFACTS_137_002, "geometry-toolbar.json"), JSON.stringify(measured, null, 2));
  });

  test("M3: a locked brand hides the actions and still right-aligns the count", async () => {
    const dir = await patchedBrand(path.join(TEMP_137_002, "lock-model"), { options: { lockModel: true } });
    const ctx = await launchExtensionContext(dir);
    try {
      let [worker] = ctx.serviceWorkers();
      if (!worker) worker = await ctx.waitForEvent("serviceworker");
      const id = worker.url().split("/")[2];
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 1280, height: 800 });
      await openOptions(page, id);
      await page.locator("#tab-btn-models").click();
      await expect(page.locator("#model-toolbar-actions")).toBeHidden();
      await expect(page.locator("#model-count")).toHaveText("Enabled 3/3");
      const count = await rectOf(page.locator("#model-count"));
      const toolbar = await rectOf(page.locator("#model-toolbar"));
      expect(Math.abs(count.x + count.width - (toolbar.x + toolbar.width))).toBeLessThanOrEqual(2);
    } finally {
      await ctx.close();
    }
  });

  test("P1: each provider remove button is 36px square and centred on its row", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-models").click();
    await page.locator("#add-model-btn").click();
    const dialog = page.locator("dialog.provider-dialog");
    await expect(dialog).toBeVisible();

    await dialog.locator(".add-header-btn").click();
    await dialog.locator(".add-header-btn").click();
    await dialog.locator(".add-model-row-btn").click();
    await expect(dialog.locator(".header-row")).toHaveCount(2);
    await expect(dialog.locator(".form-model-row")).toHaveCount(2);

    const measured: Record<string, unknown> = {};
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await dialog.locator(".form-model-id").first().fill("row-1");
      const rows: [string, string][] = [
        [".header-row", ".remove-header-btn"],
        [".form-model-row", ".remove-model-btn"],
      ];
      for (const [rowSel, btnSel] of rows) {
        for (let i = 0; i < 2; i++) {
          const row = dialog.locator(rowSel).nth(i);
          const button = await rectOf(row.locator(btnSel));
          const input = await rectOf(row.locator("input").first());
          measured[`${scheme}-${rowSel}-${i}`] = { button, input };
          expect(button.width).toBe(36);
          expect(button.height).toBe(36);
          expect(Math.abs(centreY(button) - centreY(input))).toBeLessThanOrEqual(2);
        }
      }
      await dialog.screenshot({ path: path.join(ARTIFACTS_137_002, `provider-${scheme}.png`) });
    }

    // Removing one row of each kind leaves the others.
    await dialog.locator(".header-row .remove-header-btn").nth(0).click();
    await expect(dialog.locator(".header-row")).toHaveCount(1);
    await expect(dialog.locator(".form-model-row")).toHaveCount(2);
    await dialog.locator(".form-model-row .remove-model-btn").nth(1).click();
    await expect(dialog.locator(".form-model-row")).toHaveCount(1);
    await expect(dialog.locator(".form-model-row .remove-model-btn")).toHaveCount(1);

    await fs.writeFile(path.join(ARTIFACTS_137_002, "geometry-provider.json"), JSON.stringify(measured, null, 2));
    await dialog.locator(".cancel-btn").click();
    await expect(dialog).toHaveCount(0);
  });

  test("D1: the provider form and the Key dialog share the action row; Cancel changes nothing", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-models").click();

    const measured: Record<string, unknown> = {};
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.locator("#add-model-btn").click();
      const form = page.locator("dialog.provider-dialog");
      await expect(form).toBeVisible();
      measured[`provider-${scheme}`] = await expectSharedActionRow(form);
      await form.screenshot({ path: path.join(ARTIFACTS_137_002, `provider-dialog-${scheme}.png`) });
      await form.locator(".cancel-btn").click();
      await expect(form).toHaveCount(0);

      await page.locator("#model-table .key-btn").first().click();
      const key = page.locator("#brand-key-dialog");
      await expect(key).toBeVisible();
      measured[`key-${scheme}`] = await expectSharedActionRow(key);
      await key.screenshot({ path: path.join(ARTIFACTS_137_002, `key-dialog-${scheme}.png`) });
      await key.locator(".dialog-cancel-btn").click();
      await expect(key).toHaveCount(0);
    }

    // Cancel kept the store untouched.
    const [worker] = context.serviceWorkers();
    const stored = await worker.evaluate(async () => (await chrome.storage.local.get("modelStore")).modelStore);
    expect(stored).toBeUndefined();
    await fs.writeFile(path.join(ARTIFACTS_137_002, "geometry-dialogs-part1.json"), JSON.stringify(measured, null, 2));
  });

  test("D2: the model delete and agent delete confirms share the action row", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        userAgents: [
          {
            id: "analyst",
            displayName: "Data Analyst",
            description: "Analyzes table data",
            instructions: "You analyze tables.",
            model: null,
            tools: "*",
            excludeTools: [],
            skills: "*",
            excludeSkills: [],
          },
        ],
      });
    });

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    await seedNineCustom(page, worker);
    await page.emulateMedia({ colorScheme: "light" });
    await page.locator("#tab-btn-models").click();

    await page.locator('tr.model-row[data-ref="p9/custom-1"] .model-select').check();
    await page.locator("#delete-models-btn").click();
    const confirm = page.locator("dialog.model-delete-dialog");
    await expect(confirm).toBeVisible();
    const measured: Record<string, unknown> = { modelDelete: await expectSharedActionRow(confirm) };
    await confirm.screenshot({ path: path.join(ARTIFACTS_137_002, "confirm-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await confirm.screenshot({ path: path.join(ARTIFACTS_137_002, "confirm-dark.png") });
    await confirm.locator(".cancel-btn").click();
    await expect(confirm).toHaveCount(0);
    await expect(page.locator('tr.model-row[data-ref="p9/custom-1"]')).toHaveCount(1);

    await page.emulateMedia({ colorScheme: "light" });
    await page.locator("#tab-btn-agents").click();
    const userCard = page.locator("#agent-cards .card").filter({ hasText: "Data Analyst" });
    await userCard.locator(".card-edit-btn").click();
    await userCard.locator(".delete-btn").click();
    const agentConfirm = page.locator("dialog:has(.dialog-delete-btn)");
    await expect(agentConfirm).toBeVisible();
    measured.agentDelete = await expectSharedActionRow(agentConfirm);
    await agentConfirm.screenshot({ path: path.join(ARTIFACTS_137_002, "agent-confirm-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await agentConfirm.screenshot({ path: path.join(ARTIFACTS_137_002, "agent-confirm-dark.png") });
    await agentConfirm.locator(".dialog-cancel-btn").click();
    await expect(agentConfirm).toHaveCount(0);

    const stored = await worker.evaluate(async () => (await chrome.storage.local.get("userAgents")).userAgents);
    expect(Array.isArray(stored)).toBe(true);
    expect((stored as { id: string }[]).map((a) => a.id)).toEqual(["analyst"]);
    await fs.writeFile(path.join(ARTIFACTS_137_002, "geometry-dialogs-part2.json"), JSON.stringify(measured, null, 2));
  });

  test("D3: the built-in provider grid shares the action row", async () => {
    const dir = await patchedBrand(path.join(TEMP_137_002, "grid"), { options: { builtInProviders: true } });
    const ctx = await launchExtensionContext(dir);
    try {
      let [worker] = ctx.serviceWorkers();
      if (!worker) worker = await ctx.waitForEvent("serviceworker");
      const id = worker.url().split("/")[2];
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 1280, height: 800 });
      await openOptions(page, id);
      await page.locator("#tab-btn-models").click();
      await page.locator("#add-model-btn").click();
      const grid = page.locator("dialog.provider-grid-dialog");
      await expect(grid).toBeVisible();
      await page.emulateMedia({ colorScheme: "light" });
      await expectSharedActionRow(grid);
      await grid.screenshot({ path: path.join(ARTIFACTS_137_002, "grid-light.png") });
      await page.emulateMedia({ colorScheme: "dark" });
      await grid.screenshot({ path: path.join(ARTIFACTS_137_002, "grid-dark.png") });
      await grid.locator(".cancel-btn").click();
      await expect(grid).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test("D4: the refresh diff and refresh error dialogs share the action row", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-models").click();

    let mode: "ok" | "401" = "401";
    await page.route(`${ENDPOINT_137_002}/models`, async (route) => {
      if (mode === "401") {
        await route.fulfill({ status: 401, body: "{}" });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [{ id: "row-1" }, { id: "added" }] }),
        });
      }
    });

    await page.locator("#add-model-btn").click();
    const form = page.locator("dialog.provider-dialog");
    await expect(form).toBeVisible();
    await form.locator("#provider-endpoint").fill(ENDPOINT_137_002);
    await form.locator(".form-model-id").first().fill("row-1");

    await page.emulateMedia({ colorScheme: "light" });
    await form.locator(".refresh-models-btn").click();
    const error = page.locator("dialog.refresh-error-dialog");
    await expect(error).toBeVisible();
    await expectSharedActionRow(error);
    await error.screenshot({ path: path.join(ARTIFACTS_137_002, "refresh-error-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await error.screenshot({ path: path.join(ARTIFACTS_137_002, "refresh-error-dark.png") });
    await error.locator(".close-btn").click();
    await expect(error).toHaveCount(0);

    mode = "ok";
    await page.emulateMedia({ colorScheme: "light" });
    await form.locator(".refresh-models-btn").click();
    const diff = page.locator("dialog.diff-dialog");
    await expect(diff).toBeVisible();
    await expectSharedActionRow(diff);
    await diff.screenshot({ path: path.join(ARTIFACTS_137_002, "diff-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await diff.screenshot({ path: path.join(ARTIFACTS_137_002, "diff-dark.png") });
    await diff.locator(".cancel-btn").click();
    await expect(diff).toHaveCount(0);
    await form.locator(".cancel-btn").click();
    await expect(form).toHaveCount(0);
  });

  test("R1: no Skills or Agents button moves against the removed page-wide margin", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async (skills) => {
      await chrome.storage.local.set({ savedSkills: skills });
    }, SEED_SKILLS);

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    await page.emulateMedia({ colorScheme: "light" });

    const snapshot = (tab: "skills" | "agents") =>
      page.locator(`#tab-${tab} button`).evaluateAll((els) =>
        els
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              key: `${el.id || el.className}|${el.textContent}`,
              x: r.x, y: r.y, width: r.width, height: r.height,
            };
          }),
      );

    const readBoth = async () => {
      await page.locator("#tab-btn-skills").click();
      const skills = await snapshot("skills");
      await page.locator("#tab-btn-agents").click();
      const agents = await snapshot("agents");
      await page.locator("#tab-agents .card").nth(0).locator(".card-edit-btn").click();
      const expanded = await snapshot("agents");
      await page.locator("#tab-agents .card").nth(0).locator(".cancel-btn").click();
      return { skills, agents, expanded };
    };

    const now = await readBoth();
    // The removed rule was one line: `button { margin-top: 20px }`. Re-adding
    // it here reproduces the pre-change page for these two tabs exactly.
    await page.addStyleTag({ content: "button { margin-top: 20px; }" });
    const before = await readBoth();

    const compare = (after: typeof now.skills, earlier: typeof now.skills, label: string) => {
      expect(after.length).toBeGreaterThan(0);
      expect(earlier.map((e) => e.key)).toEqual(after.map((e) => e.key));
      after.forEach((a, i) => {
        const b = earlier[i];
        for (const k of ["x", "y", "width", "height"] as const) {
          expect(
            Math.abs(a[k] - b[k]),
            `${label} button ${a.key} ${k}: ${b[k]} -> ${a[k]}`,
          ).toBeLessThanOrEqual(2);
        }
      });
      return after.length;
    };

    const counts = {
      skills: compare(now.skills, before.skills, "skills"),
      agents: compare(now.agents, before.agents, "agents"),
      expanded: compare(now.expanded, before.expanded, "agents expanded"),
    };

    await page.locator("#tab-btn-skills").click();
    await page.screenshot({ path: path.join(ARTIFACTS_137_002, "skills-after-light.png"), fullPage: true });
    await page.locator("#tab-btn-agents").click();
    await page.screenshot({ path: path.join(ARTIFACTS_137_002, "agents-after-light.png"), fullPage: true });
    await page.locator("#tab-agents .card").nth(0).locator(".card-edit-btn").click();
    await page.screenshot({ path: path.join(ARTIFACTS_137_002, "agents-edit-after-light.png"), fullPage: true });

    await fs.writeFile(
      path.join(ARTIFACTS_137_002, "geometry-regression.json"),
      JSON.stringify({ counts, before, now }, null, 2),
    );
  });
});

const ARTIFACTS_137_003 =
  process.env.E2E_ARTIFACTS_DIR ?? path.resolve(HERE, "../../../temp/e2e-artifacts/model-table-capabilities");

test.describe("Model table capabilities and ID badge", () => {
  test.beforeAll(async () => {
    await fs.mkdir(ARTIFACTS_137_003, { recursive: true });
  });

  test("C1: Capabilities header, eye and crossed-out eye icons, greyscale distinction, and 8px ID badge with >= 3:1 contrast in light and dark", async ({
    context,
    extensionId,
  }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        modelStore: {
          providers: [
            {
              id: "p-deepseek",
              name: "DeepSeek",
              builtIn: "deepseek",
              wireFormat: "anthropic",
              endpoint: "https://api.deepseek.com/anthropic",
              apiKey: "sk-test-f46e",
              headers: [],
              models: [
                { model: "deepseek-flash", label: "DeepSeek V4.1 Flash", vision: true },
                { model: "deepseek-v4-pro", label: "DeepSeek V4 Pro", vision: false },
              ],
            },
          ],
          brandKeys: {},
          disabled: [],
          defaultModel: null,
        },
      });
    });

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-models").click();

    const headers = await page.locator("#model-table thead th").allTextContents();
    expect(headers).toEqual(["", "Provider / model", "Format", "Capabilities", "Enabled", "Default", ""]);
    expect(headers).not.toContain("Vision");
    await expect(page.locator("#model-table .pill.vision")).toHaveCount(0);

    const visionCap = page.locator('tr.model-row[data-ref="p-deepseek/deepseek-flash"] td:nth-child(4) > span.cap:not(.off)');
    const noVisionCap = page.locator('tr.model-row[data-ref="p-deepseek/deepseek-v4-pro"] td:nth-child(4) > span.cap.off');
    await expect(visionCap).toHaveAttribute("role", "img");
    await expect(visionCap).toHaveAttribute("aria-label", "Vision");
    await expect(visionCap).toHaveAttribute("title", "Vision");
    await expect(noVisionCap).toHaveAttribute("role", "img");
    await expect(noVisionCap).toHaveAttribute("aria-label", "No vision");
    await expect(noVisionCap).toHaveAttribute("title", "No vision");

    const visionPath = await visionCap.locator("svg path").getAttribute("d");
    const noVisionPath = await noVisionCap.locator("svg path").getAttribute("d");
    expect(visionPath ?? "").not.toBe("");
    expect(noVisionPath ?? "").not.toBe("");
    expect(visionPath).not.toBe(noVisionPath);

    const report: Record<string, unknown> = {};
    const pngs: Record<"light" | "dark", Buffer> = {
      light: Buffer.alloc(0),
      dark: Buffer.alloc(0),
    };

    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", `wa2-${scheme}`);

      const metrics = await page.evaluate(() => {
        const parseRgb = (s: string): [number, number, number] => {
          const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (!m) throw new Error(`unexpected rgb: ${s}`);
          return [Number(m[1]), Number(m[2]), Number(m[3])];
        };
        const blend = (fg: [number, number, number], bg: [number, number, number], a: number): [number, number, number] => [
          fg[0] * a + bg[0] * (1 - a),
          fg[1] * a + bg[1] * (1 - a),
          fg[2] * a + bg[2] * (1 - a),
        ];
        const lum = ([r, g, b]: [number, number, number]): number => {
          const f = (v: number) => {
            const c = v / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const contrast = (a: [number, number, number], b: [number, number, number]): number => {
          const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
          return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
        };

        const rows = [...document.querySelectorAll<HTMLTableRowElement>("#model-table tr.model-row")];
        const background = (node: Element): [number, number, number] => {
          const color = getComputedStyle(node).backgroundColor;
          const alpha = color.startsWith("rgba") ? Number(color.match(/,\s*([\d.]+)\)$/)?.[1] ?? 1) : 1;
          if (alpha === 1) return parseRgb(color);
          const underneath: [number, number, number] = node.parentElement ? background(node.parentElement) : [255, 255, 255];
          return blend(parseRgb(color), underneath, alpha);
        };
        const badgeChecks = rows.map((row) => {
          const label = row.querySelector<HTMLElement>(".model-label")!;
          const mid = row.querySelector<HTMLElement>(".mid")!;
          const td = row.querySelector<HTMLElement>("td.model")!;
          const cs = getComputedStyle(mid);
          const tdBg = background(td);
          const midOpc = parseFloat(cs.opacity);
          const midBg = blend(parseRgb(cs.backgroundColor), tdBg, midOpc);
          const midFg = blend(parseRgb(cs.color), tdBg, midOpc);
          const lRect = label.getBoundingClientRect();
          const mRect = mid.getBoundingClientRect();
          return {
            ref: row.dataset.ref,
            gapPx: Number((mRect.left - lRect.right).toFixed(2)),
            display: cs.display,
            marginLeft: cs.marginLeft,
            fontSize: cs.fontSize,
            padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
            borderRadius: cs.borderTopLeftRadius,
            borderWidth: cs.borderTopWidth,
            borderStyle: cs.borderTopStyle,
            fontFamily: cs.fontFamily,
            contrast: contrast(midFg, midBg),
          };
        });

        const offRow = document.querySelector<HTMLTableRowElement>('tr.model-row[data-ref="p-deepseek/deepseek-v4-pro"]')!;
        const offTd = offRow.querySelectorAll<HTMLElement>("td")[3];
        const offCap = offTd.querySelector<HTMLElement>(".cap.off")!;
        const offSvg = offCap.querySelector<SVGElement>("svg")!;
        const onSvg = document.querySelector<SVGElement>('tr.model-row[data-ref="p-deepseek/deepseek-flash"] .cap svg')!;
        const tdBg = background(offTd);
        const capOpc = parseFloat(getComputedStyle(offCap).opacity);
        const svgFg = blend(parseRgb(getComputedStyle(offSvg).color), tdBg, capOpc);
        const onRect = onSvg.getBoundingClientRect();
        const offRect = offSvg.getBoundingClientRect();

        return {
          badgeChecks,
          offCapContrast: contrast(svgFg, tdBg),
          onSvgSize: { width: onRect.width, height: onRect.height },
          offSvgSize: { width: offRect.width, height: offRect.height },
        };
      });

      report[scheme] = metrics;
      expect(metrics.onSvgSize).toEqual({ width: 20, height: 20 });
      expect(metrics.offSvgSize).toEqual({ width: 20, height: 20 });
      expect(metrics.offCapContrast).toBeGreaterThanOrEqual(3);
      for (const b of metrics.badgeChecks) {
        expect(b.display).toBe("inline-block");
        expect(b.marginLeft).toBe("8px");
        expect(b.fontSize).toBe("12px");
        expect(b.padding).toBe("1px 6px 1px 6px");
        expect(b.borderRadius).toBe("4px");
        expect(b.borderWidth).toBe("1px");
        expect(b.borderStyle).toBe("solid");
        expect(b.fontFamily).toContain("monospace");
        expect(Math.abs(b.gapPx - 8)).toBeLessThanOrEqual(1.5);
        expect(b.contrast).toBeGreaterThanOrEqual(3);
      }

      pngs[scheme] = await page.screenshot({
        path: path.join(ARTIFACTS_137_003, `models-table-${scheme}.png`),
        fullPage: true,
      });
    }

    // Build greyscale stacked image of light and dark screenshots to verify non-colour distinction.
    const greyB64 = await page.evaluate(
      async ({ lightB64, darkB64 }) => {
        const load = (src: string) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
          });
        const [top, bottom] = await Promise.all([
          load(`data:image/png;base64,${lightB64}`),
          load(`data:image/png;base64,${darkB64}`),
        ]);
        const gap = 20;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(top.width, bottom.width);
        canvas.height = top.height + gap + bottom.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(top, 0, 0);
        ctx.drawImage(bottom, 0, top.height + gap);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const y = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
          d[i] = y;
          d[i + 1] = y;
          d[i + 2] = y;
        }
        ctx.putImageData(imgData, 0, 0);
        return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
      },
      { lightB64: pngs.light.toString("base64"), darkB64: pngs.dark.toString("base64") },
    );
    await fs.writeFile(path.join(ARTIFACTS_137_003, "models-table-greyscale.png"), Buffer.from(greyB64, "base64"));
    await fs.writeFile(path.join(ARTIFACTS_137_003, "contrast-and-geometry.json"), JSON.stringify(report, null, 2));
  });

  test("C2: the provider form keeps its Vision column label and checkbox unchanged", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOptions(page, extensionId);
    await page.locator("#tab-btn-models").click();
    await page.locator("#add-model-btn").click();
    const dialog = page.locator("dialog.provider-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".form-model-cols span")).toHaveText(["Model ID", "Display name", "Vision", ""]);
    await expect(dialog.locator(".vision-check").first()).toHaveText("Vision");
    await expect(dialog.locator("input.form-model-vision").first()).toHaveAttribute("aria-label", "Vision");
    await dialog.locator(".cancel-btn").click();
  });
});
