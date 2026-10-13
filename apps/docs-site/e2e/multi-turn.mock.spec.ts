import { test, expect } from './fixtures';
import { openBubble, sendChat, waitForAssistantReply, waitForTurnComplete, installMockScript } from './helpers';
import { docsMultiTurnScript } from '../src/e2e-mock/mock-scripts';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'e2e-screenshots');

test.describe.configure({ retries: 1 });

// Tolerate transient backend 5xx ("Failed to load resource") so a cloud LLM
// hiccup doesn't mask the real regression we guard (MissingToolResultsError).
test.use({ consoleErrorExtraAllowlist: ['Failed to load resource'] });

test('multi-turn: 5 tool-driven turns in one docs session surface no error', async ({ page }) => {
  test.setTimeout(600_000);

  // The mock removes every model request, so `page.goto('', { waitUntil:
  // 'networkidle' })` inside openBubble can settle. With a live call in
  // flight it timed out at 30 s (multi-turn.mock.spec.ts:20 failure).
  const modelCalls = await installMockScript(page, docsMultiTurnScript);
  await openBubble(page);

  // The mock is turn-index driven and ignores the prompt text; these strings
  // stay as written so the spec still documents what a real session asks.
  // Docs-host prompts chosen to reliably trigger this host's tools
  // (snapshot/summarize/search_docs) across turns, all in ONE session —
  // no New Session between turns.
  const PROMPTS = [
    'Take a snapshot of this page and tell me what it covers.',
    'Summarize the page I am currently on.',
    'Use search_docs to find pages about the registry and list a couple of them.',
    'Take another snapshot and tell me the page title.',
    'Use search_docs to find pages about theming and list a couple of them.',
  ];

  for (const prompt of PROMPTS) {
    await sendChat(page, prompt);
    await waitForTurnComplete(page, 180_000);

    // Per-turn guard: fail fast ONLY on the tool-results regression.
    // Transient backend 5xx is tolerated — the final text scan is definitive.
    const errCount = await page.locator('agent-chat-panel .wa-notice[data-tone="error"]').count();
    if (errCount > 0) {
      const errText = await page.locator('agent-chat-panel .wa-notice[data-tone="error"]').innerText();
      expect(errText).not.toMatch(/Tool results are missing|MissingToolResultsError/i);
    }

    // Deterministic: the last assistant message is non-empty.
    const lastReply = await waitForAssistantReply(page, 60_000);
    expect(lastReply.length).toBeGreaterThan(0);
  }

  // Final no-error assertions
  const panelError = await page.evaluate(
    () => (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel')?.error ?? null,
  );
  expect(panelError).toBeNull();

  // Scan raw tool outcomes from panel state (audit log retired to the debug screen).
  const outcomes = await page.evaluate(() => {
    const panel = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const messages = panel?.messages ?? [];
    return messages
      .flatMap((m) => m.trace ?? [])
      .map((t) => t.outcomeSummary ?? '')
      .join(' ');
  });
  expect(outcomes).not.toMatch(/Tool results are missing|MissingToolResultsError/i);
  expect(modelCalls()).toBe(0);

  // Transient end-of-session screenshot (deleted on review pass, per hygiene).
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'multi-turn-docs-end.png') });
});