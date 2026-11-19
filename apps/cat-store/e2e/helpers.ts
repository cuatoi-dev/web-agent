import path from 'path';
import fs from 'fs';
import { type Page } from '@playwright/test';
import type { ChatPanelProbe, ComposerInputProbe, AgentPageProbe } from './dom-types';

export const TEST_IMAGE = path.resolve(__dirname, 'fixtures/004-test-rainbow.png');
export const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts');

/**
 * Agent-init settle gate.
 *
 * The panel is created on the FIRST launcher click (web-agent-embed.ts:346), so
 * `page.goto(..., { waitUntil: 'networkidle' })` cannot cover the fetches the
 * agent controller issues afterwards. `createDataSourceProvider()`
 * (packages/web-agent-core/src/datasource/provider.ts:22-34) calls
 * `describeOrders()` -> GET /api/orders/describe, and `initAgent()` creates one
 * each time it runs: once at controller construction (controller.ts:135) and
 * again after tool providers or registry skills load (controller.ts:151, :167).
 *
 * If a spec navigates (page.goto / page.reload) while one of those fetches is in
 * flight, the browser cancels it (net::ERR_ABORTED), fetch rejects with
 * "TypeError: Failed to fetch", and provider.ts:31 logs "Failed to describe
 * source" — which the console guard (e2e/fixtures.ts) fails the test on.
 *
 * The counter is installed in the PAGE, not over Playwright's network events, so
 * "the fetch was issued" and "the session is ready" are observed in the same JS
 * context and cannot be read out of order.
 */
const DESCRIBE_PATH = '/api/orders/describe';

/** Pages that already have the counter init-script registered. */
const describeCounterInstalled = new WeakSet<Page>();

async function installDescribeCounter(page: Page) {
  if (describeCounterInstalled.has(page)) return;
  describeCounterInstalled.add(page);
  // Runs before page scripts in EVERY document of this page, so each navigation
  // starts with fresh counters.
  await page.addInitScript((describePath: string) => {
    const w = window;
    if (w.__WA_E2E_DESCRIBE__) return;
    const counter = { issued: 0, inFlight: 0 };
    w.__WA_E2E_DESCRIBE__ = counter;
    const originalFetch = w.fetch.bind(w);
    w.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
      const isDescribe = String(url).includes(describePath);
      if (!isDescribe) return originalFetch(input, init);
      counter.issued++;
      counter.inFlight++;
      // `finally` settles the counter on BOTH fulfilment and rejection, so an
      // aborted fetch cannot leave the gate stuck.
      return originalFetch(input, init).finally(() => { counter.inFlight--; });
    };
  }, DESCRIBE_PATH);
}

/**
 * Resolve once the agent's data-source init has SETTLED: the session exists (so
 * every startup `initAgent()` call has already issued its describe fetch) and no
 * describe fetch is still in flight. Call before any navigation that follows an
 * opened panel.
 */
export async function waitForAgentInitSettled(page: Page, timeout = 30_000) {
  await page.waitForFunction(() => {
    // activeSessionId is set by openOrCreateActiveSession(), which runs AFTER
    // loadConfiguredToolProviders() and loadConfiguredSkillRegistry()
    // (controller.ts:170-188) — and both call initAgent() before returning. So
    // once this is set, every describe fetch of this page load has been issued.
    // Agent-chat-panel now lives inside <web-agent-bubble>'s OPEN shadow
    // root, so a raw document.querySelector no longer finds it — go through
    // the bubble's shadowRoot explicitly.
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    if (!panel?._state?.activeSessionId) return false;
    const counter = window.__WA_E2E_DESCRIBE__;
    return !!counter && counter.issued > 0 && counter.inFlight === 0;
  }, undefined, { timeout, polling: 100 });
}

