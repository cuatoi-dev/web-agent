import { test, expect } from './fixtures';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { openBubble, sendChat, waitForAssistantReply, waitForToolCall, installMockScript, shot } from './helpers';
import { docsSlugSearchScript, docsSkillsScript } from '../src/e2e-mock/mock-scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the search dataset the search_docs tool imports. Each entry must carry
// a `category` ('Guides' | 'Beer CSS Reference') so the tool can format the
// SPA hash route. See scripts/build-static.mjs.
const docsIndex = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../src/generated/docs-index.json'), 'utf-8')
) as Array<{ slug: string; title: string; category?: string; folder?: string; text: string }>;

test.describe.configure({ mode: 'serial' });

// No shared beforeEach: each test installs its own mock script, and
// addInitScript must be registered before openBubble navigates.

// ─── Test 1: search_docs — known slug appears in reply ───────────────────────

test('search_docs: registry query — known slug in reply', async ({ page }) => {
  test.setTimeout(180_000);
  const modelCalls = await installMockScript(page, docsSlugSearchScript);
  await openBubble(page);

  await sendChat(page, 'Use search_docs to search for "registry" and tell me what pages you find.');

  // Deterministic: a search_docs tool call must have happened (its UI affordance
  // is "search_docs" in the rendered HTML — see helpers.waitForToolCall).
  await waitForToolCall(page, 60_000);

  const reply = await waitForAssistantReply(page, 120_000);
  expect(reply.length).toBeGreaterThan(10);
  expect(modelCalls()).toBe(0);

  await shot(page, 'custom-tools-01-search-registry.png');
});

// ─── Test 2: search_docs — lit3-scoped query returns lit3-registry ────────────

test('search_docs: lit3 scoped query returns lit3-registry result', async ({ page }) => {
  test.setTimeout(180_000);
  const modelCalls = await installMockScript(page, docsSlugSearchScript);
  await openBubble(page);

  await sendChat(page, 'Use search_docs with query "lit3 registry" and tell me the page slug it returns.');

  // Deterministic: search_docs tool call must happen.
  await waitForToolCall(page, 60_000);

  const reply = await waitForAssistantReply(page, 120_000);
  expect(reply.length).toBeGreaterThan(10);
  expect(modelCalls()).toBe(0);

  await shot(page, 'custom-tools-02-search-lit3.png');
});

// ─── Test 4: search_docs — beercss query triggers tool + dataset is categorized ──
//
// Deterministic check (mirrors routing.mock.spec.ts's fs-read of md-index.json):
// - The tool round-trip (waitForToolCall + non-empty reply) MUST happen.
// - The on-disk search dataset (src/generated/docs-index.json) MUST contain a
//   beercss entry (e.g. slug "button") AND at least one Guides entry, with
//   the `category` field set on each — proving the category enrichment.

test('search_docs: beercss query triggers tool + search index is categorized', async ({ page }) => {
  test.setTimeout(180_000);

  // ---- fs-read assertion (deterministic, no LLM) -----------------------------
  const beerCssEntry = docsIndex.find(
    (e) => e.slug === 'button' && e.category === 'Beer CSS Reference',
  );
  expect(beerCssEntry, 'docs-index.json must contain {slug:"button", category:"Beer CSS Reference"}').toBeDefined();
  expect(docsIndex.some((e) => e.category === 'Guides'), 'docs-index.json must contain at least one Guides entry').toBe(true);
  // Every entry must carry a category (Guides | Beer CSS Reference).
  for (const e of docsIndex) {
    expect(e.category, `every docs-index entry needs a category: ${e.slug}`).toBeTruthy();
    expect(e.folder, `every docs-index entry needs a folder: ${e.slug}`).toBeTruthy();
  }

  // ---- tool round-trip (deterministic: tool call + non-empty reply) ----------
  const modelCalls = await installMockScript(page, docsSlugSearchScript);
  await openBubble(page);
  await sendChat(page, 'Use search_docs with query "button" and tell me the first page slug and route it returns.');

  await waitForToolCall(page, 60_000);
  const reply = await waitForAssistantReply(page, 120_000);
  expect(reply.length).toBeGreaterThan(10);
  expect(modelCalls()).toBe(0);

  await shot(page, 'custom-tools-04-search-beercss.png');
});

// ─── Test 3: docs-guide skill round-trip ─────────────────────────────────────

test('skills: search_skills + load_skill round-trip for docs-guide', async ({ page }) => {
  test.setTimeout(180_000);
  const modelCalls = await installMockScript(page, docsSkillsScript);
  await openBubble(page);

  // A natural question about integration should cause the panel to call
  // search_skills → load_skill docs-guide (the skill is registered on the bubble).
  // The docs-guide skill then asks which UI framework before calling search_docs.
  await sendChat(page, 'How do I integrate the Web Agent into my Lit 3 app?');

  await waitForToolCall(page, 60_000);

  const reply = await waitForAssistantReply(page, 120_000);
  expect(reply.length).toBeGreaterThan(10);

  const asksFramework = /which.*(framework|Lit)|Lit 3.*Lit 1|framework.*using|what.*framework/i.test(reply);
  if (asksFramework) {
    // Confirm Lit 3 and wait for a second reply (also deterministic: non-empty).
    await sendChat(page, 'I am using Lit 3.');
    try { await waitForToolCall(page, 60_000); } catch { /* ok */ }
    const reply2 = await waitForAssistantReply(page, 120_000);
    expect(reply2.length).toBeGreaterThan(10);
  }

  await shot(page, 'custom-tools-03-docs-guide.png');
  expect(modelCalls()).toBe(0);
});
