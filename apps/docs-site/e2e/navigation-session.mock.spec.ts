/**
 * Regression guard: agent turn → client-side hash route change → second agent turn.
 * Previously full-page navigation reloaded the page and disposed the session (the core
 * 026 bug class). The SPA must keep the bubble and its session alive across hash
 * route changes. All assertions are deterministic — no LLM-wording checks; we assert
 * each turn completes, reply is non-empty, route changed, bubble is the same JS instance,
 * and no MissingToolResultsError appears in the panel.
 */
import { test, expect } from './fixtures';
import { openBubble, sendChat, waitForAssistantReply, waitForTurnComplete, installMockScript } from './helpers';
import { docsProseReplyScript } from '../src/e2e-mock/mock-scripts';

test('agent-turn → client-nav → agent-turn: bubble survives, no MissingToolResultsError', async ({ page }) => {
  test.setTimeout(300_000);

  // Installing the mock BEFORE openBubble is both the fix and the diagnostic:
  // the 5-minute hang was a live model call that never let the turn settle.
  const modelCalls = await installMockScript(page, docsProseReplyScript);
  await openBubble(page);

  // ── Turn 1: fire an agent turn on the default route ────────────────────────
  await sendChat(page, 'Summarize the page I am currently on.');
  await waitForTurnComplete(page, 120_000);
  const firstReply = await waitForAssistantReply(page, 30_000);
  expect(firstReply.length).toBeGreaterThan(0);

  // ── Mark the bubble instance and set a no-reload sentinel ─────────────────
  await page.evaluate(() => {
    window.__noReloadSentinel = 'alive';
    const b = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble');
    if (b) b.__instanceMark = 'nav-regression-guard';
  });

  // ── Client-side hash nav — click a sidebar link, no page reload ───────────
  await page.locator('docs-app .side-nav a[href="#/guides/architecture"]').first().click();
  await expect(page).toHaveURL(/#\/guides\/architecture$/);
  await expect(page.locator('docs-app article')).toHaveAttribute('data-slug', 'architecture');

  // Verify no reload happened
  const noReload = await page.evaluate(() => window.__noReloadSentinel);
  expect(noReload).toBe('alive');

  // Verify bubble is the SAME JS instance (session not disposed)
  const instanceMark = await page.evaluate(() => {
    const b = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble');
    return b ? b.__instanceMark : null;
  });
  expect(instanceMark).toBe('nav-regression-guard');

  // ── Turn 2: second agent turn on the new route — must complete without error ─
  await sendChat(page, 'Summarize the page I am currently on.');
  await waitForTurnComplete(page, 120_000);
  const secondReply = await waitForAssistantReply(page, 30_000);
  expect(secondReply.length).toBeGreaterThan(0);

  // Definitive guard: no MissingToolResultsError anywhere in the panel
  const panelText = await page.locator('agent-chat-panel').innerText();
  expect(panelText).not.toMatch(/Tool results are missing|MissingToolResultsError/i);
  expect(modelCalls()).toBe(0);
});
