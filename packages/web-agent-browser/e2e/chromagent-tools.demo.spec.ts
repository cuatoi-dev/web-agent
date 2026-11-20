// Live proof: Chromagent, with the real model (brand/model.yml's
// first entry, `anthropic-sonnet`), is offered and
// uses todo_write, set_schedule and page_snapshot.
import { test, expect, ask, expectCall } from "./demo-helpers";
import type { Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(
  HERE,
  "../../../temp/artifacts/agent-defaults-step-limit-and-chromagent-tools",
);

async function chooseAgent(page: Page, id: string): Promise<void> {
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator(`#agent-option-${id}`).click();
}

test.describe("Chromagent full tool set live proof", () => {
  test("chromagent makes a todo list, schedules a reminder and snapshots the page", async ({ demoExtension }) => {
    test.setTimeout(240_000);
    const sitePage = await demoExtension.context.newPage();
    await sitePage.goto("http://localhost:10040/plain.html");

    const panelPage = await demoExtension.context.newPage();
    await panelPage.setViewportSize({ width: 480, height: 760 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    await chooseAgent(panelPage, "chromagent");
    await expect(panelPage.locator("#agent-combo .name")).toHaveText("Chromagent");

    const prompt =
      "Make a todo list with two items, then schedule a reminder in 10 minutes, then take a page snapshot of the active tab.";
    const { trace, reply } = await ask(panelPage, prompt, { model: demoExtension.model, timeoutMs: 200_000 });

    const offered = await panelPage.evaluate(() => {
      const panel = document.querySelector("#chat agent-chat-panel:not([hidden])") as unknown as {
        session?: { availableTools(): { name: string }[] };
      } | null;
      return panel?.session?.availableTools().map((t) => t.name) ?? [];
    });

    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    await fs.writeFile(
      path.join(ARTIFACTS_DIR, "live-trace.json"),
      JSON.stringify({ prompt, model: demoExtension.model, offered, trace, reply }, null, 2),
    );
    await panelPage.screenshot({ path: path.join(ARTIFACTS_DIR, "live-chromagent-panel.png") });

    expect(offered).toEqual(expect.arrayContaining(["todo_write", "set_schedule", "page_snapshot"]));
    expectCall(trace, "todo_write");
    expectCall(trace, "set_schedule");
    expectCall(trace, "page_snapshot");

    await panelPage.close();
    await sitePage.close();
  });
});
