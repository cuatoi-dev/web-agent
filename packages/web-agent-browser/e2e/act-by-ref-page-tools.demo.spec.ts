import { test, expect, ask, expectCall } from "./demo-helpers";
import type { Page } from "@playwright/test";

async function chooseAgent(page: Page, id: string): Promise<void> {
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator(`#agent-option-${id}`).click();
}

test.describe("Act-by-ref page tools live proof", () => {
  test("tesagent fills email and picks express shipping on checkout.html against the real model", async ({
    demoExtension,
  }) => {
    test.setTimeout(330_000);
    const sitePage = await demoExtension.context.newPage();
    await sitePage.goto("http://localhost:10040/checkout.html");

    const panelPage = await demoExtension.context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    await chooseAgent(panelPage, "tesagent");

    const prompt =
      "Start debugging the checkout tab. On it: fill the coupon field with SAVE10 and click Apply; fill the email field with qa@example.com; select Express shipping. Report each step.";
    const { trace } = await ask(panelPage, prompt, { model: demoExtension.model, timeoutMs: 300_000 });

    expectCall(trace, "page_fill_form", (input: unknown) =>
      typeof input === "object" &&
      input !== null &&
      Array.isArray((input as { fields?: unknown }).fields) &&
      (input as { fields: Array<{ value?: unknown }> }).fields.some(
        (field) => field.value === "qa@example.com",
      ));
    expectCall(trace, "page_select_option", (input: unknown) =>
      typeof input === "object" &&
      input !== null &&
      Array.isArray((input as { values?: unknown }).values) &&
      (input as { values: unknown[] }).values.some(
        (value) => typeof value === "string" && value.toLowerCase() === "express",
      ));

    expect(await sitePage.locator("#email").inputValue()).toBe("qa@example.com");
    expect(await sitePage.locator("#shipping").inputValue()).toBe("express");

    await panelPage.close();
    await sitePage.close();
  });
});
