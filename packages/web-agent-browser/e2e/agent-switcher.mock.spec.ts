import { test, expect } from "./extension.fixture";
import { chromium, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "../dist");
// Per the user's test-extension-copy instruction (task 001, "## Manager note
// — test extension copies"): every e2e copy of dist/ lives under
// temp/e2e-extensions/<spec>/, removed when the spec finishes.
const TEMP_DIR = path.resolve(HERE, "../temp/e2e-extensions/agent-switcher");
const ARTIFACTS_DIR = path.resolve(
  HERE,
  "../../../temp/artifacts/2026-09-15-171940-002-side-panel-agent-switcher",
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

const VISIBLE_PANEL = "#chat agent-chat-panel:not([hidden])";
const TESAGENT_DESCRIPTION = "Test agent — explores a website, writes and runs test cases";

/** Mock model for these specs.
 *  - The auto-title request answers "Apples chat" when the conversation
 *    mentions apples, else "Other chat".
 *  - A message containing "slow task" holds the call open for 60 s, so the turn
 *    keeps running until it is stopped (MockResponse.delayMs).
 *  - Anything else answers at once. */
function installSwitcherMock(page: Page): Promise<void> {
  return page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = (opts) => {
      const content = opts.messages[opts.messages.length - 1]?.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content.map((part) => ("text" in part && typeof part.text === "string" ? part.text : "")).join(" ")
            : "";
      if (text.includes("Summarize the following conversation as a short UI title")) {
        return { text: text.includes("apples") ? "Apples chat" : "Other chat" };
      }
      if (text.includes("slow task")) return { text: "Slow task done.", delayMs: 60_000 };
      return { text: "Mock response." };
    };
  });
}

async function openPanel(page: Page, extensionId: string): Promise<void> {
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.locator("#agent-row")).toBeVisible();
}

async function setTheme(page: Page, theme: "wa2-light" | "wa2-dark"): Promise<void> {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
}

async function dialogButtonContrast(
  page: Page,
  name: "Cancel" | "Stop and switch" | "Danger sample",
  state: "rest" | "hover" | "focus",
): Promise<{ ratio: number; fill: string }> {
  const button = page.locator(`${VISIBLE_PANEL} .wa-confirm-card`).getByRole("button", { name, exact: true });
  if (state === "hover") await button.hover();
  else if (state === "focus") {
    await page.locator(`${VISIBLE_PANEL} .wa-confirm-card h3`).hover();
    await button.focus();
  } else await page.locator(`${VISIBLE_PANEL} .wa-confirm-card h3`).hover();
  return button.evaluate((button) => {
    const card = button.closest(".wa-confirm-card");
    if (!card) throw new Error("confirmation card missing");
    const rgba = (value: string): { channels: number[]; alpha: number } => {
      const numbers = value.match(/[\d.]+/g)?.map(Number);
      if (!numbers || numbers.length < 3) throw new Error(`invalid colour: ${value}`);
      const srgb = value.startsWith("color(srgb");
      return { channels: numbers.slice(0, 3).map((n) => srgb ? n * 255 : n), alpha: numbers[3] ?? 1 };
    };
    const cardColor = rgba(getComputedStyle(card).backgroundColor).channels;
    const style = getComputedStyle(button);
    const fillColor = rgba(style.backgroundColor);
    const textColor = rgba(style.color).channels;
    const opacity = Number(style.opacity);
    const blend = (top: number[], bottom: number[], alpha: number): number[] =>
      top.map((channel, index) => channel * alpha + bottom[index] * (1 - alpha));
    const fill = blend(blend(fillColor.channels, cardColor, fillColor.alpha), cardColor, opacity);
    const text = blend(textColor, cardColor, opacity);
    const luminance = (channels: number[]): number => {
      const linear = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const a = luminance(text);
    const b = luminance(fill);
    return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), fill: style.backgroundColor };
  });
}

