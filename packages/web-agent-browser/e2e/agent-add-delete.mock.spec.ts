import { test, expect, openOptions } from "./extension.fixture";
import type { BrowserContext, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(HERE, "../../../temp/artifacts/2026-09-16-182426-004-add-and-delete-agent");

const NEW = '#agent-cards .card[data-agent-id="_new"]';
const CT = '#agent-cards .card[data-agent-id="checkout-tester"]';
const TESAGENT = '#agent-cards .card[data-agent-id="tesagent"]';
const CHROMAGENT = '#agent-cards .card[data-agent-id="chromagent"]';
const DIALOG = "#delete-agent-dialog";
const VISIBLE_PANEL = "#chat agent-chat-panel:not([hidden])";
const DB = "web-agent-web-agent-extension-panel-checkout-tester";
const CT_INSTRUCTIONS = "You test checkout flows.";

const CHECKOUT_TESTER = {
  id: "checkout-tester",
  displayName: "Checkout tester",
  description: "Walks the checkout flow",
  instructions: CT_INSTRUCTIONS,
  model: null,
  tools: ["read_tabs", "page_eval"],
  excludeTools: [],
  skills: "*",
  excludeSkills: [],
};
const ANALYST = { ...CHECKOUT_TESTER, id: "analyst", displayName: "Analyst", tools: "*" };
const skill = (name: string, owner?: string) => ({
  name,
  description: `${name} description`,
  definition: `${name} definition`,
  ...(owner === undefined ? {} : { owner }),
});

async function seed(context: BrowserContext, items: Record<string, unknown>): Promise<void> {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  await worker.evaluate(async (i) => { await chrome.storage.local.set(i); }, items);
}

async function openAgents(page: Page, extensionId: string, cards: number): Promise<void> {
  await openOptions(page, extensionId);
  await page.locator("#tab-btn-agents").click();
  await expect(page.locator("#agent-cards .card")).toHaveCount(cards);
  await expect(page.locator("#add-agent-btn")).toBeEnabled();
}

async function stored(page: Page, keys: string[]): Promise<Record<string, unknown>> {
  return page.evaluate((k) => chrome.storage.local.get(k), keys);
}

async function chips(page: Page, id: string): Promise<string[]> {
  return page.locator(`#${id}-box .chip`).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.name ?? ""));
}

async function pickTools(page: Page, prefix: string, names: string[]): Promise<void> {
  await page.locator(`#${prefix}-tools-box`).click();
  await expect(page.locator(`#${prefix}-tools-list`)).toBeVisible();
  for (const n of names) {
    await page.locator(`#${prefix}-tools-list [role="option"][data-name="${n}"]`).click();
  }
}

/** Adds one agent through the UI and waits for the new card to close. */
async function addThroughUi(page: Page, name: string, tools: string[] | null): Promise<void> {
  await page.locator("#add-agent-btn").click();
  await expect(page.locator(`${NEW} .edit-body`)).toBeVisible();
  await page.locator("#edit-_new-displayName").fill(name);
  await page.locator("#edit-_new-description").fill("Walks the checkout flow");
  await page.locator("#edit-_new-instructions").fill(CT_INSTRUCTIONS);
  if (tools !== null) await pickTools(page, "edit-_new", tools);
  await page.locator(`${NEW} .save-btn`).click();
  await expect(page.locator(NEW)).toHaveCount(0);
}

async function openPanel(context: BrowserContext, extensionId: string): Promise<Page> {
  const panelPage = await context.newPage();
  await panelPage.setViewportSize({ width: 400, height: 700 });
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panelPage.locator("#agent-row")).toBeVisible();
  return panelPage;
}

