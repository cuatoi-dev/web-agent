import {
  ask,
  record,
  expectCall,
  expectOrder,
  expectNoCall,
  type AuditCall,
  type DemoPromptRecord,
} from './helpers';
import type { Page } from '@playwright/test';

export const TRIGGER =
  'Please run the docs demo: call load_skill("demo") to load the "demo" skill, then perform every step of that scripted demo in order.';

export const FORM_REQUEST =
  'Call show_generative_ui right now with exactly this input and do nothing else: ' +
  '{"type":"form","id":"feedback-direct","fields":[' +
  '{"kind":"text","name":"topic","label":"Topic"},' +
  '{"kind":"select","name":"framework","label":"Framework","options":["lit3","lit1","vanilla"]},' +
  '{"kind":"checkbox","name":"helpful","label":"Was this helpful?"}' +
  '],"submit_label":"Send feedback"}';

export function formProbeValue(): string {
  return `e2e-form-${Date.now()}`;
}

export interface SubmittedForm {
  names: string[];
  values: Record<string, string | boolean>;
}

export async function waitForNewFormBlock(page: Page, countBefore: number, timeout = 120_000): Promise<void> {
  await page.waitForFunction(
    (before) => {
      const root = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot ?? document;
      return root.querySelectorAll('agent-form-block').length > before;
    },
    countBefore,
    { polling: 500, timeout },
  );
}

export async function fillAndSubmitForm(page: Page, probe: string): Promise<SubmittedForm> {
  const form = page.locator('agent-form-block').last();
  const textInputs = await form.locator('input[type="text"], input:not([type])').all();
  const names: string[] = [];
  const values: Record<string, string | boolean> = {};

  for (let i = 0; i < textInputs.length; i++) {
    const inp = textInputs[i];
    const name = (await inp.getAttribute('data-name')) ?? `text-${i}`;
    const val = `${probe}-${i}`;
    await inp.fill(val);
    names.push(name);
    values[name] = val;
  }

  const selects = await form.locator('select').all();
  for (let i = 0; i < selects.length; i++) {
    const sel = selects[i];
    const name = (await sel.getAttribute('data-name')) ?? `select-${i}`;
    const opts = await sel.locator('option').all();
    const lastOpt = opts[opts.length - 1];
    const lastVal = lastOpt ? await lastOpt.getAttribute('value') : null;
    if (lastVal !== null) {
      await sel.selectOption(lastVal);
      names.push(name);
      values[name] = lastVal;
    }
  }

  const checkboxes = await form.locator('input[type="checkbox"]').all();
  for (let i = 0; i < checkboxes.length; i++) {
    const cb = checkboxes[i];
    const name = (await cb.getAttribute('data-name')) ?? `cb-${i}`;
    await cb.check();
    names.push(name);
    values[name] = true;
  }

  const submitBtn = form.locator('[type="submit"]').first();
  await submitBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await submitBtn.click();

  return { names, values };
}

export {
  ask,
  record,
  expectCall,
  expectOrder,
  expectNoCall,
  type AuditCall,
  type DemoPromptRecord,
};
