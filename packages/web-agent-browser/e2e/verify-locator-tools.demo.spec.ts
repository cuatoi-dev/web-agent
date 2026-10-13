import { test, expect, ask, expectCall } from "./demo-helpers";
import type { Page } from "@playwright/test";

async function chooseAgent(page: Page, id: string): Promise<void> {
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator(`#agent-option-${id}`).click();
}

test.describe("page_verify and page_generate_locator live proof", () => {
  test("tesagent verifies the discount and returns an Apply locator on checkout.html against the real model", async ({
    demoExtension,
  }) => {
    test.setTimeout(150_000);
    const sitePage = await demoExtension.context.newPage();
    await sitePage.goto("http://localhost:10040/checkout.html");

    // Prepare the discount through the fixture, so the single model turn
    // focuses on verifying it and generating a locator.
    await sitePage.locator("#coupon").fill("SAVE10");
    await sitePage.locator("#apply-btn").click();
    await expect(sitePage.locator("#coupon-status")).toHaveText("Discount: -$4.20");

    const panelPage = await demoExtension.context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    await chooseAgent(panelPage, "tesagent");

    const prompt =
      "Check that the discount line says Discount: -$4.20, then give me a locator for the Apply button.";
    const { trace } = await ask(panelPage, prompt, { model: demoExtension.model });

    expectCall(trace, "page_verify", (input: unknown) =>
      typeof input === "object" &&
      input !== null &&
      (input as { kind?: unknown }).kind === "text_visible" &&
      String((input as { text?: unknown }).text).includes("Discount: -$4.20"));
    expectCall(trace, "page_generate_locator", (input: unknown) =>
      typeof input === "object" &&
      input !== null &&
      typeof (input as { ref?: unknown }).ref === "string");

    const locatorCall = trace.find((t) => t.name === "page_generate_locator");
    expect(locatorCall?.outcomeSummary).toContain("Apply");
    expect(locatorCall?.outcomeSummary).toContain("matches 1 element");

    await panelPage.close();
    await sitePage.close();
  });
});