export async function openPanel(page: Page) {
  await installDescribeCounter(page);
  await page.goto('', { timeout: 30_000 });

  // Wait on the launcher button, not the `web-agent-bubble` host: the host has
  // no CSS of its own on cat-store (default `display: inline`) and all its
  // children are `position: fixed`, so its own bounding box collapses to 0x0 —
  // measured live — and Playwright's `state: 'visible'` never resolves against
  // it. The launcher itself always has a real box.
  const launcher = page.locator('web-agent-bubble button#launcher');
  await launcher.waitFor({ state: 'visible', timeout: 15_000 });

  // The panel is created on first open, so it is absent — not merely hidden —
  // until the launcher is clicked. Guard the click so a re-entrant call cannot
  // toggle an already-open panel shut.
  const panelOpen = await page.locator('agent-chat-panel').isVisible().catch(() => false);
  if (!panelOpen) {
    await launcher.click();
  }

  await page.locator('agent-chat-panel').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('agent-chat-panel #input').waitFor({ state: 'visible', timeout: 15_000 });

  // Do not return while the agent is still fetching: a later page.goto /
  // page.reload would cancel that fetch and trip the console guard.
  await waitForAgentInitSettled(page);
}

export async function gotoAgentPage(page: Page) {
  await installDescribeCounter(page);
  await page.goto('#/agent');
  await waitForAgentPageSettled(page);
}

export async function reloadAgentPage(page: Page) {
  await page.reload();
  await waitForAgentPageSettled(page);
}

export async function waitForAgentPageSettled(page: Page, timeout = 30_000) {
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('app-root');
    const agentPage = appRoot?.shadowRoot?.querySelector('agent-page') as AgentPageProbe | null;
    if (!agentPage?._activeId) return false;
    const counter = window.__WA_E2E_DESCRIBE__;
    return !!counter && counter.issued > 0 && counter.inFlight === 0;
  }, undefined, { timeout, polling: 100 });
}


export async function sendChat(page: Page, text: string) {
  // Focus the inner input by clicking the host, then type with real key events
  // so Material Web's Lit reactive property observes the change and enables Send.
  await page.locator('agent-chat-panel #input').click();
  await page.waitForTimeout(200);
  await page.keyboard.type(text, { delay: 20 });

  await page.waitForTimeout(400);

  const sendBtn = page.locator('agent-chat-panel .input-area md-icon-button[data-aria-label="Send"]');
  await sendBtn.waitFor({ state: 'visible' });
  await sendBtn.click();
}

/** Type into the composer and click Send. Works whether or not a turn is
 *  running — the collapsed icon button shows Send (not Stop) whenever the
 *  composer has typed content, regardless of running state. */
export async function submitComposer(page: Page, text: string) {
  await page.locator('agent-chat-panel #input').click();
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    // Pierce the bubble's shadow root explicitly — see waitForAgentInitSettled.
    const el = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel #input') as ComposerInputProbe | null;
    if (el) el.value = '';
  });
  await page.waitForTimeout(100);
  await page.keyboard.type(text, { delay: 15 });
  await page.waitForTimeout(250);
  const send = page.locator('agent-chat-panel .input-area md-icon-button[data-aria-label="Send"]');
  await send.waitFor({ state: 'visible' });
  await send.click();
  await page.waitForTimeout(150);
}

export async function waitForAssistantReply(page: Page, timeout = 120_000): Promise<string> {
  await page.waitForFunction(() => {
    // Pierce the bubble's shadow root explicitly — see waitForAgentInitSettled.
    const root = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot;
    const vs = [...(root?.querySelectorAll('agent-message-view') ?? [])].filter(v => v.querySelector('.assistant'));
    if (vs.length === 0) return false;
    const last = vs[vs.length - 1];
    const t = (last.querySelector('.content')?.textContent ?? '').trim();
    return t.length > 5;
  }, { polling: 1_000, timeout });
  return await page.evaluate(() => {
    const root = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot;
    const vs = [...(root?.querySelectorAll('agent-message-view') ?? [])].filter(v => v.querySelector('.assistant'));
    const last = vs[vs.length - 1];
    return (last?.querySelector('.content')?.textContent ?? '').trim();
  });
}

