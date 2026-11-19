import { test, expect } from './fixtures';
import { chooseTheme, gotoAgentPage, sendChat } from './helpers';
import path from 'path';
import fs from 'fs';

// The collapse toggle sits clear of the divider rail when expanded, and
// stays a fixed 8px inside the viewport's right edge when collapsed.
// Viewport is the project default (1280x800) from playwright.config.ts.

const ARTIFACTS_DIR = path.resolve(
  __dirname,
  '../../../temp/artifacts/2026-08-13-122925-001-agent-page-toggle-off-the-divider-line',
);

const MOCK_REPLY = 'AGENT-TOGGLE-OFFSET-MOCK-4b2c';
const GAP_PX = 8; // .divider-toggle's offset from the rail
const VIEWPORT_WIDTH = 1280;

test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

test.beforeEach(async ({ page }) => {
  await page.addInitScript((reply) => {
    window.__WA_MOCK_SCRIPT__ = { text: reply, finishReason: 'stop' };
  }, MOCK_REPLY);
});

const toggle = (page: import('@playwright/test').Page) =>
  page.locator('agent-page button.divider-toggle');

async function dividerCenter(page: import('@playwright/test').Page) {
  const b = await page.locator('agent-page .col-divider').boundingBox();
  expect(b).not.toBeNull();
  return { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 };
}

async function dragDivider(page: import('@playwright/test').Page, dx: number) {
  const c = await dividerCenter(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx, c.y, { steps: 10 });
  await page.mouse.up();
}

test('scenario 1: expanded — the toggle clears the rail and sits over the right panel', async ({
  page,
}) => {
  await gotoAgentPage(page);

  const bToggle = (await toggle(page).boundingBox())!;
  const bDivider = (await page.locator('agent-page .col-divider').boundingBox())!;
  const bSide = (await page.locator('agent-page .col-side').boundingBox())!;

  expect(bToggle.x).toBeGreaterThanOrEqual(bDivider.x + bDivider.width);
  expect(bToggle.x - (bDivider.x + bDivider.width)).toBeCloseTo(GAP_PX, 0);
  expect(bToggle.x).toBeGreaterThanOrEqual(bSide.x);
  expect(bToggle.x + bToggle.width).toBeLessThanOrEqual(bSide.x + bSide.width);
  expect(bToggle.x).toBeCloseTo(974, 0);
  expect(bToggle.width).toBeCloseTo(24, 0);
});

