import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, getTabId } from "./extension.fixture";
import type { BrowserContext, Page, Worker } from "@playwright/test";

const ORIGIN = "http://localhost:10040";
const PREVIEW_URL = `${ORIGIN}/upload-preview.html`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAINBOW_PNG = path.resolve(HERE, "../../../apps/cat-store/e2e/fixtures/004-test-rainbow.png");

interface PlannedCall {
  name: string;
  input: Record<string, unknown>;
}

async function getWorker(context: BrowserContext): Promise<Worker> {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  return worker;
}

async function enableOrigin(worker: Worker, origins: string[]): Promise<void> {
  await worker.evaluate(async (o: string[]) => {
    await chrome.storage.local.set({ enabledOrigins: o });
  }, origins);
}

async function openPanel(context: BrowserContext, extensionId: string, tabId: number): Promise<Page> {
  const panelPage = await context.newPage();
  await panelPage.addInitScript((id: number) => {
    window.__WA_ENABLE_VFS_PROOF__ = true;
    window.__PICKER_CALLS__ = [];
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async (o: { mode?: string }) => {
      window.__PICKER_CALLS__!.push(o);
      const name = window.__PICK_NEXT__ ?? "reports";
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle(name, { create: true });
    };
    window.__WA_MOCK_SCRIPT__ = (opts) => {
      const lastMsg = opts.messages[opts.messages.length - 1];
      const lastText = typeof lastMsg?.content === "string" ? lastMsg.content : "";
      if (lastText.includes("Summarize the following conversation as a short UI title")) {
        return { text: "Upload from VFS" };
      }
      const queue = window.__PLAN__ ?? [];
      const results = window.__TOOL_RESULTS__ ?? [];
      const seen = window.__SEEN_TOOL_IDS__ ?? new Set();
      // A page_screenshot success sends its image in its own user message on the
      // next call, so the tool result is not always last: scan every message.
      for (const msg of opts.messages) {
        if (!Array.isArray(msg?.content)) continue;
        for (const part of msg.content as {
          type?: string;
          toolCallId?: string;
          toolName?: string;
          isError?: boolean;
          output?: unknown;
        }[]) {
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
      }
      window.__SEEN_TOOL_IDS__ = seen;
      window.__TOOL_RESULTS__ = results;
      function refFor(label: string): string {
        const snap = [...results].reverse().find((r) => r.tool === "page_snapshot");
        if (snap) {
          const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const m = snap.text.match(new RegExp(`"${escaped}"[^\\n]*\\[ref=(\\d+)\\]`));
          if (m) return m[1];
        }
        return "missing";
      }
      if (results.length < queue.length) {
        const next = queue[results.length];
        const rawInput = { ...next.input };
        if (typeof rawInput.ref === "string" && rawInput.ref.startsWith("@")) {
          rawInput.ref = refFor(rawInput.ref.slice(1));
        }
        const withTab =
          next.name.startsWith("page_") || next.name === "start_debugging"
            ? { tabId: id, ...rawInput }
            : rawInput;
        return { toolCalls: [{ id: `tc_${seen.size}`, name: next.name, input: withTab }] };
      }
      return { text: results.map((r) => r.text).join("\n") || "Done." };
    };
  }, tabId);

  await panelPage.setViewportSize({ width: 420, height: 740 });
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panelPage.locator("#agent-row")).toBeVisible();
  await panelPage.locator("#agent-combo").click();
  await expect(panelPage.locator("#agent-list")).toBeVisible();
  await panelPage.locator("#agent-option-tesagent").click();
  await panelPage.waitForFunction(() => window.__WA_VFS_PROOF__?.tesagent !== undefined);
  await panelPage.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true });
  });
  return panelPage;
}

