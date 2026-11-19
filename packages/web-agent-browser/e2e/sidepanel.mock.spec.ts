import { test, expect, getTabId, openOptions } from "./extension.fixture";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(
  HERE,
  "../../../temp/artifacts/2026-08-31-023032-001-extension-side-panel",
);
// The page-agent icon toggle.
const ICON_ARTIFACTS_DIR = path.resolve(
  HERE,
  "../../../temp/artifacts/2026-09-15-171940-003-page-agent-icon-toggle",
);
const SYNC_ARTIFACTS_DIR = path.resolve(
  process.env.TASK_ARTIFACTS_DIR ?? path.join(HERE, "../test-results/tab-state-sync"),
);
const SITE_URL = "http://localhost:10040/plain.html";
// The four status texts of the page-agent icon. The origin is location.origin
// (src/content.ts:50), so it carries the scheme.
const OFF_TEXT = "Turn on the agent in this tab. The in-page agent is off for http://localhost:10040.";
const ON_TEXT = "Turn off the agent in this tab. The in-page agent is on for http://localhost:10040.";
const NO_SITE_TEXT = "Turn on the agent in this tab. Open a website in a tab to use this control.";
const FOREIGN_TEXT = "Turn on the agent in this tab. This page already has its own agent, so nothing was added.";

type Rgb = [number, number, number];

/** The checks every tab state makes on the icon: tooltip, accessible name,
 *  pressed, disabled, and the non-colour cue — the slash (::after) when not
 *  pressed, the dot when pressed. The aria-label check comes first so the
 *  others run after main() has resolved the tab state. */
async function expectIconState(
  icon: Locator,
  text: string,
  want: { pressed: boolean; disabled: boolean },
): Promise<void> {
  await expect(icon).toHaveAttribute("aria-label", text);
  await expect(icon).toHaveAttribute("title", text);
  await expect(icon).toHaveAttribute("aria-pressed", String(want.pressed));
  if (want.disabled) await expect(icon).toBeDisabled();
  else await expect(icon).toBeEnabled();
  if (want.pressed) await expect(icon.locator(".dot")).toBeVisible();
  else await expect(icon.locator(".dot")).toBeHidden();
  const slash = await icon.evaluate((el) => getComputedStyle(el, "::after").content);
  expect(slash).toBe(want.pressed ? "none" : '""');
}

async function setTheme(page: Page, theme: "wa2-light" | "wa2-dark"): Promise<void> {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
}

/** Opens the plain fixture page, then the panel as a second tab, and makes the
 *  fixture page the active tab before the panel reloads, so the icon targets
 *  it. main() awaits storage before it shows #agent-row and resolves the tab
 *  state last (src/sidepanel.ts:169-235), so this waits for the row, then for
 *  the enabled icon. */
async function panelTargetingSite(
  context: BrowserContext,
  extensionId: string,
): Promise<{ panelPage: Page; sitePage: Page }> {
  const sitePage = await context.newPage();
  await sitePage.goto(SITE_URL);
  const panelPage = await context.newPage();
  await panelPage.setViewportSize({ width: 400, height: 700 });
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await sitePage.bringToFront();
  await panelPage.reload();
  await expect(panelPage.locator("#agent-row")).toBeVisible();
  await expect(panelPage.locator("#page-agent-toggle")).toBeEnabled();
  return { panelPage, sitePage };
}

/** The RGB of one pixel of a PNG, read through a canvas in `page`. */
async function pixelAt(page: Page, png: Buffer, x: number, y: number): Promise<Rgb> {
  return page.evaluate(
    async ({ b64, px, py }) => {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = `data:image/png;base64,${b64}`;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2]] as Rgb;
    },
    { b64: png.toString("base64"), px: x, py: y },
  );
}

