import path from 'path';
import fs from 'fs';
import { test, expect } from './fixtures';
import { openPanel } from './helpers';
import type { SessionMessage, SessionMessagePart } from '@cuatoi/web-agent-core';

test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

const ARTIFACTS_DIR = path.resolve(
  __dirname, '..', '..', '..', 'tasks', 'artifacts',
  '2026-09-08-204122-008-chat-message-window',
);

/** One turn: a user bubble, then an assistant bubble carrying `tools` chips.
 *  Rows per turn = 1 + 1 + tools. Built in Node and passed to the page as a
 *  serializable argument — no need to reconstruct it in-browser. */
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

async function injectMessages(page: import('@playwright/test').Page, messages: SessionMessage[]) {
  await page.evaluate(async (msgs) => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as
      { messages: unknown; updateComplete: Promise<unknown> } | null | undefined;
    if (!panel) throw new Error('agent-chat-panel not found');
    panel.messages = msgs;
    await panel.updateComplete;
  }, messages);
}

async function readCounts(page: import('@playwright/test').Page): Promise<{ views: number; rows: number }> {
  return page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const list = panel?.querySelector('.messages-list');
    const views = list?.querySelectorAll('agent-message-view').length ?? 0;
    const tools = list?.querySelectorAll('.tool-step').length ?? 0;
    return { views, rows: views + tools };
  });
}

async function firstViewIsUser(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const first = panel?.querySelector('.messages-list agent-message-view');
    return !!first?.querySelector('.user');
  });
}

/** Rows the FIRST rendered turn contributes: its user bubble and everything up
 *  to, but not including, the next user bubble. */
async function firstTurnRows(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const views = [...(panel?.querySelectorAll('.messages-list agent-message-view') ?? [])];
    let count = 0;
    for (const view of views) {
      if (count > 0 && view.querySelector('.user')) break;
      count += 1 + view.querySelectorAll('.tool-step').length;
    }
    return count;
  });
}

async function lastViewMetrics(page: import('@playwright/test').Page): Promise<{ text: string; bottom: number }> {
  return page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const views = [...(panel?.querySelectorAll('.messages-list agent-message-view') ?? [])] as
      (Element & { text?: string })[];
    const last = views[views.length - 1];
    // `.text` is the view's own property (what was assigned), not `.textContent`
    // — the light-DOM `<style>` block is itself a DOM child, so `.textContent`
    // picks up the whole CSS text alongside the message.
    return { text: last?.text ?? '', bottom: last?.getBoundingClientRect().bottom ?? 0 };
  });
}

