import { test, expect } from './fixtures';
import { openPanel, sendChat } from './helpers';
import type { AgentPageProbe, ChatPanelProbe, WebAgentBubbleProbe } from './dom-types';

// 104/002 — the remember and onboarding skills are configured on the Agent page
// only, and the model sees them in the # Skills prompt section.
test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

async function agentPageSkills(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const appRoot = document.querySelector('app-root');
    const agentPage = appRoot?.shadowRoot?.querySelector('agent-page') as AgentPageProbe | null;
    const panel = agentPage?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    const config = panel?.buildSessionConfig();
    return (config?.skills ?? []).map((s) => ({
      name: s.name,
      description: s.description,
      definition: s.definition,
    }));
  });
}

async function bubbleSkillNames(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const widget = document.querySelector('cat-agent-widget');
    const bubble = widget?.shadowRoot?.querySelector('web-agent-bubble') as WebAgentBubbleProbe | null;
    const panel = bubble?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    return (panel?.buildSessionConfig()?.skills ?? []).map((s) => s.name);
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__SYSTEM_PROMPTS__ = [];
    window.__WA_MOCK_SCRIPT__ = (opts: any) => {
      if (typeof opts.systemPrompt === 'string') window.__SYSTEM_PROMPTS__!.push(opts.systemPrompt);
      return { text: 'Mock reply.' };
    };
  });
});

test('Agent page: the remember and onboarding skills are configured', async ({ page }) => {
  await page.goto('#/agent');
  await expect(page.locator('agent-chat-panel #input')).toBeVisible({ timeout: 15_000 });

  const skills = await agentPageSkills(page);
  const remember = skills.find((s) => s.name === 'remember');
  const onboarding = skills.find((s) => s.name === 'onboarding');
  expect(remember).toBeDefined();
  expect(onboarding).toBeDefined();
  expect(remember!.description).toContain('Save, change or forget an entry in USER.md or MEMORY.md');
  // The text names the resolved paths and limits, not placeholders.
  expect(remember!.definition).toContain('/home/shared/USER.md');
  expect(remember!.definition).toContain('/home/agent/MEMORY.md');
  expect(remember!.definition).toContain('2000');
  expect(remember!.definition).toContain('4000');
  expect(remember!.definition).not.toContain('{userPath}');
  expect(onboarding!.definition).toContain('/home/shared/USER.md');
});

test('Agent page: the model sees both skills in the # Skills prompt section', async ({ page }) => {
  await page.goto('#/agent');
  await expect(page.locator('agent-chat-panel #input')).toBeVisible({ timeout: 15_000 });
  await sendChat(page, 'hello');
  await expect(page.locator('agent-message-view .assistant .content').last())
    .toContainText('Mock reply.', { timeout: 10_000 });

  const prompts = await page.evaluate(() => window.__SYSTEM_PROMPTS__!);
  expect(prompts.length).toBeGreaterThan(0);
  expect(prompts.some((p) => p.includes('- remember — Save, change or forget an entry'))).toBe(true);
  expect(prompts.some((p) => p.includes('- onboarding — Create USER.md with the user'))).toBe(true);
});

test('bubble: neither memory skill is configured and neither is in the prompt', async ({ page }) => {
  await openPanel(page);
  const names = await bubbleSkillNames(page);
  expect(names).not.toContain('remember');
  expect(names).not.toContain('onboarding');

  await sendChat(page, 'hello');
  await expect.poll(() => page.evaluate(() => window.__SYSTEM_PROMPTS__!.length), { timeout: 10_000 })
    .toBeGreaterThan(0);
  const prompts = await page.evaluate(() => window.__SYSTEM_PROMPTS__!);
  expect(prompts.some((p) => p.includes('- remember — '))).toBe(false);
  expect(prompts.some((p) => p.includes('- onboarding — '))).toBe(false);
});
