import { test, expect } from "./extension.fixture";
import { chromium, type BrowserContext, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, "../dist");
const TEMP_DIR = path.resolve(HERE, "../temp/e2e-extensions/attach-folder");
const ARTIFACTS = path.resolve(HERE, "../../../temp/artifacts/2026-10-01-022937-003-attach-folder-button");
const RAINBOW_PNG = path.resolve(HERE, "../../../apps/cat-store/e2e/fixtures/004-test-rainbow.png");

type Seed = Record<string, string | { b64: string }>;

function installMockScript(): void {
  window.__WA_ENABLE_VFS_PROOF__ = true;
  window.__WA_MOCK_SCRIPT__ = (opts) => {
    const lastMsg = opts.messages[opts.messages.length - 1];
    const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
    if (lastText.includes("Summarize the following conversation as a short UI title")) {
      return { text: "VFS test" };
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
    return { text: results.length > 0 ? results.map((r) => r.text).join("\n") : "Reply: done" };
  };
}

function installPickerStandIn(): void {
  window.__USER_TEXTS__ = [];
  window.__PICKER_CALLS__ = [];
  const inner = window.__WA_MOCK_SCRIPT__ as ((opts: { messages: { role?: string; content: unknown }[] }) => unknown) | undefined;
  window.__WA_MOCK_SCRIPT__ = ((opts: { messages: { role?: string; content: unknown }[] }) => {
    const last = opts.messages[opts.messages.length - 1];
    if (last?.role === "user") {
      let text = "";
      if (typeof last.content === "string") {
        text = last.content;
      } else if (Array.isArray(last.content)) {
        text = (last.content as { type?: string; text?: string }[])
          .filter((p) => p && p.type === "text" && typeof p.text === "string")
          .map((p) => p.text)
          .join("\n");
      }
      if (text && !text.includes("Summarize the following conversation as a short UI title")) {
        window.__USER_TEXTS__!.push(text);
      }
    }
    if (window.__SLOW_ONCE__) {
      window.__SLOW_ONCE__ = false;
      return { text: "slow", delayMs: 3000 };
    }
    return inner ? inner(opts) : { text: "Reply: done" };
  }) as typeof window.__WA_MOCK_SCRIPT__;
  (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async (o: { mode?: string }) => {
    window.__PICKER_CALLS__!.push(o);
    const name = window.__PICK_NEXT__ ?? "reports";
    if (name === "__abort__") throw new DOMException("The user aborted a request.", "AbortError");
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(name, { create: true });
  };
}

async function openTesagent(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(installMockScript);
  await page.addInitScript(installPickerStandIn);
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.locator("#agent-row")).toBeVisible();
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator("#agent-option-tesagent").click();
  await page.waitForFunction(() => window.__WA_VFS_PROOF__?.tesagent !== undefined);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true });
  });
  return page;
}

async function seed(page: Page, dir: string, files: Seed): Promise<void> {
  await page.evaluate(
    async ({ dir, files }) => {
      const root = await navigator.storage.getDirectory();
      const base = await root.getDirectoryHandle(dir, { create: true });
      for (const [rel, body] of Object.entries(files)) {
        const parts = rel.split("/");
        let d = base;
        for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
        const h = await d.getFileHandle(parts[parts.length - 1], { create: true });
        const w = await h.createWritable();
        if (typeof body === "string") await w.write(body);
        else await w.write(Uint8Array.from(atob(body.b64), (c) => c.charCodeAt(0)));
        await w.close();
      }
    },
    { dir, files },
  );
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const inputArea = page.locator("agent-chat-panel:not([hidden]) #input");
  await inputArea.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

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

async function getWorker(context: BrowserContext) {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  return worker;
}

// Contrast of an item's text against the pixel behind it, sampled from a real
// screenshot so the state layer (hover, focus) is included.
async function measureItemContrast(page: Page, item: Locator, label: string): Promise<number> {
  const box = (await item.boundingBox())!;
  const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(box.height) };
  const png = await page.screenshot({ clip });
  const textColour = await item.evaluate((el) => getComputedStyle(el).color);
  const ratio = await page.evaluate(
    async ({ b64, textColour, h }) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0);
      const bg = Array.from(ctx.getImageData(3, Math.floor(h / 2), 1, 1).data).slice(0, 3);
      const fg = (textColour.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const lum = (rgb: number[]) => {
        const [r, g, b] = rgb.map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, z) => z - a);
      return (hi + 0.05) / (lo + 0.05);
    },
    { b64: png.toString("base64"), textColour, h: clip.height },
  );
  await fs.appendFile(path.join(ARTIFACTS, "sidepanel-menu-state-contrast.txt"), `${label}: ${ratio.toFixed(2)}:1\n`);
  return ratio;
}

