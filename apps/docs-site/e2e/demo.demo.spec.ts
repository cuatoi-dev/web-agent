import { test } from './fixtures';
import { openBubble, ask, expectCall } from './helpers';
import { TRIGGER, FORM_REQUEST } from './demo-helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(660_000);
test.use({ consoleErrorExtraAllowlist: ['[autotitle]'] });

test('docs-site full demo run via /demo skill', async ({ page }) => {
  await openBubble(page);

  // Turn 1: trigger full docs demo script
  const { trace: trace1 } = await ask(page, TRIGGER, { timeoutMs: 300_000 });
  expectCall(trace1, 'search_skills');
  expectCall(trace1, 'load_skill');
  expectCall(trace1, 'search_docs');

  // Turn 2: dedicated form presentation
  const { trace: trace2 } = await ask(page, FORM_REQUEST, { timeoutMs: 300_000 });
  expectCall(trace2, 'show_generative_ui', (input: unknown) => {
    return (input as { type?: unknown })?.type === 'form';
  });
});
