import { test, expect } from './fixtures';
import {
  openPanel,
  attachImage,
  pasteImage,
  dropImage,
  shot,
  attachmentIcon,
} from './helpers';
import type { ChatPanelProbe } from './dom-types';

test.describe.configure({ mode: 'serial' });
test.skip(process.env.E2E_ENV !== "mock", "mock tier is mock-only");

test.beforeEach(async ({ page }) => {
  await openPanel(page);
  const imageInput = await page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    return panel?.imageInput !== false;
  });
  test.skip(!imageInput, 'imageInput is disabled on this host');
});

test('attach: file input -> composer thumbnail', async ({ page }) => {
  test.setTimeout(180_000);
  await expect(attachmentIcon(page)).toBeVisible();
  await attachImage(page);
  const thumb = page.locator('agent-chat-panel .wa-thumb-strip img');
  await expect(thumb).toBeVisible();

  // The staged thumbnail is a matted card. The mat must not grow the
  // 56x56 outer footprint, and it must be a different surface from the strip.
  const box = (await thumb.boundingBox())!;
  expect(Math.round(box.width)).toBe(56);
  expect(Math.round(box.height)).toBe(56);

  const card = await thumb.evaluate((el) => {
    const cs = getComputedStyle(el);
    const strip = (el.parentElement as HTMLElement).parentElement as HTMLElement;
    return {
      boxSizing: cs.boxSizing,
      pad: parseFloat(cs.paddingTop),
      padLeft: parseFloat(cs.paddingLeft),
      bg: cs.backgroundColor,
      stripBg: getComputedStyle(strip).backgroundColor,
      wrap: (el.parentElement as HTMLElement).getBoundingClientRect().width,
    };
  });
  expect(card.boxSizing).toBe('border-box');
  expect(card.pad).toBeGreaterThanOrEqual(3);      // a visible mat exists
  expect(card.pad).toBe(card.padLeft);             // equal on all four sides
  expect(card.bg).not.toBe('rgba(0, 0, 0, 0)');    // the mat is filled
  expect(card.bg).not.toBe(card.stripBg);          // and is not the strip surface
  expect(Math.round(card.wrap)).toBe(56);          // card fills its wrap exactly
  await shot(page, 'img-01-attach.png');
});

test('paste: clipboard -> composer thumbnail', async ({ page }) => {
  test.setTimeout(180_000);
  await pasteImage(page);
  await expect(page.locator('agent-chat-panel .wa-thumb-strip img')).toBeVisible();
  await shot(page, 'img-02-paste.png');
});

test('drag-drop: -> composer thumbnail', async ({ page }) => {
  test.setTimeout(180_000);
  await dropImage(page);
  await expect(page.locator('agent-chat-panel .wa-thumb-strip img')).toBeVisible();
  await shot(page, 'img-03-drop.png');
});

test('downscale hint toast', async ({ page }) => {
  test.setTimeout(180_000);
  await page.evaluate(() => {
    window.__toasts = [];
    document.addEventListener('agent-toast', (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string } | string>).detail;
      const message = typeof detail === 'string' ? detail : detail?.message;
      window.__toasts!.push(message ?? '');
    });
  });
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 2400;
    c.height = 2400;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 2400, 2400);
    g.addColorStop(0, 'red');
    g.addColorStop(1, 'blue');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2400, 2400);
    const blob = await new Promise<Blob>((resolve, reject) => {
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png');
    });
    const file = new File([blob], 'big.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const area = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel .input-area');
    if (area) {
      area.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      area.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }
  });
  await page.waitForFunction(() => {
    const s = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel .wa-thumb-strip') as HTMLElement | null;
    return s && getComputedStyle(s).display !== 'none' && s.querySelector('img');
  }, { timeout: 10_000, polling: 500 });
  await expect.poll(() => page.evaluate(() => {
    const root = document.querySelector('app-root')?.shadowRoot;
    if (!root) return '';
    const host = root.querySelector('toast-host');
    if (!host?.shadowRoot) return '';
    return host.shadowRoot.querySelector('.toast')?.textContent?.trim() ?? '';
  }), { timeout: 10_000 }).toMatch(/resiz|fit size|scal/i);
  await shot(page, 'img-04-downscale.png');
});