function parseRgb(css: string): Rgb {
  const m = css.match(/rgba?\((\d+), (\d+), (\d+)/);
  if (!m) throw new Error(`expected an rgb() colour, got ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** WCAG relative luminance (https://www.w3.org/WAI/GL/wiki/Relative_luminance). */
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Icon colour (the svg fills with currentColor) against the rendered button
 *  background. The background is read from a pixel, so the 10 % tint is
 *  measured as composited. Pixel (3, 18) of the 37 × 37 button is 2 px inside
 *  the 1 px left border, level with the centre: outside the 24 px glyph
 *  (x 6.5-30.5), the slash (x about 9-28) and the dot (x 26-33, y 4-11). */
async function measureIcon(page: Page, theme: string, state: "off" | "on") {
  const icon = page.locator("#page-agent-toggle");
  const png = await icon.screenshot();
  const background = await pixelAt(page, png, 3, 18);
  const iconColour = parseRgb(await icon.evaluate((el) => getComputedStyle(el).color));
  const ratio = Number(contrastRatio(iconColour, background).toFixed(2));
  return { theme, state, icon: iconColour, background, ratio };
}

/** Two PNGs stacked, 20 px apart, drawn in greyscale. Same method as
 *  e2e/sidepanel.demo.spec.ts:257-280. */
async function greyscaleStack(page: Page, top: Buffer, bottom: Buffer): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ({ a, b }) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${src}`;
        });
      const [imgA, imgB] = await Promise.all([load(a), load(b)]);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(imgA.width, imgB.width);
      canvas.height = imgA.height + imgB.height + 20;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.filter = "grayscale(100%)";
      ctx.drawImage(imgA, 0, 0);
      ctx.drawImage(imgB, 0, imgA.height + 20);
      return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
    },
    { a: top.toString("base64"), b: bottom.toString("base64") },
  );
  return Buffer.from(b64, "base64");
}

