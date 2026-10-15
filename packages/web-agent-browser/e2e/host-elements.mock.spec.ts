import { test, expect, getTabId } from "./extension.fixture";

const URL = "http://localhost:10040/host-wa-button.html";

interface ToggleReply {
  mounted: boolean;
  foreign: boolean;
  requested: "on" | "off";
}

test.describe("Lazy element registration on a host page", () => {
  test("bubble off: the host's own wa-button class wins", async ({ context }) => {
    const page = await context.newPage();
    await page.goto(URL);

    // The host class renders its marker on connect.
    await expect(page.locator("#host-button")).toHaveText("HOST-WA-BUTTON");

    // No extension element was registered and no extension bubble exists.
    const state = await page.evaluate(() => ({
      waButtonIsHost: customElements.get("wa-button")?.name === "HostWaButton",
      bubble: customElements.get("web-agent-bubble"),
      panel: customElements.get("agent-chat-panel"),
    }));
    expect(state.waButtonIsHost).toBe(true);
    expect(state.bubble).toBeUndefined();
    expect(state.panel).toBeUndefined();
    await expect(page.locator("body > web-agent-bubble")).toHaveCount(0);
  });

  test("page agent toggled on: findForeignAgent still blocks mounting", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    const page = await context.newPage();
    await page.goto(URL);
    const tabId = await getTabId(worker, URL);

    const result = await worker.evaluate<ToggleReply, number>(
      (tid) => chrome.tabs.sendMessage<unknown, ToggleReply>(tid, { type: "wa-toggle" }),
      tabId,
    );

    expect(result.requested).toBe("on");
    expect(result.mounted).toBe(false);
    expect(result.foreign).toBe(true);
    await expect(page.locator("body > web-agent-bubble")).toHaveCount(0);
    expect(await page.evaluate(() => customElements.get("wa-button")?.name)).toBe("HostWaButton");
  });
});
