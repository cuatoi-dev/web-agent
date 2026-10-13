import { test, expect, ask, expectCall } from "./demo-helpers";
import type { Page } from "@playwright/test";

const SITE_A = "http://localhost:10040/plain.html";
const SITE_B = "http://127.0.0.1:10040/plain.html";

/** Clicks Allow on a confirm scrim as soon as it appears, concurrently with an
 *  `ask()`. `create_skill`/`delete_skill` block the turn on `confirmInteraction`
 *  (`skill-tools.ts:167-175,228-236`), so `ask()` would time out unless this
 *  click lands while the turn is pending. */
async function allowConfirm(page: Page, selector: string): Promise<void> {
  const scrim = page.locator(selector);
  await scrim.waitFor({ state: "visible", timeout: 120_000 });
  await scrim.locator("button:has-text('Allow'), md-filled-button:has-text('Allow')").first().click();
}

const BUBBLE_SCRIM = "web-agent-bubble agent-chat-panel .wa-confirm-scrim";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

async function openBubble(page: Page): Promise<void> {
  const launcher = page.locator("web-agent-bubble #launcher");
  await expect(launcher).toBeVisible({ timeout: 20_000 });
  await launcher.click();
  await expect(page.locator("web-agent-bubble agent-chat-panel")).toBeAttached({ timeout: 10_000 });
}

test.describe("Skills — live proof", () => {
  test("skills: create", async ({ demoExtension }) => {
    test.setTimeout(240_000);
    const page = await demoExtension.context.newPage();
    await page.goto(SITE_A);
    await openBubble(page);

    const allow = allowConfirm(page, BUBBLE_SCRIM);
    const { trace } = await ask(page, "Save a skill named pirate_speak that makes you answer like a pirate", { model: demoExtension.model });
    await allow;

    expectCall(trace, "create_skill", (i) => isRecord(i) && i.name === "pirate_speak");

    await page.close();
  });

  test("skills: found on another site", async ({ demoExtension }) => {
    test.setTimeout(300_000);
    const [worker] = demoExtension.context.serviceWorkers();
    await worker.evaluate(() => chrome.storage.local.set({
      enabledOrigins: ["http://localhost:10040", "http://127.0.0.1:10040"],
    }));

    const pageA = await demoExtension.context.newPage();
    await pageA.goto(SITE_A);
    await openBubble(pageA);
    const allow = allowConfirm(pageA, BUBBLE_SCRIM);
    await ask(pageA, "Save a skill named pirate_speak that makes you answer like a pirate", { model: demoExtension.model });
    await allow;

    const pageB = await demoExtension.context.newPage();
    await pageB.goto(SITE_B);
    await openBubble(pageB);

    const { trace } = await ask(pageB, "Use your pirate_speak skill to greet me", { model: demoExtension.model });

    expect(trace.some((t) => t.name === "search_skills" || t.name === "load_skill")).toBe(true);
    expectCall(trace, "load_skill", (i) => isRecord(i) && i.name === "pirate_speak");

    await pageB.close();
    await pageA.close();
  });

  test("skills: delete", async ({ demoExtension }) => {
    test.setTimeout(240_000);
    const [worker] = demoExtension.context.serviceWorkers();
    await worker.evaluate(() => chrome.storage.local.set({
      savedSkills: [{ name: "pirate_speak", description: "Answer like a pirate", definition: "Always answer in pirate voice." }],
    }));

    const page = await demoExtension.context.newPage();
    await page.goto(SITE_A);
    await openBubble(page);

    const allow = allowConfirm(page, BUBBLE_SCRIM);
    const { trace } = await ask(page, "Delete the pirate_speak skill", { model: demoExtension.model });
    await allow;

    expectCall(trace, "delete_skill", { name: "pirate_speak" });

    await page.close();
  });
});