test.describe("Side panel mock e2e", () => {
  test("panel page opens at 400px viewport with no horizontal overflow and attaches agent-chat-panel", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 400, height: 700 });

    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    await expect(page.locator("#agent-row")).toBeVisible();
    await expect(page.locator("#page-agent-toggle")).toBeVisible();
    await expect(page.locator("#toggle, #toggle-status, #toggle-row")).toHaveCount(0);
    await expect(page.locator("#chat agent-chat-panel")).toBeAttached();

    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalScroll).toBe(false);
  });

  test("active tab sync: switch and reload", async ({ context, extensionId }) => {
    await fs.mkdir(SYNC_ARTIFACTS_DIR, { recursive: true });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: [] });
    });

    const { panelPage, sitePage: pageA } = await panelTargetingSite(context, extensionId);
    const icon = panelPage.locator("#page-agent-toggle");
    await expectIconState(icon, OFF_TEXT, { pressed: false, disabled: false });

    const pageB = await context.newPage();
    await pageB.goto("http://127.0.0.1:10040/plain.html");
    await pageB.bringToFront();

    await expect(icon).toHaveAttribute("title", /http:\/\/127\.0\.0\.1:10040/);
    await expect(icon).not.toHaveAttribute("title", /http:\/\/localhost:10040/);
    await expect(icon).toHaveAttribute("aria-label", /http:\/\/127\.0\.0\.1:10040/);
    await expect(icon).not.toHaveAttribute("aria-label", /http:\/\/localhost:10040/);

    await pageB.reload();
    await expect(icon).toBeEnabled();
    await expect(icon).toHaveAttribute("title", /http:\/\/127\.0\.0\.1:10040/);

    await panelPage.screenshot({ path: path.join(SYNC_ARTIFACTS_DIR, "switch-b.png") });

    await pageB.bringToFront();
    await icon.evaluate((el: HTMLButtonElement) => el.click());

    await expect(pageB.locator("web-agent-bubble #launcher")).toBeVisible();
    await expect(pageA.locator("web-agent-bubble")).toHaveCount(0);

    const ON_B_TEXT = "Turn off the agent in this tab. The in-page agent is on for http://127.0.0.1:10040.";
    await expectIconState(icon, ON_B_TEXT, { pressed: true, disabled: false });

    await panelPage.screenshot({ path: path.join(SYNC_ARTIFACTS_DIR, "reload-b-on.png") });

    await pageB.bringToFront();
    await icon.evaluate((el: HTMLButtonElement) => el.click());
    await expect(pageB.locator("web-agent-bubble")).toHaveCount(0);
    const OFF_B_TEXT = "Turn on the agent in this tab. The in-page agent is off for http://127.0.0.1:10040.";
    await expectIconState(icon, OFF_B_TEXT, { pressed: false, disabled: false });

    const origins = await worker.evaluate(async () => {
      const got = await chrome.storage.local.get("enabledOrigins");
      return (got.enabledOrigins as string[]) ?? [];
    });
    expect(origins).not.toContain("http://127.0.0.1:10040");
  });

  test("active tab sync: host to plain navigation", async ({ context, extensionId }) => {
    await fs.mkdir(SYNC_ARTIFACTS_DIR, { recursive: true });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: [] });
    });

    const hostPage = await context.newPage();
    await hostPage.goto("http://localhost:10040/host-wa-button.html");

    const panelPage = await context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    await hostPage.bringToFront();
    await panelPage.reload();

    const icon = panelPage.locator("#page-agent-toggle");
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await expectIconState(icon, FOREIGN_TEXT, { pressed: false, disabled: true });
    await expect(hostPage.locator("web-agent-bubble")).toHaveCount(0);

    await hostPage.goto("http://localhost:10040/plain.html");
    await hostPage.bringToFront();

    await expectIconState(icon, OFF_TEXT, { pressed: false, disabled: false });
    await expect(icon).not.toHaveAttribute("title", /already has its own agent/);

    await panelPage.screenshot({ path: path.join(SYNC_ARTIFACTS_DIR, "host-to-plain-enabled.png") });

    await hostPage.bringToFront();
    await icon.evaluate((el: HTMLButtonElement) => el.click());

    await expect(hostPage.locator("web-agent-bubble #launcher")).toBeVisible();
    await expectIconState(icon, ON_TEXT, { pressed: true, disabled: false });

    await panelPage.screenshot({ path: path.join(SYNC_ARTIFACTS_DIR, "host-to-plain-on.png") });
  });

  test("the options page default model and theme reach the panel element", async ({ context, extensionId }) => {
    if (context.serviceWorkers().length === 0) await context.waitForEvent("serviceworker");

    // Configure options via options.html
    const optionsPage = await context.newPage();
    await openOptions(optionsPage, extensionId);
    await optionsPage.click("#tab-btn-models");
    await optionsPage.click('#model-table tr.model-row[data-ref="brand:openai-sonnet"] input.model-default');
    await optionsPage.click("#tab-btn-general");
    await optionsPage.selectOption("#theme", "wa2-dark");
    await optionsPage.click("#save");
    await expect(optionsPage.locator("#status")).toContainText("Saved.");
    await optionsPage.close();

    const panelPage = await context.newPage();
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const panelAttrs = await panelPage.evaluate(() => {
      const panel = document.querySelector("agent-chat-panel") as any;
      if (!panel) throw new Error("expected agent-chat-panel to be attached");
      return {
        path: panel.path,
        type: panel.type,
        model: panel.model,
        selectedModel: panel.selectedModel,
        dataTheme: document.documentElement.getAttribute("data-theme"),
      };
    });

    expect(panelAttrs.path).toBe("http://localhost:30000/api/openai/v1");
    expect(panelAttrs.type).toBe("openai");
    expect(panelAttrs.model).toBe("sonnet");
    expect(panelAttrs.selectedModel).toBe("brand:openai-sonnet");
    expect(panelAttrs.dataTheme).toBe("wa2-dark");
  });

  test("toggle control mounts and unmounts bubble in visited tab and updates enabledOrigins", async ({
    context,
    extensionId,
  }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    // Clean storage
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: [] });
    });

    // Tab 1: plain website
    const sitePage = await context.newPage();
    await sitePage.goto("http://localhost:10040/plain.html");
    await expect(sitePage.locator("web-agent-bubble")).toHaveCount(0);

    // Tab 2: side panel
    const panelPage = await context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // Bring sitePage to front so it is the active tab
    await sitePage.bringToFront();

    // In panelPage, reload to pick up active tab
    await panelPage.reload();
    const toggleBtn = panelPage.locator("#page-agent-toggle");
    await expectIconState(toggleBtn, OFF_TEXT, { pressed: false, disabled: false });

    // Click toggle to turn on
    await sitePage.bringToFront();
    await toggleBtn.evaluate((el: HTMLButtonElement) => el.click());

    // Verify bubble is mounted in sitePage
    await expect(sitePage.locator("web-agent-bubble #launcher")).toBeVisible();
    await expectIconState(toggleBtn, ON_TEXT, { pressed: true, disabled: false });

    const originsAfterOn = await worker.evaluate(async () => {
      const got = await chrome.storage.local.get("enabledOrigins");
      return (got.enabledOrigins as string[]) ?? [];
    });
    expect(originsAfterOn).toContain("http://localhost:10040");

    // Click toggle to turn off
    await sitePage.bringToFront();
    await toggleBtn.evaluate((el: HTMLButtonElement) => el.click());
    await expect(sitePage.locator("web-agent-bubble")).toHaveCount(0);
    await expectIconState(toggleBtn, OFF_TEXT, { pressed: false, disabled: false });

    const originsAfterOff = await worker.evaluate(async () => {
      const got = await chrome.storage.local.get("enabledOrigins");
      return (got.enabledOrigins as string[]) ?? [];
    });
    expect(originsAfterOff).not.toContain("http://localhost:10040");
  });

  test("control is disabled and mounts nothing when panel page is active", async ({
    context,
    extensionId,
  }) => {
    const panelPage = await context.newPage();
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    await expect(panelPage.locator("#agent-row")).toBeVisible();
    const toggleBtn = panelPage.locator("#page-agent-toggle");
    await expectIconState(toggleBtn, NO_SITE_TEXT, { pressed: false, disabled: true });
    await expect(panelPage.locator("web-agent-bubble")).toHaveCount(0);
  });

  test("on nested-agent page, pressing toggle mounts nothing and reports foreign agent", async ({
    context,
    extensionId,
  }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: [] });
    });

    const hostPage = await context.newPage();
    await hostPage.goto("http://localhost:10040/nested-agent.html");

    const panelPage = await context.newPage();
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    await hostPage.bringToFront();
    await panelPage.reload();

    await expect(panelPage.locator("#agent-row")).toBeVisible();
    const toggleBtn = panelPage.locator("#page-agent-toggle");

    // The page already has a foreign agent, so the icon is disabled and its
    // tooltip and accessible name carry the foreign agent message.
    await expectIconState(toggleBtn, FOREIGN_TEXT, { pressed: false, disabled: true });
    // Bubble count in body should still only be the host agent (0 extension bubbles)
    await expect(hostPage.locator("body > web-agent-bubble")).toHaveCount(0);
  });

  test("captures screenshots in light and dark at 400px width", async ({
    context,
    extensionId,
  }) => {
    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });

    const page = await context.newPage();
    await page.setViewportSize({ width: 400, height: 700 });

    // Light
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "09-panel-light-400.png") });

    // Dark
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "10-panel-dark-400.png") });
  });
});

