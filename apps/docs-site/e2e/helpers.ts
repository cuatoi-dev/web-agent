import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { type Page, type Route } from '@playwright/test';
import type { MockResponse, ProviderCallOptions } from '@cuatoi/web-agent-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts');

export async function openBubble(page: Page) {
  await page.goto('', { timeout: 30_000 });

  // Wait on the launcher button, not the `web-agent-bubble` host — the
  // host carries no CSS of its own (default `display: inline`) and its shadow
  // content is all `position: fixed`, so the host's own bounding box collapses
  // to 0x0 and Playwright's `state: 'visible'` never resolves against it. The
  // launcher itself always has a real box. Same fix as cat-store's helpers.ts.
  const launcher = page.locator('web-agent-bubble button#launcher');
  await launcher.waitFor({ state: 'visible', timeout: 15_000 });

  const panelOpen = await page.locator('agent-chat-panel').isVisible().catch(() => false);
  if (!panelOpen) {
    await launcher.click();
  }

  await page.waitForSelector('agent-chat-panel', { state: 'visible', timeout: 10_000 });
}

export async function sendChat(page: Page, text: string) {
  const input = page.locator('agent-chat-panel .wa-textarea');
  await input.waitFor({ state: 'visible' });
  await input.fill(text);
  await input.press('Enter');
}

export async function waitForAssistantReply(page: Page, timeout = 120_000): Promise<string> {
  await page.waitForFunction(() => {
    // Agent-chat-panel now lives inside <web-agent-bubble>'s OPEN shadow
    // root, so a raw document.querySelector no longer finds it — go through
    // the bubble's shadowRoot explicitly.
    const root = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot;
    const vs = [...(root?.querySelectorAll('agent-message-view') ?? [])].filter(v => v.querySelector('.message-container.assistant'));
    if (vs.length === 0) return false;
    const last = vs[vs.length - 1];
    const t = (last.querySelector('.content')?.textContent ?? '').trim();
    return t.length > 5;
  }, { polling: 1_000, timeout });
  return await page.evaluate(() => {
    const root = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot;
    const vs = [...(root?.querySelectorAll('agent-message-view') ?? [])].filter(v => v.querySelector('.message-container.assistant'));
    const last = vs[vs.length - 1];
    return (last?.querySelector('.content')?.textContent ?? '').trim();
  });
}

export async function waitForToolCall(page: Page, timeout = 45_000) {
  await page.waitForFunction(() => {
    const root = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot;
    const vs = [...(root?.querySelectorAll('agent-message-view') ?? [])].filter(v =>
      v.querySelector('.message-container.assistant')
    );
    if (vs.length === 0) return false;
    const last = vs[vs.length - 1];
    return /tool|search_docs|load_skill|search_skills/i.test(last.innerHTML);
  }, { polling: 500, timeout });
}

export async function shot(page: Page, name: string) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, name) });
}

/** Count the composer attachment-provider icons (1 on docs: the element picker). */
export async function attachButtonCount(page: Page): Promise<number> {
  return page.locator('agent-chat-panel .composer-controls [data-attachment-provider]').count();
}

/**
 * Count ONLY the built-in image attach button.
 *
 * `attachButtonCount` counts every attachment provider, and docs-site
 * legitimately has one: `domTools()` registers the element picker
 * (id "picker") unconditionally, independent of its `images` option. docs-site
 * is non-vision for IMAGES — `imageInput: false` means the image provider
 * (id "image") is never added — so this narrower count is what "no attach
 * button" actually means here.
 */
export async function imageAttachButtonCount(page: Page): Promise<number> {
  return page
    .locator('agent-chat-panel .composer-controls [data-attachment-provider="image"]')
    .count();
}

/**
 * Install a deterministic mock model and start counting real model API calls.
 *
 * MUST be called BEFORE `openBubble` — `addInitScript` only applies to
 * navigations registered after it, and `openBubble` is what navigates.
 *
 * Returns a getter for the number of intercepted model requests; a mocked spec
 * must see 0.
 */
