import { test, expect } from './fixtures';
import { openPanel, shot } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

// Tag-agnostic, same convention as attachment-provider-removal.mock.spec.ts:
// cat-store aliases ui/registry.js to acme-registry.ts, whose iconButton()
// renders <md-icon-button>, not the default registry's native <button>.
const ICONS = 'agent-chat-panel .composer-controls [data-attachment-provider]';

test.describe('page overlay styles — picker + grip (task 002)', () => {
  test.beforeEach(async ({ page }) => {
    await openPanel(page);
    // openPanel() navigates to the app root (landing-view, no products) — route
    // to the store view via the same SPA dispatch gotoCart() uses (helpers.ts),
    // not a page.goto('store') reload, which would tear down the open panel.
    await page.evaluate(() => {
      const s = window.__APP_STORE__;
      if (s) s.dispatch({ type: 'ui/setRoute', payload: '/store' });
    });
    await page.locator('product-card').first().waitFor({ state: 'visible', timeout: 15_000 });
  });

  test('G2-G6: no stylesheet reaches document.head', async ({ page }) => {
    const heads = await page.evaluate(() => ({
      picker: document.getElementById('wa-dom-picker-styles'),
      cursor: document.getElementById('wa-agent-cursor-styles'),
      grip: document.getElementById('wa-resize-grip-style'),
      chart: document.getElementById('agent-chart-block-styles'),
      waStylesInHead: document.head.querySelectorAll('style[data-wa-styles]').length,
    }));
    expect(heads.picker).toBeNull();
    expect(heads.cursor).toBeNull();
    expect(heads.grip).toBeNull();
    expect(heads.chart).toBeNull();
    expect(heads.waStylesInHead).toBe(0);
  });

  test('V1-V4: the picker outline and strip render, styled from their own local sheets', async ({ page }) => {
    await page.locator(`${ICONS}[data-attachment-provider="picker"]`).click();

    // A real qty <input> inside product-card's shadow DOM — matches the
    // picker's PINNABLE_SELECTOR directly, so resolvePinnable() has no
    // ambiguity about which element gets pinned.
    const qtyInput = page.locator('product-card input[type="number"]').first();
    await qtyInput.hover();

    await page.locator('.wa-dom-picker-outline').waitFor({ state: 'visible' });
    const outline = await page.evaluate(() => {
      const el = document.querySelector('.wa-dom-picker-outline') as HTMLElement;
      const cs = getComputedStyle(el);
      return {
        inBody: el.parentElement === document.body,
        display: cs.display,
        borderStyle: cs.borderStyle,
        borderWidth: cs.borderWidth,
        position: cs.position,
        hasSheet: !!el.querySelector('style[data-wa-styles="dom-picker-outline"]'),
      };
    });
    expect(outline.inBody).toBe(true);
    expect(outline.display).toBe('block');
    expect(outline.borderStyle).toBe('solid');
    expect(outline.borderWidth).toBe('2px');
    expect(outline.position).toBe('fixed');
    expect(outline.hasSheet).toBe(true);

    // V2: the html.wa-dom-picking rule still applies from the local sheet.
    const pickingCursor = await page.evaluate(() => getComputedStyle(document.documentElement).cursor);
    expect(pickingCursor).toBe('crosshair');

    await shot(page, '036-picker-outline.png');

    // Pin the element, then check the strip and its chip.
    await qtyInput.click();

    // V3: the raw task's called-out measurement — flex, not block. The strip
    // is the picker's composer slot() element (AttachmentProvider.slot()),
    // mounted above the composer — i.e. inside agent-chat-panel, which now
    // lives in the bubble's OPEN shadow root (003). Unlike the outline, which
    // attaches to document.body directly, the strip travels with the panel.
    const stripDisplay = await page.evaluate(
      () => getComputedStyle((document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')!.shadowRoot!.querySelector('.wa-dom-picker-strip')!).display,
    );
    expect(stripDisplay).toBe('flex');

    // V4. The chip's specified display is `inline-flex` (picker-provider.ts),
    // but it is a flex item of `.wa-dom-picker-strip` — CSS Display L3
    // blockifies a flex item's outer display type, so the browser's USED
    // value (what getComputedStyle reports) is `flex`, not `inline-flex`.
    // The specified value survives byte-identical in the source and is what
    // the unit test (picker-provider.test.ts) checks via textContent.
    const chip = await page.evaluate(() => {
      const el = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')!.shadowRoot!.querySelector('.wa-dom-picker-chip') as HTMLElement;
      const cs = getComputedStyle(el);
      return { display: cs.display, borderRadius: cs.borderRadius, background: cs.backgroundColor };
    });
    expect(chip.display).toBe('flex');
    expect(chip.borderRadius).toBe('12px');
    expect(chip.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(chip.background).not.toBe('transparent');

    await shot(page, '036-picker-chip.png');
  });

  test('V9-V10: the resize grip renders and its arrow reacts to hover', async ({ page }) => {
    const grip = page.locator('web-agent-bubble .wa-resize-grip');
    await grip.waitFor({ state: 'visible' });

    const atRest = await page.evaluate(() => {
      const bubble = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')!;
      const el = bubble.shadowRoot!.querySelector('.wa-resize-grip') as HTMLElement;
      const svg = el.querySelector('svg') as SVGElement;
      const cs = getComputedStyle(el);
      return {
        position: cs.position,
        cursor: cs.cursor,
        width: cs.width,
        height: cs.height,
        display: cs.display,
        svgOpacity: getComputedStyle(svg).opacity,
      };
    });
    expect(atRest.position).toBe('fixed');
    expect(atRest.cursor).toBe('nwse-resize');
    expect(atRest.width).toBe('28px');
    expect(atRest.height).toBe('28px');
    expect(atRest.display).toBe('block');
    expect(atRest.svgOpacity).toBe('0');

    await grip.hover();
    // The svg's opacity change is a 120ms CSS transition (panel-resize.ts) —
    // poll rather than reading immediately, or the read lands mid-transition.
    await expect
      .poll(() =>
        page.evaluate(
          () => {
            const bubble = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')!;
            return getComputedStyle(bubble.shadowRoot!.querySelector('.wa-resize-grip svg')!).opacity;
          },
        ),
      )
      .toBe('1');

    await shot(page, '036-grip-hover.png');
  });
});

test.describe('page overlay styles — agent cursor (cues demo — gallery frame)', () => {
  test('V6-V8, R4: the cursor renders from its own local sheet, which survives clear()', async ({ page }) => {
    test.setTimeout(30_000);

    await page.goto('gallery.html?frame=demo-cues', { waitUntil: 'networkidle', timeout: 30_000 });
    await page.locator('#runCues').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('#runCues').click();

    await page.waitForFunction(
      () => document.querySelectorAll('.wa-agent-cursor.wa-agent-cursor--visible').length > 0,
      { timeout: 5_000, polling: 100 },
    );

    // V7: the layer is fixed with the documented z-index, the pointer visible,
    // and the layer already carries its own local sheet.
    const layerProps = await page.evaluate(() => {
      const layer = document.querySelector('.wa-agent-cursor-layer') as HTMLElement;
      const pointer = layer.querySelector('.wa-agent-cursor') as HTMLElement;
      const cs = getComputedStyle(layer);
      return {
        position: cs.position,
        zIndex: cs.zIndex,
        pointerOpacity: getComputedStyle(pointer).opacity,
        hasSheet: !!layer.querySelector('style[data-wa-styles="agent-cursor"]'),
      };
    });
    expect(layerProps.position).toBe('fixed');
    expect(layerProps.zIndex).toBe('2147483000');
    expect(layerProps.pointerOpacity).toBe('1');
    expect(layerProps.hasSheet).toBe(true);

    // V6: a pulse, then a flash, appear during the cue lifecycle.
    await page.waitForFunction(() => document.querySelectorAll('.wa-cursor-pulse').length >= 1, {
      timeout: 5_000,
      polling: 100,
    });
    await shot(page, '036-cursor-pulse.png');
    await page.waitForFunction(() => document.querySelectorAll('.wa-cursor-flash').length >= 1, {
      timeout: 8_000,
      polling: 200,
    });

    // Let the lifecycle settle — this is when agentCursor.clear() runs.
    await page.waitForFunction(
      () => {
        const transients = document.querySelectorAll('.wa-cursor-pulse, .wa-cursor-flash').length;
        const visible = document.querySelectorAll('.wa-agent-cursor.wa-agent-cursor--visible').length > 0;
        return transients === 0 && !visible;
      },
      { timeout: 8_000, polling: 250 },
    );

    // R4: clear() removes transients but must not remove the stylesheet.
    const afterClear = await page.evaluate(() => {
      const layer = document.querySelector('.wa-agent-cursor-layer') as HTMLElement;
      return {
        hasSheet: !!layer.querySelector('style[data-wa-styles="agent-cursor"]'),
        hasPointer: !!layer.querySelector('.wa-agent-cursor'),
      };
    });
    expect(afterClear.hasSheet).toBe(true);
    expect(afterClear.hasPointer).toBe(true);
  });
});