test.describe("Page-agent icon toggle mock e2e", () => {
  test("the top row is one row: combo box left, icon button right, glyph drawn, nothing cut off at 400 px", async ({
    context,
    extensionId,
  }) => {
    const { panelPage } = await panelTargetingSite(context, extensionId);
    await expect(panelPage.locator("#toggle, #toggle-status, #toggle-row")).toHaveCount(0);

    const icon = panelPage.locator("#page-agent-toggle");
    await expect(icon.locator("svg path")).toHaveCount(1);
    expect((await icon.innerText()).trim()).toBe("");

    const row = await panelPage.locator("#agent-row").boundingBox();
    const combo = await panelPage.locator("#agent-combo").boundingBox();
    const iconBox = await icon.boundingBox();
    const chat = await panelPage.locator("#chat").boundingBox();
    if (!row || !combo || !iconBox || !chat) throw new Error("expected row, combo box, icon and chat boxes");

    expect(row.y).toBe(0);
    expect(combo.x + combo.width).toBeLessThanOrEqual(iconBox.x);
    expect(iconBox.x + iconBox.width).toBeLessThanOrEqual(400);
    for (const box of [combo, iconBox]) {
      expect(box.y).toBeGreaterThanOrEqual(row.y);
      expect(box.y + box.height).toBeLessThanOrEqual(row.y + row.height);
    }
    expect(iconBox.width).toBe(37);
    expect(iconBox.height).toBe(37);
    expect(chat.y).toBeGreaterThanOrEqual(row.y + row.height);

    const hasHorizontalScroll = await panelPage.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalScroll).toBe(false);
  });

  test("the open agent list stops before the icon button, so their boxes never overlap", async ({
    context,
    extensionId,
  }) => {
    const { panelPage } = await panelTargetingSite(context, extensionId);
    const icon = panelPage.locator("#page-agent-toggle");
    await panelPage.locator("#agent-combo").click();
    await expect(panelPage.locator("#agent-list")).toBeVisible();

    const iconBox = await icon.boundingBox();
    const listBox = await panelPage.locator("#agent-list").boundingBox();
    if (!iconBox || !listBox) throw new Error("expected the icon and the open list to have boxes");
    // Two axis-aligned boxes do not overlap when one lies entirely to a side
    // of the other on at least one axis.
    const overlaps =
      iconBox.x < listBox.x + listBox.width &&
      iconBox.x + iconBox.width > listBox.x &&
      iconBox.y < listBox.y + listBox.height &&
      iconBox.y + iconBox.height > listBox.y;
    expect(overlaps).toBe(false);
    expect(listBox.x + listBox.width).toBeLessThanOrEqual(iconBox.x);

    await setTheme(panelPage, "wa2-light");
    await fs.mkdir(ICON_ARTIFACTS_DIR, { recursive: true });
    await panelPage.screenshot({ path: path.join(ICON_ARTIFACTS_DIR, "07-list-open-with-icon-light.png") });
    await setTheme(panelPage, "wa2-dark");
    await panelPage.screenshot({ path: path.join(ICON_ARTIFACTS_DIR, "08-list-open-with-icon-dark.png") });
  });

  test("keyboard: the active extension tab disables and skips the page icon", async ({
    context,
    extensionId,
  }) => {
    const { panelPage, sitePage } = await panelTargetingSite(context, extensionId);
    await panelPage.bringToFront();

    const icon = panelPage.locator("#page-agent-toggle");
    await expectIconState(icon, NO_SITE_TEXT, { pressed: false, disabled: true });
    await panelPage.locator("#agent-combo").focus();
    await panelPage.keyboard.press("Tab");
    await expect(icon).not.toBeFocused();
    await expect(sitePage.locator("web-agent-bubble")).toHaveCount(0);
  });

  test("off, on and disabled at 400 px in light and dark, greyscale off/on pair, contrast check", async ({
    context,
    extensionId,
  }) => {
    await fs.mkdir(ICON_ARTIFACTS_DIR, { recursive: true });
    const { panelPage, sitePage } = await panelTargetingSite(context, extensionId);
    const icon = panelPage.locator("#page-agent-toggle");
    const row = panelPage.locator("#agent-row");
    const themes = ["wa2-light", "wa2-dark"] as const;
    const measured: Awaited<ReturnType<typeof measureIcon>>[] = [];
    const rowShots: Record<string, Buffer> = {};

    await expectIconState(icon, OFF_TEXT, { pressed: false, disabled: false });
    for (const theme of themes) {
      await setTheme(panelPage, theme);
      await panelPage.screenshot({ path: path.join(ICON_ARTIFACTS_DIR, `01-off-${theme}.png`) });
      rowShots[`off-${theme}`] = await row.screenshot();
      measured.push(await measureIcon(panelPage, theme, "off"));
    }

    await sitePage.bringToFront();
    await icon.evaluate((el: HTMLButtonElement) => el.click());
    await expectIconState(icon, ON_TEXT, { pressed: true, disabled: false });
    for (const theme of themes) {
      await setTheme(panelPage, theme);
      await panelPage.screenshot({ path: path.join(ICON_ARTIFACTS_DIR, `02-on-${theme}.png`) });
      rowShots[`on-${theme}`] = await row.screenshot();
      measured.push(await measureIcon(panelPage, theme, "on"));
    }

    for (const theme of themes) {
      await fs.writeFile(
        path.join(ICON_ARTIFACTS_DIR, `04-row-off-above-on-greyscale-${theme}.png`),
        await greyscaleStack(panelPage, rowShots[`off-${theme}`], rowShots[`on-${theme}`]),
      );
    }

    // Disabled: with the panel page itself the active tab, there is no website
    // to act on.
    await panelPage.bringToFront();
    await panelPage.reload();
    await expect(row).toBeVisible();
    await expectIconState(icon, NO_SITE_TEXT, { pressed: false, disabled: true });
    for (const theme of themes) {
      await setTheme(panelPage, theme);
      await panelPage.screenshot({ path: path.join(ICON_ARTIFACTS_DIR, `03-disabled-${theme}.png`) });
    }

    // Written before the assertion, so a failing ratio still leaves its evidence.
    await fs.writeFile(path.join(ICON_ARTIFACTS_DIR, "06-contrast.json"), JSON.stringify(measured, null, 2));
    for (const m of measured) {
      expect(m.ratio, `${m.state} in ${m.theme}: icon ${m.icon.join(",")} on ${m.background.join(",")}`).toBeGreaterThanOrEqual(3);
    }
  });
});

