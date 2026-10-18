import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect } from "./extension.fixture";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";

// 127/007 — the remembered shared folder. Real extension, real IndexedDB, real
// vfs and seed. The model is scripted; the folder picker is an OPFS stand-in;
// queryPermission/requestPermission are stubbed so each permission state can be
// reached without a browser restart.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STARTER_PATH = path.resolve(HERE, "../brand/agents/tesagent.home/AGENTS.md");

function installStandIns(): void {
  window.__WA_ENABLE_VFS_PROOF__ = true;
  window.__USER_TEXTS__ = [];
  window.__PICKER_CALLS__ = [];
  window.__PERM_CALLS__ = [];
  window.__WA_MOCK_SCRIPT__ = (opts) => {
    const last = opts.messages[opts.messages.length - 1];
    let text = "";
    if (typeof last?.content === "string") text = last.content;
    else if (Array.isArray(last?.content)) {
      text = (last.content as { type?: string; text?: string }[])
        .filter((p) => p && p.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("\n");
    }
    if (text.includes("Summarize the following conversation as a short UI title")) return { text: "Folder test" };
    if (last?.role === "user" && text) window.__USER_TEXTS__!.push(text);
    return { text: "Reply: done" };
  };
  (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async (o: { mode?: string }) => {
    window.__PICKER_CALLS__!.push(o);
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(window.__PICK_NEXT__ ?? "ws", { create: true });
  };
  // Permission states survive a reload through localStorage.
  const proto = FileSystemHandle.prototype as unknown as {
    queryPermission: (d: { mode: string }) => Promise<string>;
    requestPermission: (d: { mode: string }) => Promise<string>;
  };
  proto.queryPermission = function (d) {
    window.__PERM_CALLS__!.push({ kind: "query", mode: d.mode, active: navigator.userActivation.isActive });
    return Promise.resolve(localStorage.getItem("__E2E_QUERY__") ?? "granted");
  };
  proto.requestPermission = function (d) {
    window.__PERM_CALLS__!.push({ kind: "request", mode: d.mode, active: navigator.userActivation.isActive });
    return Promise.resolve(localStorage.getItem("__E2E_REQUEST__") ?? "granted");
  };
}

async function openAgent(context: BrowserContext, extensionId: string, id: "tesagent" | "chromagent"): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(installStandIns);
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.locator("#agent-combo").click();
  await page.locator(`#agent-option-${id}`).click();
  await page.waitForFunction((a) => window.__WA_VFS_PROOF__?.[a] !== undefined, id);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true });
    localStorage.removeItem("__E2E_QUERY__");
    localStorage.removeItem("__E2E_REQUEST__");
  });
  return page;
}

async function reopen(page: Page, id: "tesagent" | "chromagent"): Promise<void> {
  await page.reload();
  await page.locator("#agent-combo").click();
  await page.locator(`#agent-option-${id}`).click();
  await page.waitForFunction((a) => window.__WA_VFS_PROOF__?.[a] !== undefined, id);
}

/** Creates /<dir> in OPFS with these files (an empty map makes an empty folder). */
async function seedDir(page: Page, dir: string, files: Record<string, string>): Promise<void> {
  await page.evaluate(async ({ dir, files }) => {
    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle(dir, { create: true });
    for (const [rel, body] of Object.entries(files)) {
      const parts = rel.split("/");
      let d = base;
      for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
      const w = await (await d.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
      await w.write(body);
      await w.close();
    }
  }, { dir, files });
}

/** The text of /<dir>/AGENTS.md in OPFS, or null when there is none. */
async function readOpfs(page: Page, dir: string): Promise<string | null> {
  return page.evaluate(async (d) => {
    const root = await navigator.storage.getDirectory();
    try {
      const h = await (await root.getDirectoryHandle(d)).getFileHandle("AGENTS.md");
      return await (await h.getFile()).text();
    } catch {
      return null;
    }
  }, dir);
}

const panel = (page: Page) => page.locator("agent-chat-panel:not([hidden])");
const folderBtn = (page: Page) => panel(page).locator('.composer-controls [data-attachment-provider="folder"]');
const menuItems = (page: Page) => panel(page).locator('wa-menu.wa-attach-menu button[role="menuitem"]');
const chips = (page: Page) => panel(page).locator('[data-attachment-slot="folder"] .wa-folder-chip');

async function attach(page: Page, dir: string, which: "ro" | "rw"): Promise<void> {
  await page.evaluate((d) => { window.__PICK_NEXT__ = d; }, dir);
  await folderBtn(page).click();
  await menuItems(page).nth(which === "ro" ? 0 : 1).click();
}

async function send(page: Page, text: string): Promise<string> {
  const before = await page.evaluate(() => window.__USER_TEXTS__?.length ?? 0);
  await panel(page).locator("#input").click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await page.waitForFunction((count) => (window.__USER_TEXTS__?.length ?? 0) > count, before);
  await expect(panel(page).locator('wa-icon-button[label="Send"]')).toBeVisible();
  const texts = await page.evaluate(() => window.__USER_TEXTS__ ?? []);
  return texts[texts.length - 1] ?? "";
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(name) });
}