export async function waitForToolCall(page: Page, timeout = 45_000) {
  await page.waitForFunction(() => {
    const root = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot;
    const vs = [...(root?.querySelectorAll('agent-message-view') ?? [])].filter(v => v.querySelector('.assistant'));
    if (vs.length === 0) return false;
    const last = vs[vs.length - 1];
    return /tool|snapshot|navigat|audit|click|fill|query/i.test(last.innerHTML);
  }, { polling: 500, timeout });
}

export async function getCartBadge(page: Page): Promise<number> {
  return page.evaluate(() => {
    const findBadge = (root: Document | ShadowRoot): string | null => {
      const els = root.querySelectorAll('*');
      for (const el of els) {
        if (el.className === 'badge') return el.textContent;
      }
      return null;
    };
    let txt = findBadge(document);
    if (!txt) {
      const appRoot = document.querySelector('app-root');
      if (appRoot?.shadowRoot) txt = findBadge(appRoot.shadowRoot);
    }
    return parseInt(txt ?? '', 10) || 0;
  });
}

export async function gotoStore(page: Page) {
  // No networkidle wait: on a fresh page this is a full app load, and a live
  // dev server's own background traffic (webpack-dev-server's HMR socket, the
  // app's own polling) can keep the network from ever going idle within the
  // timeout (see openPanel above). The explicit product-card wait below is the
  // real settle signal.
  await page.goto('#/store', { timeout: 30_000 });
  // Wait for product cards to render
  await page.locator('[class*="product"], .product-card, .products, [data-testid*="product"]').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
}

export async function shot(page: Page, name: string) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, name) });
}

/** Opens the header theme menu, picks `id`, and waits until `<html>` carries it. */
export async function chooseTheme(page: Page, id: string) {
  await page.locator('app-root .theme-menu-button').click();
  await page.locator(`app-root .theme-menu-item[data-theme-id="${id}"]`).click();
  await page.waitForFunction(
    (t) => document.documentElement.getAttribute('data-theme') === t,
    id,
    { timeout: 5_000 },
  );
}

// ─── Cart navigation / state helpers ────────────────────────────────────────

/** Navigate to cart view via SPA (no page reload, preserves Redux state). */
export async function gotoCart(page: Page) {
  await page.evaluate(() => {
    const s = window.__APP_STORE__;
    if (s) s.dispatch({ type: 'ui/setRoute', payload: '/cart' });
  });
  await page.locator('cart-view').first()
    .waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
}

/**
 * Reset cart to 0 items via Redux (SPA navigation, no page reload).
 */
export async function clearCartViaUI(page: Page) {
  // Navigate to cart view within SPA
  await page.evaluate(() => {
    const s = window.__APP_STORE__;
    if (s) s.dispatch({ type: 'ui/setRoute', payload: '/cart' });
  });
  // Clear via Redux
  await page.evaluate(() => {
    const s = window.__APP_STORE__;
    if (s) s.dispatch({ type: 'cart/clearCart' });
  });
  // Return to base view within SPA (no reload)
  await page.evaluate(() => {
    const s = window.__APP_STORE__;
    if (s) s.dispatch({ type: 'ui/setRoute', payload: '/' });
  });
  await page.waitForTimeout(300);
}

/**
 * Return the text content of the promo badge for a product in the cart,
 * e.g. "1 free". Traverses shadow roots.
 */