// Hover and keyboard-focus states of the open menu, in the current theme.
async function captureItemStates(page: Page, hoverItem: Locator, focusItem: Locator, theme: string): Promise<void> {
  await hoverItem.hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACTS, `sidepanel-menu-hover-${theme}.png`) });
  expect(await measureItemContrast(page, hoverItem, `sidepanel ${theme} hover`)).toBeGreaterThanOrEqual(4.5);
  await page.mouse.move(2, 2);
  await page.keyboard.press("Shift");
  await focusItem.focus();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACTS, `sidepanel-menu-focus-${theme}.png`) });
  await expect(focusItem).toBeFocused();
  expect(await measureItemContrast(page, focusItem, `sidepanel ${theme} focus`)).toBeGreaterThanOrEqual(4.5);
}

const panel = (page: Page) => page.locator("agent-chat-panel:not([hidden])");
const folderBtn = (page: Page) => panel(page).locator('.composer-controls [data-attachment-provider="folder"]');
const imageBtn = (page: Page) => panel(page).locator('.composer-controls [data-attachment-provider="image"]');
const menuItems = (page: Page) => panel(page).locator('wa-menu.wa-attach-menu button[role="menuitem"]');
const chips = (page: Page) => panel(page).locator('[data-attachment-slot="folder"] .wa-folder-chip');
const sentChips = (page: Page) => panel(page).locator('agent-message-view .attachment-chips [data-attachment-provider="folder"]');

