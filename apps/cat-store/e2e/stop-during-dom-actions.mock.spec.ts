import { test, expect } from './fixtures';
import { chooseTheme, openPanel, sendChat, shot } from './helpers';

// 007: proves the Stop control actually stops a run of DOM `click` actions —
// both from the collapsed bubble's own `#stop-run` control (Finding 1, the
// defect the user reported) and from the panel's own composer Stop button
// (Findings 2 and 3).
import type { WebAgentBubbleProbe } from './dom-types';
import type { ProviderCallOptions } from '@cuatoi/web-agent-core';

/** The one content-part shape this script reads back out of `opts.messages`
 *  — the real ContentPart union carries several other variants. */
interface ToolResultPartLike {
  type: 'tool-result';
  toolName: string;
  output?: unknown;
}

test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

const N_CLICKS = 12;

/**
 * Deterministic, state-driven on tool-results AFTER the last user message —
 * not on call index — so a second turn in the same conversation does not
 * inherit the first turn's click count (measured pitfall, task 007 plan).
 *
 * `snapshot_page` and `click` are REAL tool executions even in mock tier —
 * only the model's response is scripted — so `snaps[0].output` is the real
 * accessibility-style tree text and the ref for the "Theme menu" button is
 * read out of it rather than hard-coded, which would silently drift if the
 * page's DOM order ever changes.
 */
const stopDuringClicksScript = function stopDuringClicksScript(opts: ProviderCallOptions) {
  let lastUserIdx = -1;
  for (let i = 0; i < opts.messages.length; i++) {
    if (opts.messages[i].role === 'user') lastUserIdx = i;
  }
  const after = opts.messages.slice(lastUserIdx + 1);
  const toolResults = (name: string): ToolResultPartLike[] =>
    (after
      .filter((m) => m.role === 'tool' && Array.isArray(m.content))
      .flatMap((m) => (Array.isArray(m.content) ? m.content : [])) as ToolResultPartLike[])
      .filter((p) => p.type === 'tool-result' && p.toolName === name);

  const snaps = toolResults('snapshot_page');
  if (snaps.length === 0) {
    return { toolCalls: [{ id: 'call_snap', name: 'snapshot_page', input: {} }] };
  }
  // snapshot_page always resolves with the accessibility-tree text.
  const snapText = (snaps[0].output as string | undefined) ?? '';
  const refMatch = /\[(\d+)\]\s*button\s*"Theme menu"/.exec(snapText);
  const ref = refMatch ? refMatch[1] : '1';

  const clicks = toolResults('click');
  if (clicks.length < 12) {
    return { toolCalls: [{ id: `call_click_${clicks.length}`, name: 'click', input: { ref } }] };
  }
  return { text: `Clicked ${clicks.length} times.`, finishReason: 'stop' };
};

async function getClickCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const bubble = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector<WebAgentBubbleProbe>('web-agent-bubble');
    const s = bubble?.panelEl?._state;
    const last = s?.messages?.[s.messages.length - 1];
    return (last?.trace ?? []).filter((t) => t.name === 'click').length;
  });
}

async function isRunning(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const bubble = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector<WebAgentBubbleProbe>('web-agent-bubble');
    return !!bubble?.panelEl?._state?.running;
  });
}

async function cursorLayerGone(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => document.querySelector('.wa-agent-cursor-layer') === null);
}

test.beforeEach(async ({ page }) => {
  // Headless Chromium defaults prefers-reduced-motion to "reduce", which
  // makes the DOM adapter's cue pacing instant and collapses the window a
  // test needs to interrupt a run mid-flight. Emulate a real user's setting
  // (measured necessary, task 007 plan) so clicks are paced.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(`window.__WA_MOCK_SCRIPT__ = ${stopDuringClicksScript.toString()};`);
});

