import path from "path";
import { test, expect } from "./fixtures";
import { chooseTheme, openPanel, sendChat, submitComposer, waitForTurnComplete } from "./helpers";

test.skip(process.env.E2E_ENV !== "mock", "mock tier is mock-only");
test.use({ viewport: { width: 1024, height: 768 }, consoleErrorExtraAllowlist: ["Compaction failed:"] });

// Task-file stem, not a bare order number — see AGENTS.md artifact hygiene rules.
const ARTIFACTS_DIR = path.resolve(
  __dirname,
  "../../../temp/artifacts/compaction-progress-indicator",
);

// Task-file stem, not a bare order number — see AGENTS.md artifact hygiene rules.
const DRAIN_ARTIFACTS_DIR = path.resolve(
  __dirname,
  "../../../temp/artifacts/drain-queue-after-manual-compact",
);

/**
 * Builds the `window.__WA_MOCK_SCRIPT__` source as a string, embedding
 * `compactionResponse` as a JSON literal rather than a closure — `.toString()`
 * on a closure only serializes the function's own source text, dropping any
 * variable it captured from an outer scope, so a closure-based script throws
 * a ReferenceError the moment it runs in the page.
 *
 * Branches on the call: a compaction summarize call is the live conversation
 * history plus one appended user turn carrying `SUMMARY_INSTRUCTION`
 * (packages/web-agent-core/src/loop/compaction.ts,
 * `summariseInCachedConversation`) — detected by that instruction text on the
 * LAST message, since the request also carries every prior turn (unlike the
 * old single-message `buildSummaryPrompt` request). Everything else is a
 * normal chat turn.
 */
function mockScriptSource(compactionResponse: unknown): string {
  return `window.__WA_MOCK_SCRIPT__ = function (opts) {
    var lastMsg = opts.messages[opts.messages.length - 1];
    var isCompactionCall = lastMsg &&
      lastMsg.role === "user" &&
      typeof lastMsg.content === "string" &&
      lastMsg.content.indexOf("structured summary of the conversation so far") !== -1;
    if (isCompactionCall) return ${JSON.stringify(compactionResponse)};
    var userTurns = opts.messages.filter(function (m) { return m.role === "user"; }).length;
    return { text: "ok " + userTurns, finishReason: "stop" };
  };`;
}

/** Manual compaction needs at least 4 completed turns — kTurnsVerbatim is 3. */
async function sendFourTurns(page: import("@playwright/test").Page) {
  for (let i = 1; i <= 4; i++) {
    await sendChat(page, `turn ${i}`);
    await waitForTurnComplete(page);
  }
}

async function toggleTheme(page: import("@playwright/test").Page) {
  const current = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await chooseTheme(page, current === "wa2-light" ? "wa2-dark" : "wa2-light");
}

/**
 * Waits for the reused working-dots row to mount and finish its entrance fade
 * (cat-store's registry override, apps/cat-store/src/acme-registry.ts, animates
 * it in with `wa-fade-in 0.2s 400ms both`).
 *
 * Why the dots used to be invisible: the dot colour resolved to
 * --wa-text-color-disabled, which is 2.26:1 against the light transcript
 * background. The colour now comes from --wa-text-color and is asserted by
 * measured contrast in working-dots.mock.spec.ts. This helper still waits only
 * for mount and fade-in, which is all it needs to do.
 */
async function waitForWorkingDotsMounted(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    () => {
      const row = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector("agent-chat-panel .messages-list > .message-row.assistant");
      if (!row) return false;
      const rect = row.getBoundingClientRect();
      return rect.height > 0 && parseFloat(getComputedStyle(row).opacity) === 1;
    },
    undefined,
    { timeout: 5_000, polling: 50 },
  );
}

