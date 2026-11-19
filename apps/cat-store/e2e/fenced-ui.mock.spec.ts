import { test, expect } from './fixtures';
import { openPanel, gotoCart, clearCartViaUI, shot, sendChat, waitForTurnComplete, getCartBadge } from './helpers';

// Fenced UI — DETERMINISTIC (no live LLM):
//   (A) the real fenced data-agent-permission attributes render on the live cart DOM
//   (B/C/D) the confirm scrim renders over the chat panel and Allow/Reject/Escape resolve
//   (E) a live agent turn drives the click tool through the open shadow roots of
//       marked md-icon-button (ask) and md-filled-button (block) hosts — the scrim
//       gates the ask-tier click, the block-tier click is refused with no dialog
// The full DomAdapter gate path is covered by web-agent-dom unit tests;
// the cat-store attribute conditionals by cart-view.test.ts. This spec
// covers the deployed-DOM + live-scrim integration that unit tests cannot.

// State-driven shadow-host permission script, self-contained for .toString()
// injection (mock tier only, zero network):
//   snapshot_page → click Remove (ask-tier, raises the scrim)
//                → snapshot_page (fresh refs after the item was removed)
//                → click Place order (block-tier, refused) → final text.
// Snapshot 1 carries both markers, so the spec can assert the (ask)/(block)
// suffixes on the ref'd lines. Uses the snapshot output, not call index.
import type { ChatPanelProbe } from './dom-types';
import type { ProviderCallOptions } from '@cuatoi/web-agent-core';
import type { Page } from '@playwright/test';
import type { ProductItem } from '../src/web/store/seed';

/** The one content-part shape this script reads back out of `opts.messages`
 *  — the real ContentPart union carries several other variants. */
interface ToolResultPartLike {
  type: 'tool-result';
  toolName: string;
  output?: unknown;
}

const shadowHostClickScript = function shadowHostClickScript(opts: ProviderCallOptions) {
  const results: Array<{ toolName: string; output: string }> = [];
  for (const msg of opts.messages) {
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
      for (const part of msg.content as ToolResultPartLike[]) {
        if (part.type === 'tool-result') {
          results.push({ toolName: part.toolName, output: (part.output as string | undefined) ?? '' });
        }
      }
    }
  }
  const snaps = results.filter((r) => r.toolName === 'snapshot_page');
  const clicks = results.filter((r) => r.toolName === 'click');
  const w = window;
  if (!w.__SHADOW_HOST_SNAPSHOT__ && snaps.length > 0) w.__SHADOW_HOST_SNAPSHOT__ = snaps[0].output;

  if (snaps.length === 0) {
    return { toolCalls: [{ id: 'call_snap1', name: 'snapshot_page', input: {} }] };
  }
  if (clicks.length === 0) {
    const m = /\[(\d+)\] button "Remove Salmon Pâté"/.exec(snaps[0].output);
    if (!m) return { text: 'Remove button not found.', finishReason: 'stop' };
    return { toolCalls: [{ id: 'call_remove', name: 'click', input: { ref: m[1] } }] };
  }
  if (snaps.length === 1) {
    return { toolCalls: [{ id: 'call_snap2', name: 'snapshot_page', input: {} }] };
  }
  if (clicks.length === 1) {
    const m = /\[(\d+)\] button "Place order"/.exec(snaps[1].output);
    if (!m) return { text: 'Place order not found.', finishReason: 'stop' };
    return { toolCalls: [{ id: 'call_order', name: 'click', input: { ref: m[1] } }] };
  }
  // The block-tier refusal is model-facing: it lives in the click tool result,
  // not in the panel DOM (the panel renders only a friendly phrase). Capture
  // the result here so the spec can assert the model actually received it.
  w.__SHADOW_HOST_BLOCK_RESULT__ = clicks[clicks.length - 1].output;
  return { text: 'Shadow-host permission checks complete.', finishReason: 'stop' };
};

// Two real seed products (apps/cat-store/src/web/store/seed.ts).
const P01: ProductItem = { id: 'p01', name: 'Salmon Pâté', category: 'Food', price: 3.99, cost: 2.59, inStock: true, emoji: '🥫' };
const P02: ProductItem = { id: 'p02', name: 'Tuna Crunchies', category: 'Food', price: 4.49, cost: 2.92, inStock: true, emoji: '🐟' };

async function seedCart(page: Page) {
  // p01 at qty 2 (decrement NOT gated), p02 at qty 1 (decrement gated)
  await page.evaluate(
    ({ p01, p02 }: { p01: ProductItem; p02: ProductItem }) => {
      const s = window.__APP_STORE__;
      s.dispatch({ type: 'cart/clearCart' });
      s.dispatch({ type: 'cart/addToCart', payload: { product: p01, qty: 2 } });
      s.dispatch({ type: 'cart/addToCart', payload: { product: p02, qty: 1 } });
    },
    { p01: P01, p02: P02 },
  );
}