async function sendToVisiblePanel(page: Page, text: string): Promise<void> {
  await page.evaluate(
    ({ selector, message }) => {
      const panel = document.querySelector<HTMLElementTagNameMap["agent-chat-panel"]>(selector);
      if (!panel) throw new Error("no visible agent-chat-panel");
      void panel.send(message);
    },
    { selector: VISIBLE_PANEL, message: text },
  );
}

/** `running` of the n-th panel in DOM order (0 = the first agent shown). */
function panelRunning(page: Page, index: number): Promise<boolean> {
  return page.evaluate((i) => {
    const panels = document.querySelectorAll<HTMLElementTagNameMap["agent-chat-panel"]>("#chat agent-chat-panel");
    return panels[i]?.running ?? false;
  }, index);
}

function storedAgentId(page: Page): Promise<unknown> {
  return page.evaluate(async () => (await chrome.storage.local.get("sidePanelAgent")).sidePanelAgent as unknown);
}

async function chooseAgent(page: Page, id: string): Promise<void> {
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator(`#agent-option-${id}`).click();
}

/** Every option row inside the 400x700 viewport and no option name clipped. */
async function expectOptionsInside(page: Page): Promise<void> {
  const boxes = await page.locator("#agent-list [role='option']").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, bottom: r.bottom };
    }),
  );
  expect(boxes.length).toBeGreaterThan(0);
  for (const b of boxes) {
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(400);
    expect(b.bottom).toBeLessThanOrEqual(700);
  }
  const clipped = await page
    .locator("#agent-list [role='option'] .name, #agent-list [role='option'] .description")
    .evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).length);
  expect(clipped).toBe(0);
}

async function expectInsideViewport(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(400);
  expect(box.y + box.height).toBeLessThanOrEqual(700);
}

/** Starts a slow Chromagent turn and opens the switch dialog by choosing tesagent. */
async function openSwitchDialog(page: Page, extensionId: string): Promise<Locator> {
  await installSwitcherMock(page);
  await openPanel(page, extensionId);
  await sendToVisiblePanel(page, "Run the slow task");
  await expect.poll(() => panelRunning(page, 0)).toBe(true);
  await chooseAgent(page, "tesagent");
  const card = page.locator(`${VISIBLE_PANEL} .wa-confirm-card`);
  await expect(card).toBeVisible();
  return card;
}