test.describe("Side panel tab tools mock e2e", () => {
  test("read_tabs execution in mock mode returns the open tabs", async ({ context, extensionId }) => {
    const sitePage = await context.newPage();
    await sitePage.goto("http://localhost:10040/plain.html");

    const panelPage = await context.newPage();
    await panelPage.addInitScript(() => {
      // A tool's real output is always a string (ToolOutcome.content in
      // web-agent-core), but the mock script reads it back off a
      // ToolResultPart whose `output` field is `unknown` — narrow rather
      // than optional-chain, which `unknown` does not support.
      function outputText(output: unknown): string {
        if (typeof output === "string") return output;
        if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
          return output.content;
        }
        return JSON.stringify(output);
      }
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Tabs" };
        }
        callCount++;
        if (callCount === 1) {
          return { toolCalls: [{ id: "tc_read", name: "read_tabs", input: {} }] };
        }
        let result = "";
        if (Array.isArray(lastMsg?.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "read_tabs");
          if (part && part.type === "tool-result") result = outputText(part.output);
        }
        window.__READ_TABS_RESULT__ = result;
        return { text: "Reported tabs." };
      };
    });
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("What tabs are open?");
    await panelPage.keyboard.press("Enter");

    await panelPage.waitForFunction(() => window.__READ_TABS_RESULT__ !== undefined, {
      timeout: 15_000,
    });
    const result = await panelPage.evaluate(() => window.__READ_TABS_RESULT__);
    expect(result).toContain("plain.html");
  });

  test("open_tab execution in mock mode opens a new tab at the given URL", async ({ context, extensionId }) => {
    const panelPage = await context.newPage();
    await panelPage.addInitScript(() => {
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Open tab" };
        }
        callCount++;
        if (callCount === 1) {
          return {
            toolCalls: [
              { id: "tc_open", name: "open_tab", input: { url: "http://localhost:10040/themed-site.html" } },
            ],
          };
        }
        return { text: "Opened the tab." };
      };
    });
    await panelPage.setViewportSize({ width: 400, height: 700 });

    const [newPage] = await Promise.all([
      context.waitForEvent("page", (p) => p.url().includes("themed-site.html")),
      (async () => {
        await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
        const inputArea = panelPage.locator("agent-chat-panel #input");
        await inputArea.click();
        await panelPage.keyboard.type("Open http://localhost:10040/themed-site.html");
        await panelPage.keyboard.press("Enter");
      })(),
    ]);

    await newPage.waitForLoadState();
    expect(newPage.url()).toContain("themed-site.html");
  });

  test("navigate_tab then refresh_tab execution in mock mode navigates and reloads the tab", async ({
    context,
    extensionId,
  }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    const sitePage = await context.newPage();
    await sitePage.goto("http://localhost:10040/plain.html");
    const tabId = await getTabId(worker, "http://localhost:10040/plain.html");

    const panelPage = await context.newPage();
    await panelPage.addInitScript((id: number) => {
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Navigate" };
        }
        callCount++;
        if (callCount === 1) {
          return {
            toolCalls: [
              { id: "tc_nav", name: "navigate_tab", input: { tabId: id, url: "http://localhost:10040/themed-site.html" } },
            ],
          };
        }
        if (callCount === 2) {
          return { toolCalls: [{ id: "tc_refresh", name: "refresh_tab", input: { tabId: id } }] };
        }
        return { text: "Navigated and refreshed." };
      };
    }, tabId);
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("Navigate that tab then refresh it");
    await panelPage.keyboard.press("Enter");

    await sitePage.waitForURL("**/themed-site.html", { timeout: 15_000 });

    await panelPage.waitForFunction(() => {
      // agent-chat-panel renders into itself (light DOM, no shadow root) —
      // see Component.renderRoot in web-agent-lit/src/ui/component.ts.
      const views = [...document.querySelectorAll("agent-chat-panel agent-message-view")];
      const assistantViews = views.filter((v) => v.querySelector(".assistant"));
      return assistantViews.some((v) => (v.querySelector(".content")?.textContent ?? "").includes("Navigated and refreshed."));
    }, { timeout: 15_000 });

    expect(sitePage.url()).toContain("themed-site.html");
  });

  test("close_tab execution with user decline leaves the tab open", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    const sitePage = await context.newPage();
    await sitePage.goto("http://localhost:10040/plain.html");
    const tabId = await getTabId(worker, "http://localhost:10040/plain.html");

    const panelPage = await context.newPage();
    await panelPage.addInitScript((id: number) => {
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Close tab" };
        }
        callCount++;
        if (callCount === 1) {
          return { toolCalls: [{ id: "tc_close", name: "close_tab", input: { tabId: id } }] };
        }
        return { text: "The user declined to close the tab." };
      };
    }, tabId);
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("Close that tab");
    await panelPage.keyboard.press("Enter");

    const scrim = panelPage.locator("agent-chat-panel .wa-confirm-scrim");
    await expect(scrim).toBeVisible({ timeout: 15_000 });
    await expect(scrim).toContainText("Plain page");

    const rejectBtn = scrim.locator("button:has-text('Reject'), md-outlined-button:has-text('Reject')").first();
    await rejectBtn.click();
    await expect(scrim).toHaveCount(0, { timeout: 5000 });

    await panelPage.waitForFunction(() => {
      const views = [...document.querySelectorAll("agent-chat-panel agent-message-view")];
      const assistantViews = views.filter((v) => v.querySelector(".assistant"));
      return assistantViews.some((v) => (v.querySelector(".content")?.textContent ?? "").includes("declined"));
    }, { timeout: 15_000 });

    expect(sitePage.isClosed()).toBe(false);
  });

  test("close_tab execution with user allow closes the tab", async ({ context, extensionId }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    const sitePage = await context.newPage();
    await sitePage.goto("http://localhost:10040/plain.html");
    const tabId = await getTabId(worker, "http://localhost:10040/plain.html");

    const panelPage = await context.newPage();
    await panelPage.addInitScript((id: number) => {
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Close tab" };
        }
        callCount++;
        if (callCount === 1) {
          return { toolCalls: [{ id: "tc_close", name: "close_tab", input: { tabId: id } }] };
        }
        return { text: "Closed the tab." };
      };
    }, tabId);
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const closePromise = sitePage.waitForEvent("close", { timeout: 15_000 });

    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("Close that tab");
    await panelPage.keyboard.press("Enter");

    const scrim = panelPage.locator("agent-chat-panel .wa-confirm-scrim");
    await expect(scrim).toBeVisible({ timeout: 15_000 });
    await expect(scrim).toContainText("Plain page");

    const allowBtn = scrim.locator("button:has-text('Allow'), md-filled-button:has-text('Allow')").first();
    await allowBtn.click();

    await closePromise;

    await panelPage.waitForFunction(() => {
      const views = [...document.querySelectorAll("agent-chat-panel agent-message-view")];
      const assistantViews = views.filter((v) => v.querySelector(".assistant"));
      return assistantViews.some((v) => (v.querySelector(".content")?.textContent ?? "").includes("Closed the tab."));
    }, { timeout: 15_000 });
  });

  test("tab_management skill is discoverable via search_skills", async ({ context, extensionId }) => {
    const panelPage = await context.newPage();
    await panelPage.addInitScript(() => {
      // A tool's real output is always a string (ToolOutcome.content in
      // web-agent-core), but the mock script reads it back off a
      // ToolResultPart whose `output` field is `unknown` — narrow rather
      // than optional-chain, which `unknown` does not support.
      function outputText(output: unknown): string {
        if (typeof output === "string") return output;
        if (typeof output === "object" && output !== null && "content" in output && typeof output.content === "string") {
          return output.content;
        }
        return JSON.stringify(output);
      }
      let callCount = 0;
      window.__WA_MOCK_SCRIPT__ = (opts) => {
        const lastMsg = opts.messages[opts.messages.length - 1];
        const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
        if (lastText.includes("Summarize the following conversation as a short UI title")) {
          return { text: "Skills" };
        }
        callCount++;
        if (callCount === 1) {
          return { toolCalls: [{ id: "tc_search", name: "search_skills", input: { query: "tab" } }] };
        }
        let result = "";
        if (Array.isArray(lastMsg?.content)) {
          const part = lastMsg.content.find((p) => p.type === "tool-result" && p.toolName === "search_skills");
          if (part && part.type === "tool-result") result = outputText(part.output);
        }
        window.__SEARCH_SKILLS_RESULT__ = result;
        return { text: "Found the tab_management skill." };
      };
    });
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    const inputArea = panelPage.locator("agent-chat-panel #input");
    await inputArea.click();
    await panelPage.keyboard.type("What skills do you have for tabs?");
    await panelPage.keyboard.press("Enter");

    await panelPage.waitForFunction(() => window.__SEARCH_SKILLS_RESULT__ !== undefined, {
      timeout: 15_000,
    });
    const result = await panelPage.evaluate(() => window.__SEARCH_SKILLS_RESULT__);
    expect(result).toContain("tab_management");
  });
});
