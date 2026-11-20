import path from 'path';
import fs from 'fs';
import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { chooseTheme, openPanel } from './helpers';
import type { SessionMessage, SessionMessagePart } from '@cuatoi/web-agent-core';

test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

// Task-file stem, not a bare order number — see AGENTS.md artifact hygiene rules.
const ARTIFACTS_DIR = path.resolve(
  __dirname, '..', '..', '..', 'temp', 'artifacts',
  'scroll-up-window-loading',
);

/** One turn: a user bubble, then an assistant bubble carrying `tools` chips.
 *  Built in Node and passed to the page as a serializable argument. */
function turn(n: number, tools: number): SessionMessage[] {
  const parts: SessionMessagePart[] = [
    { kind: 'text', text: `Reply ${n}` },
    ...Array.from({ length: tools }, (_, k) => ({
      kind: 'tool' as const,
      audit: { ts: 0, name: `tool_${k}`, input: {}, outcomeSummary: 'ok' },
    })),
  ];
  return [
    { role: 'user', text: `Question ${n}` },
    { role: 'assistant', text: `Reply ${n}`, parts },
  ];
}

function transcript(turns: number, tools = 4): SessionMessage[] {
  return Array.from({ length: turns }, (_, i) => turn(i, tools)).flat();
}

async function injectMessages(page: Page, messages: SessionMessage[]) {
  await page.evaluate(async (msgs) => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as
      { messages: unknown; updateComplete: Promise<unknown> } | null | undefined;
    if (!panel) throw new Error('agent-chat-panel not found');
    panel.messages = msgs;
    await panel.updateComplete;
  }, messages);
}

async function readCounts(page: Page): Promise<{ views: number; rows: number }> {
  return page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const list = panel?.querySelector('.messages-list');
    const views = list?.querySelectorAll('agent-message-view').length ?? 0;
    const tools = list?.querySelectorAll('.tool-step').length ?? 0;
    return { views, rows: views + tools };
  });
}

/** The panel's `.messages-list`'s first element child, when it is the
 *  loader — the `<wa-working-dots>` tag, whose own inner `<div>`
 *  carries the fade-in animation and the three `span` children. */
async function readLoaderState(page: Page): Promise<{ present: boolean; spanCount: number; opacity: number }> {
  return page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const list = panel?.querySelector('.messages-list');
    const first = list?.firstElementChild;
    if (!first || first.tagName !== 'WA-WORKING-DOTS') return { present: false, spanCount: 0, opacity: 0 };
    const inner = first.firstElementChild ?? first;
    return {
      present: true,
      spanCount: inner.querySelectorAll('span').length,
      opacity: parseFloat(getComputedStyle(inner).opacity),
    };
  });
}

async function waitForLoaderOpaque(page: Page, timeout = 5_000) {
  await page.waitForFunction(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const first = panel?.querySelector('.messages-list')?.firstElementChild;
    if (!first || first.tagName !== 'WA-WORKING-DOTS') return false;
    const inner = first.firstElementChild ?? first;
    return inner.querySelectorAll('span').length === 3 &&
      parseFloat(getComputedStyle(inner).opacity) === 1;
  }, undefined, { timeout, polling: 50 });
}

async function waitForLoaderGone(page: Page, timeout = 5_000) {
  await page.waitForFunction(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const first = panel?.querySelector('.messages-list')?.firstElementChild;
    return !first || first.tagName !== 'WA-WORKING-DOTS';
  }, undefined, { timeout, polling: 50 });
}

async function scrollListToTop(page: Page) {
  await page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const list = panel?.querySelector('.messages-list') as HTMLElement | null;
    if (list) list.scrollTop = 0;
  });
}

/** Scrolls to the top AND reads the (still pre-prepend) topmost row's text +
 *  viewport `top`, in ONE `page.evaluate` round trip.
 *
 *  `_handleListScroll()`'s dispatch is synchronous up to `_loadOlder`'s first
 *  `await` (`chat-panel-window.ts`), but that first `await` is on Lit's
 *  `updateComplete`, which never resolves inside the SAME microtask turn —
 *  so nothing the load does can land before this callback returns control to
 *  Node. Reading `scrollTop = 0` and the first row's metrics in the same
 *  synchronous callback is what guarantees "before" really means before any
 *  prepend, not merely before some later `page.evaluate` round trip (which
 *  costs enough real time for the load to already have completed). */
async function scrollToTopAndCaptureFirst(page: Page): Promise<{ text: string; top: number }> {
  return page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const list = panel?.querySelector('.messages-list') as HTMLElement | null;
    if (list) list.scrollTop = 0;
    list?.dispatchEvent(new Event('scroll'));
    const first = panel?.querySelector('.messages-list agent-message-view') as
      (Element & { text?: string }) | null;
    return { text: first?.text ?? '', top: first?.getBoundingClientRect().top ?? 0 };
  });
}

/** The top of the row whose `.text` still equals `text` — the reader's row,
 *  wherever it ended up after the prepend. */
async function topOfRowWithText(page: Page, text: string): Promise<number> {
  return page.evaluate((t) => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const views = [...(panel?.querySelectorAll('.messages-list agent-message-view') ?? [])] as
      (Element & { text?: string })[];
    const row = views.find((v) => v.text === t);
    return row?.getBoundingClientRect().top ?? -1;
  }, text);
}