async function shareMounts(page: Page, id = "tesagent"): Promise<string[]> {
  return page.evaluate((id) => window.__WA_VFS_PROOF__?.[id]?.provider?.vfs?.mounts()
    .filter((m) => m.prefix.startsWith("/share/")).map((m) => m.prefix) ?? [], id);
}
async function attachWs(page: Page): Promise<void> {
  await seedDir(page, "ws", {});
  await attach(page, "ws", "rw");
  await expect(chips(page).first()).toContainText("/share/ws · read and write");
  // Wait for the write to close before reloading or deleting the directory.
  const starter = await fs.readFile(STARTER_PATH, "utf8");
  await expect.poll(() => readOpfs(page, "ws")).toBe(starter);
}

test("rw attach in Tesagent seeds the starter; a reload remounts with no picker", async ({ context, extensionId }, testInfo) => {
  const page = await openAgent(context, extensionId, "tesagent");
  await attachWs(page);
  expect(await readOpfs(page, "ws")).toBe(await fs.readFile(STARTER_PATH, "utf8"));
  await page.waitForFunction(() => !navigator.userActivation.isActive);
  const client = await context.newCDPSession(page);
  await page.reload();
  // Playwright evaluations simulate gestures. Observe the passive query without one.
  try {
    await expect.poll(async () => {
      const response = await client.send("Runtime.evaluate", {
        expression: "Boolean(window.__PERM_CALLS__?.some((call) => call.kind === 'query'))",
        returnByValue: true,
        userGesture: false,
      });
      return response.result.value === true;
    }).toBe(true);
  } finally {
    await client.detach();
  }
  await expect(chips(page).first()).toContainText("/share/ws · read and write");
  expect(await page.evaluate(() => window.__PICKER_CALLS__)).toEqual([]);
  expect(await shareMounts(page)).toEqual(["/share/ws"]);
  expect(await page.evaluate(() => window.__PERM_CALLS__)).toContainEqual({ kind: "query", mode: "readwrite", active: false });
  await shot(page, testInfo, "remounted-light.png");
});

test("the first message of a new chat lists the folder and carries its AGENTS.md", async ({ context, extensionId }) => {
  const page = await openAgent(context, extensionId, "tesagent");
  await attachWs(page);
  await reopen(page, "tesagent");
  await expect(chips(page)).toHaveCount(1);
  const t = await send(page, "hello");
  expect(t).toContain("Attached folder: /share/ws (read and write).");
  expect(t).toContain('<agents-md path="/share/ws/AGENTS.md">');
  expect(t.indexOf('<agents-md path="/home/agent/AGENTS.md">')).toBeLessThan(t.indexOf('<agents-md path="/share/ws/AGENTS.md">'));
  expect(t).not.toContain("The user attached the folder");
  await expect(panel(page).locator("agent-message-view").filter({ hasText: "hello" })).not.toContainText("Attached folder");
  expect(await send(page, "again")).not.toContain("Attached folder");
});

test("a folder with an AGENTS.md keeps it byte for byte; read only gets nothing", async ({ context, extensionId }) => {
  const page = await openAgent(context, extensionId, "tesagent");
  const body = "# Team rules\n\n- keep me\n";
  await seedDir(page, "team", { "AGENTS.md": body });
  await attach(page, "team", "rw");
  await expect(chips(page)).toHaveCount(1);
  expect(await readOpfs(page, "team")).toBe(body);
  await seedDir(page, "ro", {});
  await attach(page, "ro", "ro");
  await expect(chips(page)).toHaveCount(2);
  expect(await readOpfs(page, "ro")).toBeNull();
});

