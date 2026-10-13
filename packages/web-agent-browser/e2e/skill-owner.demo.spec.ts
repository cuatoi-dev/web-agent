import { test, expect, ask, expectCall } from "./demo-helpers";
import type { Page } from "@playwright/test";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

async function allowConfirm(page: Page): Promise<void> {
  const scrim = page.locator("#chat agent-chat-panel:not([hidden]) .wa-confirm-scrim");
  await scrim.waitFor({ state: "visible", timeout: 120_000 });
  await scrim.locator("button:has-text('Allow'), md-filled-button:has-text('Allow')").first().click();
}

test.describe("Skill owner — live proof", () => {
  test("a private skill carries shared: false, and search_skills runs", async ({ demoExtension }) => {
    test.setTimeout(300_000);
    const panel = await demoExtension.context.newPage();
    await panel.setViewportSize({ width: 400, height: 700 });
    await panel.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panel.locator("#chat agent-chat-panel")).toBeAttached();

    const allow = allowConfirm(panel);
    const create = await ask(panel, "Save a skill named login_smoke that only you can use. Its definition: open the login page, submit valid credentials, check the dashboard loads.", { model: demoExtension.model });
    await allow;
    expectCall(create.trace, "create_skill", (i) => isRecord(i) && i.shared === false);

    const search = await ask(panel, "Search your skills for login_smoke", { model: demoExtension.model });
    expectCall(search.trace, "search_skills");

    await panel.close();
  });
});
