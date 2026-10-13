import { test, expect } from "./extension.fixture";

test.describe("Do-not-inject rules and shadow root detection", () => {
  test("does not inject on page with nested agent in shadow root", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
    });

    const page = await context.newPage();
    await page.goto("http://localhost:10040/nested-agent.html");

    // Regression guard (Scenario 9): flat querySelector returns null
    const flatQuery = await page.evaluate(() => document.querySelector("web-agent-bubble"));
    expect(flatQuery).toBeNull();

    // Scenario 8: no bubble is mounted on document.body, and exactly 1 bubble exists in host shadow root
    await expect(page.locator("body > web-agent-bubble")).toHaveCount(0);
    await expect(page.locator("web-agent-bubble")).toHaveCount(1);
  });

  test("removes extension bubble when host mounts agent late", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
    });

    const page = await context.newPage();
    await page.goto("http://localhost:10040/late-agent.html");

    // Immediately after load, extension mounted its bubble on body
    await expect(page.locator("body > web-agent-bubble")).toHaveCount(1);

    // Within 6 s, late-agent mounts, the extension bubble on body is removed, and exactly 1 host bubble remains
    await expect(page.locator("body > web-agent-bubble")).toHaveCount(0, { timeout: 6000 });
    await expect(page.locator("web-agent-bubble")).toHaveCount(1);
  });

  test("does not mistake own open panel for foreign agent on DOM mutation", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
    });

    const page = await context.newPage();
    await page.goto("http://localhost:10040/plain.html");

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible();
    await launcher.click();

    // Panel is opened inside own shadow root
    await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached();

    // Trigger arbitrary DOM mutation on light DOM
    await page.evaluate(() => {
      const p = document.createElement("p");
      p.textContent = "dynamically added text";
      document.body.appendChild(p);
    });

    // Bubble must remain intact
    await page.waitForTimeout(200);
    await expect(page.locator("web-agent-bubble")).toHaveCount(1);
    await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached();
  });
});