test("needs permission: the chip shows Allow; Allow mounts at the same path", async ({ context, extensionId }, testInfo) => {
  const page = await openAgent(context, extensionId, "tesagent");
  await attachWs(page);
  await page.evaluate(() => localStorage.setItem("__E2E_QUERY__", "prompt"));
  await reopen(page, "tesagent");
  await expect(chips(page)).toContainText("ws · needs permission");
  const allow = chips(page).getByRole("button", { name: "Allow access to ws" });
  await expect(allow).toBeVisible();
  expect(await shareMounts(page)).toEqual([]);
  expect(await send(page, "hi")).toContain("Folder ws needs the user to allow access.");
  await shot(page, testInfo, "needs-permission-light.png");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, testInfo, "needs-permission-dark.png");
  await page.emulateMedia({ colorScheme: "light" });
  await allow.click();
  await expect(chips(page)).toContainText("/share/ws · read and write");
  expect(await shareMounts(page)).toEqual(["/share/ws"]);
  expect((await page.evaluate(() => window.__PERM_CALLS__))?.at(-1)).toEqual({ kind: "request", mode: "readwrite", active: true });
  expect(await send(page, "next")).toContain("The user attached the folder /share/ws (read and write, 1 files).");
});

test("Allow refused: the chip stays and the notice says so", async ({ context, extensionId }) => {
  const page = await openAgent(context, extensionId, "tesagent");
  await attachWs(page);
  await page.evaluate(() => { localStorage.setItem("__E2E_QUERY__", "prompt"); localStorage.setItem("__E2E_REQUEST__", "denied"); });
  await reopen(page, "tesagent");
  await chips(page).getByRole("button", { name: "Allow access to ws" }).click();
  await expect(panel(page).locator(".wa-folder-notice")).toHaveText("Access to ws was not allowed.");
  await expect(chips(page)).toContainText("ws · needs permission");
  expect(await shareMounts(page)).toEqual([]);
});

test("a deleted folder shows unavailable and mounts nothing; × forgets it", async ({ context, extensionId }, testInfo) => {
  const page = await openAgent(context, extensionId, "tesagent");
  await attachWs(page);
  await page.evaluate(async () => (await navigator.storage.getDirectory()).removeEntry("ws", { recursive: true }));
  await reopen(page, "tesagent");
  await expect(chips(page)).toContainText("ws · unavailable");
  await expect(chips(page).getByRole("button", { name: "Allow access to ws" })).toHaveCount(0);
  expect(await shareMounts(page)).toEqual([]);
  await shot(page, testInfo, "unavailable-light.png");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, testInfo, "unavailable-dark.png");
  await chips(page).getByRole("button", { name: "Remove ws" }).click();
  await expect(chips(page)).toHaveCount(0);
  await reopen(page, "tesagent");
  await expect(chips(page)).toHaveCount(0);
});

test("× on a mounted folder: it does not come back after a reload", async ({ context, extensionId }) => {
  const page = await openAgent(context, extensionId, "tesagent");
  await attachWs(page);
  await chips(page).getByRole("button", { name: "Remove /share/ws" }).click();
  await expect(chips(page)).toHaveCount(0);
  await reopen(page, "tesagent");
  await expect(chips(page)).toHaveCount(0);
  expect(await shareMounts(page)).toEqual([]);
});

test("Chromagent remembers its folder and never seeds", async ({ context, extensionId }, testInfo) => {
  const page = await openAgent(context, extensionId, "chromagent");
  await seedDir(page, "cw", {});
  await attach(page, "cw", "rw");
  await expect(chips(page)).toHaveCount(1);
  expect(await readOpfs(page, "cw")).toBeNull();
  await reopen(page, "chromagent");
  await expect(chips(page)).toContainText("/share/cw · read and write");
  expect(await shareMounts(page, "chromagent")).toEqual(["/share/cw"]);
  await shot(page, testInfo, "chromagent-remounted.png");
});