async function runPlan(
  panelPage: Page,
  plan: PlannedCall[],
  prompt: string,
): Promise<{ tool: string; text: string; isError: boolean }[]> {
  await panelPage.evaluate((p: PlannedCall[]) => {
    window.__PLAN__ = p;
    window.__TOOL_RESULTS__ = [];
  }, plan);
  const inputArea = panelPage.locator("agent-chat-panel:not([hidden]) #input");
  await inputArea.click();
  await panelPage.keyboard.type(prompt);
  await panelPage.keyboard.press("Enter");
  await panelPage.waitForFunction(
    (n: number) => (window.__TOOL_RESULTS__?.length ?? 0) >= n,
    plan.length,
    { timeout: 30_000 },
  );
  // Wait for the assistant turn to finish before the next prompt is typed.
  await expect(panelPage.locator("agent-chat-panel:not([hidden])")).not.toHaveAttribute("running", "");
  return panelPage.evaluate(() => window.__TOOL_RESULTS__ ?? []);
}

test.describe("page_upload_file from VFS mock e2e (001)", () => {
  test("uploads saved screenshot, VFS markdown, overrides, mixed inline+path, and enforces error and 10 MB gates", async ({
    context,
    extensionId,
  }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);
    const sitePage = await context.newPage();
    await sitePage.goto(PREVIEW_URL);
    const tabId = await getTabId(worker, PREVIEW_URL);
    const panelPage = await openPanel(context, extensionId, tabId);

    // 1. Capture screenshot + snapshot to obtain the saved path and upload ref.
    const r1 = await runPlan(
      panelPage,
      [
        { name: "start_debugging", input: {} },
        { name: "page_screenshot", input: {} },
        { name: "page_snapshot", input: {} },
      ],
      "Debug, screenshot, and snapshot.",
    );
    expect(r1[1].isError).toBe(false);
    const savedMatch = /Saved (\/tmp\/screenshots\/[^\s]+\.png)/.exec(r1[1].text);
    expect(savedMatch).not.toBeNull();
    const shotPath = savedMatch![1];
    const shotBase = path.posix.basename(shotPath);
    const refMatch = /"Upload files"[^\n]*\[ref=(\d+)\]/.exec(r1[2].text);
    expect(refMatch).not.toBeNull();
    const uploadRef = refMatch![1];

    const storedShotBytes = await panelPage.evaluate(async (p: string) => {
      const f = await window.__WA_VFS_PROOF__!.tesagent.provider.vfs.get(p);
      if (!f) return -1;
      return atob(f.content).length;
    }, shotPath);
    expect(storedShotBytes).toBeGreaterThan(0);

    // Criterion 1: upload saved screenshot by path.
    const rShot = await runPlan(
      panelPage,
      [{ name: "page_upload_file", input: { ref: uploadRef, files: [{ path: shotPath }] } }],
      "Upload the screenshot.",
    );
    expect(rShot[0].isError).toBe(false);
    expect(rShot[0].text).toContain(`${shotBase} (`);
    expect(rShot[0].text).toContain(`, from ${shotPath}).`);
    await expect(sitePage.locator("#change-summary")).toHaveText(`${shotBase}|image/png|${storedShotBytes}`);
    await expect(sitePage.locator(`#uploaded-list li[data-name="${shotBase}"] img.preview`)).toBeVisible();
    const naturalW = await sitePage
      .locator(`#uploaded-list li[data-name="${shotBase}"] img.preview`)
      .evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(naturalW).toBeGreaterThan(0);

    // Criterion 2: write /home/agent/notes.md and upload by path (UTF-8 + text/markdown).
    const mdText = "# Test notes\nCafé line\n";
    const mdBytes = Buffer.byteLength(mdText, "utf8");
    const rMd = await runPlan(
      panelPage,
      [
        { name: "write_file", input: { file_path: "/home/agent/notes.md", content: mdText } },
        { name: "page_upload_file", input: { ref: uploadRef, files: [{ path: "/home/agent/notes.md" }] } },
      ],
      "Write notes.md and upload it.",
    );
    expect(rMd[0].isError).toBe(false);
    expect(rMd[1].isError).toBe(false);
    expect(rMd[1].text).toContain(`notes.md (${mdBytes} B, from /home/agent/notes.md).`);
    await expect(sitePage.locator("#change-summary")).toHaveText(`notes.md|text/markdown|${mdBytes}`);
    await expect(sitePage.locator('#uploaded-list li[data-name="notes.md"] .text-preview')).toHaveText(mdText);

    // Criterion 3: name and mimeType override path defaults.
    const rOverride = await runPlan(
      panelPage,
      [
        {
          name: "page_upload_file",
          input: {
            ref: uploadRef,
            files: [{ path: "/home/agent/notes.md", name: "custom.txt", mimeType: "text/plain" }],
          },
        },
      ],
      "Upload with overrides.",
    );
    expect(rOverride[0].isError).toBe(false);
    expect(rOverride[0].text).toContain(`custom.txt (${mdBytes} B, from /home/agent/notes.md).`);
    await expect(sitePage.locator("#change-summary")).toHaveText(`custom.txt|text/plain|${mdBytes}`);

    // Criterion 4 & 8: mix path file + inline CSV in one call; then inline-only call.
    const rMix = await runPlan(
      panelPage,
      [
        {
          name: "page_upload_file",
          input: {
            ref: uploadRef,
            files: [
              { path: "/home/agent/notes.md" },
              { name: "orders.csv", mimeType: "text/csv", text: "a,b\n1,2\n" },
            ],
          },
        },
      ],
      "Upload mixed.",
    );
    expect(rMix[0].isError).toBe(false);
    expect(rMix[0].text).toContain(`notes.md (${mdBytes} B, from /home/agent/notes.md), orders.csv (8 B).`);
    await expect(sitePage.locator("#change-summary")).toHaveText(
      `notes.md|text/markdown|${mdBytes}\norders.csv|text/csv|8`,
    );

    const rInline = await runPlan(
      panelPage,
      [
        {
          name: "page_upload_file",
          input: {
            ref: uploadRef,
            files: [{ name: "inline.txt", mimeType: "text/plain", text: "hello" }],
          },
        },
      ],
      "Upload inline only.",
    );
    expect(rInline[0].isError).toBe(false);
    expect(rInline[0].text).toMatch(/inline\.txt \(5 B\)\.$/);
    await expect(sitePage.locator("#change-summary")).toHaveText("inline.txt|text/plain|5");

    // Criteria 5, 6, 7: error cases set no files and fire no change event.
    const countBeforeErrors = await sitePage.locator("#change-summary").getAttribute("data-change-count");
    await panelPage.evaluate(async () => {
      const sixMb = "A".repeat(6 * 1024 * 1024);
      const vfs = window.__WA_VFS_PROOF__!.tesagent.provider.vfs;
      await vfs.write("/home/agent/six-a.txt", sixMb);
      await vfs.write("/home/agent/six-b.txt", sixMb);
    });

    const rErrors = await runPlan(
      panelPage,
      [
        { name: "page_upload_file", input: { ref: uploadRef, files: [{ path: "/home/agent/missing.md" }] } },
        { name: "page_upload_file", input: { ref: uploadRef, files: [{ path: "/tmp/screenshots" }] } },
        { name: "page_upload_file", input: { ref: uploadRef, files: [{ path: "/home/agent/notes.md", text: "dup" }] } },
        { name: "page_upload_file", input: { ref: uploadRef, files: [{ name: "empty.txt", mimeType: "text/plain" }] } },
        {
          name: "page_upload_file",
          input: {
            ref: uploadRef,
            files: [{ path: "/home/agent/six-a.txt" }, { path: "/home/agent/six-b.txt" }],
          },
        },
      ],
      "Run error checks.",
    );
    expect(rErrors[0]).toEqual({
      tool: "page_upload_file",
      text: "No file at /home/agent/missing.md. Use glob_files to find it.",
      isError: true,
    });
    expect(rErrors[1]).toEqual({
      tool: "page_upload_file",
      text: "No file at /tmp/screenshots. Use glob_files to find it.",
      isError: true,
    });
    expect(rErrors[2]).toEqual({
      tool: "page_upload_file",
      text: 'File "/home/agent/notes.md": pass exactly one of text, base64, size and fill, or path.',
      isError: true,
    });
    expect(rErrors[3]).toEqual({
      tool: "page_upload_file",
      text: 'File "empty.txt": pass exactly one of text, base64, size and fill, or path.',
      isError: true,
    });
    expect(rErrors[4]).toEqual({
      tool: "page_upload_file",
      text: "Uploads are limited to 10 MB in total.",
      isError: true,
    });
    await expect(sitePage.locator("#change-summary")).toHaveAttribute("data-change-count", countBeforeErrors!);
    await expect(sitePage.locator("#change-summary")).toHaveText("inline.txt|text/plain|5");

    await context.close();
  });

  test("uploads files from an attached folder under /share/<name>", async ({ context, extensionId }) => {
    const worker = await getWorker(context);
    await enableOrigin(worker, [ORIGIN]);
    const sitePage = await context.newPage();
    await sitePage.goto(PREVIEW_URL);
    const tabId = await getTabId(worker, PREVIEW_URL);
    const panelPage = await openPanel(context, extensionId, tabId);

    const rainbowBuf = await fs.readFile(RAINBOW_PNG);
    const rainbowB64 = rainbowBuf.toString("base64");
    const csvContent = "quarter,sales\nQ3,120000\n";
    const csvBytes = Buffer.byteLength(csvContent, "utf8");

    await panelPage.evaluate(
      async ({ csv, pngB64 }) => {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle("reports", { create: true });
        const csvHandle = await dir.getFileHandle("q3-sales.csv", { create: true });
        const cw = await csvHandle.createWritable();
        await cw.write(csv);
        await cw.close();

        const pngHandle = await dir.getFileHandle("rainbow.png", { create: true });
        const pw = await pngHandle.createWritable();
        await pw.write(Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0)));
        await pw.close();

        window.__PICK_NEXT__ = "reports";
      },
      { csv: csvContent, pngB64: rainbowB64 },
    );

    const panel = panelPage.locator("agent-chat-panel:not([hidden])");
    await panel.locator('.composer-controls [data-attachment-provider="folder"]').click();
    await panel.locator('wa-menu.wa-attach-menu button[role="menuitem"]').nth(0).click();
    await expect(panel.locator('[data-attachment-slot="folder"] .wa-folder-chip').first()).toContainText(
      "/share/reports · read only",
    );

    const r = await runPlan(
      panelPage,
      [
        { name: "start_debugging", input: {} },
        { name: "page_snapshot", input: {} },
        {
          name: "page_upload_file",
          input: {
            ref: "@Upload files",
            files: [{ path: "/share/reports/q3-sales.csv" }, { path: "/share/reports/rainbow.png" }],
          },
        },
        {
          name: "page_upload_file",
          input: { ref: "@Upload files", files: [{ path: "/share/reports" }] },
        },
      ],
      "Debug, snapshot, and upload attached folder files.",
    );

    expect(r[2].isError).toBe(false);
    expect(r[2].text).toContain("from /share/reports/q3-sales.csv");
    expect(r[2].text).toContain("from /share/reports/rainbow.png");
    await expect(sitePage.locator("#change-summary")).toHaveText(
      `q3-sales.csv|text/csv|${csvBytes}\nrainbow.png|image/png|${rainbowBuf.length}`,
    );
    await expect(sitePage.locator('#uploaded-list li[data-name="rainbow.png"] img.preview')).toBeVisible();

    expect(r[3]).toEqual({
      tool: "page_upload_file",
      text: "No file at /share/reports. Use glob_files to find it.",
      isError: true,
    });

    await context.close();
  });
});
