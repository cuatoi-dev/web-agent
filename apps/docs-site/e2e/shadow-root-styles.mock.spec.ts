import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openBubble, shot } from './helpers';

const SHADOW_HOST_ID = 'wa-shadow-test-host';

/** The title-edit row's children (title input, confirm, cancel — fixed order,
 *  registry-agnostic) plus the header's icon buttons (aria-label is set by
 *  every registry's iconButton(), so this holds for the default registry and
 *  for cat-store's Material registry alike). Returns their bounding rects,
 *  read from whichever `root` the panel currently lives in — a test-created
 *  shadow host's `ShadowRoot` when `hostId` is given, or (003) the bubble's
 *  own OPEN shadow root by default — `agent-chat-panel` is never in the light
 *  DOM when reached through the normal `<web-agent-bubble>` flow any more. */
async function titleEditControlRects(page: Page, hostId: string | null) {
  return page.evaluate((id: string | null) => {
    const root: Document | ShadowRoot = id
      ? document.getElementById(id)!.shadowRoot!
      : ((document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot ?? document);
    const panel = root.querySelector('agent-chat-panel')!;
    const row = panel.querySelector('.wa-title-edit-row')!;
    const iconLabels = ['New session', 'Session history', 'Menu options'];
    const icons = iconLabels
      .map((label) => panel.querySelector(`[aria-label="${label}"]`))
      .filter((el): el is Element => !!el);
    const els = [...row.children, ...icons];
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
  }, hostId);
}

/** AABB overlap test over every pair. A shared edge (zero-width touching
 *  rects, as at the fix's exact boundary) is not an overlap. */
function overlappingPairs(rects: { left: number; right: number; top: number; bottom: number }[]) {
  const pairs: [number, number][] = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const intersects = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      if (intersects) pairs.push([i, j]);
    }
  }
  return pairs;
}

test('the panel keeps its styles inside a shadow root', async ({ page }) => {
  await openBubble(page);

  // Move the live panel into a test-only shadow root. The panel keeps its
  // session; only its position in the tree changes.
  await page.evaluate((hostId) => {
    const root = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot;
    const panel = root?.querySelector('agent-chat-panel');
    if (!panel) throw new Error('agent-chat-panel not found');
    const host = document.createElement('div');
    host.id = hostId;
    host.style.cssText =
      'position:fixed; right:16px; bottom:16px; width:420px; height:640px; z-index:2000;';
    document.body.appendChild(host);
    host.attachShadow({ mode: 'open' }).appendChild(panel);
  }, SHADOW_HOST_ID);

  // The registry sheet travelled with the panel …
  const sheetInShadow = await page.evaluate((hostId) => {
    const root = document.getElementById(hostId)!.shadowRoot!;
    return [...root.querySelectorAll('agent-chat-panel > style')]
      .some((s) => (s.textContent ?? '').includes('.wa-btn'));
  }, SHADOW_HOST_ID);
  expect(sheetInShadow).toBe(true);

  // … and left nothing global behind.
  expect(await page.evaluate(() => !!document.getElementById('wa-registry-styles'))).toBe(false);
  expect(await page.evaluate(() => !!document.getElementById('wa-confirm-scrim-styles'))).toBe(false);

  // Open the inline title editor: confirm and cancel are `.wa-icon-btn`
  // buttons (they were `.wa-btn` text buttons before task 001 of 2026-08-11).
  // Hover the header first — the pencil is pointer-events:none until then
  // (task 001 of 2026-09-07), and Playwright's hit test would fail.
  await page.locator(`#${SHADOW_HOST_ID} agent-chat-panel .header`).hover();
  await page.locator(`#${SHADOW_HOST_ID} [aria-label="Edit session title"]`).click();

  const btn = page.locator(`#${SHADOW_HOST_ID} .wa-title-edit-row button.wa-icon-btn`).first();
  await btn.waitFor({ state: 'visible' });

  const measured = await btn.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      borderRadius: cs.borderRadius,
      width: cs.width,
      height: cs.height,
      inShadow: el.getRootNode() !== document,
    };
  });

  expect(measured.inShadow).toBe(true);
  expect(measured.borderRadius).toBe('50%');   // browser default is 0px
  expect(measured.width).toBe('40px');         // an unstyled button sizes to content
  expect(measured.height).toBe('40px');

  // Regression guard (task 001 rework, commit 3952bc93): the title input,
  // the confirm and cancel icon buttons and the header's icon buttons must
  // never overlap. Before the fix, the cancel control's right edge sat 67px
  // past the icon group's left edge at the panel's default width; here, at
  // the ~420px shadow-host width, they should land flush (0px overlap).
  const rects = await titleEditControlRects(page, SHADOW_HOST_ID);
  // 3 row children (input, confirm, cancel) + 3 icon buttons (new session,
  // history, kebab) — a wrong count means a selector missed an element and
  // the overlap check below would silently pass on too few rects.
  expect(rects.length).toBe(6);
  expect(overlappingPairs(rects)).toEqual([]);

  await shot(page, 'shadow-root-panel-styles.png');
});

test.describe('title-edit header controls never overlap', () => {
  for (const theme of ['wa2-dark', 'wa2-light'] as const) {
    test(`bubble's own shadow root, default width, ${theme}`, async ({ page }) => {
      await openBubble(page);
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);

      await page.locator('agent-chat-panel .header').hover();
      await page.locator('agent-chat-panel [aria-label="Edit session title"]').click();
      await page.locator('agent-chat-panel .wa-title-edit-row').waitFor({ state: 'visible' });

      const rects = await titleEditControlRects(page, null);
      expect(rects.length).toBe(6);
      expect(overlappingPairs(rects)).toEqual([]);
    });
  }
});