test.describe("Agent switcher mock e2e", () => {
  test.beforeAll(async () => {
    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
  });

  test.afterAll(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  test("combo button shows Chromagent and its description, light and dark at 400px", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openPanel(page, extensionId);
    const combo = page.locator("#agent-combo");
    await expect(combo.locator(".name")).toHaveText("Chromagent");
    await expect(combo.locator(".description")).toHaveText("Your Personal Assistant");
    await expect(combo.locator(".name")).toBeVisible();
    await expect(combo.locator(".description")).toBeVisible();
    await expect(combo).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#agent-list")).toBeHidden();
    // "Your Personal Assistant" fits at 400 px, so it must not be cut off.
    expect(await combo.locator(".description").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await combo.locator(".name").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await setTheme(page, "wa2-light");
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "01-combo-light.png") });
    await setTheme(page, "wa2-dark");
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "02-combo-dark.png") });
  });

  test("the open list shows Chromagent first, then tesagent, each with its description", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openPanel(page, extensionId);
    await page.locator("#agent-combo").click();
    await expect(page.locator("#agent-combo")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#agent-list [role='option'] .name")).toHaveText(["Chromagent", "Tesagent"]);
    await expect(page.locator("#agent-list [role='option'] .description")).toHaveText([
      "Your Personal Assistant",
      TESAGENT_DESCRIPTION,
    ]);
    await expect(page.locator("#agent-option-chromagent")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#agent-option-tesagent")).toHaveAttribute("aria-selected", "false");
    await expectOptionsInside(page);
    await setTheme(page, "wa2-light");
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "03-list-open-light.png") });
    await setTheme(page, "wa2-dark");
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "04-list-open-dark.png") });
    // 120/002 review fix (item 6b) — hover shares the same tint/text tokens as
    // aria-selected; capture the unselected tesagent row's :hover state too, so
    // both states the fix touches have their own screenshot evidence.
    await page.locator("#agent-option-tesagent").hover();
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "list-hover-dark.png") });
    await setTheme(page, "wa2-light");
    await page.locator("#agent-option-tesagent").hover();
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "list-hover-light.png") });
  });

  test("a brand with Checkout tester lists Chromagent, Checkout tester, tesagent", async () => {
    const dir = path.resolve(TEMP_DIR, "three-agents");
    const brand = JSON.parse(await fs.readFile(path.join(EXT, "brand.json"), "utf8")) as { agents: unknown[] };
    await patchedBrand(dir, {
      agents: [
        ...brand.agents,
        {
          id: "checkout_tester",
          displayName: "Checkout tester",
          description: "Walks the checkout flow and reports broken steps",
          instructions: "You are Checkout tester. Walk the checkout flow and report every broken step.",
          tools: "*",
          skills: "*",
        },
      ],
    });
    const { ctx, extensionId } = await launchPatchedContext(dir);
    try {
      const page = await ctx.newPage();
      await openPanel(page, extensionId);
      await page.locator("#agent-combo").click();
      await expect(page.locator("#agent-list [role='option'] .name")).toHaveText(["Chromagent", "Checkout tester", "Tesagent"]);
      await expect(page.locator("#agent-list [role='option'] .description")).toHaveText([
        "Your Personal Assistant",
        "Walks the checkout flow and reports broken steps",
        TESAGENT_DESCRIPTION,
      ]);
      await expectOptionsInside(page);
      await setTheme(page, "wa2-light");
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "05-list-three-agents-light.png") });
      await setTheme(page, "wa2-dark");
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, "06-list-three-agents-dark.png") });
    } finally {
      await ctx.close();
    }
  });

  test("keyboard: ArrowDown opens, ArrowDown highlights tesagent, Enter selects; Escape closes with no change", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openPanel(page, extensionId);
    const combo = page.locator("#agent-combo");
    await combo.focus();
    await page.keyboard.press("ArrowDown");
    await expect(combo).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#agent-list")).toBeVisible();
    await expect(combo).toHaveAttribute("aria-activedescendant", "agent-option-chromagent");
    await page.keyboard.press("ArrowDown");
    await expect(combo).toHaveAttribute("aria-activedescendant", "agent-option-tesagent");
    // 120/002 review fix (item 6b) — the keyboard-highlighted row only gains an
    // outline (no background change), so its description keeps the rest-state
    // colour; capture it anyway for the round's contrast evidence.
    await setTheme(page, "wa2-light");
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "list-highlighted-light.png") });
    await setTheme(page, "wa2-dark");
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "list-highlighted-dark.png") });
    await page.keyboard.press("Enter");
    await expect(combo).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#agent-list")).toBeHidden();
    await expect(combo.locator(".name")).toHaveText("Tesagent");
    await expect(page.locator(`${VISIBLE_PANEL} .header-title`)).toHaveText("Tesagent");
    await expect(page.locator("#agent-option-tesagent")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#agent-option-chromagent")).toHaveAttribute("aria-selected", "false");

    await combo.focus();
    await page.keyboard.press("ArrowDown");
    await expect(combo).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowUp");
    await expect(combo).toHaveAttribute("aria-activedescendant", "agent-option-chromagent");
    await page.keyboard.press("Escape");
    await expect(combo).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#agent-list")).toBeHidden();
    await expect(combo).not.toHaveAttribute("aria-activedescendant");
    await expect(combo.locator(".name")).toHaveText("Tesagent");
    await expect(page.locator(`${VISIBLE_PANEL} .header-title`)).toHaveText("Tesagent");
    await expect(combo).toBeFocused();
  });

  test("a click outside the open list closes it with no change", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openPanel(page, extensionId);
    await page.locator("#agent-combo").click();
    await expect(page.locator("#agent-list")).toBeVisible();
    const box = await page.locator(`${VISIBLE_PANEL} .messages-list`).boundingBox();
    if (!box) throw new Error("messages list has no box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10);
    await expect(page.locator("#agent-combo")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#agent-list")).toBeHidden();
    await expect(page.locator("#agent-combo .name")).toHaveText("Chromagent");
    await expect(page.locator("#chat agent-chat-panel")).toHaveCount(1);
  });

  test("selecting tesagent shows its panel, keeps Chromagent hidden in the DOM, opens its own database, and shows no dialog", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openPanel(page, extensionId);
    await chooseAgent(page, "tesagent");
    await expect(page.locator(`${VISIBLE_PANEL} .header-title`)).toHaveText("Tesagent");
    const panels = page.locator("#chat agent-chat-panel");
    await expect(panels).toHaveCount(2);
    await expect(panels.nth(0)).toHaveAttribute("hidden", "");
    await expect(panels.nth(0)).toBeHidden();
    await expect(panels.nth(0).locator(".header-title")).toHaveText("Chromagent");
    await expect(panels.nth(1)).toBeVisible();
    await expect(page.locator(".wa-confirm-scrim")).toHaveCount(0);
    await expect(page.locator("#agent-combo .name")).toHaveText("Tesagent");
    await expect
      .poll(() => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? "")))
      .toContain("web-agent-web-agent-extension-panel-tesagent");
  });

  test("each agent keeps its own history", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await installSwitcherMock(page);
    await openPanel(page, extensionId);
    await sendToVisiblePanel(page, "I like apples");
    await expect(page.locator(`${VISIBLE_PANEL} .header-title`)).toHaveText("Apples chat");

    await chooseAgent(page, "tesagent");
    await expect(page.locator(`${VISIBLE_PANEL} .header-title`)).toHaveText("Tesagent");
    await page.locator(`${VISIBLE_PANEL} #history-anchor`).click();
    await expect(page.locator(VISIBLE_PANEL).getByRole("button", { name: "+ New Session" })).toBeVisible();
    await expect(page.locator(`${VISIBLE_PANEL} .wa-history-row`, { hasText: "Apples chat" })).toHaveCount(0);
    // 120/002 round 3 — the history dropdown must stay inside the panel
    // viewport with no cut-off button text, the same guard the switch-dialog
    // test below already applies to its own card.
    await expectInsideViewport(page.locator(`${VISIBLE_PANEL} [role="dialog"]`));
    for (const name of ["+ New Session", "Clear all history"]) {
      const btn = page.locator(VISIBLE_PANEL).getByRole("button", { name, exact: true });
      expect(await btn.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "09-tesagent-history.png") });
    await page.locator(`${VISIBLE_PANEL} #history-anchor`).click();

    await chooseAgent(page, "chromagent");
    await expect(page.locator(`${VISIBLE_PANEL} .header-title`)).toHaveText("Apples chat");
    await page.locator(`${VISIBLE_PANEL} #history-anchor`).click();
    await expect(page.locator(VISIBLE_PANEL).getByRole("button", { name: "+ New Session" })).toBeVisible();
    await expect(page.locator(`${VISIBLE_PANEL} .wa-history-row`, { hasText: "Apples chat" })).toHaveCount(1);
    await expectInsideViewport(page.locator(`${VISIBLE_PANEL} [role="dialog"]`));
    for (const name of ["+ New Session", "Clear all history"]) {
      const btn = page.locator(VISIBLE_PANEL).getByRole("button", { name, exact: true });
      expect(await btn.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "10-chromagent-history.png") });
  });

  test("switching while a turn runs asks; Cancel keeps Chromagent and its turn", async ({ context, extensionId }) => {
    const page = await context.newPage();
    const card = await openSwitchDialog(page, extensionId);
    await expect(card.locator("h3")).toHaveText("Switch to Tesagent?");
    await expect(card.locator("p")).toHaveText("Chromagent is still working. Stop it and switch to Tesagent?");
    const cancel = card.getByRole("button", { name: "Cancel", exact: true });
    const stopAndSwitch = card.getByRole("button", { name: "Stop and switch", exact: true });
    await expect(cancel).toBeVisible();
    await expect(stopAndSwitch).toBeVisible();
    await expectInsideViewport(card);
    for (const btn of [cancel, stopAndSwitch]) {
      expect(await btn.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await setTheme(page, "wa2-light");
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "07-switch-dialog-light.png") });
    await setTheme(page, "wa2-dark");
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "08-switch-dialog-dark.png") });

    // The shared hover rule also styles danger buttons. Add the real UI
    // element after the screenshots so its rendered colours are checked here.
    await card.evaluate((element) => {
      const danger = document.createElement("wa-button");
      danger.setAttribute("variant", "danger");
      danger.setAttribute("label", "Danger sample");
      element.append(danger);
    });

    for (const theme of ["wa1-dark", "wa2-dark", "wa2-light"] as const) {
      await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
      for (const name of ["Cancel", "Stop and switch", "Danger sample"] as const) {
        const rest = await dialogButtonContrast(page, name, "rest");
        expect(rest.ratio, `${theme} ${name} rest contrast`).toBeGreaterThanOrEqual(4.5);
        const hover = await dialogButtonContrast(page, name, "hover");
        expect(hover.ratio, `${theme} ${name} hover contrast`).toBeGreaterThanOrEqual(4.5);
        expect(hover.fill, `${theme} ${name} hover fill`).not.toBe(rest.fill);
        const focus = await dialogButtonContrast(page, name, "focus");
        expect(focus.ratio, `${theme} ${name} focus contrast`).toBeGreaterThanOrEqual(4.5);
      }
    }

    await cancel.click();
    await expect(page.locator(".wa-confirm-scrim")).toHaveCount(0);
    await expect(page.locator("#chat agent-chat-panel")).toHaveCount(1);
    await expect(page.locator("#chat agent-chat-panel").nth(0)).toBeVisible();
    await expect(page.locator(`${VISIBLE_PANEL} .header-title`)).toHaveText("Chromagent");
    expect(await panelRunning(page, 0)).toBe(true);
    await expect(page.locator(VISIBLE_PANEL).getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await expect(page.locator("#agent-combo .name")).toHaveText("Chromagent");
    expect(await storedAgentId(page)).toBe("chromagent");
  });

  test("switching while a turn runs asks; Stop and switch stops the turn, then shows tesagent", async ({ context, extensionId }) => {
    const page = await context.newPage();
    const card = await openSwitchDialog(page, extensionId);
    await card.getByRole("button", { name: "Stop and switch", exact: true }).click();
    await expect.poll(() => panelRunning(page, 0)).toBe(false);
    await expect(page.locator("#chat agent-chat-panel").nth(0).locator('[aria-label="Stop"]')).toHaveCount(0);
    await expect(page.locator(".wa-confirm-scrim")).toHaveCount(0);
    await expect(page.locator(`${VISIBLE_PANEL} .header-title`)).toHaveText("Tesagent");
    await expect(page.locator("#chat agent-chat-panel").nth(0)).toHaveAttribute("hidden", "");
    await expect(page.locator("#agent-combo .name")).toHaveText("Tesagent");
  });

  test("the panel reopens on the agent used last", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openPanel(page, extensionId);
    await chooseAgent(page, "tesagent");
    await expect.poll(() => storedAgentId(page)).toBe("tesagent");
    await page.close();

    const reopened = await context.newPage();
    await openPanel(reopened, extensionId);
    await expect(reopened.locator("#agent-combo .name")).toHaveText("Tesagent");
    await expect(reopened.locator(`${VISIBLE_PANEL} .header-title`)).toHaveText("Tesagent");
    await expect(reopened.locator("#chat agent-chat-panel")).toHaveCount(1);
  });

  test("a stored agent that no longer exists falls back to Chromagent", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openPanel(page, extensionId);
    await expect(page.locator("#agent-combo .name")).toHaveText("Chromagent");
    await page.evaluate(async () => {
      await chrome.storage.local.set({ sidePanelAgent: "removed_agent" });
    });
    expect(await storedAgentId(page)).toBe("removed_agent");
    await page.reload();
    await expect(page.locator("#agent-row")).toBeVisible();
    await expect(page.locator("#agent-combo .name")).toHaveText("Chromagent");
    await expect(page.locator(`${VISIBLE_PANEL} .header-title`)).toHaveText("Chromagent");
    await expect.poll(() => storedAgentId(page)).toBe("chromagent");
  });

  // --- 121/002: the side panel reads the merged agent store -----------------

  test("stored agent edits and user agents reflect in side panel combo and panel setup", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        agentEdits: {
          tesagent: {
            description: "Custom tesagent tester",
            instructions: "Custom tesagent instructions",
            model: "anthropic-sonnet",
            tools: ["read_tabs", "page_eval"],
            excludeTools: [],
            skills: "*",
            excludeSkills: [],
          },
        },
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
    await openPanel(page, extensionId);

    await page.locator("#agent-combo").click();
    const items = page.locator("#agent-list li");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText("Chromagent");
    await expect(items.nth(1)).toContainText("Data Analyst");
    await expect(items.nth(2)).toContainText("Tesagent");
    await expect(items.nth(2)).toContainText("Custom tesagent tester");
  });

  test("a stored edit's model routes the panel to that model entry's endpoint and model", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async (description) => {
      await chrome.storage.local.set({
        agentEdits: {
          tesagent: {
            description,
            instructions: "Custom tesagent instructions",
            model: "anthropic-sonnet",
            tools: "*",
            excludeTools: [],
            skills: "*",
            excludeSkills: [],
          },
        },
      });
    }, TESAGENT_DESCRIPTION);

    const page = await context.newPage();
    await openPanel(page, extensionId);
    await chooseAgent(page, "tesagent");

    const routed = await page.evaluate((selector) => {
      const panel = document.querySelector<HTMLElementTagNameMap["agent-chat-panel"]>(selector);
      return { model: panel?.model, path: panel?.path };
    }, VISIBLE_PANEL);
    // brand/model.yml's anthropic-sonnet entry (External facts table,
    // task 002): model "sonnet" at the shared gateway's anthropic path.
    expect(routed.model).toBe("sonnet");
    expect(routed.path).toBe("http://localhost:30000/api/anthropic");
  });

  test("a stored edit's tools filter the panel to exactly those two of its own tool providers", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async (description) => {
      await chrome.storage.local.set({
        agentEdits: {
          tesagent: {
            description,
            instructions: "Custom tesagent instructions",
            model: null,
            tools: ["read_tabs", "page_eval"],
            excludeTools: [],
            skills: "*",
            excludeSkills: [],
          },
        },
      });
    }, TESAGENT_DESCRIPTION);

    const page = await context.newPage();
    await openPanel(page, extensionId);
    await chooseAgent(page, "tesagent");

    const names = await page.evaluate(async (selector) => {
      const panel = document.querySelector<HTMLElementTagNameMap["agent-chat-panel"]>(selector);
      const loaded = await Promise.all((panel?.toolProviders ?? []).map((p) => p.load()));
      return loaded.flat().map((t) => t.name).sort();
    }, VISIBLE_PANEL);
    expect(names).toEqual(["page_eval", "read_tabs"]);
  });

  test("selecting a stored user agent opens a panel using its stored instructions", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        userAgents: [
          {
            id: "analyst",
            displayName: "Data Analyst",
            description: "Analyzes table data",
            instructions: "You analyze tables and only tables.",
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
    await openPanel(page, extensionId);
    await chooseAgent(page, "analyst");
    await expect(page.locator(`${VISIBLE_PANEL} .header-title`)).toHaveText("Data Analyst");

    const instructions = await page.evaluate((selector) => {
      const panel = document.querySelector<HTMLElementTagNameMap["agent-chat-panel"]>(selector);
      return panel?.appContext?.appInstructions;
    }, VISIBLE_PANEL);
    expect(instructions).toBe("You analyze tables and only tables.");
  });
});
