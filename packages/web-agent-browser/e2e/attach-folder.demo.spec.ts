import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect } from "./demo-helpers";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.resolve(HERE, "../../../temp/artifacts/2026-10-01-022937-003-attach-folder-button");

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

async function sendComposer(panelPage: Page, prompt: string, timeoutMs = 120_000) {
  const before = await panelPage.evaluate(() => {
    const panel = document.querySelector("agent-chat-panel:not([hidden])")
      ?? document.querySelector("web-agent-bubble")?.shadowRoot?.querySelector("agent-chat-panel");
    return (panel as { messages?: unknown[] })?.messages?.length ?? 0;
  });
  const inputArea = panelPage.locator("agent-chat-panel:not([hidden]) #input");
  await inputArea.click();
  await panelPage.keyboard.type(prompt);
  await panelPage.keyboard.press("Enter");

  await panelPage.waitForFunction((beforeIndex) => {
    const panel = document.querySelector("agent-chat-panel:not([hidden])")
      ?? document.querySelector("web-agent-bubble")?.shadowRoot?.querySelector("agent-chat-panel");
    const p = panel as { running?: boolean; messages?: Array<{ role?: string; text?: string }> } | null;
    if (!p) return false;
    const msgs = p.messages ?? [];
    return !p.running && msgs.slice(beforeIndex).some((m) => m.role === "assistant" && Boolean(m.text?.trim()));
  }, before, { timeout: timeoutMs });

  return await panelPage.evaluate((sentPrompt) => {
    const panel = document.querySelector("agent-chat-panel:not([hidden])")
      ?? document.querySelector("web-agent-bubble")?.shadowRoot?.querySelector("agent-chat-panel");
    const msgs = (panel as { messages?: Array<{ role?: string; text?: string; trace?: Array<{ name: string; input: Record<string, unknown> }> }> })?.messages ?? [];
    const wanted = sentPrompt.trim();
    const userIdx = msgs.findLastIndex((m) => {
      if (m.role !== "user") return false;
      const shown = m.text?.trim() ?? "";
      return shown === wanted || shown.includes(wanted);
    });
    const turn = userIdx < 0 ? [] : msgs.slice(userIdx);
    const trace = turn.flatMap((m) => m.trace ?? []);
    const reply = turn.filter((m) => m.role === "assistant").map((m) => m.text ?? "").join("\n").trim();
    return { reply, trace };
  }, prompt);
}

test.describe("attach-folder live demo (Run A)", () => {
  test("live proof against real model in extension side panel", async ({ demoExtension }) => {
    test.setTimeout(300_000);
    await fs.mkdir(ARTIFACTS, { recursive: true });

    const panelPage = await demoExtension.context.newPage();
    await panelPage.addInitScript(() => {
      window.__WA_ENABLE_VFS_PROOF__ = true;
      (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => {
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle("reports", { create: true });
      };
    });

    const requests: { url: string; stream: unknown; postData: unknown }[] = [];
    panelPage.on("request", (req) => {
      if (!req.url().includes("/api/anthropic/")) return;
      let postData: unknown;
      let stream: unknown;
      try {
        const raw = req.postData() ?? "";
        postData = JSON.parse(raw);
        stream = (postData as { stream?: unknown })?.stream;
      } catch {
        postData = req.postData();
      }
      requests.push({ url: req.url(), stream, postData });
    });

    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    await chooseAgent(panelPage, "tesagent");
    await panelPage.waitForFunction(() => window.__WA_VFS_PROOF__?.tesagent !== undefined);

    // 1. Seed OPFS reports folder
    await seed(panelPage, "reports", {
      "q3-sales.csv": "quarter,sales\nQ3,120000\n",
      "q3-costs.csv": "quarter,costs\nQ3,45000\n",
      "q3-headcount.csv": "quarter,headcount\nQ3,24\n",
    });

    // 2. Click folder button and Attach folder (read only)
    const folderBtn = panelPage.locator('agent-chat-panel:not([hidden]) .composer-controls [data-attachment-provider="folder"]');
    await folderBtn.click();
    const menuItems = panelPage.locator('agent-chat-panel:not([hidden]) wa-menu.wa-attach-menu button[role="menuitem"]');
    await expect(menuItems.first()).toHaveText("Attach folder (read only)");
    await menuItems.first().click();

    const chip = panelPage.locator('agent-chat-panel:not([hidden]) [data-attachment-slot="folder"] .wa-folder-chip');
    await expect(chip).toContainText("/share/reports · read only");

    // 3. Send "Summarise the Q3 CSVs"
    const summary = await sendComposer(panelPage, "Summarise the Q3 CSVs");
    await panelPage.screenshot({ path: path.join(ARTIFACTS, "live-ext-summary.png") });

    // Proof: request body contains attach line
    const attachReq = requests.find((r) => JSON.stringify(r.postData).includes("The user attached the folder /share/reports (read only, 3 files)."));
    expect(attachReq, "expected a request with attach line").toBeTruthy();

    // Proof: trace has read_file or glob_files with /share/reports
    const hasReportsTool = summary.trace.some((t) => (t.name === "read_file" || t.name === "glob_files") && JSON.stringify(t.input).includes("/share/reports"));
    expect(hasReportsTool, "expected trace to access /share/reports").toBe(true);

    // Proof: figures 120000, 45000, 24
    const plain = summary.reply.replace(/,/g, "");
    for (const fig of ["120000", "45000", "24"]) {
      expect(plain, `reply should contain ${fig}`).toContain(fig);
    }

    // Proof: sent message shows folder chip
    const sentChip = panelPage.locator('agent-chat-panel:not([hidden]) agent-message-view .attachment-chips [data-attachment-provider="folder"]').last();
    await expect(sentChip).toHaveText("/share/reports · read only");

    // 4. Click Remove /share/reports and send "Is the reports folder still attached?"
    const removeBtn = panelPage.locator('agent-chat-panel:not([hidden]) button[aria-label="Remove /share/reports"]');
    await removeBtn.click();
    await expect(chip).toHaveCount(0);

    const removedTurn = await sendComposer(panelPage, "Is the reports folder still attached?");
    await panelPage.screenshot({ path: path.join(ARTIFACTS, "live-ext-removed.png") });

    const removeReq = requests.find((r) => JSON.stringify(r.postData).includes("The user removed the folder /share/reports."));
    expect(removeReq, "expected a request with remove line").toBeTruthy();
    expect(removedTurn.reply).toMatch(/removed|no longer|not attached/i);

    // 5. Every request has stream === false
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) {
      expect(r.stream).toBe(false);
    }

    // Save artifacts
    await fs.writeFile(
      path.join(ARTIFACTS, "live-ext-requests.json"),
      JSON.stringify(requests, null, 2),
    );
    await fs.writeFile(
      path.join(ARTIFACTS, "live-ext-answers.json"),
      JSON.stringify(
        {
          summary: { prompt: "Summarise the Q3 CSVs", reply: summary.reply, trace: summary.trace },
          removed: { prompt: "Is the reports folder still attached?", reply: removedTurn.reply, trace: removedTurn.trace },
        },
        null,
        2,
      ),
    );

    await panelPage.close();
  });
});