test('scenario 2: collapsed — the toggle sits 8px inside the viewport edge and is fully inside the viewport', async ({
  page,
}) => {
  await gotoAgentPage(page);
  await page.getByRole('button', { name: 'Collapse side panel' }).click();

  const bToggle = (await toggle(page).boundingBox())!;
  const bChat = (await page.locator('agent-page .col-chat').boundingBox())!;

  // The collapsed offset is anchored instead of "GAP_PX clear of the
  // rail" (which pushed the toggle deep enough into .col-chat to overlap a
  // right-aligned user message bubble) to a fixed 8px from the viewport's
  // own right edge, so it can never be clipped regardless of layout width.
  expect(bToggle.x).toBeGreaterThanOrEqual(bChat.x);
  expect(bToggle.x + bToggle.width).toBeLessThanOrEqual(bChat.x + bChat.width);
  expect(bToggle.x).toBeGreaterThanOrEqual(0);
  expect(bToggle.x + bToggle.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
  expect(VIEWPORT_WIDTH - (bToggle.x + bToggle.width)).toBeCloseTo(GAP_PX, 0);
});

test('scenario 2b: collapsed, narrow viewport — the toggle never overlaps the last user bubble (the reported bug), both themes', async ({
  page,
}) => {
  // Reproduces the reported case directly: phone-width viewport, panel
  // collapsed, last message a short right-aligned user bubble. Scenario 2
  // only checks the toggle against the viewport and .col-chat — it proves
  // the toggle is where intended, not that a bubble never sits under it.
  //
  // Collapse BEFORE sending: at 375px the EXPANDED three-column layout
  // overflows its 760px combined minimum width (a separate, known
  // layout limitation), which squeezes #input off
  // screen and makes it unclickable. Collapsing first removes .col-side and
  // lets .col-chat take the full width, same as the reported case.
  await page.setViewportSize({ width: 375, height: 740 });
  await gotoAgentPage(page);

  await page.getByRole('button', { name: 'Collapse side panel' }).click();

  await sendChat(page, 'hello');
  await expect(page.locator('agent-chat-panel agent-message-view').last()).toContainText(MOCK_REPLY);

  for (const theme of ['dark', 'light'] as const) {
    if (theme === 'light') {
      await chooseTheme(page, 'wa2-light');
      await page.waitForFunction(
        () => document.documentElement.getAttribute('data-theme') === 'wa2-light',
        { timeout: 5_000 },
      );
    }

    const bToggle = (await toggle(page).boundingBox())!;
    const bBubble = (await page
      .locator('agent-chat-panel agent-message-view .message-container.user')
      .last()
      .boundingBox())!;

    // Zero rectangle overlap: the two boxes are disjoint if one sits fully
    // to the side of, or fully above/below, the other on at least one axis.
    const noOverlap =
      bToggle.x + bToggle.width <= bBubble.x ||
      bBubble.x + bBubble.width <= bToggle.x ||
      bToggle.y + bToggle.height <= bBubble.y ||
      bBubble.y + bBubble.height <= bToggle.y;

    expect(noOverlap).toBe(true);
  }
});

test('scenario 3: the offset survives a drag', async ({ page }) => {
  await gotoAgentPage(page);
  await dragDivider(page, -200);

  const bSide = (await page.locator('agent-page .col-side').boundingBox())!;
  expect(bSide.width).toBeCloseTo(520, 0);

  const bToggle = (await toggle(page).boundingBox())!;
  const bDivider = (await page.locator('agent-page .col-divider').boundingBox())!;

  expect(bDivider.x).toBeCloseTo(754, 0);
  expect(bToggle.x).toBeCloseTo(774, 0);
  expect(bToggle.x).toBeGreaterThanOrEqual(bDivider.x + bDivider.width);
  expect(bToggle.x - (bDivider.x + bDivider.width)).toBeCloseTo(GAP_PX, 0);
});

test('scenario 4: the toggle stays inside the rail\'s DOM, and the grip does not move', async ({
  page,
}) => {
  await gotoAgentPage(page);

  const parentIsDivider = async () =>
    page.evaluate(() => {
      const root = (document.querySelector('app-root'))!.shadowRoot!
        .querySelector('agent-page')!.shadowRoot as ShadowRoot;
      const btn = root.querySelector('button.divider-toggle') as HTMLElement;
      return btn.parentElement?.classList.contains('col-divider');
    });

  expect(await parentIsDivider()).toBe(true);

  const bGrip = (await page.locator('agent-page .divider-grip').boundingBox())!;
  const bDivider = (await page.locator('agent-page .col-divider').boundingBox())!;
  expect(
    Math.abs(bGrip.x + bGrip.width / 2 - (bDivider.x + bDivider.width / 2)),
  ).toBeLessThanOrEqual(1);
  expect(bDivider.width).toBeCloseTo(12, 0);

  await page.getByRole('button', { name: 'Collapse side panel' }).click();
  expect(await parentIsDivider()).toBe(true);
});

test('scenario 5: the stacking fix still holds, in both themes', async ({ page }) => {
  await gotoAgentPage(page);

  for (const theme of ['dark', 'light'] as const) {
    if (theme === 'light') {
      await chooseTheme(page, 'wa2-light');
      await page.waitForFunction(
        () => document.documentElement.getAttribute('data-theme') === 'wa2-light',
        { timeout: 5_000 },
      );
    }

    const isExpanded = await page
      .getByRole('button', { name: 'Collapse side panel' })
      .count();
    if (isExpanded > 0) {
      await page.getByRole('button', { name: 'Collapse side panel' }).click();
    }

    const stack = await page.evaluate(() => {
      const root = (document.querySelector('app-root'))!.shadowRoot!
        .querySelector('agent-page')!.shadowRoot as ShadowRoot;
      const btn = root.querySelector('button.divider-toggle') as HTMLElement;
      const r = btn.getBoundingClientRect();
      return root
        .elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        .map((el) => {
          const cls = typeof el.className === 'string' ? el.className : el.getAttribute('class') || '';
          return `${el.tagName}.${cls}`;
        });
    });

    expect(stack[0] === 'BUTTON.divider-toggle' || stack[0] === 'svg.').toBe(true);
    const toggleIdx = stack.findIndex((s) => s.startsWith('BUTTON.divider-toggle'));
    const messagesIdx = stack.findIndex((s) => s.includes('messages-list'));
    if (messagesIdx !== -1) {
      expect(toggleIdx).toBeLessThan(messagesIdx);
    }
    expect(stack[0]).not.toBe('DIV.messages-list');

    // Expand again so the next theme iteration starts from a known state.
    await page.getByRole('button', { name: 'Expand side panel' }).focus();
    await page.keyboard.press('Enter');
  }
});

test('scenario 6: the toggle is clickable where it now sits, and clicking it does not start a drag', async ({
  page,
}) => {
  await gotoAgentPage(page);

  const widthBefore = (await page.locator('agent-page .col-side').boundingBox())!.width;

  const bToggle = (await toggle(page).boundingBox())!;
  const cx = bToggle.x + bToggle.width / 2;
  const cy = bToggle.y + bToggle.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 200, cy, { steps: 10 });
  await page.mouse.up();

  const widthAfter = (await page.locator('agent-page .col-side').boundingBox())!.width;
  expect(widthAfter).toBeCloseTo(widthBefore, 0);

  await toggle(page).click();
  await expect(page.locator('agent-page .col-side')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand side panel' })).toHaveCount(1);
});

test('scenario 7: contrast against the NEW backdrop, both themes', async ({ page }) => {
  await gotoAgentPage(page);

  const computeRatios = async (collapsed: boolean) =>
    page.evaluate((isCollapsed) => {
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

      const root = (document.querySelector('app-root'))!.shadowRoot!
        .querySelector('agent-page')!.shadowRoot as ShadowRoot;
      const btn = root.querySelector('button.divider-toggle') as HTMLElement;
      const style = getComputedStyle(btn);
      const backdrop = isCollapsed
        ? getComputedStyle(
            root.querySelector('agent-chat-panel .messages-list') as Element,
          ).backgroundColor
        : getComputedStyle(root.querySelector('.col-side') as Element).backgroundColor;

      return {
        borderVsBackdrop: ratio(style.borderColor, backdrop),
        chevronVsButtonBg: ratio(style.color, style.backgroundColor),
        raw: {
          borderColor: style.borderColor,
          backdrop,
          chevronColor: style.color,
          buttonBackground: style.backgroundColor,
        },
      };
    }, collapsed);

  type Ratios = Awaited<ReturnType<typeof computeRatios>>;
  const results: Record<string, { expanded: Ratios; collapsed: Ratios }> = {};

  for (const theme of ['dark', 'light'] as const) {
    if (theme === 'light') {
      await chooseTheme(page, 'wa2-light');
      await page.waitForFunction(
        () => document.documentElement.getAttribute('data-theme') === 'wa2-light',
        { timeout: 5_000 },
      );
    }

    const expanded = await computeRatios(false);
    await page.getByRole('button', { name: 'Collapse side panel' }).click();
    const collapsed = await computeRatios(true);
    results[theme] = { expanded, collapsed };

    await page.getByRole('button', { name: 'Expand side panel' }).focus();
    await page.keyboard.press('Enter');
  }

  console.log('CONTRAST_RESULTS', JSON.stringify(results));

  for (const theme of ['dark', 'light'] as const) {
    expect(results[theme].expanded.borderVsBackdrop).toBeGreaterThanOrEqual(3);
    expect(results[theme].expanded.chevronVsButtonBg).toBeGreaterThanOrEqual(3);
    expect(results[theme].collapsed.borderVsBackdrop).toBeGreaterThanOrEqual(3);
    expect(results[theme].collapsed.chevronVsButtonBg).toBeGreaterThanOrEqual(3);
  }
});

test('scenario 8: screenshots — two themes x two states', async ({ page }) => {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  // gotoAgentPage() must be the page's FIRST navigation — see
  // agent-right-panel.mock.spec.ts scenario 15 for why.
  await gotoAgentPage(page);

  for (const theme of ['dark', 'light'] as const) {
    await page.goto('#/store');
    await gotoAgentPage(page);
    if (theme === 'light') {
      await chooseTheme(page, 'wa2-light');
      await page.waitForFunction(
        () => document.documentElement.getAttribute('data-theme') === 'wa2-light',
        { timeout: 5_000 },
      );
    }

    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, `toggle-expanded-${theme}.png`),
      fullPage: true,
    });

    await page.getByRole('button', { name: 'Collapse side panel' }).click();
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, `toggle-collapsed-${theme}.png`),
      fullPage: true,
    });
  }
});
