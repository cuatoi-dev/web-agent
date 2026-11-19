import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect, ask } from "./demo-helpers";

// Live proof. The real model, the real gateway route
// (anthropic-sonnet), real OPFS folders and a real
// click on the real Delete button. No model mock, no network stub, no
// automatic approval.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.resolve(HERE, "../../../temp/artifacts/2026-10-01-022937-002-vfs-folder-mounts");

async function chooseAgent(page: Page, id: string): Promise<void> {
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator(`#agent-option-${id}`).click();
}

async function seed(page: Page, dir: string, files: Record<string, string>): Promise<void> {
  await page.evaluate(
    async ({ dir, files }) => {
      const root = await navigator.storage.getDirectory();
      const d = await root.getDirectoryHandle(dir, { create: true });
      for (const [name, text] of Object.entries(files)) {
        const w = await (await d.getFileHandle(name, { create: true })).createWritable();
        await w.write(text);
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

test.describe("VFS folder mounts — live proof", () => {
  test("the agent summarises a read-only folder, then deletes a file after the user clicks Delete", async ({
    demoExtension,
  }) => {
    test.setTimeout(300_000);
    await fs.mkdir(ARTIFACTS, { recursive: true });

    const panelPage = await demoExtension.context.newPage();
    await panelPage.addInitScript(() => {
      window.__WA_ENABLE_VFS_PROOF__ = true;
    });
    const requests: { url: string; stream: unknown; model: unknown; status?: number }[] = [];
    panelPage.on("request", (req) => {
      if (!req.url().includes("/api/anthropic/")) return;
      let body: { stream?: unknown; model?: unknown } = {};
      try {
        body = JSON.parse(req.postData() ?? "{}") as { stream?: unknown; model?: unknown };
      } catch {
        // not JSON: record no stream flag
      }
      requests.push({ url: req.url(), stream: body.stream, model: body.model });
    });
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    await chooseAgent(panelPage, "tesagent");
    await panelPage.waitForFunction(() => window.__WA_VFS_PROOF__?.tesagent !== undefined);

    await seed(panelPage, "reports", {
      "q3-sales.csv": "quarter,sales\nQ3,120000\n",
      "q3-costs.csv": "quarter,costs\nQ3,45000\n",
      "q3-headcount.csv": "quarter,headcount\nQ3,24\n",
    });
    await mountFolder(panelPage, "reports", "/share/reports", false);

    // Turn 1: summarise the read-only folder.
    const summary = await ask(panelPage, "Summarise the Q3 CSVs in /share/reports", { model: demoExtension.model });
    expect(summary.error).toBeNull();
    expect(
      summary.trace.some((t) => (t.name === "glob_files" || t.name === "read_file") && JSON.stringify(t.input).includes("/share/reports")),
      "expected glob_files or read_file on /share/reports",
    ).toBe(true);
    const plain = summary.reply.replace(/,/g, "");
    for (const figure of ["120000", "45000", "24"]) expect(plain, `reply quotes ${figure}`).toContain(figure);
    await panelPage.screenshot({ path: path.join(ARTIFACTS, "live-summary.png") });
    await fs.writeFile(
      path.join(ARTIFACTS, "live-summary.json"),
      JSON.stringify({ prompt: "Summarise the Q3 CSVs in /share/reports", reply: summary.reply, trace: summary.trace }, null, 2),
    );

    // Turn 2: delete a file in a read-and-write folder; the user clicks Delete.
    await seed(panelPage, "site", { "old.css": "body { margin: 0; }\n" });
    await mountFolder(panelPage, "site", "/share/site", true);
    const turn = ask(panelPage, "Delete /share/site/old.css", { model: demoExtension.model });
    const card = panelPage.locator("agent-chat-panel:not([hidden]) .wa-confirm-card");
    await expect(card).toBeVisible({ timeout: 120_000 });
    await expect(card.locator("h3")).toHaveText("Delete old.css from your disk?");
    await panelPage.screenshot({ path: path.join(ARTIFACTS, "live-delete-confirm.png") });
    await card.getByRole("button", { name: "Delete", exact: true }).click();
    const deleted = await turn;
    expect(deleted.error).toBeNull();
    const call = deleted.trace.find((t) => t.name === "delete_file");
    expect(call, "expected a delete_file call").toBeTruthy();
    expect(call?.failed).not.toBe(true);
    const gone = await panelPage.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const d = await root.getDirectoryHandle("site");
      try {
        await d.getFileHandle("old.css");
        return "present";
      } catch (e) {
        return (e as { name?: string }).name ?? "error";
      }
    });
    expect(gone).toBe("NotFoundError");
    await fs.writeFile(
      path.join(ARTIFACTS, "live-delete.json"),
      JSON.stringify({ reply: deleted.reply, trace: deleted.trace, directLookup: gone }, null, 2),
    );
    await fs.writeFile(
      path.join(ARTIFACTS, "live-requests.json"),
      JSON.stringify({ route: demoExtension.model, requests }, null, 2),
    );
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) expect(r.stream).toBe(false);

    await panelPage.close();
  });
});
