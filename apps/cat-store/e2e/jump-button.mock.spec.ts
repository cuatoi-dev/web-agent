import path from 'path';
import fs from 'fs';
import { test, expect } from './fixtures';
import { openPanel } from './helpers';
import { listThemes } from '@cuatoi/web-agent-lit/themes';
import type { SessionMessage, SessionMessagePart } from '@cuatoi/web-agent-core';

test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

const ARTIFACTS_DIR = path.resolve(
  __dirname, '..', '..', '..', 'tasks', 'artifacts',
  '2026-09-08-204122-010-jump-button-and-gallery-states',
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

function panelLocator(page: import('@playwright/test').Page) {
  return page.locator('cat-agent-widget');
}

async function jumpBtnCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    return panel?.querySelectorAll('.wa-jump-btn').length ?? 0;
  });
}

async function scrollList(page: import('@playwright/test').Page, top: number) {
  await page.evaluate((t) => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const list = panel?.querySelector('.messages-list') as HTMLElement | null;
    if (!list) throw new Error('.messages-list not found');
    list.scrollTop = t;
    list.dispatchEvent(new Event('scroll'));
  }, top);
}

test('jump-button S1 — at the bottom, no button', async ({ page }) => {
  await openPanel(page);
  await injectMessages(page, transcript(80, 4));
  expect(await jumpBtnCount(page)).toBe(0);
  expect(panelLocator(page)).toBeDefined();
});

test('jump-button S2 — scrolled off the bottom, the button appears', async ({ page }) => {
  await openPanel(page);
  await injectMessages(page, transcript(80, 4));
  await scrollList(page, 400);
  await expect.poll(() => jumpBtnCount(page), { timeout: 10_000 }).toBe(1);
});

test('jump-button S3 — press returns the list to the bottom and removes the button', async ({ page }) => {
  await openPanel(page);
  await injectMessages(page, transcript(80, 4));
  await scrollList(page, 400);
  await expect.poll(() => jumpBtnCount(page), { timeout: 10_000 }).toBe(1);

  await page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    // .wa-jump-btn is now the <wa-icon-button> wrapper, whose
    // own click listener sits on the real button one level inside — a real
    // user's mouse click lands there naturally (the wrapper contributes no
    // box of its own), but a JS .click() call must target it explicitly.
    const wrapper = panel?.querySelector('.wa-jump-btn') as HTMLElement | null;
    const field = (wrapper?.querySelector('button, md-icon-button') as HTMLElement | null) ?? wrapper;
    field?.click();
  });
  await expect.poll(() => jumpBtnCount(page), { timeout: 10_000 }).toBe(0);
  const atBottom = await page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const list = panel?.querySelector('.messages-list') as HTMLElement | null;
    if (!list) return false;
    return list.scrollHeight - list.scrollTop - list.clientHeight < 30;
  });
  expect(atBottom).toBe(true);
});

test('jump-button S4/S5 — centred over the list and clear of the composer', async ({ page }) => {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await openPanel(page);
  await injectMessages(page, transcript(80, 4));
  await scrollList(page, 400);
  await expect.poll(() => jumpBtnCount(page), { timeout: 10_000 }).toBe(1);

  for (const width of [480, 760]) {
    await page.evaluate((w) => {
      document.documentElement.style.setProperty('--web-agent-panel-width', `${w}px`);
    }, width);
    const geometry = await page.evaluate(() => {
      const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
        .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
      const wrapper = panel?.querySelector('.wa-jump-btn') as HTMLElement | null;
      const list = panel?.querySelector('.messages-list') as HTMLElement | null;
      const input = panel?.querySelector('.input-area') as HTMLElement | null;
      if (!wrapper || !list || !input) throw new Error('jump button geometry nodes not found');
      // The wrapper is display: contents so it contributes no box
      // of its own; measure the real button that carries the visible geometry.
      const btn = wrapper.querySelector('button, md-icon-button') ?? wrapper;
      const b = btn.getBoundingClientRect();
      const l = list.getBoundingClientRect();
      const i = input.getBoundingClientRect();
      return {
        panelWidth: (panel as HTMLElement).getBoundingClientRect().width,
        centreDelta: Math.abs((b.left + b.right) / 2 - (l.left + l.right) / 2),
        btnBottom: b.bottom,
        inputTop: i.top,
      };
    });
    expect(geometry.centreDelta).toBeLessThan(2);
    expect(geometry.btnBottom).toBeLessThanOrEqual(geometry.inputTop);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, `docked-${width}-scrolled.png`), fullPage: true });
  }
});

