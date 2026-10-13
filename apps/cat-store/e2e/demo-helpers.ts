import { type Page } from '@playwright/test';
import {
  ask,
  record,
  expectCall,
  expectOrder,
  expectNoCall,
  type AuditCall,
  type DemoPromptRecord,
} from './helpers';

export const TRIGGER =
  'Please run the store demo: call load_skill("demo") to load the "demo" skill, then perform every step of that scripted demo in order.';

export {
  ask,
  record,
  expectCall,
  expectOrder,
  expectNoCall,
  type AuditCall,
  type DemoPromptRecord,
};

/**
 * Every tool call of the conversation, in order, lower-cased.
 *
 * Reads the agent's own audit (`agent-chat-panel.messages[].trace`), NOT the
 * rendered `.tool-step` rows: a tool that returns `outcome.block`
 * (`show_chart`, `show_generative_ui`) renders as a UI block and produces NO
 * tool-step row (see packages/web-agent-core/src/controller-messages.ts, getAssistantParts).
 * Asserting on the DOM rows therefore made block-emitting tools invisible on
 * success and visible only on failure — an inverted signal.
 *
 * Returns [] when the panel is not mounted/has no state; callers' non-empty
 * HARD assertion is the intended loud failure — do NOT fall back to the DOM.
 *
 * Still used by audit-trace.mock.spec.ts (mock tier, out of scope for this task).
 */
export async function auditToolNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // 003: pierce the bubble's shadow root explicitly — agent-chat-panel now
    // lives there. See helpers.ts's waitForAgentInitSettled.
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as
      | (Element & { messages?: { trace?: { name: string }[] }[] })
      | null;
    const names: string[] = [];
    for (const m of panel?.messages ?? []) {
      for (const entry of m.trace ?? []) {
        const t = entry?.name?.trim().toLowerCase();
        if (t) names.push(t);
      }
    }
    return names;
  });
}

export async function hasBlock(page: Page, tag: string): Promise<boolean> {
  return page.evaluate((t) => {
    const root = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot ?? document;
    return root.querySelector(t) !== null;
  }, tag);
}

/** Still used by generative-ui-button-display-leak.mock.spec.ts (mock tier, out of scope for this task). */
export async function waitForBlock(page: Page, tag: string, timeout = 180_000): Promise<void> {
  await page.waitForFunction(
    (t) => {
      const root = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot ?? document;
      return root.querySelector(t) !== null;
    },
    tag,
    { polling: 1_000, timeout },
  );
}
