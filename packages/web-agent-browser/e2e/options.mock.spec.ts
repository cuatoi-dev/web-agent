import { test, expect, openOptions, optionsReady } from "./extension.fixture";
import { chromium } from "@playwright/test";
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
    await expect(page.locator("#model-table")).toBeVisible();
    await fs.mkdir(ARTIFACTS_004, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACTS_004, "02-options-page-dark.png"), fullPage: true });
  });

  test("the default model reaches the bubble on a page", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    const options = await context.newPage();
    await openOptions(options, extensionId);
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

  test("T1: tab bar displays Models, Skills, Agents; keyboard ArrowRight/ArrowLeft cycle all three", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openOptions(page, extensionId);

    await expect(page.locator("#tab-btn-models")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tab-btn-skills")).toHaveAttribute("aria-selected", "false");
    await expect(page.locator("#tab-btn-agents")).toHaveAttribute("aria-selected", "false");
    await expect(page.locator("#tab-models")).toBeVisible();
    await expect(page.locator("#tab-skills")).toBeHidden();
    await expect(page.locator("#tab-agents")).toBeHidden();

    await page.locator("#tab-btn-skills").click();
    await expect(page.locator("#tab-btn-skills")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tab-skills")).toBeVisible();

    await page.locator("#tab-btn-skills").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tab-btn-agents")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tab-btn-agents")).toBeFocused();
    await expect(page.locator("#tab-agents")).toBeVisible();
    await expect(page.locator("#tab-skills")).toBeHidden();

    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tab-btn-models")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tab-btn-models")).toBeFocused();

    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#tab-btn-agents")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(page.locator("#tab-btn-models")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(page.locator("#tab-btn-agents")).toHaveAttribute("aria-selected", "true");

    await page.reload();
    await optionsReady(page);
    await expect(page.locator("#tab-btn-models")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tab-models")).toBeVisible();
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
    await expect(page.locator("#model-table tr.model-row .model-label")).toHaveText(["Sonnet", "Sonnet OpenAI", "Gemini Flash"]);
    await expect(page.locator('#model-table tr.model-row[data-ref="brand:anthropic-sonnet"] input.model-default')).toBeChecked();
    await expect(page.locator("#model-count")).toHaveText("3 of 3 models enabled");
    await expect(page.locator("#tab-models > label")).toHaveText(["Theme"]);
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
      await expect(page.locator("#model-count")).toHaveText("2 of 3 models enabled");
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

  test("models tab fields, hints, save button and status align left at 560px maximum width", async ({ context, extensionId }) => {
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

    const tableBox = await page.locator("#tab-models > .table-wrap").evaluate((el) => el.getBoundingClientRect());
    expect(tableBox.left).toBe(24);

    const saveBox = await page.locator("#save").evaluate((el) => el.getBoundingClientRect());
    expect(saveBox.left).toBe(24);
    expect(saveBox.width).toBeLessThanOrEqual(560);

    const statusBox = await page.locator("#status").evaluate((el) => el.getBoundingClientRect());
    expect(statusBox.left).toBe(24);
    expect(statusBox.width).toBeLessThanOrEqual(560);

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

    // Initial state: Models active
    expect(await page.locator("#tab-models").evaluate((el) => getComputedStyle(el).display)).toBe("flex");
    expect(await page.locator("#tab-skills").evaluate((el) => getComputedStyle(el).display)).toBe("none");
    expect(await page.locator("#tab-agents").evaluate((el) => getComputedStyle(el).display)).toBe("none");

    // Switch to Skills
    await page.locator("#tab-btn-skills").click();
    expect(await page.locator("#tab-models").evaluate((el) => getComputedStyle(el).display)).toBe("none");
    expect(await page.locator("#tab-skills").evaluate((el) => getComputedStyle(el).display)).toBe("flex");
    expect(await page.locator("#tab-agents").evaluate((el) => getComputedStyle(el).display)).toBe("none");

    // Switch to Agents via keyboard
    await page.locator("#tab-btn-skills").focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.locator("#tab-models").evaluate((el) => getComputedStyle(el).display)).toBe("none");
    expect(await page.locator("#tab-skills").evaluate((el) => getComputedStyle(el).display)).toBe("none");
    expect(await page.locator("#tab-agents").evaluate((el) => getComputedStyle(el).display)).toBe("flex");
  });

  test("full-window screenshots of all three tabs at 1280 and 1024 in light and dark", async ({ context, extensionId }) => {
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

        // Models tab screenshot
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