export async function installMockScript(
  page: Page,
  script: (opts: ProviderCallOptions) => MockResponse,
): Promise<() => number> {
  await page.addInitScript(`window.__WA_MOCK_SCRIPT__ = ${script.toString()};`);
  let calls = 0;
  const count = (route: Route) => {
    calls++;
    void route.abort();
  };
  await page.route('**/api/anthropic/**', count);
  await page.route('**/api/openai/**', count);
  return () => calls;
}

/** Return innerHTML of the last assistant message (empty string if none). */
export async function lastAssistantHtml(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot;
    const vs = [...(root?.querySelectorAll('agent-message-view') ?? [])].filter(v => v.querySelector('.message-container.assistant'));
    if (vs.length === 0) return '';
    return (vs[vs.length - 1].querySelector('.message-container.assistant') as HTMLElement)?.innerHTML ?? '';
  });
}

/**
 * Wait for a single turn to complete by polling the panel's `running` property.
 * First waits briefly for `running === true` (turn started), then for `running === false`
 * (turn settled), then a small pad so the UI finishes rendering any final state.
 */
export async function waitForTurnComplete(page: Page, timeout = 150_000) {
  // Wait for turn to start (running === true) — short timeout, swallow if already done
  await page.waitForFunction(
    // Pierce the bubble's shadow root explicitly — see waitForAssistantReply.
    () => (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel')?.running === true,
    undefined,
    { polling: 200, timeout: 8_000 },
  ).catch(() => {});
  // Wait for turn to settle (running === false)
  await page.waitForFunction(
    () => (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel')?.running === false,
    undefined,
    { polling: 500, timeout },
  );
  // Small settle pad for final render
  await page.waitForTimeout(500);
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
  // the four evaluate/waitForFunction calls below, matching this file's other
  // shadow-piercing helpers (waitForAssistantReply, waitForToolCall, etc.).
  const before = await panelPage.evaluate(() => {
    const inBubble = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel:not([hidden])')
      ?? (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const panel = (inBubble ?? document.querySelector('agent-chat-panel:not([hidden])') ?? document.querySelector('agent-chat-panel')) as { messages?: unknown[] } | null;
    return panel?.messages?.length ?? 0;
  });

  const sendPromise = panelPage.evaluate((text) => {
    const inBubble = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel:not([hidden])')
      ?? (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const panel = (inBubble ?? document.querySelector('agent-chat-panel:not([hidden])') ?? document.querySelector('agent-chat-panel')) as { send: (t: string) => Promise<{ ran: string }> } | null;
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
          const inBubble = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document)
            .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel:not([hidden])')
            ?? (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
          const panel = (inBubble ?? document.querySelector('agent-chat-panel:not([hidden])') ?? document.querySelector('agent-chat-panel')) as { messages?: Array<{ role?: string; text?: string }>; running?: boolean } | null;
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
        const inBubble = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document)
          .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel:not([hidden])')
          ?? (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
        const panel = (inBubble ?? document.querySelector('agent-chat-panel:not([hidden])') ?? document.querySelector('agent-chat-panel')) as { messages?: Array<{ role?: string; text?: string; trace?: AuditCall[] }> } | null;
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
        const traceSoFar = turn.flatMap((m) => m.trace ?? []).map((t) => `${t.name}(${JSON.stringify(t.input)}) -> ${JSON.stringify(((t as { outcomeSummary?: string }).outcomeSummary ?? '').slice(0, 200))}`);
        return traceSoFar.join(', ');
      }, prompt);
      throw new Error(`turn timed out after ${timeoutMs}ms; trace so far: ${state}`, { cause: err });
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const { turn, panelError } = await panelPage.evaluate((sentPrompt) => {
    const inBubble = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel:not([hidden])')
      ?? (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel');
    const panel = (inBubble ?? document.querySelector('agent-chat-panel:not([hidden])') ?? document.querySelector('agent-chat-panel')) as { messages?: Array<{ role?: string; text?: string; trace?: AuditCall[] }>; error?: string | null } | null;
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