test.describe('008: the chat message window', () => {
  test('B1-B3: the window bounds what is in the DOM, starts on a user message, and the cut extends to that turn\'s user message', async ({ page }) => {
    await openPanel(page);
    await injectMessages(page, transcript(300));

    // B1
    const counts = await readCounts(page);
    expect(counts.rows).toBe(204);
    expect(counts.views).toBe(68);

    // B2
    expect(await firstViewIsUser(page)).toBe(true);

    // B3
    const rows = await firstTurnRows(page);
    expect(counts.rows).toBeGreaterThanOrEqual(200);
    expect(counts.rows - rows).toBeLessThan(200);
  });

  test('B4: a single turn bigger than the window is shown whole', async ({ page }) => {
    await openPanel(page);
    const bigParts: SessionMessagePart[] = [
      { kind: 'text', text: 'Reply big' },
      ...Array.from({ length: 248 }, (_, k) => ({
        kind: 'tool' as const,
        audit: { ts: 0, name: `tool_${k}`, input: {}, outcomeSummary: 'ok' },
      })),
    ];
    const bigTurn: SessionMessage[] = [
      { role: 'user', text: 'Question big' },
      { role: 'assistant', text: 'Reply big', parts: bigParts },
    ];
    await injectMessages(page, [...transcript(40), ...bigTurn]);

    const counts = await readCounts(page);
    expect(counts.views).toBe(2);
    expect(counts.rows).toBe(250);
    expect(await firstViewIsUser(page)).toBe(true);
  });

  test('B5: a host window of 50 gets fewer rows by the same rules', async ({ page }) => {
    await openPanel(page);
    await injectMessages(page, transcript(300));
    const before = await readCounts(page);

    await page.evaluate(async () => {
      const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
        .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as
        { config: unknown; updateComplete: Promise<unknown> } | null | undefined;
      if (!panel) throw new Error('agent-chat-panel not found');
      panel.config = { messageWindow: 50 };
      await panel.updateComplete;
    });
    await injectMessages(page, transcript(300));

    const after = await readCounts(page);
    const rows = await firstTurnRows(page);
    expect(after.rows).toBeGreaterThanOrEqual(50);
    expect(after.rows - rows).toBeLessThan(50);
    expect(after.rows).toBeLessThan(before.rows);
    expect(after.views).toBeLessThan(before.views);
    expect(await firstViewIsUser(page)).toBe(true);
  });

  test('B6-B7: nothing trims while scrolled off the bottom; returning to the bottom trims back without moving the last row', async ({ page }) => {
    await openPanel(page);
    await injectMessages(page, transcript(300));
    const atBottom = await readCounts(page);

    // Scroll away from the bottom and let the real scroll event settle.
    // 2000, not 0: this case tests "scrolled off the bottom", not "reached
    // the top" — 009 gives literal top-of-list scroll positions (below
    // chat-panel-window.ts's TOP_THRESHOLD_PX) a real, intentional side effect (the
    // scroll-up window load), so 0 here would trigger that unrelated feature
    // and inflate the view count this test checks. A 300-turn transcript
    // renders well over 2000px tall, so this is still nowhere near the top.
    await page.evaluate(() => {
      const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
        .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
      const list = panel?.querySelector('.messages-list') as HTMLElement | null;
      if (list) list.scrollTop = 2000;
    });
    await page.waitForTimeout(200);

    await injectMessages(page, [...transcript(300), ...transcript(20)]);

    // B6
    const scrolledUp = await readCounts(page);
    expect(scrolledUp.views - atBottom.views).toBe(40);

    // B7 — return to the bottom. Record the last row's text and position in
    // the SAME evaluate call that sets scrollTop, so the snapshot is taken the
    // instant the list reaches the bottom, before the (async) scroll handler
    // has a chance to trim and re-pin. That is the fair "before" to compare
    // against the settled "after": both are genuinely at the bottom, so the
    // last row's screen position is comparable across the trim.
    const before = await page.evaluate(() => {
      const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
        .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
      const list = panel?.querySelector('.messages-list') as HTMLElement | null;
      if (list) list.scrollTop = list.scrollHeight;
      const views = [...(panel?.querySelectorAll('.messages-list agent-message-view') ?? [])] as
        (Element & { text?: string })[];
      const last = views[views.length - 1];
      return { text: last?.text ?? '', bottom: last?.getBoundingClientRect().bottom ?? 0 };
    });

    await page.waitForFunction((expected) => {
      const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
        .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
      const views = panel?.querySelectorAll('.messages-list agent-message-view').length ?? 0;
      return views === expected;
    }, atBottom.views, { timeout: 10_000, polling: 100 });

    const after = await readCounts(page);
    expect(after.views).toBe(atBottom.views);
    const last = await lastViewMetrics(page);
    expect(last.text).toBe(before.text);
    expect(Math.abs(last.bottom - before.bottom)).toBeLessThan(2);
  });

  test('B8: a streaming turn still appends and renders normally with the window active', async ({ page }) => {
    await openPanel(page);
    const base = transcript(300);
    const growingTexts = ['Wor', 'Working o', 'Working on it, done.'];

    for (const text of growingTexts) {
      await injectMessages(page, [
        ...base,
        { role: 'user', text: 'Question new' },
        { role: 'assistant', text, pending: true },
      ]);
      const last = await lastViewMetrics(page);
      expect(last.text).toBe(text);
      const counts = await readCounts(page);
      expect(counts.rows).toBeGreaterThanOrEqual(195);
      expect(counts.rows).toBeLessThanOrEqual(215);
    }
  });

  test('B9-B10: screenshots at 480px and 760px', async ({ page }) => {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    await openPanel(page);
    await injectMessages(page, transcript(300));

    // B9 — assert the state, then capture.
    expect(await firstViewIsUser(page)).toBe(true);
    let counts = await readCounts(page);
    expect(counts.rows).toBe(204);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'window-docked-480.png'), fullPage: true });

    // B10 — widen the panel, re-assert, then capture.
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--web-agent-panel-width', '760px');
    });
    const box = await page.locator('agent-chat-panel').boundingBox();
    expect(Math.round(box!.width)).toBe(760);
    expect(await firstViewIsUser(page)).toBe(true);
    counts = await readCounts(page);
    expect(counts.rows).toBe(204);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'window-docked-760.png'), fullPage: true });
  });
});