async function lastViewText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const views = [...(panel?.querySelectorAll('.messages-list agent-message-view') ?? [])] as
      (Element & { text?: string })[];
    return views[views.length - 1]?.text ?? '';
  });
}

async function toggleTheme(page: Page) {
  const current = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await chooseTheme(page, current === 'wa2-light' ? 'wa2-dark' : 'wa2-light');
}

/** WCAG 2.x relative luminance + contrast ratio for the top loader's dots
 *  against `.messages-list`'s background — same formula
 *  `working-dots.mock.spec.ts` uses for the bottom loader. */
const CONTRAST_PROBE_TOP = `(() => {
  const parse = (s) => s.match(/[\\d.]+/g).slice(0, 3).map(Number);
  const lum = (rgb) => {
    const c = rgb.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const root = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot ?? document;
  const dot = root.querySelector('agent-chat-panel .messages-list > wa-working-dots:first-child span');
  if (!dot) return null;
  const fg = lum(parse(getComputedStyle(dot).backgroundColor));
  const bg = lum(parse(getComputedStyle(
    root.querySelector('agent-chat-panel .messages-list')
  ).backgroundColor));
  const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  return { ratio, dotColor: getComputedStyle(dot).backgroundColor };
})()`;

async function runContrastProbeTop(page: Page): Promise<{ ratio: number; dotColor: string } | null> {
  return page.evaluate(CONTRAST_PROBE_TOP);
}

test.describe('scroll-up window loading', () => {
  test('B1: the window is active on a 1,800-row transcript', async ({ page }) => {
    await openPanel(page);
    await injectMessages(page, transcript(300, 4));
    const counts = await readCounts(page);
    expect(counts.rows).toBeLessThan(300);
  });

  test('B2: scrolling to the top shows the three-dot loader at the head of the list', async ({ page }) => {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    await openPanel(page);
    await injectMessages(page, transcript(300, 4));
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'mock-01-windowed-bottom.png'), fullPage: true });

    await scrollListToTop(page);
    await waitForLoaderOpaque(page);
    const loader = await readLoaderState(page);
    expect(loader.present).toBe(true);
    expect(loader.spanCount).toBe(3);
    expect(loader.opacity).toBe(1);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'mock-02-loading-top.png'), fullPage: true });
  });

  test('B3-B4: the load prepends older rows, holds the reader\'s row, and removes nothing from the bottom', async ({ page }) => {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    await openPanel(page);
    await injectMessages(page, transcript(300, 4));
    const before = await readCounts(page);
    const lastBefore = await lastViewText(page);

    // Scroll and capture the reader's row in one round trip — see
    // `scrollToTopAndCaptureFirst`'s doc comment for why "before" must be
    // measured here, not before scrolling (off-screen, still pinned to the
    // bottom) and not after `waitForLoaderOpaque` (the prepend has already
    // landed by then; only the loader's own fade-in is still pending).
    const firstBefore = await scrollToTopAndCaptureFirst(page);
    await waitForLoaderOpaque(page);
    await waitForLoaderGone(page);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'mock-03-after-load.png'), fullPage: true });

    const after = await readCounts(page);
    expect(after.rows).toBeGreaterThan(before.rows);
    expect(after.views).toBeGreaterThan(before.views);

    const topAfter = await topOfRowWithText(page, firstBefore.text);
    expect(topAfter).toBeGreaterThanOrEqual(0);
    expect(Math.abs(topAfter - firstBefore.top)).toBeLessThanOrEqual(5);

    expect(await lastViewText(page)).toBe(lastBefore);
  });

  test('B5: repeated scroll-ups keep loading older windows', async ({ page }) => {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    await openPanel(page);
    await injectMessages(page, transcript(300, 4));

    await scrollListToTop(page);
    await waitForLoaderOpaque(page);
    await waitForLoaderGone(page);
    const afterFirst = await readCounts(page);

    await scrollListToTop(page);
    await waitForLoaderOpaque(page);
    await waitForLoaderGone(page);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'mock-04-second-load.png'), fullPage: true });
    const afterSecond = await readCounts(page);

    expect(afterSecond.rows).toBeGreaterThan(afterFirst.rows);
  });

  test('B6: at the start of the session, scrolling to the top shows no loader', async ({ page }) => {
    await openPanel(page);
    await injectMessages(page, transcript(2, 4));

    await scrollListToTop(page);
    await page.waitForTimeout(500);
    const loader = await readLoaderState(page);
    expect(loader.present).toBe(false);
  });

  test('B7: the loader is clearly visible against the messages-list background in the light theme too', async ({ page }) => {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    await openPanel(page);
    await injectMessages(page, transcript(300, 4));
    await toggleTheme(page);

    await scrollListToTop(page);
    await waitForLoaderOpaque(page);
    const loader = await readLoaderState(page);
    expect(loader.present).toBe(true);
    expect(loader.spanCount).toBe(3);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'mock-05-loading-top-light.png'), fullPage: true });

    const result = await runContrastProbeTop(page);
    expect(result).not.toBeNull();
    expect(result!.ratio).toBeGreaterThanOrEqual(3);
    console.log(`[009] light theme top loader: ratio=${result!.ratio.toFixed(2)} color=${result!.dotColor}`);
  });
});