test('jump-button S6/S7/S9 — no count, an accessible name, and an SVG glyph', async ({ page }) => {
  await openPanel(page);
  await injectMessages(page, transcript(80, 4));
  await scrollList(page, 400);
  await expect.poll(() => jumpBtnCount(page), { timeout: 10_000 }).toBe(1);

  const facts = await page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const wrapper = panel?.querySelector('.wa-jump-btn') as HTMLElement | null;
    if (!wrapper) throw new Error('.wa-jump-btn not found');
    // aria-label lands on the real button one level inside the wrapper
    //; textContent/querySelector already traverse through it.
    const field = wrapper.querySelector('button, md-icon-button') ?? wrapper;
    return {
      text: wrapper.textContent ?? '',
      label: field.getAttribute('aria-label') ?? field.getAttribute('data-aria-label') ?? '',
      hasSvg: wrapper.querySelector('svg') !== null,
      hasI: wrapper.querySelector('i') !== null,
      hasSpan: wrapper.querySelector('span') !== null,
    };
  });
  expect(facts.text.trim()).toBe('');
  expect(/\d/.test(facts.text)).toBe(false);
  expect(facts.label.trim()).toBeTruthy();
  expect(facts.label).not.toBe('arrow_downward');
  expect(facts.hasSvg).toBe(true);
  expect(facts.hasI).toBe(false);
});

test('jump-button S8 — keyboard focus is visibly indicated', async ({ page }) => {
  await openPanel(page);
  await injectMessages(page, transcript(80, 4));
  await scrollList(page, 400);
  await expect.poll(() => jumpBtnCount(page), { timeout: 10_000 }).toBe(1);

  const outline = await page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const wrapper = panel?.querySelector('.wa-jump-btn') as HTMLElement | null;
    if (!wrapper) throw new Error('.wa-jump-btn not found');
    // The wrapper carries no tabindex of its own — .focus() and
    // the :focus-visible outline both belong to the real button inside it.
    const btn = wrapper.querySelector('button, md-icon-button') ?? wrapper;
    btn.focus();
    const cs = getComputedStyle(btn);
    return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
  });
  expect(outline.style).not.toBe('none');
  expect(outline.width).toBeGreaterThan(0);
});

test('jump-button S10 — in neither the list nor the composer', async ({ page }) => {
  await openPanel(page);
  await injectMessages(page, transcript(80, 4));
  await scrollList(page, 400);
  await expect.poll(() => jumpBtnCount(page), { timeout: 10_000 }).toBe(1);

  const placement = await page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const inList = panel?.querySelector('.messages-list .wa-jump-btn') !== null;
    const inComposer = panel?.querySelector('.input-area .wa-jump-btn') !== null;
    const anchor = panel?.querySelector('.wa-jump-anchor');
    const nextIsInput = anchor?.nextElementSibling?.classList.contains('input-area') ?? false;
    return { inList, inComposer, nextIsInput };
  });
  expect(placement.inList).toBe(false);
  expect(placement.inComposer).toBe(false);
  expect(placement.nextIsInput).toBe(true);
});

test('jump-button S20 — a short transcript never shows the button', async ({ page }) => {
  await openPanel(page);
  await injectMessages(page, transcript(3, 1));
  const facts = await page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as
      { querySelector(s: string): Element | null } | null;
    return panel?.querySelector('.wa-jump-btn') !== null;
  });
  expect(facts).toBe(false);
  expect(await readCounts(page)).toBeDefined();
});