export async function getLinePromoBadge(page: Page, productId: string): Promise<string> {
  return page.evaluate((pid) => {
    const FRAGMENTS: Record<string, string> = {
      p01: 'Salmon', p02: 'Tuna',    p03: 'Chicken', p04: 'Turkey',
      p05: 'Feather', p06: 'Laser',  p07: 'Crinkle', p08: 'Catnip',
      p09: 'Donut',
    };

    function traverse(root: Document | ShadowRoot): string {
      // Strategy 1 — find promo-badge in an element with data-product-id
      const byId = root.querySelector(`[data-product-id="${pid}"] .promo-badge`);
      if (byId) return byId.textContent?.trim() ?? '';

      // Strategy 2 — name fragment in same row
      const fragment = FRAGMENTS[pid];
      if (fragment) {
        for (const badge of root.querySelectorAll('.promo-badge')) {
          const row =
            badge.closest('tr, [class*="cart-item"], [class*="item-row"], li') ??
            badge.parentElement;
          if (row?.textContent?.includes(fragment))
            return badge.textContent?.trim() ?? '';
        }
      }

      // Recurse into shadow roots
      for (const el of root.querySelectorAll('*')) {
        const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr) {
          const found = traverse(sr);
          if (found) return found;
        }
      }
      return '';
    }

    return traverse(document);
  }, productId);
}

/**
 * Wait for a single turn to complete by polling the panel's `running` property.
 * First waits briefly for `running === true` (turn started), then for `running === false`
 * (turn settled), then a small pad so the UI finishes rendering any final state.
 */
export async function waitForTurnComplete(page: Page, timeout = 150_000) {
  // Wait for turn to start (running === true) — short timeout, swallow if already done
  await page.waitForFunction(
    // Pierce the bubble's shadow root explicitly — see waitForAgentInitSettled.
    () => ((document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null)?.running === true,
    undefined,
    { polling: 200, timeout: 8_000 },
  ).catch(() => {});
  // Wait for turn to settle (running === false)
  await page.waitForFunction(
    () => ((document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null)?.running === false,
    undefined,
    { polling: 500, timeout },
  );
  // Small settle pad for final render
  await page.waitForTimeout(500);
}

/**
 * Return the text content of the discount line in cart totals,
 * e.g. "Promo discount: −$3.99". Traverses shadow roots.
 */
export async function getPromoDiscountText(page: Page): Promise<string> {
  return page.evaluate(() => {
    function traverse(root: Document | ShadowRoot): string {
      const el = root.querySelector('.totals .discount, .discount-line, [class*="promo-discount"]');
      if (el) return el.textContent?.trim() ?? '';

      for (const node of root.querySelectorAll('*')) {
        const sr = (node as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr) {
          const found = traverse(sr);
          if (found) return found;
        }
      }
      return '';
    }
    return traverse(document);
  });
}

// ─── Image attachment helpers ────────────────────────────────────────

/** The composer icon for a registered attachment provider. */
export function attachmentIcon(page: Page, providerId = 'image') {
  return page.locator(`agent-chat-panel .composer-controls [data-attachment-provider="${providerId}"]`);
}

/** Attach an image via the hidden file input and wait for composer thumbnail. */
export async function attachImage(page: Page, file = TEST_IMAGE) {
  await page.locator('agent-chat-panel input[type="file"][accept="image/*"]').setInputFiles(file);
  await page.waitForFunction(() => {
    // Pierce the bubble's shadow root explicitly — see waitForAgentInitSettled.
    const s = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel .wa-thumb-strip') as HTMLElement | null;
    return s && getComputedStyle(s).display !== 'none' && s.querySelector('img');
  }, { timeout: 10_000, polling: 500 });
}

/** Paste an image via ClipboardEvent on the composer input. */
export async function pasteImage(page: Page, file = TEST_IMAGE) {
  const buf = fs.readFileSync(file);
  const b64 = buf.toString('base64');
  await page.evaluate(async (base64) => {
    const resp = await fetch(`data:image/png;base64,${base64}`);
    const blob = await resp.blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'pasted.png', { type: 'image/png' }));
    // Pierce the bubble's shadow root explicitly — see waitForAgentInitSettled.
    const input = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel #input');
    if (input) {
      input.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt, bubbles: true, cancelable: true,
      }));
    }
  }, b64);
  await page.waitForFunction(() => {
    const s = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel .wa-thumb-strip') as HTMLElement | null;
    return s && getComputedStyle(s).display !== 'none' && s.querySelector('img');
  }, { timeout: 10_000, polling: 500 });
}

