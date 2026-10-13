import { test, expect } from "./extension.fixture";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, "../dist");
const DIST_ALL_URLS = path.resolve(HERE, "../temp/e2e-extensions/brand-manifest/all-urls");
const USER_DATA_DIR = "/tmp/playwright-brand-manifest-mock-profile";

test("LP3: <all_urls> grants cross-origin fetch with no permission prompt", async () => {
  test.setTimeout(120_000);
  await fs.rm(USER_DATA_DIR, { recursive: true, force: true });
  await fs.rm(DIST_ALL_URLS, { recursive: true, force: true });

  await fs.cp(EXTENSION, DIST_ALL_URLS, { recursive: true });
  const manifestPath = path.join(DIST_ALL_URLS, "manifest.json");
  const manifestContent = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifestContent.host_permissions = ["<all_urls>"];
  await fs.writeFile(manifestPath, JSON.stringify(manifestContent, null, 2), "utf8");

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    channel: "chromium",
    args: [`--disable-extensions-except=${DIST_ALL_URLS}`, `--load-extension=${DIST_ALL_URLS}`],
  });

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    const fetchStatus = await worker.evaluate(async () => {
      const res = await fetch("https://example.com/");
      return res.status;
    });
    expect(fetchStatus).toBe(200);

    const allPermissions = await worker.evaluate(async () => {
      return await chrome.permissions.getAll();
    });
    expect(allPermissions.origins).toContain("<all_urls>");
  } finally {
    await context.close();
  }
});
