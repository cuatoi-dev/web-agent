import { test, expect } from './fixtures';
import { openPanel, sendChat, shot } from './helpers';
import type { ProviderCallOptions } from '@cuatoi/web-agent-core';

// Cat-store's LocalStorageSkillRegistry has no owners, so its
// create_skill has no `shared` input and the confirm summary is unchanged.
// BDD 0250.10.

const createSkillMockScript = function (opts: ProviderCallOptions) {
  const create = (opts.tools ?? []).find((t) => t.name === 'create_skill');
  if (window.__CAT_CREATE_SKILL_SCHEMA__ === undefined) {
    window.__CAT_CREATE_SKILL_SCHEMA__ = create ? create.input_schema : null;
    return {
      toolCalls: [
        {
          id: 'call_create_cat_note',
          name: 'create_skill',
          input: { name: 'cat_note', description: 'A cat-store note', definition: 'Note text.' },
        },
      ],
    };
  }
  return { text: 'Not saved.', finishReason: 'stop' };
};

test.describe.configure({ mode: 'serial' });
test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(`window.__WA_MOCK_SCRIPT__ = ${createSkillMockScript.toString()};`);
  await openPanel(page);
});

test('create_skill in cat-store has no shared input and the summary names only the skill', async ({ page }) => {
  await sendChat(page, 'Save a skill named cat_note.');
  const scrim = page.locator('agent-chat-panel .wa-confirm-scrim');
  await expect(scrim).toBeVisible({ timeout: 30_000 });
  await expect(scrim.locator('.wa-confirm-card strong').first()).toHaveText('Create skill "cat_note"');
  await shot(page, 'create-skill-no-owner-01-confirm.png');

  const schema = await page.evaluate(() => window.__CAT_CREATE_SKILL_SCHEMA__);
  expect(schema).not.toBeNull();
  expect(Object.keys((schema as { properties: Record<string, unknown> }).properties)).not.toContain('shared');
  expect((schema as { required: string[] }).required).toEqual(['name', 'description', 'definition']);

  await scrim.locator("button:has-text('Reject'), md-outlined-button:has-text('Reject')").first().click();
  await expect(scrim).toHaveCount(0, { timeout: 10_000 });
});