test("compaction in flight, then cancelled", async ({ page }) => {
  test.setTimeout(60_000);

  // Held open for 8s so the in-flight state is observable; the stop click
  // cancels it long before it would resolve on its own.
  await page.addInitScript(
    mockScriptSource({ text: "SUMMARY", finishReason: "stop", delayMs: 8_000 }),
  );

  await openPanel(page);
  await sendFourTurns(page);

  const tokensBefore = await page.evaluate(
    () => document.querySelector("agent-context-gauge")?.tokens,
  );

  await page.locator("agent-context-gauge .gauge-wrapper").click();

  const row = page.locator("agent-message-view .compaction-step");
  await expect(row).toHaveAttribute("data-compaction-status", "running", { timeout: 5_000 });
  // The gauge is the same icon, spinning (CSS class on the existing SVG, not a
  // new element) — and the transcript shows the same working-dots row a normal
  // in-progress turn shows, reused unchanged.
  await expect(page.locator("agent-context-gauge .gauge-svg")).toHaveClass(/\bbusy\b/);
  // Scoped to a DIRECT child of .messages-list so this only matches the
  // chat-panel-level "extra" row (not a real message's own .message-row,
  // which lives inside that <agent-message-view>'s shadow root instead).
  // Asserted by DOM presence + geometry here; working-dots.mock.spec.ts asserts
  // the painted colour (measured contrast) that proves the dots are visible.
  await expect(page.locator("agent-chat-panel .messages-list > .message-row.assistant")).toBeVisible();
  await expect(
    page.locator('agent-chat-panel .input-area md-icon-button[data-aria-label="Stop"]'),
  ).toBeVisible();
  await expect(
    page.locator('agent-chat-panel .input-area md-icon-button[data-aria-label="Send"]'),
  ).toHaveCount(0);

  // Default theme is dark — capture light first (undecorated filename), then dark.
  await toggleTheme(page);
  await waitForWorkingDotsMounted(page);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "01-compaction-in-flight.png") });
  await toggleTheme(page);
  await waitForWorkingDotsMounted(page);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "01-compaction-in-flight-dark.png") });

  await page.locator('agent-chat-panel .input-area md-icon-button[data-aria-label="Stop"]').click();

  await expect(row).toHaveAttribute("data-compaction-status", "cancelled", { timeout: 5_000 });
  await expect(page.locator("agent-context-gauge .gauge-svg")).not.toHaveClass(/\bbusy\b/);
  await expect(page.locator("agent-chat-panel .messages-list > .message-row.assistant")).toHaveCount(0);
  await expect(
    page.locator('agent-chat-panel .input-area md-icon-button[data-aria-label="Send"]'),
  ).toBeVisible();
  await expect(row.locator(".tool-step-phrase")).toHaveText("Whiskers compacts its context · cancelled");

  const tokensAfter = await page.evaluate(
    () => document.querySelector("agent-context-gauge")?.tokens,
  );
  expect(tokensAfter).toBe(tokensBefore);

  await toggleTheme(page);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "02-compaction-cancelled.png") });
  await toggleTheme(page);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "02-compaction-cancelled-dark.png") });
});

test("a failed compaction shows the failed row", async ({ page }) => {
  // The compaction call's error is retryable (status 404 is not in the
  // non-retryable set), so the transport middleware retries with backoff
  // until its retries run out, long before runCompaction's 2-minute timeout —
  // settling to "failed" takes real time, not a bug, just the production retry path.
  test.setTimeout(60_000);

  await page.addInitScript(
    mockScriptSource({ error: { message: "Compaction model unavailable", status: 404 } }),
  );

  await openPanel(page);
  await sendFourTurns(page);

  await page.locator("agent-context-gauge .gauge-wrapper").click();

  const row = page.locator("agent-message-view .compaction-step");
  await expect(row).toHaveAttribute("data-compaction-status", "failed", { timeout: 20_000 });
  await expect(row.locator(".tool-step-phrase")).toHaveText("Whiskers compacts its context · failed");

  await toggleTheme(page);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "03-compaction-failed.png") });
  await toggleTheme(page);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, "03-compaction-failed-dark.png") });
});

test("a message queued during a manual compaction fires when the compaction finishes", async ({ page }) => {
  test.setTimeout(60_000);

  // The compaction summarize call is held 4s so the queued message is
  // observable in flight; every normal turn returns "ok N".
  await page.addInitScript(
    mockScriptSource({ text: "SUMMARY", finishReason: "stop", delayMs: 4_000 }),
  );

  await openPanel(page);
  await sendFourTurns(page);

  await page.locator("agent-context-gauge .gauge-wrapper").click();
  await expect(page.locator("agent-message-view .compaction-step")).toHaveAttribute(
    "data-compaction-status",
    "running",
    { timeout: 5_000 },
  );

  // Queue a message while the compaction runs.
  await submitComposer(page, "What is in my cart?");
  await expect(page.locator("agent-chat-panel .wa-queue-item")).toHaveCount(1);
  await expect(page.locator("agent-chat-panel .wa-queue-item .wa-queue-text")).toHaveText(
    "What is in my cart?",
  );

  // The held summarize resolves on its own, then the queued message fires by
  // itself: the queue drains to empty and the transcript gains the message
  // plus an assistant reply.
  await expect(page.locator("agent-chat-panel .wa-queue-item")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("agent-message-view .user .content").last()).toContainText(
    "What is in my cart?",
  );
  await expect(page.locator("agent-message-view .assistant .content").last()).toContainText("ok");

  await toggleTheme(page);
  await page.screenshot({ path: path.join(DRAIN_ARTIFACTS_DIR, "04-compaction-drain-queue.png") });
  await toggleTheme(page);
  await page.screenshot({ path: path.join(DRAIN_ARTIFACTS_DIR, "04-compaction-drain-queue-dark.png") });
});
