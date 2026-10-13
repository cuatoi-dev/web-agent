import { test, expect } from './fixtures';
import { openPanel, shot } from './helpers';

// 003: drag the top-left grip to resize the open chat box.

test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

async function panelBox(page: import('@playwright/test').Page) {
  const box = await page.locator('agent-chat-panel').boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function gripCenter(page: import('@playwright/test').Page) {
  const b = await page.locator('web-agent-bubble .wa-resize-grip').boundingBox();
  expect(b).not.toBeNull();
  return { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 };
}

async function dragFromGrip(page: import('@playwright/test').Page, dx: number, dy: number) {
  const c = await gripCenter(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 5 });
  await page.mouse.up();
}

test.describe('003: drag the top-left grip to resize the chat box', () => {
  test('1: the grip is a 28x28 nwse-resize hit area; its inline-SVG arrow is hidden at rest and shown on hover', async ({ page }) => {
    await openPanel(page);
    const grip = page.locator('web-agent-bubble .wa-resize-grip');
    await expect(grip).toBeVisible();
    const b = await grip.boundingBox();
    expect(Math.round(b!.width)).toBe(28);
    expect(Math.round(b!.height)).toBe(28);
    expect(await grip.evaluate(el => getComputedStyle(el).cursor)).toBe('nwse-resize');
    expect(await grip.evaluate(el => getComputedStyle(el).touchAction)).toBe('none');

    // Inline SVG only, never an icon font: the two apps share no font, and a
    // missing glyph would be a tofu box.
    const svg = grip.locator('svg');
    await expect(svg).toHaveCount(1);
    expect(await svg.locator('path').first().getAttribute('stroke')).toBe('currentColor');
    expect(await grip.evaluate(el => getComputedStyle(el).color)).toMatch(/^rgb\(/);

    // Hidden at rest, shown on hover, hidden again when the pointer leaves.
    await expect(svg).toHaveCSS('opacity', '0');
    await grip.hover();
    await expect(svg).toHaveCSS('opacity', '1');
    await page.mouse.move(0, 0);
    await expect(svg).toHaveCSS('opacity', '0');
  });

  test('2: the grip is hidden when the chat is closed', async ({ page }) => {
    await openPanel(page);
    await page.locator('web-agent-bubble button#launcher').click();
    await expect(page.locator('web-agent-bubble .wa-resize-grip')).not.toBeVisible();
  });

  test('3: the grip sits flush to the box top-left corner, no overlap, no gap', async ({ page }) => {
    await openPanel(page);
    const grip = await page.locator('web-agent-bubble .wa-resize-grip').boundingBox();
    const box = await panelBox(page);
    expect(Math.abs((grip!.x + grip!.width) - box.x)).toBeLessThanOrEqual(1);
    expect(Math.abs((grip!.y + grip!.height) - box.y)).toBeLessThanOrEqual(1);
  });

  test('4: default size is unchanged and no data-wa-resized is set', async ({ page }) => {
    await openPanel(page);
    const box = await panelBox(page);
    expect(Math.round(box.width)).toBe(480);
    expect(Math.round(box.height)).toBe(Math.round(Math.min(660, 0.8 * 800)));
    await expect(page.locator('web-agent-bubble')).not.toHaveAttribute('data-wa-resized', /.*/);
    // Hover so the arrow is visible in the shot: it is hidden at rest by design.
    await page.locator('web-agent-bubble .wa-resize-grip').hover();
    await page.waitForTimeout(200);
    await shot(page, '003-grip-default-catstore-1280x800.png');
  });

  test('5: dragging up and left grows the box', async ({ page }) => {
    await openPanel(page);
    await dragFromGrip(page, -100, -40);
    const box = await panelBox(page);
    expect(Math.round(box.width)).toBe(580);
    expect(Math.round(box.height)).toBe(680);
  });

  test('6: dragging down and right shrinks the box', async ({ page }) => {
    await openPanel(page);
    await dragFromGrip(page, 60, 40);
    const box = await panelBox(page);
    expect(Math.round(box.width)).toBe(420);
    expect(Math.round(box.height)).toBe(600);
  });

  test('7: the box updates during the drag, not only on release', async ({ page }) => {
    await openPanel(page);
    const c = await gripCenter(page);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x - 100, c.y - 40, { steps: 1 });
    const during = await panelBox(page);
    expect(Math.round(during.width)).toBe(580);
    expect(Math.round(during.height)).toBe(680);
    await page.mouse.up();
  });

  test('8: the bottom-right corner does not move during a drag', async ({ page }) => {
    await openPanel(page);
    const before = await panelBox(page);
    const beforeRight = before.x + before.width;
    const beforeBottom = before.y + before.height;
    await dragFromGrip(page, -200, -100);
    const after = await panelBox(page);
    expect(Math.abs(after.x + after.width - beforeRight)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y + after.height - beforeBottom)).toBeLessThanOrEqual(1);
  });

  test('9: the box never gets smaller than 360 x 420', async ({ page }) => {
    await openPanel(page);
    await dragFromGrip(page, 400, 400);
    const box = await panelBox(page);
    expect(Math.round(box.width)).toBe(360);
    expect(Math.round(box.height)).toBe(420);
    await shot(page, '003-min-360x420-catstore-1280x800.png');
  });

  test('10: the box never gets larger than the window less its margins', async ({ page }) => {
    await openPanel(page);
    await dragFromGrip(page, -2000, -2000);
    const box = await panelBox(page);
    expect(Math.round(box.width)).toBe(1240);
    expect(Math.round(box.height)).toBe(700);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    await shot(page, '003-max-1240x700-catstore-1280x800.png');
  });

  test('11: a dragged height beats the 80vh cap', async ({ page }) => {
    await openPanel(page);
    await dragFromGrip(page, -2000, -2000);
    const box = await panelBox(page);
    const cap = 0.8 * 800;
    expect(Math.round(box.height)).toBe(700);
    expect(700).toBeGreaterThan(cap);
    const maxHeight = await page.locator('web-agent-bubble #panel-container')
      .evaluate(el => getComputedStyle(el).maxHeight);
    expect(maxHeight).toBe('none');
  });

  test('12: closing and reopening drops the dragged size', async ({ page }) => {
    await openPanel(page);
    await dragFromGrip(page, -220, 140);
    let box = await panelBox(page);
    expect(Math.round(box.width)).toBe(700);
    expect(Math.round(box.height)).toBe(500);
    await page.locator('web-agent-bubble button#launcher').click();
    await page.locator('web-agent-bubble button#launcher').click();
    await page.locator('agent-chat-panel').waitFor({ state: 'visible' });
    await expect(page.locator('web-agent-bubble')).not.toHaveAttribute('data-wa-resized', /.*/);
    const inlineStyle = await page.locator('web-agent-bubble').getAttribute('style') ?? '';
    expect(inlineStyle).not.toContain('--web-agent-panel-width');
    expect(inlineStyle).not.toContain('--web-agent-panel-height');
    box = await panelBox(page);
    expect(Math.round(box.width)).toBe(480);
    expect(Math.round(box.height)).toBe(Math.round(Math.min(660, 0.8 * 800)));
    await shot(page, '003-reopen-default-catstore-1280x800.png');
  });

  test('14: the panel element itself is never touched', async ({ page }) => {
    await openPanel(page);
    await dragFromGrip(page, -100, -40);
    const style = (await page.locator('agent-chat-panel').getAttribute('style')) ?? '';
    expect(style).not.toMatch(/position|width|height/);
  });

  test('15: a chart message reflows to the wider box', async ({ page }) => {
    await page.addInitScript(() => {
      window.__WA_MOCK_SCRIPT__ = [
        {
          toolCalls: [{
            id: 'call_show_chart',
            name: 'show_chart',
            input: {
              title: 'Products in your cart',
              config: {
                type: 'bar',
                data: {
                  labels: ['Premium Cat Food', 'Cat Toy Mouse'],
                  datasets: [
                    { label: 'Quantity', data: [3, 1], yAxisID: 'qty-axis' },
                    { label: 'Price ($)', data: [12.99, 8.5], yAxisID: 'price-axis', type: 'line' }
                  ]
                },
                options: {
                  scales: {
                    yAxes: [
                      { id: 'qty-axis', position: 'left' },
                      { id: 'price-axis', position: 'right' }
                    ]
                  }
                }
              }
            }
          }]
        },
        { text: 'Here is the chart of products in your cart.', finishReason: 'stop' }
      ];
    });
    await page.route('**/api/anthropic/**', route => route.abort());
    await openPanel(page);

    const findMaxCanvasWidth = () => page.evaluate(() => {
      function traverse(root: Document | ShadowRoot): number {
        let maxW = 0;
        for (const el of root.querySelectorAll('canvas')) {
          maxW = Math.max(maxW, el.getBoundingClientRect().width);
        }
        for (const el of root.querySelectorAll('*')) {
          const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
          if (sr) maxW = Math.max(maxW, traverse(sr));
        }
        return maxW;
      }
      return traverse(document);
    });

    const { sendChat } = await import('./helpers');
    await sendChat(page, 'draw a chart of products in my cart');
    await page.waitForFunction(() => {
      function hasCanvas(root: Document | ShadowRoot): boolean {
        if (root.querySelector('canvas')) return true;
        for (const el of root.querySelectorAll('*')) {
          const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
          if (sr && hasCanvas(sr)) return true;
        }
        return false;
      }
      return hasCanvas(document);
    }, { timeout: 20_000 });
    await page.waitForTimeout(800);
    const before = await findMaxCanvasWidth();

    await dragFromGrip(page, -200, 0);
    await page.waitForTimeout(800);
    const after = await findMaxCanvasWidth();
    expect(after).toBeGreaterThan(before);
    await shot(page, '003-larger-with-chart-catstore-1280x800.png');
  });

  test('16: the message list uses the new height', async ({ page }) => {
    await openPanel(page);
    const before = await page.locator('agent-chat-panel .messages-list').boundingBox();
    await dragFromGrip(page, 0, -60);
    const after = await page.locator('agent-chat-panel .messages-list').boundingBox();
    expect(after!.height).toBeGreaterThan(before!.height);
  });

  test('17: a pointerdown on the hidden grip still drags, and the arrow shows while dragging', async ({ page }) => {
    await openPanel(page);
    const svg = page.locator('web-agent-bubble .wa-resize-grip svg');
    await expect(svg).toHaveCSS('opacity', '0');

    // No pointer ever hovered the grip; the arrow is still hidden at rest.
    await page.evaluate(() => {
      const bubble = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')!;
      const grip = bubble.shadowRoot!.querySelector('.wa-resize-grip') as HTMLElement;
      if (!grip) throw new Error('grip missing');
      const r = grip.getBoundingClientRect();
      const sx = r.left + r.width / 2;
      const sy = r.top + r.height / 2;
      grip.dispatchEvent(new PointerEvent('pointerdown', {
        pointerType: 'mouse', clientX: sx, clientY: sy, bubbles: true, cancelable: true,
      }));
      document.dispatchEvent(new PointerEvent('pointermove', {
        pointerType: 'mouse', clientX: sx - 100, clientY: sy - 40, bubbles: true, cancelable: true,
      }));
    });

    // The drag is live without any hover, and the arrow shows while the
    // pointer is held down (the data-wa-dragging attribute).
    await expect(svg).toHaveCSS('opacity', '1');
    const box = await panelBox(page);
    expect(Math.round(box.width)).toBe(580);
    expect(Math.round(box.height)).toBe(680);

    await page.evaluate(() => {
      document.dispatchEvent(new PointerEvent('pointerup', {
        pointerType: 'mouse', bubbles: true, cancelable: true,
      }));
    });

    // The pointer never hovered the grip, so the arrow hides again on release.
    await expect(svg).toHaveCSS('opacity', '0');
  });
});