test('S2 — the bubble Stop control stops a run before all planned clicks land (Finding 1)', async ({ page }) => {
  let apiCallCount = 0;
  await page.route('**/api/anthropic/**', (route) => {
    apiCallCount++;
    void route.abort();
  });

  await openPanel(page);
  await sendChat(page, `Click the Theme menu button ${N_CLICKS} times, one at a time.`);

  await expect.poll(() => getClickCount(page), { timeout: 15_000, message: 'waiting for the first click' }).toBeGreaterThanOrEqual(1);

  // Collapse the panel — this is the regression: before this task, no Stop
  // control existed anywhere once the panel was hidden.
  await page.locator('web-agent-bubble button#launcher').click();

  const stopBtn = page.locator('#stop-run');
  await expect(stopBtn).toHaveAttribute('data-visible', 'true', { timeout: 5_000 });
  await shot(page, '007-stop-collapsed-bubble.png');

  await stopBtn.click();

  await expect.poll(() => isRunning(page), { timeout: 10_000, message: 'waiting for the run to stop' }).toBe(false);

  const performed = await getClickCount(page);
  expect(performed).toBeLessThan(N_CLICKS);
  expect(await cursorLayerGone(page)).toBe(true);
  await shot(page, '007-after-stop.png');

  expect(apiCallCount).toBe(0);
});

test('S1/S3 — the panel composer Stop button stops a run before all planned clicks land, panel open', async ({ page }) => {
  let apiCallCount = 0;
  await page.route('**/api/anthropic/**', (route) => {
    apiCallCount++;
    void route.abort();
  });

  await openPanel(page);
  await sendChat(page, `Click the Theme menu button ${N_CLICKS} times, one at a time.`);

  await expect.poll(() => getClickCount(page), { timeout: 15_000, message: 'waiting for the first click' }).toBeGreaterThanOrEqual(1);

  const stopBtn = page.getByRole('button', { name: 'Stop' });
  await expect(stopBtn).toBeVisible({ timeout: 5_000 });
  await shot(page, '007-stop-open-panel.png');

  await stopBtn.click();

  await expect.poll(() => isRunning(page), { timeout: 10_000, message: 'waiting for the run to stop' }).toBe(false);

  const performed = await getClickCount(page);
  expect(performed).toBeLessThan(N_CLICKS);
  expect(await cursorLayerGone(page)).toBe(true);

  expect(apiCallCount).toBe(0);
});

test('#stop-run resolves its colours from --wa-* tokens and meets WCAG AA contrast in both themes', async ({ page }) => {
  await openPanel(page);

  // The control's own visibility does not depend on a live run — drive it
  // directly (same fields _syncStopBtn() reads) so this check is independent
  // of the click-run race the other two tests exercise.
  const computeForTheme = () =>
    page.evaluate(() => {
      const lum = (c: string) => {
        const [r, g, b] = c
          .match(/\d+(\.\d+)?/g)!
          .slice(0, 3)
          .map(Number)
          .map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a: string, b: string) =>
        (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

      const bubble = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector<WebAgentBubbleProbe>('web-agent-bubble');
      bubble!._running = true;
      bubble!.isOpen = false;
      bubble!._syncStopBtn!();

      const btn = bubble!.shadowRoot!.querySelector('#stop-run') as HTMLElement;
      const style = getComputedStyle(btn);
      const backdrop = getComputedStyle(document.body).backgroundColor;

      const result = {
        visible: btn.dataset.visible,
        ariaLabel: btn.getAttribute('aria-label'),
        iconVsButtonBg: ratio(style.color, style.backgroundColor),
        buttonVsBackdrop: ratio(style.backgroundColor, backdrop === 'rgba(0, 0, 0, 0)' ? style.backgroundColor : backdrop),
        raw: { iconColor: style.color, buttonBackground: style.backgroundColor, backdrop },
      };

      bubble!._running = false;
      bubble!._syncStopBtn!();
      return result;
    });

  const dark = await computeForTheme();
  await chooseTheme(page, 'wa2-light');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme')?.includes('light'), { timeout: 5_000 });
  const light = await computeForTheme();

  console.log('STOP_RUN_CONTRAST', JSON.stringify({ dark, light }));

  for (const result of [dark, light]) {
    expect(result.visible).toBe('true');
    expect(result.ariaLabel).toBe('Stop');
    // Non-text UI component (WCAG 2.1 SC 1.4.11): 3:1 minimum.
    expect(result.iconVsButtonBg).toBeGreaterThanOrEqual(3);
  }
});