test.describe("attach-folder mock suite", () => {
  test("1. the folder button is in the composer row with attach file; the image button still opens the file chooser", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await expect(folderBtn(page)).toBeVisible();
    await expect(imageBtn(page)).toBeVisible();

    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), imageBtn(page).click()]);
    expect(await chooser.element().getAttribute("accept")).toBe("image/*");
    await page.keyboard.press("Escape");

    await page.locator("#agent-combo").click();
    await page.locator("#agent-option-chromagent").click();
    await expect(folderBtn(page)).toBeVisible();
  });

  test("2. the menu offers read only and read and write", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await folderBtn(page).click();
    await expect(menuItems(page)).toHaveText(["Attach folder (read only)", "Attach folder (read and write)"]);

    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "wa2-light");
    await page.screenshot({ path: path.join(ARTIFACTS, "sidepanel-menu-light.png") });
    await captureItemStates(page, menuItems(page).nth(1), menuItems(page).nth(0), "light");

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "wa2-dark");
    await page.screenshot({ path: path.join(ARTIFACTS, "sidepanel-menu-dark.png") });
    await captureItemStates(page, menuItems(page).nth(1), menuItems(page).nth(0), "dark");

    await page.keyboard.press("Escape");
    await expect(panel(page).locator("wa-menu.wa-attach-menu")).not.toHaveAttribute("open");
  });

  test("2b. the header menu, which uses the same wa-menu, shows a hover layer", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    for (const [scheme, theme] of [["light", "wa2-light"], ["dark", "wa2-dark"]] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await panel(page).locator("#menu-anchor").click();
      const items = panel(page).locator('wa-menu[anchor-id="menu-anchor"] button[role="menuitem"]');
      await expect(items.first()).toBeVisible();
      await items.first().hover();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(ARTIFACTS, `sidepanel-headermenu-hover-${scheme}.png`) });
      await page.keyboard.press("Escape");
      await expect(items.first()).toBeHidden();
    }
  });

  test("3. read only attaches /share/reports with a chip; Send stays disabled", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "reports", {
      "q3-sales.csv": "quarter,sales\nQ3,120000\n",
      "q3-costs.csv": "quarter,costs\nQ3,45000\n",
      "q3-headcount.csv": "quarter,headcount\nQ3,24\n",
    });
    await page.evaluate(() => { window.__PICK_NEXT__ = "reports"; });
    await folderBtn(page).click();
    await menuItems(page).nth(0).click();

    await expect(chips(page).first()).toContainText("/share/reports · read only");
    const calls = await page.evaluate(() => window.__PICKER_CALLS__);
    expect(calls).toEqual([{ mode: "read" }]);

    const mounts = await page.evaluate(() => window.__WA_VFS_PROOF__?.tesagent?.provider?.vfs?.mounts());
    expect(mounts?.find((m) => m.prefix === "/share/reports")).toMatchObject({
      prefix: "/share/reports",
      writable: false,
      external: true,
    });

    const sendBtn = panel(page).locator('wa-icon-button[label="Send"]');
    const disabled = await sendBtn.evaluate((el: HTMLElement & { disabled?: boolean }) => el.disabled ?? el.hasAttribute("disabled"));
    expect(disabled).toBe(true);
  });

  test("4. read and write shows its mode; a second reports mounts -2", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "reports", { "q3-sales.csv": "a" });
    await seed(page, "site", { "old.css": "body { margin: 0; }" });

    await page.evaluate(() => { window.__PICK_NEXT__ = "reports"; });
    await folderBtn(page).click();
    await menuItems(page).nth(0).click();
    await expect(chips(page).filter({ hasText: "/share/reports · read only" })).toBeVisible();

    await page.evaluate(() => { window.__PICK_NEXT__ = "site"; });
    await folderBtn(page).click();
    await menuItems(page).nth(1).click();
    await expect(chips(page).filter({ hasText: "/share/site · read and write" })).toBeVisible();

    const calls = await page.evaluate(() => window.__PICKER_CALLS__);
    expect(calls?.[calls.length - 1]).toEqual({ mode: "readwrite" });

    await page.evaluate(() => { window.__PICK_NEXT__ = "reports"; });
    await folderBtn(page).click();
    await menuItems(page).nth(0).click();
    await expect(chips(page).filter({ hasText: "/share/reports-2 · read only" })).toBeVisible();

    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "wa2-light");
    await page.screenshot({ path: path.join(ARTIFACTS, "sidepanel-chips-light.png") });

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "wa2-dark");
    await page.screenshot({ path: path.join(ARTIFACTS, "sidepanel-chips-dark.png") });
  });

  test("5. cancelling the picker attaches nothing", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await page.evaluate(() => { window.__PICK_NEXT__ = "__abort__"; });
    await folderBtn(page).click();
    await menuItems(page).nth(0).click();

    await expect(panel(page).locator('[data-attachment-slot="folder"] .wa-folder-notice')).toHaveText("No folder was attached.");
    const mounts = await page.evaluate(() => window.__WA_VFS_PROOF__?.tesagent?.provider?.vfs?.mounts());
    expect(mounts?.filter((m) => m.prefix.startsWith("/share/"))).toEqual([]);
  });

  test("6. the model gets the attach line; the transcript shows only the typed text and the chip", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "reports", {
      "q3-sales.csv": "quarter,sales\nQ3,120000\n",
      "q3-costs.csv": "quarter,costs\nQ3,45000\n",
      "q3-headcount.csv": "quarter,headcount\nQ3,24\n",
    });
    await page.evaluate(() => { window.__PICK_NEXT__ = "reports"; });
    await folderBtn(page).click();
    await menuItems(page).nth(0).click();
    await expect(chips(page).first()).toContainText("/share/reports · read only");

    await sendMessage(page, "Summarise the Q3 CSVs");
    await expect(panel(page).locator('wa-icon-button[label="Send"]')).toBeVisible();

    const texts = await page.evaluate(() => window.__USER_TEXTS__);
    const lastText = texts?.[texts.length - 1] ?? "";
    expect(lastText).toContain("The user attached the folder /share/reports (read only, 3 files).");
    expect(lastText).toContain("Summarise the Q3 CSVs");

    const userMsg = panel(page).locator("agent-message-view").filter({ hasText: "Summarise the Q3 CSVs" });
    await expect(userMsg).not.toContainText("The user attached");
    await expect(sentChips(page).last()).toHaveText("/share/reports · read only");

    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "wa2-light");
    await page.screenshot({ path: path.join(ARTIFACTS, "sidepanel-sent-light.png") });

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "wa2-dark");
    await page.screenshot({ path: path.join(ARTIFACTS, "sidepanel-sent-dark.png") });
  });

  test("7. an image and a folder both show under the sent message", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "reports", { "q3-sales.csv": "a" });
    await page.evaluate(() => { window.__PICK_NEXT__ = "reports"; });
    await folderBtn(page).click();
    await menuItems(page).nth(0).click();
    await expect(chips(page).first()).toContainText("/share/reports · read only");

    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), imageBtn(page).click()]);
    await chooser.setFiles(RAINBOW_PNG);

    await sendMessage(page, "Look");
    await expect(panel(page).locator('wa-icon-button[label="Send"]')).toBeVisible();

    const userMsg = panel(page).locator("agent-message-view").filter({ hasText: "Look" });
    await expect(userMsg.locator('.attachment-chips [data-attachment-provider="image"]')).toBeVisible();
    await expect(userMsg.locator('.attachment-chips [data-attachment-provider="folder"]')).toBeVisible();
  });

  test("8. a message sent while the agent runs keeps the folder chip", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "reports", { "q3-sales.csv": "a" });
    await page.evaluate(() => {
      window.__SLOW_ONCE__ = true;
      window.__PICK_NEXT__ = "reports";
    });

    const inputArea = page.locator("agent-chat-panel:not([hidden]) #input");
    await inputArea.click();
    await page.keyboard.type("first");
    await page.keyboard.press("Enter");
    await expect(panel(page).locator('wa-icon-button[label="Stop"]')).toBeVisible();

    await folderBtn(page).click();
    await menuItems(page).nth(0).click();
    await expect(chips(page).first()).toContainText("/share/reports · read only");

    await inputArea.click();
    await page.keyboard.type("second");
    await page.keyboard.press("Enter");

    await expect(panel(page).locator('wa-icon-button[label="Send"]')).toBeVisible({ timeout: 10000 });

    const secondMsg = panel(page).locator("agent-message-view").filter({ hasText: "second" });
    await expect(secondMsg.locator('.attachment-chips [data-attachment-provider="folder"]')).toBeVisible();
    await expect(secondMsg).not.toContainText("The user attached");

    const texts = await page.evaluate(() => window.__USER_TEXTS__);
    const secondText = texts?.find((t) => t.includes("second"));
    expect(secondText).toContain("The user attached the folder /share/reports");
  });

  test("9. × removes the folder; the next message says so; read_file says it does not exist", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "reports", { "q3-sales.csv": "quarter,sales\nQ3,120000\n" });
    await page.evaluate(() => { window.__PICK_NEXT__ = "reports"; });
    await folderBtn(page).click();
    await menuItems(page).nth(0).click();

    await sendMessage(page, "one");
    await expect(panel(page).locator('wa-icon-button[label="Send"]')).toBeVisible();

    await panel(page).locator('button[aria-label="Remove /share/reports"]').click();
    await expect(chips(page)).toHaveCount(0);

    await page.evaluate(() => {
      window.__PLAN__ = [{ name: "read_file", input: { file_path: "/share/reports/q3-sales.csv" } }];
    });

    await sendMessage(page, "two");
    await expect(panel(page).locator('wa-icon-button[label="Send"]')).toBeVisible();

    const texts = await page.evaluate(() => window.__USER_TEXTS__);
    const twoText = texts?.find((t) => t.includes("two"));
    expect(twoText).toContain("The user removed the folder /share/reports.");

    const toolResults = await page.evaluate(() => window.__TOOL_RESULTS__);
    expect(toolResults?.[0]).toMatchObject({ tool: "read_file", isError: true });
    expect(toolResults?.[0]?.text).toContain("does not exist");
  });

  test("10. attach and remove before a send adds nothing", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "reports", { "q3-sales.csv": "a" });
    await page.evaluate(() => { window.__PICK_NEXT__ = "reports"; });
    await folderBtn(page).click();
    await menuItems(page).nth(0).click();
    await expect(chips(page)).toHaveCount(1);

    await panel(page).locator('button[aria-label="Remove /share/reports"]').click();
    await expect(chips(page)).toHaveCount(0);

    await sendMessage(page, "three");
    await expect(panel(page).locator('wa-icon-button[label="Send"]')).toBeVisible();

    const texts = await page.evaluate(() => window.__USER_TEXTS__);
    const threeText = texts?.[texts.length - 1];
    expect(threeText).toContain('<agents-md path="/home/agent/AGENTS.md">');
    expect(threeText).not.toContain("The user attached the folder");
    expect(threeText).not.toContain("The user removed the folder");
    expect(threeText?.replace(/<agents-md[^>]*>[\s\S]*?<\/agents-md>\s*/, "").trim()).toBe("three");
  });

  test("11. a reload mounts a remembered folder again at the same path with no picker", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "reports", { "q3-sales.csv": "a" });
    await page.evaluate(() => { window.__PICK_NEXT__ = "reports"; });
    await folderBtn(page).click();
    await menuItems(page).nth(0).click();
    await expect(chips(page)).toHaveCount(1);

    await page.reload();
    await page.locator("#agent-combo").click();
    await page.locator("#agent-option-tesagent").click();

    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toContainText("/share/reports · read only");
    expect(await page.evaluate(() => window.__PICKER_CALLS__)).toEqual([]);
    const mounts = await page.evaluate(() => window.__WA_VFS_PROOF__?.tesagent?.provider?.vfs?.mounts());
    expect(mounts?.filter((m) => m.prefix.startsWith("/share/")).map((m) => m.prefix)).toEqual(["/share/reports"]);
  });

  test("12. without showDirectoryPicker the menu offers the read-only copy, and it goes through the real webkitdirectory input", async ({ context, extensionId }) => {
    const fixtureDir = path.resolve(HERE, "../test-results/attach-folder-fixtures/reports");
    await fs.mkdir(fixtureDir, { recursive: true });
    await fs.mkdir(path.join(fixtureDir, ".git"), { recursive: true });
    await fs.writeFile(path.join(fixtureDir, "a.csv"), "x,y\n1,2\n");
    await fs.writeFile(path.join(fixtureDir, "b.xlsx"), "not a sheet");
    await fs.writeFile(path.join(fixtureDir, ".git/config"), "[core]\n");

    const page = await context.newPage();
    await page.addInitScript(installMockScript);
    await page.addInitScript(installPickerStandIn);
    await page.addInitScript(() => {
      Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true, writable: true });
    });
    await page.setViewportSize({ width: 400, height: 700 });
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await page.locator("#agent-combo").click();
    await page.locator("#agent-option-tesagent").click();
    await page.waitForFunction(() => window.__WA_VFS_PROOF__?.tesagent !== undefined);

    await folderBtn(page).click();
    expect(await menuItems(page).allTextContents()).toEqual(["Attach folder (read-only copy)"]);

    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), menuItems(page).first().click()]);
    await chooser.element().setInputFiles(fixtureDir);

    await expect(chips(page).first()).toContainText("/share/reports · read only");

    const vfsList = await page.evaluate(async () => {
      const vfs = window.__WA_VFS_PROOF__?.tesagent?.provider?.vfs;
      return (await vfs.list("/share/reports")).map((e: { abs: string }) => e.abs);
    });
    expect(vfsList).toEqual(["/share/reports/a.csv"]);

    await page.evaluate(() => {
      window.__PLAN__ = [
        { name: "write_file", input: { file_path: "/share/reports/n.txt", content: "x" } },
        { name: "edit_file", input: { file_path: "/share/reports/a.csv", old_string: "x", new_string: "z" } },
        { name: "delete_file", input: { file_path: "/share/reports/a.csv" } },
        { name: "move_file", input: { source_path: "/share/reports/a.csv", destination_path: "/tmp/a.csv" } },
      ];
    });

    await sendMessage(page, "go");
    await expect(panel(page).locator('wa-icon-button[label="Send"]')).toBeVisible();

    const toolResults = await page.evaluate(() => window.__TOOL_RESULTS__);
    expect(toolResults).toHaveLength(4);
    for (const tr of toolResults!) {
      expect(tr.isError).toBe(true);
      expect(tr.text).toContain("is read-only. The user attached /share/reports read only.");
    }
  });

  test("13. an agent whose profile excludes read_file has no folder button", async () => {
    const dir = path.resolve(TEMP_DIR, "exclude-read-file");
    const brand = JSON.parse(await fs.readFile(path.join(EXT, "brand.json"), "utf8"));
    brand.agents = brand.agents.map((a: any) =>
      a.id === "chromagent" ? { ...a, excludeTools: ["read_file"] } : a,
    );
    await patchedBrand(dir, brand);
    const { ctx, extensionId } = await launchPatchedContext(dir);
    try {
      const page = await ctx.newPage();
      await page.addInitScript(installMockScript);
      await page.addInitScript(installPickerStandIn);
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
      await page.waitForFunction(
        () => (document.querySelector("agent-chat-panel:not([hidden])") as unknown as { _state?: { activeSessionId?: string } })?._state?.activeSessionId !== undefined,
      );
      await expect(panel(page).locator('.composer-controls [data-attachment-provider="image"]')).toBeVisible();
      await expect(panel(page).locator('.composer-controls [data-attachment-provider="folder"]')).toHaveCount(0);

      await page.locator("#agent-combo").click();
      await page.locator("#agent-option-tesagent").click();
      await page.waitForFunction(() => window.__WA_VFS_PROOF__?.tesagent !== undefined);
      await expect(folderBtn(page)).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("14. the in-page agent shows the folder button", async ({ context }) => {
    const worker = await getWorker(context);
    const page = await context.newPage();
    await worker.evaluate(() => chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] }));
    await page.goto("http://localhost:10040/plain.html");
    await page.locator("web-agent-bubble #launcher").click();
    await expect(page.locator("web-agent-bubble agent-chat-panel #input")).toBeVisible();

    const bubblePanel = page.locator("web-agent-bubble agent-chat-panel");
    await expect(bubblePanel.locator('.composer-controls [data-attachment-provider="folder"]')).toBeVisible();
    await expect(bubblePanel.locator('.composer-controls [data-attachment-provider="image"]')).toBeVisible();

    await page.screenshot({ path: path.join(ARTIFACTS, "inpage-composer.png") });
  });
});
