// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { Page } from '@playwright/test';
import {
  formProbeValue,
  FORM_REQUEST,
  waitForNewFormBlock,
  fillAndSubmitForm,
  expectCall,
  expectOrder,
  expectNoCall,
  type AuditCall,
} from './demo-helpers';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stand-in for the two `Page` methods `waitForNewFormBlock` calls:
 * `waitForFunction` runs the predicate straight against jsdom's real
 * `document` — `waitForNewFormBlock`'s DOM probe falls back to plain
 * `document` when `docs-agent-widget`/`web-agent-bubble` are absent (the
 * first `?? document` in the probe), which is exactly this jsdom page: no
 * widget is mounted. Polls every 5ms regardless of the real `polling` option
 * so a rejecting case does not burn the real timeout in wall-clock time.
 */
function fakePage(): Page {
  return {
    async waitForFunction(
      fn: (arg: unknown) => boolean,
      arg: unknown,
      opts: { timeout: number },
    ): Promise<void> {
      const deadline = Date.now() + opts.timeout;
      if (fn(arg)) return;
      while (Date.now() < deadline) {
        await sleep(5);
        if (fn(arg)) return;
      }
      throw new Error(`waitForFunction timed out after ${opts.timeout}ms`);
    },
  } as unknown as Page;
}

/**
 * Hand-rolled stand-in for a Playwright `Locator`, backed by real jsdom
 * elements. `els()` is re-evaluated on every call rather than captured once,
 * matching how a real `Locator` re-queries the DOM.
 */
class FakeLocator {
  constructor(
    private readonly els: () => Element[],
    private readonly clicks: Element[],
  ) {}

  locator(selector: string): FakeLocator {
    return new FakeLocator(
      () => this.els().flatMap((el) => [...el.querySelectorAll(selector)]),
      this.clicks,
    );
  }

  all(): FakeLocator[] {
    return this.els().map((el) => new FakeLocator(() => [el], this.clicks));
  }

  last(): FakeLocator {
    return new FakeLocator(() => {
      const els = this.els();
      return els.length ? [els[els.length - 1]] : [];
    }, this.clicks);
  }

  first(): FakeLocator {
    return new FakeLocator(() => this.els().slice(0, 1), this.clicks);
  }

  getAttribute(name: string): string | null {
    return this.els()[0]?.getAttribute(name) ?? null;
  }

  fill(value: string): void {
    (this.els()[0] as HTMLInputElement).value = value;
  }

  selectOption(value: string): void {
    (this.els()[0] as HTMLSelectElement).value = value;
  }

  check(): void {
    (this.els()[0] as HTMLInputElement).checked = true;
  }

  click(): void {
    const el = this.els()[0];
    if (el) this.clicks.push(el);
  }

  // No element to wait for is the ONLY failure this stub simulates — a real
  // submit control always resolves this immediately. That is what makes it a
  // stub of a rejecting `waitFor`, not a timer.
  waitFor(): void {
    if (this.els().length === 0) {
      throw new Error('Timeout waiting for locator to become visible');
    }
  }
}

/** A fake `page.locator()` scoped to `container`, plus the clicks it recorded. */
function fakeFormPage(container: HTMLElement): { page: Page; clicks: Element[] } {
  const clicks: Element[] = [];
  const page = {
    locator(selector: string): FakeLocator {
      return new FakeLocator(() => [...container.querySelectorAll(selector)], clicks);
    },
  } as unknown as Page;
  return { page, clicks };
}

describe('formProbeValue', () => {
  it('returns a fresh value on every call', async () => {
    const a = formProbeValue();
    await sleep(5);
    const b = formProbeValue();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^e2e-form-\d+$/);
    expect(b).toMatch(/^e2e-form-\d+$/);
  });
});

describe('FORM_REQUEST', () => {
  it('names "kind", not "type", for every field', () => {
    expect(FORM_REQUEST).toContain('"kind":"text"');
    expect(FORM_REQUEST).toContain('"kind":"select"');
    expect(FORM_REQUEST).toContain('"kind":"checkbox"');
    expect(FORM_REQUEST).not.toContain('"type":"text"');
  });

  it('asks for the three fields the dedicated step fills', () => {
    expect(FORM_REQUEST).toContain('"name":"topic"');
    expect(FORM_REQUEST).toContain('"name":"framework"');
    expect(FORM_REQUEST).toContain('"name":"helpful"');
    expect(FORM_REQUEST).toContain('"submit_label":"Send feedback"');
  });
});