/** Drop an image via DragEvents on the panel. */
export async function dropImage(page: Page, file = TEST_IMAGE) {
  const buf = fs.readFileSync(file);
  const b64 = buf.toString('base64');
  const payload = await page.evaluate(async (base64) => {
    const resp = await fetch(`data:image/png;base64,${base64}`);
    const blob = await resp.blob();
    return { name: 'drop.png', mimeType: 'image/png', buffer: Array.from(new Uint8Array(await blob.arrayBuffer())) };
  }, b64);
  await page.evaluate((p) => {
    // Pierce the bubble's shadow root explicitly — see waitForAgentInitSettled.
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    if (!panel) return;
    const file = new File([new Uint8Array(p.buffer)], p.name, { type: p.mimeType });
    const dt = new DataTransfer();
    dt.items.add(file);
    panel.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    panel.dispatchEvent(new DragEvent('drop',    { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, payload);
  await page.waitForFunction(() => {
    const s = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel .wa-thumb-strip') as HTMLElement | null;
    return s && getComputedStyle(s).display !== 'none' && s.querySelector('img');
  }, { timeout: 10_000, polling: 500 });
}

// ─── Demo helpers ────────────────────────────────────────

const PROMPTS_LOG = path.resolve(__dirname, '../test-results/demo-prompts.jsonl');

export interface AuditCall {
  name: string;
  input: unknown;
  outcomeSummary: string;
  failed?: boolean;
}

export interface DemoPromptRecord {
  test: string;
  prompt: string;
  model: string;
  trace: AuditCall[];
  reply: string;
  error: string | null;
  ms: number;
}

export async function ask(
  panelPage: Page,
  prompt: string,
  opts: { timeoutMs?: number; model?: string } = {},
): Promise<{ trace: AuditCall[]; reply: string; error: string | null }> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const startMs = Date.now();

  // Inlined (not shared via a serialized closure) because page.evaluate cannot
  // close over Node-scope helpers, and reconstructing a shared closure with
  // `new Function` trips @typescript-eslint/no-implied-eval. Duplicated across
  // the four evaluate/waitForFunction calls below, matching the rest of this
  // file's convention (see waitForAgentInitSettled, waitForToolCall, etc.).
  const before = await panelPage.evaluate(() => {
    const appRoot = document.querySelector('app-root');
    const agentPage = appRoot?.shadowRoot?.querySelector('agent-page');
    const inAgentPage = agentPage?.shadowRoot?.querySelector('agent-chat-panel:not([hidden])')
      ?? agentPage?.shadowRoot?.querySelector('agent-chat-panel');
    const inBubble = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel:not([hidden])')
      ?? (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const panel = (inAgentPage ?? inBubble ?? document.querySelector('agent-chat-panel:not([hidden])') ?? document.querySelector('agent-chat-panel')) as { messages?: unknown[] } | null;
    return panel?.messages?.length ?? 0;
  });

  const sendPromise = panelPage.evaluate((text) => {
    const appRoot = document.querySelector('app-root');
    const agentPage = appRoot?.shadowRoot?.querySelector('agent-page');
    const inAgentPage = agentPage?.shadowRoot?.querySelector('agent-chat-panel:not([hidden])')
      ?? agentPage?.shadowRoot?.querySelector('agent-chat-panel');
    const inBubble = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel:not([hidden])')
      ?? (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const panel = (inAgentPage ?? inBubble ?? document.querySelector('agent-chat-panel:not([hidden])') ?? document.querySelector('agent-chat-panel')) as { send: (t: string) => Promise<{ ran: string }> } | null;
    if (!panel) throw new Error('no agent-chat-panel found');
    return panel.send(text);
  }, prompt);

  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('TIMED_OUT')), timeoutMs);
  });

  try {
    const outcome = await Promise.race([sendPromise, timeoutPromise]);
    if (outcome.ran === 'command') {
      await panelPage.waitForFunction(
        (beforeIndex) => {
          const appRoot = document.querySelector('app-root');
          const agentPage = appRoot?.shadowRoot?.querySelector('agent-page');
          const inAgentPage = agentPage?.shadowRoot?.querySelector('agent-chat-panel:not([hidden])')
            ?? agentPage?.shadowRoot?.querySelector('agent-chat-panel');
          const inBubble = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
            .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel:not([hidden])')
            ?? (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
          const panel = (inAgentPage ?? inBubble ?? document.querySelector('agent-chat-panel:not([hidden])') ?? document.querySelector('agent-chat-panel')) as { messages?: Array<{ role?: string; text?: string }>; running?: boolean } | null;
          const messages = panel?.messages ?? [];
          return messages.slice(beforeIndex).some((m) => m.role === 'assistant' && Boolean(m.text?.trim()))
            && !panel?.running;
        },
        before,
        { timeout: timeoutMs },
      );
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'TIMED_OUT') {
      const state = await panelPage.evaluate((sentPrompt) => {
        const appRoot = document.querySelector('app-root');
        const agentPage = appRoot?.shadowRoot?.querySelector('agent-page');
        const inAgentPage = agentPage?.shadowRoot?.querySelector('agent-chat-panel:not([hidden])')
          ?? agentPage?.shadowRoot?.querySelector('agent-chat-panel');
        const inBubble = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
          .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel:not([hidden])')
          ?? (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
        const panel = (inAgentPage ?? inBubble ?? document.querySelector('agent-chat-panel:not([hidden])') ?? document.querySelector('agent-chat-panel')) as { messages?: Array<{ role?: string; text?: string; trace?: AuditCall[] }> } | null;
        const msgs = panel?.messages ?? [];
        const wanted = sentPrompt.trim();
        let currentUserIndex = -1;
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m.role !== 'user') continue;
          const shown = m.text?.trim() ?? '';
          if (shown === wanted || shown.endsWith(`\n${wanted}`)) {
            currentUserIndex = i;
            break;
          }
        }
        const turn = currentUserIndex < 0 ? [] : msgs.slice(currentUserIndex);
        const traceSoFar = turn.flatMap((m) => m.trace ?? []).map((t) => `${t.name}(${JSON.stringify(t.input)}) -> ${JSON.stringify((t.outcomeSummary ?? '').slice(0, 200))}`);
        return traceSoFar.join(', ');
      }, prompt);
      throw new Error(`turn timed out after ${timeoutMs}ms; trace so far: ${state}`, { cause: err });
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const { turn, panelError } = await panelPage.evaluate((sentPrompt) => {
    const appRoot = document.querySelector('app-root');
    const agentPage = appRoot?.shadowRoot?.querySelector('agent-page');
    const inAgentPage = agentPage?.shadowRoot?.querySelector('agent-chat-panel:not([hidden])')
      ?? agentPage?.shadowRoot?.querySelector('agent-chat-panel');
    const inBubble = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel:not([hidden])')
      ?? (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const panel = (inAgentPage ?? inBubble ?? document.querySelector('agent-chat-panel:not([hidden])') ?? document.querySelector('agent-chat-panel')) as { messages?: Array<{ role?: string; text?: string; trace?: AuditCall[] }>; error?: string | null } | null;
    const msgs = panel?.messages ?? [];
    const error = panel?.error ?? null;
    const wanted = sentPrompt.trim();
    let currentUserIndex = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role !== 'user') continue;
      const shown = m.text?.trim() ?? '';
      if (shown === wanted || shown.endsWith(`\n${wanted}`)) {
        currentUserIndex = i;
        break;
      }
    }
    if (currentUserIndex < 0) throw new Error(`sent prompt missing from conversation: ${sentPrompt}`);
    return { turn: msgs.slice(currentUserIndex), panelError: error };
  }, prompt);

  const elapsedMs = Date.now() - startMs;
  const trace: AuditCall[] = turn.flatMap((m) => m.trace ?? []).map((t) => ({
    name: t.name,
    input: t.input,
    outcomeSummary: t.outcomeSummary ?? '',
    failed: t.failed,
  }));

  const lastAssistant = [...turn].reverse().find((m) => m.role === 'assistant');
  const reply = (typeof lastAssistant?.text === 'string' ? lastAssistant.text : '').trim();

  if (panelError && /HTTP 429|rate limit/i.test(panelError)) {
    throw new Error(`gateway rate limit: ${panelError}`);
  }

  const { test } = await import('@playwright/test');
  const entry: DemoPromptRecord = {
    test: test.info().title,
    prompt,
    model: opts.model ?? process.env.DEMO_MODEL ?? 'sonnet',
    trace,
    reply,
    error: panelError,
    ms: elapsedMs,
  };

  await record(entry);
  return { trace, reply, error: panelError };
}

export async function record(entry: DemoPromptRecord): Promise<void> {
  await fs.promises.mkdir(path.dirname(PROMPTS_LOG), { recursive: true });
  await fs.promises.appendFile(PROMPTS_LOG, JSON.stringify(entry) + '\n', 'utf8');
  try {
    const { test } = await import('@playwright/test');
    await test.info().attach('demo-prompt', {
      body: JSON.stringify(entry, null, 2),
      contentType: 'application/json',
    });
  } catch {
    // ignore if called outside test runner context
  }
}

export function expectCall(
  trace: AuditCall[],
  name: string,
  argsMatch?: Record<string, unknown> | ((input: unknown) => boolean),
): void {
  const calls = trace.filter((t) => t.name === name);
  const calledSummary = trace.length > 0
    ? trace.map((t) => `${t.name}(${JSON.stringify(t.input)})`).join(', ')
    : 'none';
  if (calls.length === 0) {
    throw new Error(`expected a ${name} call; the model called: ${calledSummary}`);
  }
  if (argsMatch) {
    const matches = typeof argsMatch === 'function'
      ? calls.some((c) => argsMatch(c.input))
      : calls.some((c) => {
          if (typeof c.input !== 'object' || c.input === null) return false;
          const inputRec = c.input as Record<string, unknown>;
          return Object.entries(argsMatch).every(([k, v]) => inputRec[k] === v);
        });
    if (!matches) {
      const inputsSummary = calls.map((c) => JSON.stringify(c.input)).join(', ');
      throw new Error(`${name} was called, but its inputs were: ${inputsSummary}`);
    }
  }
}

export function expectOrder(trace: AuditCall[], names: string[]): void {
  let prevIndex = -1;
  let prevName = '';
  for (const name of names) {
    const idx = trace.findIndex((t, i) => i > prevIndex && t.name === name);
    if (idx === -1) {
      const calledSummary = trace.map((t) => t.name).join(', ');
      throw new Error(`expected ${name} in trace, but it was not called (called: ${calledSummary})`);
    }
    if (idx <= prevIndex) {
      throw new Error(`expected ${name} (index ${idx}) after ${prevName} (index ${prevIndex})`);
    }
    prevIndex = idx;
    prevName = name;
  }
}

export function expectNoCall(trace: AuditCall[], name: string): void {
  const calls = trace.filter((t) => t.name === name);
  if (calls.length > 0) {
    const inputsSummary = calls.map((c) => JSON.stringify(c.input)).join(', ');
    throw new Error(`expected no ${name} call; the model called: ${inputsSummary}`);
  }
}
