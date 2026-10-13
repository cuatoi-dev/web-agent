import { test, expect, ask, expectCall } from "./demo-helpers";

const FIXTURE_URL = "http://localhost:10040/checkout.html";

test.describe("Action journal export — live proof", () => {
  test("export: apply two coupons and export a Playwright test", async ({ demoExtension }) => {
    test.setTimeout(630_000);

    const sitePage = await demoExtension.context.newPage();
    sitePage.on("dialog", () => {});
    await sitePage.goto(FIXTURE_URL);

    const panelPage = await demoExtension.context.newPage();
    await panelPage.setViewportSize({ width: 400, height: 700 });
    await panelPage.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panelPage.locator("#agent-row")).toBeVisible();
    await panelPage.locator("#agent-combo").click();
    await expect(panelPage.locator("#agent-list")).toBeVisible();
    await panelPage.locator("#agent-option-tesagent").click();
    await expect(panelPage.locator("#agent-combo .name")).toHaveText("Tesagent");
    await expect(panelPage.locator("#chat agent-chat-panel:not([hidden])")).toBeAttached();
    await sitePage.bringToFront();

    const prompt = "Apply coupon SAVE10, then try NOTREAL, then export this as a Playwright test";
    const { trace } = await ask(panelPage, prompt, { model: demoExtension.model, timeoutMs: 600_000 });
    expectCall(trace, "page_fill_form", (input: unknown) =>
      typeof input === "object" && input !== null &&
      Array.isArray((input as { fields?: unknown }).fields) &&
      (input as { fields: Array<{ value?: unknown }> }).fields.some((f) => typeof f.value === "string" && /SAVE10/.test(f.value)));
    expectCall(trace, "page_click");
    expectCall(trace, "export_test", { format: "playwright" });

    await panelPage.close();
    await sitePage.close();
  });
});
