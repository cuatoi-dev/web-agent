import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Locator, Page, Worker } from "@playwright/test";
import { test, expect } from "./extension.fixture";

// Run-time folder mounts. Real OPFS handles, the real extension, a
// mock model. No handle and no dialog is faked.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.resolve(HERE, "../../../temp/artifacts/vfs-folder-mounts");
const VISIBLE_PANEL = "agent-chat-panel:not([hidden])";

// A valid 1x1 PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

interface PlannedCall {
  name: string;
  input: Record<string, unknown>;
}
interface ToolResult {
  tool: string;
  text: string;
  isError: boolean;
}
interface CallResult {
  content: string;
  isError: boolean;
  image: boolean;
  mediaType?: string;
  asked: Record<string, unknown>[];
}
type Seed = Record<string, string | { b64: string }>;

async function getWorker(context: BrowserContext): Promise<Worker> {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  return worker;
}

/** Self-contained (serialised by addInitScript). The queue pattern of
 *  vfs-extension.mock.spec.ts. */
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
    return { text: results.map((r) => r.text).join("\n") };
  };
}

async function openTesagent(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(installMockScript);
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.locator("#agent-row")).toBeVisible();
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator("#agent-option-tesagent").click();
  await page.waitForFunction(() => window.__WA_VFS_PROOF__?.tesagent !== undefined);
  // Start every case from an empty origin-private root.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true });
  });
  return page;
}

/** Writes files into an OPFS folder (created when absent). A path may contain
 *  folders. Seeds are written through the real handle API. */
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

async function mountFolder(page: Page, dir: string, prefix: string, writable: boolean): Promise<void> {
  await page.evaluate(
    async ({ dir, prefix, writable }) => {
      const hook = window.__WA_VFS_PROOF__!.tesagent;
      const root = await navigator.storage.getDirectory();
      const handle = await root.getDirectoryHandle(dir, { create: true });
      hook.provider.vfs.mount(prefix, hook.directoryBackend(handle, { writable }), { external: true });
    },
    { dir, prefix, writable },
  );
}

/** Runs one file tool directly, with a real ToolContext. `confirm` is how the
 *  host answers: "none" = no callback, true/false = a recording callback. */
async function call(
  page: Page,
  tool: string,
  input: Record<string, unknown>,
  opts: { sid?: string; confirm?: "none" | boolean } = {},
): Promise<CallResult> {
  return page.evaluate(
    async ({ tool, input, sid, confirm }) => {
      const hook = window.__WA_VFS_PROOF__!.tesagent;
      const tools = await hook.provider.load();
      const def = tools.find((t) => t.name === tool);
      if (!def) throw new Error(`no tool ${tool}`);
      const asked: Record<string, unknown>[] = [];
      const ctx: Record<string, unknown> = { sessionId: sid };
      if (confirm !== "none") {
        ctx.confirmInteraction = (d: Record<string, unknown>) => {
          asked.push(d);
          return Promise.resolve(confirm);
        };
      }
      const out = await def.execute(input, ctx as never);
      const o = out as { content: string; isError?: boolean; images?: { mediaType: string }[] };
      return { content: o.content, isError: o.isError === true, image: !!o.images?.length, mediaType: o.images?.[0]?.mediaType, asked };
    },
    { tool, input, sid: opts.sid ?? "s1", confirm: opts.confirm ?? "none" },
  );
}

async function opfsText(page: Page, dir: string, rel: string): Promise<string | null> {
  return page.evaluate(
    async ({ dir, rel }) => {
      try {
        const root = await navigator.storage.getDirectory();
        let d = await root.getDirectoryHandle(dir);
        const parts = rel.split("/");
        for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg);
        const f = await (await d.getFileHandle(parts[parts.length - 1])).getFile();
        return await f.text();
      } catch (e) {
        if ((e as { name?: string }).name === "NotFoundError") return null;
        throw e;
      }
    },
    { dir, rel },
  );
}

