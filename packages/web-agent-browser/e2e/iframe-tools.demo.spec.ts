// Live proof. The built extension, real Chromium, real model
// through the router, driving tesagent against a checkout page
// whose payment field sits in a cross-site iframe.
import { test, expect, ask, expectCall } from "./demo-helpers";
import type { Page } from "@playwright/test";
import { routeCrossSiteFrames } from "./cross-site-frames";

async function chooseAgent(page: Page, id: string): Promise<void> {
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator(`#agent-option-${id}`).click();
}

test.describe("Iframe tools live proof", () => {
  test("tesagent fills and pays inside the cross-site payment iframe against the real model", async ({
    demoExtension,
  }) => {
    test.setTimeout(150_000);
    await routeCrossSiteFrames(demoExtension.context);

    const sitePage = await demoExtension.context.newPage();
    await sitePage.goto("http://localhost:10040/checkout-frames.html");

    const panelPage = await demoExtension.context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    await chooseAgent(panelPage, "tesagent");

    const prompt =
      "Start debugging the checkout tab, fill the payment iframe card number with 4242 4242 4242 4242, press Pay, and tell me what the payment frame says.";
    const { trace, reply } = await ask(panelPage, prompt, { model: demoExtension.model });

    expectCall(
      trace,
      "page_fill_form",
      (input: unknown) =>
        typeof input === "object" &&
        input !== null &&
        Array.isArray((input as { fields?: unknown }).fields) &&
        (input as { fields: Array<{ ref?: unknown }> }).fields.length > 0 &&
        (input as { fields: Array<{ ref?: unknown }> }).fields.every(
          (field) => typeof field.ref === "string" && field.ref.startsWith("f1:"),
        ),
    );

    await expect(sitePage.frameLocator("#payment").locator("#state")).toHaveText("Paid", {
      timeout: 15_000,
    });
    // The card number's spacing is the model's choice: the field is a bare
    // input with no formatting script, so compare the digits, not the spacing.
    expect(
      (await sitePage.frameLocator("#payment").locator("#card").inputValue()).replace(/\s+/g, ""),
    ).toBe("4242424242424242");
    expect(reply.toLowerCase()).toContain("paid");

    await panelPage.close();
    await sitePage.close();
  });
});
