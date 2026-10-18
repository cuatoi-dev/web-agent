import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect, ask, expectCall } from "./demo-helpers";
import { bodyOf, captionOf, savedPathOf, SAVED_PNG_PATH, SAVED_RECORDING_PATH } from "./saved-files";

// 127/003 — the saving tools against the real model. No mock script anywhere:
// the model decides the calls, the browser really captures, and the file is
// really written. The attached folder is mounted through the existing proof
// hook with the same backend the composer's "Attach folder (read and write)"
// produces, because the folder picker is a native dialog a headless run cannot
// drive; the visible proof drives that flow on the VNC desktop.

/** The site to test against. The default is the local fixture server every
 *  other demo spec uses; set DEMO_SITE_URL to run the same proof against a
 *  deployed app. The origin follows the URL, so nothing else names a host. */
const SITE_URL = process.env.DEMO_SITE_URL ?? "http://localhost:10040/checkout.html";
const SITE_ORIGIN = new URL(SITE_URL).origin;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.resolve(HERE, "../../../../../tasks/artifacts/2026-10-18-110941-003-vfs-write-and-saving-tools");

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

interface StoredFile {
  content: string;
  encoding: string;
  mimeType: string;
}

async function openPanel(
  context: import("@playwright/test").BrowserContext,
  extensionId: string,
): Promise<import("@playwright/test").Page> {
  // demo-helpers enables only the fixture origin; the proof runs on the
  // deployed cat-store, so its origin is enabled the same way.
  const [worker] = context.serviceWorkers();
  await worker.evaluate(async (o: string) => {
    await chrome.storage.local.set({ enabledOrigins: [o] });
  }, SITE_ORIGIN);

  const page = await context.newPage();
  // The proof hook only exposes the handle; it changes no behaviour.
  await page.addInitScript(() => {
    window.__WA_ENABLE_VFS_PROOF__ = true;
  });
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.locator("#agent-row")).toBeVisible();
  await page.locator("#agent-combo").click();
  await expect(page.locator("#agent-list")).toBeVisible();
  await page.locator("#agent-option-tesagent").click();
  await expect(page.locator("#agent-combo .name")).toHaveText("Tesagent");
  await page.waitForFunction(() => window.__WA_VFS_PROOF__?.tesagent !== undefined);
  return page;
}

/** Mounts an empty OPFS folder read and write, exactly as the composer's
 *  "Attach folder (read and write)" choice does. */
async function attachWritableFolder(page: import("@playwright/test").Page, dir: string, prefix: string): Promise<void> {
  await page.evaluate(
    async ({ dir, prefix }) => {
      const hook = window.__WA_VFS_PROOF__!.tesagent;
      const root = await navigator.storage.getDirectory();
      const handle = await root.getDirectoryHandle(dir, { create: true });
      hook.provider.vfs.mount(prefix, hook.directoryBackend(handle, { writable: true }), { external: true });
    },
    { dir, prefix },
  );
}

function storedFile(page: import("@playwright/test").Page, absPath: string): Promise<StoredFile | null> {
  return page.evaluate(async (p) => {
    const f = await window.__WA_VFS_PROOF__!.tesagent.provider.vfs.get(p);
    return f ? { content: f.content, encoding: f.encoding, mimeType: f.mimeType } : null;
  }, absPath);
}

function listedPaths(page: import("@playwright/test").Page, prefix: string): Promise<string[]> {
  return page.evaluate(async (p) => {
    const vfs = window.__WA_VFS_PROOF__!.tesagent.provider.vfs;
    return (await vfs.list(p)).map((e) => e.abs).sort();
  }, prefix);
}