describe('waitForNewFormBlock', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves when the count rises', async () => {
    document.body.appendChild(document.createElement('agent-form-block'));
    document.body.appendChild(document.createElement('agent-form-block'));
    await expect(waitForNewFormBlock(fakePage(), 1, 1_000)).resolves.toBeUndefined();
  });

  it('rejects when the count does not rise', async () => {
    document.body.appendChild(document.createElement('agent-form-block'));
    await expect(waitForNewFormBlock(fakePage(), 1, 30)).rejects.toThrow();
  });
});

function buildForm(container: HTMLElement, { withSubmit }: { withSubmit: boolean }): void {
  const form = document.createElement('agent-form-block');

  const topic = document.createElement('input');
  topic.type = 'text';
  topic.setAttribute('data-name', 'topic');
  form.appendChild(topic);

  const framework = document.createElement('select');
  framework.setAttribute('data-name', 'framework');
  for (const value of ['lit3', 'lit1', 'vanilla']) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    framework.appendChild(option);
  }
  form.appendChild(framework);

  const helpful = document.createElement('input');
  helpful.type = 'checkbox';
  helpful.setAttribute('data-name', 'helpful');
  form.appendChild(helpful);

  if (withSubmit) {
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Send feedback';
    form.appendChild(submit);
  }

  container.appendChild(form);
}

describe('fillAndSubmitForm', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('returns every field it filled', async () => {
    buildForm(container, { withSubmit: true });
    const { page } = fakeFormPage(container);
    const probe = 'e2e-form-123';

    const result = await fillAndSubmitForm(page, probe);

    // "vanilla" is the LAST select option, not "lit3" — `_resetValues`
    // already pre-selects options[0], so the first option proves nothing.
    expect(result).toEqual({
      names: ['topic', 'framework', 'helpful'],
      values: { topic: `${probe}-0`, framework: 'vanilla', helpful: true },
    });
  });

  it('clicks the submit control exactly once', async () => {
    buildForm(container, { withSubmit: true });
    const { page, clicks } = fakeFormPage(container);

    await fillAndSubmitForm(page, 'e2e-form-123');

    expect(clicks).toHaveLength(1);
    expect((clicks[0] as HTMLElement).getAttribute('type')).toBe('submit');
  });

  it('throws when no submit control is visible', async () => {
    buildForm(container, { withSubmit: false });
    const { page, clicks } = fakeFormPage(container);

    let dispatched = false;
    document.addEventListener('block-submit', () => {
      dispatched = true;
    });

    await expect(fillAndSubmitForm(page, 'e2e-form-123')).rejects.toThrow();

    expect(clicks).toHaveLength(0);
    expect(dispatched).toBe(false);
  });
});

function call(name: string, input: unknown = {}): AuditCall {
  return { name, input, outcomeSummary: '' };
}

describe('expectCall', () => {
  it('throws when the tool was not called', () => {
    expect(() => expectCall([call('search_docs')], 'load_skill')).toThrow();
  });

  it('passes when the tool was called', () => {
    expect(() => expectCall([call('load_skill', { name: 'demo' })], 'load_skill')).not.toThrow();
  });

  it('validates an object argument predicate', () => {
    const trace = [call('load_skill', { name: 'demo' })];
    expect(() => expectCall(trace, 'load_skill', { name: 'demo' })).not.toThrow();
    expect(() => expectCall(trace, 'load_skill', { name: 'panel-chart' })).toThrow();
  });

  it('validates a function argument predicate', () => {
    const trace = [call('show_generative_ui', { type: 'form' })];
    expect(() => expectCall(trace, 'show_generative_ui', (i) => (i as { type?: unknown })?.type === 'form')).not.toThrow();
    expect(() => expectCall(trace, 'show_generative_ui', (i) => (i as { type?: unknown })?.type === 'chart')).toThrow();
  });
});

describe('expectOrder', () => {
  it('passes when calls appear in the given order', () => {
    const trace = [call('search_skills'), call('load_skill'), call('search_docs')];
    expect(() => expectOrder(trace, ['search_skills', 'load_skill', 'search_docs'])).not.toThrow();
  });

  it('rejects an out-of-order sequence', () => {
    const trace = [call('load_skill'), call('search_skills')];
    expect(() => expectOrder(trace, ['search_skills', 'load_skill'])).toThrow();
  });
});

describe('expectNoCall', () => {
  it('throws when a forbidden tool was called', () => {
    expect(() => expectNoCall([call('show_generative_ui')], 'show_generative_ui')).toThrow();
  });

  it('passes when the forbidden tool was never called', () => {
    expect(() => expectNoCall([call('load_skill')], 'show_generative_ui')).not.toThrow();
  });
});