test.describe("Add agent and Delete agent", () => {
  test("AD1: Add agent opens the new card at the top; hint follows the name", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId, 2);
    await page.locator("#add-agent-btn").click();

    await expect(page.locator("#agent-cards .card")).toHaveCount(3);
    await expect(page.locator("#agent-cards .card").first()).toHaveAttribute("data-agent-id", "_new");
    const card = page.locator(NEW);
    await expect(card).toHaveClass(/editing/);
    await expect(card.locator(".card-title .n")).toContainText("New agent");
    await expect(card.locator(".pill")).toHaveText(["Added by you"]);
    await expect(card.locator(".card-title .d")).toHaveText("Fill in the fields, then save.");
    await expect(card.locator(".card-edit-btn")).toHaveText("Editing");
    await expect(page.locator("#edit-_new-model")).toHaveValue("");
    await expect(page.locator("#edit-_new-model option:checked")).toHaveText("Use the options page model");
    expect(await chips(page, "edit-_new-skills")).toEqual(["*"]);
    expect(await chips(page, "edit-_new-tools")).toEqual(["*"]);
    await expect(page.locator("#edit-_new-skills-box .chip")).toContainText("All skills (*)");
    await expect(page.locator("#edit-_new-tools-box .chip")).toContainText("All tools (*)");
    await expect(card.locator(".actions button")).toHaveText(["Cancel", "Save agent"]);
    await expect(page.locator(CHROMAGENT)).toHaveClass(/dim/);
    await expect(page.locator(TESAGENT)).toHaveClass(/dim/);
    await expect(page.locator(`${CHROMAGENT} .card-edit-btn`)).toBeDisabled();
    await expect(page.locator(`${TESAGENT} .card-edit-btn`)).toBeDisabled();
    await expect(page.locator("#add-agent-btn")).toBeDisabled();

    await expect(page.locator("#edit-_new-id-hint")).toHaveText("Id: agent");
    await page.locator("#edit-_new-displayName").fill("Checkout tester");
    await expect(page.locator("#edit-_new-id-hint")).toHaveText("Id: checkout-tester");
  });

  test("AD2: blank fields show task 003's messages and write nothing", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId, 2);
    await page.locator("#add-agent-btn").click();
    await page.locator(`${NEW} .save-btn`).click();
    await expect(page.locator("#edit-_new-displayName-error")).toHaveText("Enter a display name.");
    await expect(page.locator("#edit-_new-displayName-error")).toHaveAttribute("role", "alert");
    await expect(page.locator("#edit-_new-description-error")).toHaveText("Enter a description.");
    await expect(page.locator("#edit-_new-instructions-error")).toHaveText("Enter the system instructions.");
    await expect(page.locator("#edit-_new-displayName")).toBeFocused();
    await expect(page.locator(`${NEW} .edit-body`)).toBeVisible();
    expect((await stored(page, ["userAgents"])).userAgents).toBeUndefined();
  });

  test("AD3: Cancel removes the new card and writes nothing", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId, 2);
    await page.locator("#add-agent-btn").click();
    await page.locator("#edit-_new-displayName").fill("Not saved");
    await page.locator(`${NEW} .cancel-btn`).click();
    await expect(page.locator(NEW)).toHaveCount(0);
    await expect(page.locator("#agent-cards .card")).toHaveCount(2);
    await expect(page.locator("#add-agent-btn")).toBeEnabled();
    expect((await stored(page, ["userAgents"])).userAgents).toBeUndefined();
  });

  test("AD4: save Checkout tester with two tools; state 5 screenshots", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 800, height: 1400 });
    await openAgents(page, extensionId, 2);
    await page.locator("#add-agent-btn").click();
    await page.locator("#edit-_new-displayName").fill("Checkout tester");
    await page.locator("#edit-_new-description").fill("Walks the checkout flow and reports broken steps");
    await page.locator("#edit-_new-instructions").fill(CT_INSTRUCTIONS);
    await pickTools(page, "edit-_new", ["read_tabs", "page_eval"]);
    await page.keyboard.press("Escape");
    await expect(page.locator("#edit-_new-tools-list")).toBeHidden();
    await expect(page.locator("#edit-_new-id-hint")).toHaveText("Id: checkout-tester");

    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "01-new-agent-filled-light.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "02-new-agent-filled-dark.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "light" });

    await page.locator(`${NEW} .save-btn`).click();
    await expect(page.locator(NEW)).toHaveCount(0);
    const users = (await stored(page, ["userAgents"])).userAgents as { id: string; displayName: string; tools: unknown }[];
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe("checkout-tester");
    expect(users[0].displayName).toBe("Checkout tester");
    expect(users[0].tools).toEqual(["read_tabs", "page_eval"]);
    await expect(page.locator(`${CT} .edit-body`)).toHaveCount(0);
    await expect(page.locator(`${CT} .card-title .n`)).toContainText("Checkout tester");
    await expect(page.locator(`${CT} .pill`)).toHaveText(["Added by you"]);
    await expect(page.locator(`${CT} .facts`)).toContainText("Tools 2 selected");
  });

  test("AD5: a second Checkout tester is checkout-tester-2; Tesagent is tesagent-2", async ({ context, extensionId }) => {
    await seed(context, { userAgents: [CHECKOUT_TESTER] });
    const page = await context.newPage();
    await openAgents(page, extensionId, 3);
    await addThroughUi(page, "Checkout tester", null);
    await addThroughUi(page, "Tesagent", null);
    const ids = ((await stored(page, ["userAgents"])).userAgents as { id: string }[]).map((u) => u.id);
    expect(ids).toEqual(["checkout-tester", "checkout-tester-2", "tesagent-2"]);
    await expect(page.locator("#agent-cards .card")).toHaveCount(5);
  });

  test("AD6: renaming Checkout tester to Cart tester keeps the id", async ({ context, extensionId }) => {
    await seed(context, { userAgents: [CHECKOUT_TESTER] });
    const page = await context.newPage();
    await openAgents(page, extensionId, 3);
    await page.locator(`${CT} .card-edit-btn`).click();
    await page.locator("#edit-checkout-tester-displayName").fill("Cart tester");
    await page.locator(`${CT} .save-btn`).click();
    await expect(page.locator(`${CT} .edit-body`)).toHaveCount(0);
    const users = (await stored(page, ["userAgents"])).userAgents as { id: string; displayName: string }[];
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe("checkout-tester");
    expect(users[0].displayName).toBe("Cart tester");
    await expect(page.locator(`${CT} .card-title .n`)).toContainText("Cart tester");
  });

  test("AD7: the side panel lists Checkout tester with its instructions and only its two tools", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openAgents(page, extensionId, 2);
    await addThroughUi(page, "Checkout tester", ["read_tabs", "page_eval"]);

    const panelPage = await openPanel(context, extensionId);
    await panelPage.locator("#agent-combo").click();
    await expect(panelPage.locator("#agent-option-checkout-tester")).toBeVisible();
    await panelPage.locator("#agent-option-checkout-tester").click();
    await expect(panelPage.locator(`${VISIBLE_PANEL} .header-title`)).toHaveText("Checkout tester");

    const got = await panelPage.evaluate(async (selector) => {
      const panel = document.querySelector<HTMLElementTagNameMap["agent-chat-panel"]>(selector);
      const fromProviders = (await Promise.all((panel?.toolProviders ?? []).map((p) => p.load()))).flat().map((t) => t.name);
      const config = panel?.config as unknown as { tools: (ctx: object) => { name: string }[] };
      const fromCore = config.tools({}).map((t) => t.name);
      return { instructions: panel?.appContext?.appInstructions, tools: [...fromProviders, ...fromCore].sort() };
    }, VISIBLE_PANEL);
    expect(got.instructions).toBe(CT_INSTRUCTIONS);
    expect(got.tools).toEqual(["page_eval", "read_tabs"]);
  });

  test("DL1: Delete agent shows on a user agent, not on a brand agent", async ({ context, extensionId }) => {
    await seed(context, { userAgents: [CHECKOUT_TESTER] });
    const page = await context.newPage();
    await openAgents(page, extensionId, 3);
    await page.locator(`${TESAGENT} .card-edit-btn`).click();
    await expect(page.locator(`${TESAGENT} .delete-btn`)).toHaveCount(0);
    await expect(page.locator(`${TESAGENT} .reset-btn`)).toBeVisible();
    await page.locator(`${TESAGENT} .cancel-btn`).click();
    await page.locator(`${CT} .card-edit-btn`).click();
    await expect(page.locator(`${CT} .actions .row`).first().locator(".delete-btn")).toHaveText("Delete agent");
    await expect(page.locator(`${CT} .reset-btn`)).toHaveCount(0);
  });

  test("DL2: dialog text for 1, 2 and 0 owned skills; focus on Cancel; screenshots", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 800, height: 900 });
    const cases: [unknown[], string][] = [
      [[skill("ct_one", "checkout-tester"), skill("shared_one")], "Delete Checkout tester? Its chat history and its 1 private skill are deleted too."],
      [[skill("ct_one", "checkout-tester"), skill("ct_two", "checkout-tester")], "Delete Checkout tester? Its chat history and its 2 private skills are deleted too."],
      [[skill("shared_one"), skill("an_one", "analyst")], "Delete Checkout tester? Its chat history and its 0 private skills are deleted too."],
    ];
    for (const [i, [skills, text]] of cases.entries()) {
      await seed(context, { userAgents: [CHECKOUT_TESTER, ANALYST], savedSkills: skills });
      await openAgents(page, extensionId, 4);
      await page.locator(`${CT} .card-edit-btn`).click();
      await page.locator(`${CT} .delete-btn`).click();
      await expect(page.locator(DIALOG)).toBeVisible();
      await expect(page.locator(`${DIALOG} p`)).toHaveText(text);
      await expect(page.locator(`${DIALOG} .dialog-cancel-btn`)).toBeFocused();
      await expect(page.locator(`${DIALOG} .dialog-delete-btn`)).toHaveText("Delete agent");
      if (i === 0) {
        const box = await page.locator(DIALOG).boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(800);
        expect(box!.y + box!.height).toBeLessThanOrEqual(900);
        await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, "03-delete-dialog-light.png") });
        await page.emulateMedia({ colorScheme: "dark" });
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, "04-delete-dialog-dark.png") });
        await page.emulateMedia({ colorScheme: "light" });
      }
      await page.locator(`${DIALOG} .dialog-cancel-btn`).click();
      await expect(page.locator(DIALOG)).toHaveCount(0);
    }
  });

  test("DL3: Cancel and Escape close the dialog, store nothing, keep the card open", async ({ context, extensionId }) => {
    await seed(context, { userAgents: [CHECKOUT_TESTER], savedSkills: [skill("ct_one", "checkout-tester")], sidePanelAgent: "checkout-tester" });
    const page = await context.newPage();
    await openAgents(page, extensionId, 3);
    const before = await stored(page, ["userAgents", "savedSkills", "sidePanelAgent"]);
    await page.locator(`${CT} .card-edit-btn`).click();

    await page.locator(`${CT} .delete-btn`).click();
    await page.locator(`${DIALOG} .dialog-cancel-btn`).click();
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await expect(page.locator(`${CT} .edit-body`)).toBeVisible();
    expect(await stored(page, ["userAgents", "savedSkills", "sidePanelAgent"])).toEqual(before);

    await page.locator(`${CT} .delete-btn`).click();
    await expect(page.locator(DIALOG)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await expect(page.locator(`${CT} .edit-body`)).toBeVisible();
    expect(await stored(page, ["userAgents", "savedSkills", "sidePanelAgent"])).toEqual(before);
  });

  test("DL4: confirm removes the agent, its skills, sidePanelAgent and the database; the side panel falls back", async ({ context, extensionId }) => {
    await seed(context, {
      userAgents: [CHECKOUT_TESTER, ANALYST],
      savedSkills: [skill("ct_one", "checkout-tester"), skill("shared_one"), skill("an_one", "analyst")],
      sidePanelAgent: "checkout-tester",
    });

    // Create the session database: the panel opens on sidePanelAgent.
    const firstPanel = await openPanel(context, extensionId);
    await expect(firstPanel.locator(`${VISIBLE_PANEL} .header-title`)).toHaveText("Checkout tester");
    await expect.poll(() => firstPanel.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).toContain(DB);
    await firstPanel.close();

    const page = await context.newPage();
    await openAgents(page, extensionId, 4);
    await page.locator("#tab-btn-skills").click();
    await expect(page.locator("#skill-list .skill-name")).toHaveText(["ct_one", "shared_one", "an_one"]);
    await page.locator("#tab-btn-agents").click();

    await page.locator(`${CT} .card-edit-btn`).click();
    await page.locator(`${CT} .delete-btn`).click();
    await page.locator(`${DIALOG} .dialog-delete-btn`).click();

    await expect(page.locator(DIALOG)).toHaveCount(0);
    await expect(page.locator(CT)).toHaveCount(0);
    await expect(page.locator("#agent-cards .card")).toHaveCount(3);
    const s = await stored(page, ["userAgents", "savedSkills", "sidePanelAgent"]);
    expect((s.userAgents as { id: string }[]).map((u) => u.id)).toEqual(["analyst"]);
    expect(s.savedSkills).toEqual([skill("shared_one"), skill("an_one", "analyst")]);
    expect(s.sidePanelAgent).toBeUndefined();

    await page.locator("#tab-btn-skills").click();
    await expect(page.locator("#skill-list .skill-name")).toHaveText(["shared_one", "an_one"]);

    await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).not.toContain(DB);

    const panelPage = await openPanel(context, extensionId);
    await expect(panelPage.locator(`${VISIBLE_PANEL} .header-title`)).toHaveText("Chromagent");
    await panelPage.locator("#agent-combo").click();
    await expect(panelPage.locator("#agent-option-chromagent")).toBeVisible();
    await expect(panelPage.locator("#agent-option-checkout-tester")).toHaveCount(0);
  });
});
