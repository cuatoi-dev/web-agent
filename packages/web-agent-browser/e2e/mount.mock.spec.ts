import { test, expect } from "./extension.fixture";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(HERE, "../../../temp/artifacts/2026-08-16-124449-002-web-agent-browser-extension-package");

test.describe("Extension mount and toggle", () => {
  test("mount lifecycle on plain page", async ({ context }) => {
    // 1. Extension loads
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    expect(worker.url()).toMatch(/^chrome-extension:\/\//);

    const page = await context.newPage();
    page.on("console", (m) => console.log("PAGE LOG:", m.text()));
    page.on("pageerror", (err) => console.error("PAGE ERROR:", err));

    // 2. Golden path — site not yet enabled
    await page.goto("http://localhost:10040/plain.html");
    await expect(page.locator("web-agent-bubble")).toHaveCount(0);

    // 3. Golden path — after enabling
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
    });
    await page.reload();

    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible();
    await expect(page.locator("web-agent-bubble")).toHaveCount(1);

    // 4. The launcher opens the panel
    await launcher.click();
    const panel = page.locator("web-agent-bubble agent-chat-panel");
    await expect(panel).toBeAttached();

    // 7. Screenshot artifact
    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "01-bubble-open-fixture.png") });

    // 5. The choice survives a reload
    await page.reload();
    await expect(page.locator("web-agent-bubble")).toHaveCount(1);

    // 6. Turning it off
    await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      for (const t of tabs) {
        if (t.id != null) {
          try {
            await chrome.tabs.sendMessage(t.id, { type: "wa-toggle" });
          } catch {
            // ignore tabs with no listener
          }
        }
      }
    });

    await expect(page.locator("web-agent-bubble")).toHaveCount(0);
    const storedOrigins = await worker.evaluate(async () => {
      const got = await chrome.storage.local.get("enabledOrigins");
      return got.enabledOrigins as string[];
    });
    expect(storedOrigins).not.toContain("http://localhost:10040");
  });

  test("programmatic toolbar action toggles extension bubble on and off", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    const page = await context.newPage();
    await page.goto("http://localhost:10040/plain.html");

    // 1. Initially disabled on this origin
    await expect(page.locator("web-agent-bubble")).toHaveCount(0);

    // 2. Trigger toolbar action message from worker for active tab
    await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true });
      for (const t of tabs) {
        if (t.id != null) {
          try {
            await chrome.tabs.sendMessage(t.id, { type: "wa-toggle" });
          } catch {
            // ignore
          }
        }
      }
    });

    // 3. Bubble mounts on page and storage is updated
    const launcher = page.locator("web-agent-bubble #launcher");
    await expect(launcher).toBeVisible();
    await expect(page.locator("web-agent-bubble")).toHaveCount(1);

    // 4. Capture artifact for programmatic toolbar toggle
    await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "05-toolbar-action-toggle.png") });

    const storedOrigins = await worker.evaluate(async () => {
      const got = await chrome.storage.local.get("enabledOrigins");
      return (got.enabledOrigins as string[]) || [];
    });
    expect(storedOrigins).toContain("http://localhost:10040");

    // 5. Trigger toolbar action message again -> bubble unmounts and origin is removed
    await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true });
      for (const t of tabs) {
        if (t.id != null) {
          try {
            await chrome.tabs.sendMessage(t.id, { type: "wa-toggle" });
          } catch {
            // ignore
          }
        }
      }
    });

    await expect(page.locator("web-agent-bubble")).toHaveCount(0);
    const updatedOrigins = await worker.evaluate(async () => {
      const got = await chrome.storage.local.get("enabledOrigins");
      return (got.enabledOrigins as string[]) || [];
    });
    expect(updatedOrigins).not.toContain("http://localhost:10040");
  });
});