test.describe('003: touch drag (iPad landscape)', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test('13: touch uses the same code path and clamps to the viewport maximum', async ({ page }) => {
    await openPanel(page);
    let box = await panelBox(page);
    expect(Math.round(box.height)).toBe(Math.round(Math.min(660, 0.8 * 768)));

    await page.evaluate(() => {
      const bubble = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')!;
      const grip = bubble.shadowRoot!.querySelector('.wa-resize-grip') as HTMLElement;
      if (!grip) throw new Error('grip missing');
      const r = grip.getBoundingClientRect();
      const sx = r.left + r.width / 2;
      const sy = r.top + r.height / 2;
      grip.dispatchEvent(new PointerEvent('pointerdown', {
        pointerType: 'touch', clientX: sx, clientY: sy, bubbles: true, cancelable: true,
      }));
      document.dispatchEvent(new PointerEvent('pointermove', {
        pointerType: 'touch', clientX: sx - 120, clientY: sy - 30, bubbles: true, cancelable: true,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', {
        pointerType: 'touch', clientX: sx - 120, clientY: sy - 30, bubbles: true, cancelable: true,
      }));
    });

    box = await panelBox(page);
    expect(Math.round(box.width)).toBe(600);
    expect(Math.round(box.height)).toBe(644);

    // Drag to the minimum on touch, then capture the tightest-layout shot.
    await page.evaluate(() => {
      const bubble = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')!;
      const grip = bubble.shadowRoot!.querySelector('.wa-resize-grip') as HTMLElement;
      if (!grip) throw new Error('grip missing');
      const r = grip.getBoundingClientRect();
      const sx = r.left + r.width / 2;
      const sy = r.top + r.height / 2;
      grip.dispatchEvent(new PointerEvent('pointerdown', {
        pointerType: 'touch', clientX: sx, clientY: sy, bubbles: true, cancelable: true,
      }));
      document.dispatchEvent(new PointerEvent('pointermove', {
        pointerType: 'touch', clientX: sx + 400, clientY: sy + 400, bubbles: true, cancelable: true,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', {
        pointerType: 'touch', clientX: sx + 400, clientY: sy + 400, bubbles: true, cancelable: true,
      }));
    });

    box = await panelBox(page);
    expect(Math.round(box.width)).toBe(360);
    expect(Math.round(box.height)).toBe(420);
    await shot(page, '003-min-360x420-catstore-ipad-1024x768.png');
  });
});