test.describe("VFS saving tools — live proof", () => {
  test("a screenshot is saved to the attached folder and to the default path", async ({ demoExtension }) => {
    test.setTimeout(600_000);
    await fs.mkdir(ARTIFACTS, { recursive: true });

    const sitePage = await demoExtension.context.newPage();
    await sitePage.goto(SITE_URL);
    await expect(sitePage).not.toHaveTitle("");

    const panelPage = await openPanel(demoExtension.context, demoExtension.extensionId);
    await attachWritableFolder(panelPage, "artifacts", "/share/artifacts");
    await sitePage.bringToFront();

    const { trace, error } = await ask(
      panelPage,
      "Call read_tabs, then start_debugging on the tab showing the site, then take a screenshot " +
        'and save it to "/share/artifacts/shots/cart.png" using the save_to argument. Then take ' +
        "a second screenshot with no save_to so it uses the default path. Report both saved paths.",
      { model: demoExtension.model },
    );
    expect(error).toBeNull();
    expectCall(trace, "read_tabs");
    expectCall(trace, "start_debugging");
    expectCall(trace, "page_screenshot", (i) => isRecord(i) && i.save_to === "/share/artifacts/shots/cart.png");
    expectCall(trace, "page_screenshot", (i) => isRecord(i) && i.save_to === undefined);

    const shots = trace.filter((t) => t.name === "page_screenshot");
    expect(shots).toHaveLength(2);
    expect(shots.every((t) => !t.failed)).toBe(true);
    expect(captionOf(shots[0].outcomeSummary)).toMatch(/^Viewport screenshot, \d+ × \d+\.$/);
    expect(shots[0].outcomeSummary).toContain("\nSaved /share/artifacts/shots/cart.png");
    const defaultPath = savedPathOf(shots[1].outcomeSummary);
    expect(defaultPath).toMatch(SAVED_PNG_PATH);
    expect(bodyOf(shots[1].outcomeSummary)).toMatch(/^Viewport screenshot, \d+ × \d+\.$/);

    // The folder really holds the PNG, and it is a PNG.
    expect(await listedPaths(panelPage, "/share/artifacts")).toEqual(["/share/artifacts/shots/cart.png"]);
    const onDisk = await storedFile(panelPage, "/share/artifacts/shots/cart.png");
    expect(onDisk).toMatchObject({ encoding: "base64", mimeType: "image/png" });
    const head = [...atob(onDisk!.content)].slice(0, 8).map((c) => c.charCodeAt(0));
    expect(head).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(atob(onDisk!.content).length).toBeGreaterThan(5000);

    // The Files screen lists both, without a reload.
    await panelPage.getByRole("button", { name: "Menu options" }).click();
    await panelPage.getByRole("menuitem", { name: "Files" }).click();
    await expect(panelPage.locator("agent-files-screen")).toBeVisible();
    // Exact names: "shots" is a substring of /tmp/screenshots.
    const rowNamed = (name: string) =>
      panelPage.locator("agent-files-screen .wa-ftree-row")
        .filter({ has: panelPage.locator(`.wa-ftree-row-name:text-is("${name}")`) });
    await expect(rowNamed("artifacts").first()).toBeVisible();
    // A mount starts expanded, so only expand what is still closed.
    if ((await rowNamed("shots").count()) === 0) await rowNamed("artifacts").first().click();
    await expect(rowNamed("shots").first()).toBeVisible();
    if ((await rowNamed("cart.png").count()) === 0) await rowNamed("shots").first().click();
    await expect(rowNamed("cart.png").first()).toBeVisible();
    await panelPage.screenshot({ path: path.join(ARTIFACTS, "live-01-files-attached-folder.png") });

    await fs.writeFile(
      path.join(ARTIFACTS, "live-screenshot-paths.txt"),
      `${shots[0].outcomeSummary}\n---\n${shots[1].outcomeSummary}\n`,
      "utf8",
    );

    await panelPage.close();
    await sitePage.close();
  });

  test("stop_recording saves the report it returns", async ({ demoExtension }) => {
    test.setTimeout(600_000);
    await fs.mkdir(ARTIFACTS, { recursive: true });

    const sitePage = await demoExtension.context.newPage();
    await sitePage.goto(SITE_URL);
    const panelPage = await openPanel(demoExtension.context, demoExtension.extensionId);
    await sitePage.bringToFront();

    // The turn waits for the user, so the confirmation is answered while it
    // is still running rather than after ask() returns.
    const asked = ask(
      panelPage,
      "Call read_tabs, then start_debugging on the tab showing the site, then start_recording on that tab. " +
        "Wait for the recording to be confirmed, then call stop_recording and tell me the saved path.",
      { model: demoExtension.model },
    );
    const scrim = panelPage.locator('agent-chat-panel:not([hidden]) .wa-confirm-scrim');
    await expect(scrim).toBeVisible({ timeout: 90_000 });
    await panelPage.screenshot({ path: path.join(ARTIFACTS, "live-03-recording-confirm.png") });
    await scrim.locator("button:has-text('Allow'), md-filled-button:has-text('Allow')").first().click();
    await expect(scrim).toHaveCount(0, { timeout: 30_000 });

    const { trace, error } = await asked;
    expect(error).toBeNull();
    expectCall(trace, "start_recording");
    expectCall(trace, "stop_recording");

    const stop = trace.filter((t) => t.name === "stop_recording")[0];
    const saved = savedPathOf(stop.outcomeSummary);
    expect(saved).toMatch(SAVED_RECORDING_PATH);
    const report = bodyOf(stop.outcomeSummary);
    expect(report).toMatch(/^Recorded \d+ steps? on /);

    const stored = await storedFile(panelPage, saved);
    expect(stored).toMatchObject({ content: report, encoding: "utf8" });

    await fs.writeFile(
      path.join(ARTIFACTS, "live-recording-report.md"),
      report + `\n\nSaved ${saved}\n`,
      "utf8",
    );
    await panelPage.screenshot({ path: path.join(ARTIFACTS, "live-02-recording-saved.png") });

    await panelPage.close();
    await sitePage.close();
  });
});