async function opfsMtime(page: Page, dir: string, rel: string): Promise<number> {
  return page.evaluate(
    async ({ dir, rel }) => {
      const root = await navigator.storage.getDirectory();
      const d = await root.getDirectoryHandle(dir);
      return (await (await d.getFileHandle(rel)).getFile()).lastModified;
    },
    { dir, rel },
  );
}

async function setPlan(page: Page, plan: PlannedCall[]): Promise<void> {
  await page.evaluate((p) => {
    window.__PLAN__ = p;
    window.__TOOL_RESULTS__ = [];
    window.__SEEN_TOOL_IDS__ = new Set();
  }, plan);
}

async function send(page: Page, text: string): Promise<void> {
  const input = page.locator(`${VISIBLE_PANEL} #input`);
  await input.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

async function toolResults(page: Page, n: number): Promise<ToolResult[]> {
  await page.waitForFunction((count: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= count, n, { timeout: 30_000 });
  return page.evaluate(() => window.__TOOL_RESULTS__ ?? []);
}

async function setTheme(page: Page, theme: "wa2-light" | "wa2-dark"): Promise<void> {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
}

/** Foreground/background contrast of one element, from computed styles. The
 *  background is the first opaque one found walking up through shadow roots. */
async function contrastOf(loc: Locator): Promise<{ fg: string; bg: string; ratio: number }> {
  return loc.evaluate((el) => {
    const toRgb = (css: string): number[] => {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const g = c.getContext("2d")!;
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = css;
      g.fillRect(0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const lum = (rgb: number[]) => {
      const f = (v: number) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
    };
    let bg = [255, 255, 255, 1];
    for (let e: Element | null = el; e; e = e.parentElement ?? ((e.getRootNode() as ShadowRoot).host ?? null)) {
      const c = toRgb(getComputedStyle(e).backgroundColor);
      if (c[3] > 0.95) {
        bg = c;
        break;
      }
    }
    const fg = toRgb(getComputedStyle(el).color);
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return { fg: fg.join(","), bg: bg.join(","), ratio: Number(((hi + 0.05) / (lo + 0.05)).toFixed(2)) };
  });
}

async function openFiles(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Menu options" }).click();
  await page.getByRole("menuitem", { name: "Files" }).click();
  await expect(page.locator("agent-files-screen")).toBeVisible();
}

const OLD_CSS = "body { margin: 0; }\n";

test.describe("VFS folder mounts", () => {
  test.beforeEach(async ({ context }) => {
    const worker = await getWorker(context);
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
    });
  });

  test("1 read only: filtering, numbered read, hidden file, image", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "reports", {
      "a.csv": "region,sales\nAPAC,1200\n",
      "b.xlsx": "binary-ish hidden-marker",
      "c.png": { b64: PNG_B64 },
      ".git/config": "hidden-marker",
      "node_modules/x/index.js": "hidden-marker",
    });
    await mountFolder(page, "reports", "/share/reports", false);
    const glob = await call(page, "glob_files", { pattern: "**/*", path: "/share/reports" });
    const lines = glob.content.split("\n").filter((l) => l.startsWith("/"));
    expect(new Set(lines)).toEqual(new Set(["/share/reports/a.csv", "/share/reports/c.png"]));
    const csv = await call(page, "read_file", { file_path: "/share/reports/a.csv" });
    expect(csv.content).toContain("1\tregion,sales");
    expect(csv.content).toContain("2\tAPAC,1200");
    const xlsx = await call(page, "read_file", { file_path: "/share/reports/b.xlsx" });
    expect(xlsx.content).toBe("Error: /share/reports/b.xlsx does not exist.");
    const png = await call(page, "read_file", { file_path: "/share/reports/c.png" });
    expect(png.image).toBe(true);
    expect(png.mediaType).toBe("image/png");
    const bytes = await page.evaluate(async () => {
      const hook = window.__WA_VFS_PROOF__!.tesagent;
      const f = await hook.provider.vfs.get("/share/reports/c.png");
      return f?.content;
    });
    expect(bytes).toBe(PNG_B64);
  });

  test("2 read only: search never matches hidden files", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "reports", {
      "a.csv": "region,sales\nAPAC,1200\n",
      "b.xlsx": "hidden-marker",
      ".git/config": "hidden-marker",
      "node_modules/x/index.js": "hidden-marker",
    });
    await mountFolder(page, "reports", "/share/reports", false);
    const none = await call(page, "search_files", { pattern: "hidden-marker", path: "/share/reports" });
    expect(none.content).not.toContain("/share/reports/");
    const apac = await call(page, "search_files", { pattern: "APAC", path: "/share/reports" });
    expect(apac.content).toContain("/share/reports/a.csv");
    expect(apac.content).not.toContain("b.xlsx");
  });

  test("3 read only: every change is refused and nothing asks", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "reports", { "a.csv": "x\n" });
    await mountFolder(page, "reports", "/share/reports", false);
    const msg = (p: string) =>
      `Error: ${p} is read-only. The user attached /share/reports read only. Writable paths: /tmp, /home/agent, /home/shared.`;
    const w = await call(page, "write_file", { file_path: "/share/reports/a.csv", content: "y" }, { confirm: true });
    const e = await call(page, "edit_file", { file_path: "/share/reports/a.csv", old_string: "x", new_string: "y" }, { confirm: true });
    const d = await call(page, "delete_file", { file_path: "/share/reports/a.csv" }, { confirm: true });
    const m = await call(page, "move_file", { source_path: "/share/reports/a.csv", destination_path: "/home/agent/a.csv" }, { confirm: true });
    expect(w.content).toBe(msg("/share/reports/a.csv"));
    expect(e.content).toBe(msg("/share/reports/a.csv"));
    expect(d.content).toBe(msg("/share/reports/a.csv"));
    expect(m.content).toBe(msg("/share/reports/a.csv"));
    await call(page, "write_file", { file_path: "/home/agent/h.md", content: "h" });
    const into = await call(page, "move_file", { source_path: "/home/agent/h.md", destination_path: "/share/reports/h.md" }, { confirm: true });
    expect(into.content).toBe(msg("/share/reports/h.md"));
    for (const r of [w, e, d, m, into]) {
      expect(r.isError).toBe(true);
      expect(r.asked).toHaveLength(0);
      expect(r.content).not.toMatch(/Writable paths:.*\/share\/reports/);
    }
    expect(await opfsText(page, "reports", "a.csv")).toBe("x\n");
  });

  test("4 read and write: create, edit, own-write freshness, AGENTS.md block", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "site", { "AGENTS.md": "Site rules", "docs/page.md": "page" });
    await mountFolder(page, "site", "/share/site", true);
    const created = await call(page, "write_file", { file_path: "/share/site/new.md", content: "hello\n" });
    expect(created.content).toBe("File created successfully at: /share/site/new.md");
    expect(await opfsText(page, "site", "new.md")).toBe("hello\n");
    const edit1 = await call(page, "edit_file", { file_path: "/share/site/new.md", old_string: "hello", new_string: "hi" });
    expect(edit1.isError).toBe(false);
    expect(await opfsText(page, "site", "new.md")).toBe("hi\n");
    const edit2 = await call(page, "edit_file", { file_path: "/share/site/new.md", old_string: "hi", new_string: "hey" });
    expect(edit2.isError).toBe(false);
    expect(await opfsText(page, "site", "new.md")).toBe("hey\n");
    // AGENTS.md: the ancestor block is emitted once for a chat.
    const first = await call(page, "read_file", { file_path: "/share/site/docs/page.md" }, { sid: "agents-chat" });
    expect(first.content).toContain('<agents-md path="/share/site/AGENTS.md">');
    const second = await call(page, "read_file", { file_path: "/share/site/docs/page.md" }, { sid: "agents-chat" });
    expect(second.content).not.toContain("<agents-md");
    await page.waitForTimeout(25);
    await seed(page, "site", { "AGENTS.md": "Site rules v2" });
    const third = await call(page, "read_file", { file_path: "/share/site/docs/page.md" }, { sid: "agents-chat" });
    expect(third.content).toContain("Site rules v2");
  });

  test("5 changed on disk: write and edit need a fresh read", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "site", { "w.md": "one\n", "e.md": "one\n" });
    await mountFolder(page, "site", "/share/site", true);
    const err = (p: string) => `Error: ${p} changed on disk since you read it. Read it again with read_file.`;
    for (const op of ["write", "edit"] as const) {
      const name = op === "write" ? "w.md" : "e.md";
      const p = `/share/site/${name}`;
      await call(page, "read_file", { file_path: p });
      const readMtime = await opfsMtime(page, "site", name);
      await page.waitForTimeout(25);
      await seed(page, "site", { [name]: "changed elsewhere\n" });
      expect(await opfsMtime(page, "site", name), "fixture: the disk time must advance").toBeGreaterThan(readMtime);
      const input =
        op === "write"
          ? { file_path: p, content: "mine\n" }
          : { file_path: p, old_string: "changed", new_string: "mine" };
      const blocked = await call(page, op === "write" ? "write_file" : "edit_file", input);
      expect(blocked.content).toBe(err(p));
      expect(await opfsText(page, "site", name)).toBe("changed elsewhere\n");
      await call(page, "read_file", { file_path: p });
      const ok = await call(page, op === "write" ? "write_file" : "edit_file", input);
      expect(ok.isError).toBe(false);
    }
  });

  test("6 writes: binary rejection, PNG, nested text, extensions, lookups", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "site", { "keep.md": "k", ".git/config": "g" });
    await mountFolder(page, "site", "/share/site", true);
    const bad = await call(page, "write_file", {
      file_path: "/share/site/x.bin", content: "AAEC", encoding: "base64", mime_type: "application/octet-stream",
    });
    expect(bad.content).toBe("Error: Only text files and PNG, JPEG, GIF or WebP images can be written.");
    expect(await opfsText(page, "site", "x.bin")).toBeNull();
    const png = await call(page, "write_file", {
      file_path: "/share/site/img/p.png", content: PNG_B64, encoding: "base64", mime_type: "image/png",
    });
    expect(png.isError).toBe(false);
    const meta = await page.evaluate(async () => {
      const hook = window.__WA_VFS_PROOF__!.tesagent;
      const f = await hook.provider.vfs.get("/share/site/img/p.png");
      const entries = await hook.provider.vfs.list("/share/site/img");
      const root = await navigator.storage.getDirectory();
      const site = await root.getDirectoryHandle("site");
      const img = await site.getDirectoryHandle("img");
      const disk = await (await img.getFileHandle("p.png")).getFile();
      return { content: f?.content, mime: f?.mimeType, mtime: f?.mtimeMs, size: entries[0]?.size, diskMtime: disk.lastModified, diskSize: disk.size };
    });
    expect(meta.content).toBe(PNG_B64);
    expect(meta.mime).toBe("image/png");
    expect(meta.mtime).toBe(meta.diskMtime);
    expect(meta.size).toBe(meta.diskSize);
    const nested = await call(page, "write_file", { file_path: "/share/site/a/b/c.TXT", content: "deep" });
    expect(nested.isError).toBe(false);
    expect(await opfsText(page, "site", "a/b/c.TXT")).toBe("deep");
    const svg = await call(page, "write_file", { file_path: "/share/site/d.svg", content: "<svg/>" });
    expect(svg.isError).toBe(false);
    const hidden = await call(page, "read_file", { file_path: "/share/site/.git/config" });
    expect(hidden.content).toBe("Error: /share/site/.git/config does not exist.");
    const missing = await call(page, "read_file", { file_path: "/share/site/nope/x.md" });
    expect(missing.content).toBe("Error: /share/site/nope/x.md does not exist.");
    const wrongKind = await call(page, "read_file", { file_path: "/share/site/keep.md/x" });
    expect(wrongKind.content).toBe("Error: /share/site/keep.md/x does not exist.");
    expect(await opfsText(page, "site", "nope/x.md")).toBeNull();
  });

  test("7 delete: dialog wording, Cancel, Delete, no callback", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "site", { "old.css": OLD_CSS });
    await mountFolder(page, "site", "/share/site", true);
    const dialogContrast: Record<string, Record<string, { fg: string; bg: string; ratio: number }>> = {};
    for (const theme of ["wa2-light", "wa2-dark"] as const) {
      await setTheme(page, theme);
      await setPlan(page, [{ name: "delete_file", input: { file_path: "/share/site/old.css" } }]);
      await send(page, "Delete the old stylesheet");
      const card = page.locator(`${VISIBLE_PANEL} .wa-confirm-card`);
      await expect(card).toBeVisible();
      await expect(card.locator("h3")).toHaveText("Delete old.css from your disk?");
      await expect(card).toContainText("The agent wants to delete /share/site/old.css. This cannot be undone.");
      await expect(card.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
      await fs.mkdir(ARTIFACTS, { recursive: true });
      await page.screenshot({ path: path.join(ARTIFACTS, `delete-confirm-${theme}.png`) });
      dialogContrast[theme] = {
        title: await contrastOf(card.locator("h3")),
        body: await contrastOf(card.locator("p").first()),
        cancel: await contrastOf(card.getByRole("button", { name: "Cancel", exact: true })),
        delete: await contrastOf(card.getByRole("button", { name: "Delete", exact: true })),
      };
      await card.getByRole("button", { name: "Cancel", exact: true }).click();
      const [cancelled] = await toolResults(page, 1);
      expect(cancelled.text).toBe("Deleting /share/site/old.css was not confirmed by the user; not performed.");
      expect(await opfsText(page, "site", "old.css")).toBe(OLD_CSS);
    }
    await fs.writeFile(path.join(ARTIFACTS, "contrast-dialog.json"), JSON.stringify(dialogContrast, null, 2));
    await setPlan(page, [{ name: "delete_file", input: { file_path: "/share/site/old.css" } }]);
    await send(page, "Delete the old stylesheet again");
    const card = page.locator(`${VISIBLE_PANEL} .wa-confirm-card`);
    await card.getByRole("button", { name: "Delete", exact: true }).click();
    const [deleted] = await toolResults(page, 1);
    expect(deleted.text).toBe("Deleted /share/site/old.css.");
    expect(await opfsText(page, "site", "old.css")).toBeNull();
    const glob = await call(page, "glob_files", { pattern: "**/*", path: "/share/site" });
    expect(glob.content).not.toContain("old.css");
    await seed(page, "site", { "again.css": OLD_CSS });
    const blind = await call(page, "delete_file", { file_path: "/share/site/again.css" }, { confirm: "none" });
    expect(blind.content).toBe("Error: deleting /share/site/again.css needs the user's confirmation, and this app cannot ask. Not performed.");
    expect(await opfsText(page, "site", "again.css")).toBe(OLD_CSS);
  });

  test("8 move: confirm for either end, Cancel, no callback, early failures", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "site", { "a.md": "a", "taken.md": "t" });
    await seed(page, "reports", { "r.csv": "r\n" });
    await mountFolder(page, "site", "/share/site", true);
    await mountFolder(page, "reports", "/share/reports", false);
    await call(page, "write_file", { file_path: "/home/agent/x.md", content: "x" });
    const cancelled = await call(page, "move_file", { source_path: "/share/site/a.md", destination_path: "/share/site/b.md" }, { confirm: false });
    expect(cancelled.content).toBe("Moving /share/site/a.md was not confirmed by the user; not performed.");
    expect(await opfsText(page, "site", "a.md")).toBe("a");
    expect(await opfsText(page, "site", "b.md")).toBeNull();
    const blind = await call(page, "move_file", { source_path: "/share/site/a.md", destination_path: "/share/site/b.md" });
    expect(blind.content).toBe("Error: moving /share/site/a.md needs the user's confirmation, and this app cannot ask. Not performed.");
    // Through the real dialog.
    await setPlan(page, [{ name: "move_file", input: { source_path: "/share/site/a.md", destination_path: "/share/site/b.md" } }]);
    await send(page, "Rename a to b");
    const card = page.locator(`${VISIBLE_PANEL} .wa-confirm-card`);
    await expect(card.locator("h3")).toHaveText("Move a.md on your disk?");
    await expect(card).toContainText("The agent wants to move /share/site/a.md to /share/site/b.md.");
    await card.getByRole("button", { name: "Move", exact: true }).click();
    const [moved] = await toolResults(page, 1);
    expect(moved.text).toBe("Moved /share/site/a.md to /share/site/b.md.");
    expect(await opfsText(page, "site", "a.md")).toBeNull();
    expect(await opfsText(page, "site", "b.md")).toBe("a");
    const into = await call(page, "move_file", { source_path: "/home/agent/x.md", destination_path: "/share/site/x.md" }, { confirm: true });
    expect(into.asked).toHaveLength(1);
    expect(await opfsText(page, "site", "x.md")).toBe("x");
    const out = await call(page, "move_file", { source_path: "/share/site/x.md", destination_path: "/home/agent/y.md" }, { confirm: true });
    expect(out.asked).toHaveLength(1);
    expect(await opfsText(page, "site", "x.md")).toBeNull();
    const exists = await call(page, "move_file", { source_path: "/share/site/b.md", destination_path: "/share/site/taken.md" }, { confirm: true });
    expect(exists.content).toBe("Error: /share/site/taken.md already exists.");
    const ro = await call(page, "move_file", { source_path: "/share/site/b.md", destination_path: "/share/reports/b.md" }, { confirm: true });
    expect(ro.content).toContain("is read-only. The user attached /share/reports read only.");
    expect(exists.asked).toHaveLength(0);
    expect(ro.asked).toHaveLength(0);
  });

  test("9 mount lifecycle", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "reports", { "a.md": "one" });
    const events = await page.evaluate(async () => {
      const hook = window.__WA_VFS_PROOF__!.tesagent;
      const vfs = hook.provider.vfs;
      let n = 0;
      const off = vfs.subscribe(() => n++);
      const root = await navigator.storage.getDirectory();
      const handle = await root.getDirectoryHandle("reports");
      const refused: string[] = [];
      vfs.mount("/share/reports", hook.directoryBackend(handle, { writable: true }), { external: true });
      for (const bad of ["/", "/tmp", "/home/agent/x", "/home", "/share/reports", "/share", "/share/reports/deep"]) {
        try {
          vfs.mount(bad, hook.directoryBackend(handle, { writable: false }));
        } catch (e) {
          refused.push((e as Error).message);
        }
      }
      vfs.mount("/share/reports-old", hook.directoryBackend(handle, { writable: false }));
      const afterMounts = n;
      const homeUnmount = vfs.unmount("/home/agent");
      const unmounted = vfs.unmount("/share/reports");
      off();
      return { refused, afterMounts, homeUnmount, unmounted, n, prefixes: vfs.mounts().map((m) => m.prefix) };
    });
    expect(events.refused).toHaveLength(7);
    for (const m of events.refused) expect(m).toMatch(/^vfs\.mount: .+ overlaps an existing mount$/);
    expect(events.afterMounts).toBe(2);
    expect(events.homeUnmount).toBe(false);
    expect(events.unmounted).toBe(true);
    expect(events.n).toBe(3);
    expect(events.prefixes).toContain("/home/agent");
    expect(events.prefixes).toContain("/share/reports-old");
    expect(events.prefixes).not.toContain("/share/reports");
    const gone = await call(page, "read_file", { file_path: "/share/reports/a.md" });
    expect(gone.content).toBe("Error: /share/reports/a.md does not exist.");
    // Tools loaded before the mount see a new mount; remount needs fresh reads in two chats.
    await mountFolder(page, "reports", "/share/reports", true);
    for (const sid of ["c1", "c2"]) await call(page, "read_file", { file_path: "/share/reports/a.md" }, { sid });
    await page.evaluate(() => window.__WA_VFS_PROOF__!.tesagent.provider.vfs.unmount("/share/reports"));
    await mountFolder(page, "reports", "/share/reports", true);
    for (const sid of ["c1", "c2"]) {
      const out = await call(page, "edit_file", { file_path: "/share/reports/a.md", old_string: "one", new_string: "two" }, { sid });
      expect(out.content).toContain("has not been read in this chat");
    }
  });

  test("10 internal regression: no confirm, old read rule", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await call(page, "write_file", { file_path: "/home/agent/h.md", content: "h" });
    const del = await call(page, "delete_file", { file_path: "/home/agent/h.md" }, { confirm: true });
    expect(del.content).toBe("Deleted /home/agent/h.md.");
    expect(del.asked).toHaveLength(0);
    await call(page, "write_file", { file_path: "/home/agent/m.md", content: "m" });
    const mv = await call(page, "move_file", { source_path: "/home/agent/m.md", destination_path: "/home/agent/n.md" }, { confirm: true });
    expect(mv.asked).toHaveLength(0);
    await call(page, "read_file", { file_path: "/home/agent/n.md" });
    await page.waitForTimeout(25);
    await page.evaluate(async () => {
      const hook = window.__WA_VFS_PROOF__!.tesagent;
      await hook.provider.vfs.get("/home/agent/n.md");
    });
    const over = await call(page, "write_file", { file_path: "/home/agent/n.md", content: "n2" });
    expect(over.isError).toBe(false);
  });

  test("11 Files screen: badges, themes, contrast, unmount, screen delete", async ({ context, extensionId }) => {
    const page = await openTesagent(context, extensionId);
    await seed(page, "reports", { "q3.csv": "a\n", "pic.png": { b64: PNG_B64 } });
    await seed(page, "site", { "old.css": OLD_CSS, "keep.css": OLD_CSS });
    await mountFolder(page, "reports", "/share/reports", false);
    await mountFolder(page, "site", "/share/site", true);
    await fs.mkdir(ARTIFACTS, { recursive: true });
    await openFiles(page);
    const rows = page.locator("agent-files-screen .wa-ftree-row");
    const reportsRow = rows.filter({ hasText: "reports" }).first();
    const siteRow = rows.filter({ hasText: "site" }).first();
    await expect(reportsRow).toContainText("read-only");
    await expect(siteRow).toContainText("your disk");
    await expect(reportsRow).not.toContainText("your disk");
    // Expand a mount only when its files are not listed yet.
    if ((await rows.filter({ hasText: "q3.csv" }).count()) === 0) await reportsRow.click();
    if ((await rows.filter({ hasText: "old.css" }).count()) === 0) await siteRow.click();
    await expect(rows.filter({ hasText: "old.css" }).first()).toBeVisible();
    const measured: Record<string, unknown> = {};
    for (const theme of ["wa2-light", "wa2-dark"] as const) {
      await setTheme(page, theme);
      await page.screenshot({ path: path.join(ARTIFACTS, `files-${theme}.png`) });
      measured[theme] = await page.evaluate(() => {
        const toRgb = (css: string): number[] => {
          const c = document.createElement("canvas");
          c.width = c.height = 1;
          const g = c.getContext("2d")!;
          g.clearRect(0, 0, 1, 1);
          g.fillStyle = css;
          g.fillRect(0, 0, 1, 1);
          const d = g.getImageData(0, 0, 1, 1).data;
          return [d[0], d[1], d[2], d[3] / 255];
        };
        const lum = (rgb: number[]) => {
          const f = (v: number) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
        };
        const bgOf = (el: Element): number[] => {
          for (let e: Element | null = el; e; e = e.parentElement ?? ((e.getRootNode() as ShadowRoot).host ?? null)) {
            const c = toRgb(getComputedStyle(e).backgroundColor);
            if (c[3] > 0.95) return c;
          }
          return [255, 255, 255, 1];
        };
        const out: Record<string, { fg: string; bg: string; ratio: number }> = {};
        const badges = Array.from(document.querySelectorAll("agent-files-screen .wa-badge"));
        for (const b of badges) {
          const label = (b.textContent ?? "").trim();
          const fg = toRgb(getComputedStyle(b).color);
          const bg = bgOf(b);
          const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
          out[`badge:${label}`] = { fg: fg.join(","), bg: bg.join(","), ratio: Number(((l1 + 0.05) / (l2 + 0.05)).toFixed(2)) };
        }
        return out;
      });
      await page.evaluate(() => (document.documentElement.style.filter = "grayscale(1)"));
      await page.screenshot({ path: path.join(ARTIFACTS, `files-${theme}-grayscale.png`) });
      await page.evaluate(() => (document.documentElement.style.filter = ""));
    }
    await fs.writeFile(path.join(ARTIFACTS, "contrast.json"), JSON.stringify(measured, null, 2));
    for (const theme of ["wa2-light", "wa2-dark"]) {
      for (const [k, v] of Object.entries(measured[theme] as Record<string, { ratio: number }>)) {
        expect(v.ratio, `${theme} ${k}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Screen Delete: Cancel keeps the file, confirm removes it from the disk.
    await rows.filter({ hasText: "old.css" }).first().click();
    await page.waitForTimeout(200);
    const del = page.getByRole("button", { name: "Delete", exact: true });
    await del.click();
    await page.locator(`${VISIBLE_PANEL} .wa-confirm-card, .wa-confirm-card`).first().getByRole("button", { name: /Cancel|Reject/ }).click();
    expect(await opfsText(page, "site", "old.css")).toBe(OLD_CSS);
    await del.click();
    await page.locator(".wa-confirm-card").first().getByRole("button", { name: /Delete|Allow|Confirm/ }).click();
    await expect.poll(() => opfsText(page, "site", "old.css")).toBeNull();
    // Unmount, reopen: the row is gone.
    await page.evaluate(() => window.__WA_VFS_PROOF__!.tesagent.provider.vfs.unmount("/share/reports"));
    await page.getByRole("button", { name: /Back|Close/ }).first().click();
    await openFiles(page);
    await expect(page.locator("agent-files-screen .wa-ftree-row").filter({ hasText: "reports" })).toHaveCount(0);
    // External PNG size is its byte size.
    const size = await page.evaluate(async () => {
      const hook = window.__WA_VFS_PROOF__!.tesagent;
      const root = await navigator.storage.getDirectory();
      const reports = await root.getDirectoryHandle("reports");
      hook.provider.vfs.mount("/share/reports", hook.directoryBackend(reports, { writable: false }), { external: true });
      const entries = await hook.provider.vfs.list("/share/reports");
      return { listed: entries.find((e) => e.path === "/pic.png")?.size, disk: (await (await reports.getFileHandle("pic.png")).getFile()).size };
    });
    expect(size.listed).toBe(size.disk);
  });
});