for (const theme of listThemes().map(({ id }) => id)) {
  test(`jump-button gallery window-bottom — ${theme}`, async ({ page }) => {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    await page.goto(`gallery.html?frame=window-bottom&theme=${theme}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForSelector('agent-chat-panel', { timeout: 15_000 });
    const counts = await page.evaluate(() => {
      const panel = document.querySelector('agent-chat-panel');
      const list = panel?.querySelector('.messages-list');
      return {
        views: list?.querySelectorAll('agent-message-view').length ?? 0,
        rows: (list?.querySelectorAll('agent-message-view').length ?? 0) + (list?.querySelectorAll('.tool-step').length ?? 0),
        buttons: panel?.querySelectorAll('.wa-jump-btn').length ?? 0,
      };
    });
    expect(counts.views).toBe(68);
    expect(counts.rows).toBe(204);
    expect(counts.buttons).toBe(0);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, `gallery-window-bottom-${theme}.png`), fullPage: true });
  });

  test(`jump-button gallery window-scrolled — ${theme}`, async ({ page }) => {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    await page.goto(`gallery.html?frame=window-scrolled&theme=${theme}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForSelector('agent-chat-panel', { timeout: 15_000 });
    const facts = await page.evaluate(() => {
      const panel = document.querySelector('agent-chat-panel');
      const list = panel?.querySelector('.messages-list') as HTMLElement | null;
      return {
        rows: (list?.querySelectorAll('agent-message-view').length ?? 0) + (list?.querySelectorAll('.tool-step').length ?? 0),
        buttons: panel?.querySelectorAll('.wa-jump-btn').length ?? 0,
        scrollTop: list?.scrollTop ?? -1,
      };
    });
    expect(facts.rows).toBe(204);
    expect(facts.buttons).toBe(1);
    expect(facts.scrollTop).toBe(400);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, `gallery-window-scrolled-${theme}.png`), fullPage: true });
  });

  test(`jump-button gallery window-loading-older — ${theme}`, async ({ page }) => {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    await page.goto(`gallery.html?frame=window-loading-older&theme=${theme}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForSelector('agent-chat-panel', { timeout: 15_000 });
    const loaderHead = await page.evaluate(() => {
      const panel = document.querySelector('agent-chat-panel');
      const first = panel?.querySelector('.messages-list')?.firstElementChild;
      return { tag: first?.tagName ?? '', spans: first?.querySelectorAll('span').length ?? -1 };
    });
    // The loader is now the <wa-working-dots> tag (its own inner
    // <div> sits one level inside it); querySelectorAll('span') already
    // traverses through that extra level, so the span count is unaffected.
    expect(loaderHead.tag).toBe('WA-WORKING-DOTS');
    expect(loaderHead.spans).toBe(3);
    await page.waitForTimeout(2000);
    // DOM shape is not enough — three spans can
    // be present yet sub-pixel. Assert visibility: non-zero computed opacity
    // AND a non-trivial bounding width on every dot, so a bounce-stuck or
    // scale(0) dot fails this case. If the dots are invisible again, `minW`
    // reads below 1px and this case goes red.
    const visibility = await page.evaluate(() => {
      const panel = document.querySelector('agent-chat-panel');
      const host = panel?.querySelector('.messages-list')?.firstElementChild as HTMLElement | null;
      // The fade-in animation is inline style on the <wa-working-dots> tag's
      // own inner <div>, one level below the host measured above.
      const first = (host?.firstElementChild as HTMLElement | null) ?? host;
      const dots = first ? Array.from(first.querySelectorAll('span')) : [];
      const perDot = dots.map((s) => {
        const cs = getComputedStyle(s);
        return { opacity: parseFloat(cs.opacity), w: s.getBoundingClientRect().width };
      });
      return {
        count: dots.length,
        containerOpacity: first ? parseFloat(getComputedStyle(first).opacity) : -1,
        minOpacity: Math.min(...perDot.map((d) => d.opacity)),
        minW: Math.min(...perDot.map((d) => d.w)),
      };
    });
    expect(visibility.count).toBe(3);
    expect(visibility.containerOpacity).toBeGreaterThan(0);
    expect(visibility.minOpacity).toBeGreaterThan(0);
    expect(visibility.minW).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, `gallery-window-loading-older-${theme}.png`), fullPage: true });
  });

  test(`jump-button gallery window-loaded-older — ${theme}`, async ({ page }) => {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    await page.goto(`gallery.html?frame=window-loaded-older&theme=${theme}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForSelector('agent-chat-panel', { timeout: 15_000 });
    const counts = await page.evaluate(() => {
      const panel = document.querySelector('agent-chat-panel');
      const list = panel?.querySelector('.messages-list');
      return {
        views: list?.querySelectorAll('agent-message-view').length ?? 0,
        rows: (list?.querySelectorAll('agent-message-view').length ?? 0) + (list?.querySelectorAll('.tool-step').length ?? 0),
      };
    });
    expect(counts.views).toBe(136);
    expect(counts.rows).toBe(408);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, `gallery-window-loaded-older-${theme}.png`), fullPage: true });
  });
}

test('jump-button gallery S15 — the catalog renders every state except the deliberate present-demo skip', async ({ page }) => {
  await page.goto('gallery.html?theme=wa2-dark', { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForSelector('figure[data-state]', { timeout: 15_000 });
  const figures = await page.locator('figure[data-state]').count();
  // 36 ids in GALLERY_STATES minus the one deliberate skip: gallery.ts
  // renders no tile for 'present-demo' (it would put blocks-demo's two
  // deliberate rejection charts on the page and break the zero-.error-card
  // assertion in finance-charts.mock.spec.ts). No state is missing.
  expect(figures).toBe(35);
  expect(await page.locator('.error-card').count()).toBe(0);
});