test.describe('fenced UI', () => {
  test('A: fenced data-agent-permission attributes render on the live cart DOM', async ({ page }) => {
    await openPanel(page);
    await clearCartViaUI(page);
    await seedCart(page);
    await gotoCart(page);
    // Playwright locators pierce open shadow roots (cart-view lives inside app-root's shadow DOM).
    await page.locator('cart-view').first().waitFor({ state: 'visible' });
    await page.locator('cart-view .qty-stepper').first().waitFor({ state: 'visible' });

    // Place order = block, with a non-empty reason
    const placeOrder = page.locator('md-filled-button[data-agent-permission="block"]');
    await expect(placeOrder).toHaveCount(1);
    expect((await placeOrder.getAttribute('data-agent-permission-reason'))?.length).toBeGreaterThan(0);

    // Remove buttons = ask, one per row (2), each with a reason
    const removeBtns = page.locator('md-icon-button[data-agent-permission="ask"]');
    await expect(removeBtns).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      expect((await removeBtns.nth(i).getAttribute('data-agent-permission-reason'))?.length).toBeGreaterThan(0);
    }

    // Decrement: exactly one row gated (qty===1), one ungated (qty===2)
    await expect(page.locator('cart-view .qty-dec')).toHaveCount(2);
    const gatedDec = page.locator('cart-view .qty-dec[data-agent-permission="ask"]');
    await expect(gatedDec).toHaveCount(1);
    expect((await gatedDec.getAttribute('data-agent-permission-reason'))?.length).toBeGreaterThan(0);

    // Increment buttons never carry a permission attribute
    await expect(page.locator('cart-view .qty-inc')).toHaveCount(2);
    await expect(page.locator('cart-view .qty-inc[data-agent-permission]')).toHaveCount(0);
  });

  test('B: confirm scrim renders over the chat panel; Reject resolves false (+ screenshot)', async ({ page }) => {
    await openPanel(page);
    await page.evaluate((reason) => {
      const p = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
      window.__scrim = p!._defaultConfirmScrim!({
        ref: 'r1',
        name: 'Remove Salmon Pâté',
        action: 'click',
        reason,
      });
    }, 'Removing an item from the cart — ask the shopper to confirm.');

    const scrim = page.locator('agent-chat-panel .wa-confirm-scrim');
    await scrim.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(scrim.getByText('Confirm action')).toBeVisible();
    await expect(scrim.getByText(/Removing an item from the cart/)).toBeVisible();
    await shot(page, 'fenced-scrim.png');

    await scrim.getByText('Reject', { exact: false }).first().click();
    const rejected = await page.evaluate(() => window.__scrim);
    expect(rejected).toBe(false);
    await expect(page.locator('agent-chat-panel .wa-confirm-scrim')).toHaveCount(0);
  });

  test('C: scrim Allow resolves true', async ({ page }) => {
    await openPanel(page);
    await page.evaluate(() => {
      const p = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
      window.__scrim = p!._defaultConfirmScrim!({
        ref: 'r1',
        name: 'Remove item',
        action: 'click',
      });
    });
    const scrim = page.locator('agent-chat-panel .wa-confirm-scrim');
    await scrim.waitFor({ state: 'visible', timeout: 10_000 });
    await scrim.getByText('Allow', { exact: false }).first().click();
    const allowed = await page.evaluate(() => window.__scrim);
    expect(allowed).toBe(true);
    await expect(page.locator('agent-chat-panel .wa-confirm-scrim')).toHaveCount(0);
  });

  test('D: scrim Escape resolves false', async ({ page }) => {
    await openPanel(page);
    await page.evaluate(() => {
      const p = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
      window.__scrim = p!._defaultConfirmScrim!({
        ref: 'r1',
        name: 'Remove item',
        action: 'click',
      });
    });
    const scrim = page.locator('agent-chat-panel .wa-confirm-scrim');
    await scrim.waitFor({ state: 'visible', timeout: 10_000 });
    await page.keyboard.press('Escape');
    const escaped = await page.evaluate(() => window.__scrim);
    expect(escaped).toBe(false);
    await expect(page.locator('agent-chat-panel .wa-confirm-scrim')).toHaveCount(0);
  });

  test('E: ask/block markers enforce through open shadow roots in a live agent turn (+ screenshot)', async ({ page }) => {
    await page.addInitScript(`window.__WA_MOCK_SCRIPT__ = ${shadowHostClickScript.toString()};`);

    let apiCallCount = 0;
    await page.route('**/api/anthropic/**', (route) => {
      apiCallCount++;
      void route.abort();
    });

    await openPanel(page);
    await clearCartViaUI(page);
    await seedCart(page); // p01 qty2 + p02 qty1 — the Remove click removes only p01
    await gotoCart(page);

    await sendChat(page, 'remove the salmon and try to place the order');

    // ask-tier: the click tool on the shadow-inner Remove button must raise the scrim first
    const scrim = page.locator('agent-chat-panel .wa-confirm-scrim');
    await scrim.waitFor({ state: 'visible', timeout: 30_000 });
    await expect(scrim.getByText('Confirm action')).toBeVisible();
    await expect(scrim.getByText(/Agent wants to perform/)).toBeVisible();
    await expect(scrim.getByText(/Remove Salmon Pâté/)).toBeVisible();
    await shot(page, 'fenced-shadow-host-ask.png');
    await scrim.getByText('Allow', { exact: false }).first().click();

    // block-tier: Place order is refused with no dialog, and the order is not placed.
    // The refused message is the tool result the model receives, not panel text —
    // the panel shows the friendly phrase, so assert both.
    await waitForTurnComplete(page);
    await expect(page.locator('agent-chat-panel .wa-confirm-scrim')).toHaveCount(0);
    expect(await getCartBadge(page)).toBe(1); // p02 still in cart — order was never placed
    await expect(page.locator('agent-chat-panel')).toContainText(/tried to click an element/);
    const blockResult = await page.evaluate(() => window.__SHADOW_HOST_BLOCK_RESULT__ ?? '');
    expect(blockResult).toContain('Blocked by interaction policy ("block")');
    await shot(page, 'fenced-shadow-host-block.png');

    // the snapshot annotation follows the shadow-host markers
    const snapText = await page.evaluate(() => window.__SHADOW_HOST_SNAPSHOT__ ?? '');
    expect(snapText).toContain('button "Remove Salmon Pâté" (ask)');
    expect(snapText).toContain('button "Place order" (block)');

    // zero real model calls (leak guard)
    expect(apiCallCount).toBe(0);
  });
});
