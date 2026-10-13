import type { SkillDef } from "@cuatoi/web-agent-core";

/** 120/005 — the side panel's `playwright` skill group. 124/004 — extended for
 *  idea 122: survey with page_snapshot, locators from page_generate_locator,
 *  checks with page_verify, and the file from export_test. */
export const playwrightScriptSkill: SkillDef = {
  name: "playwright_script",
  description:
    "Write one runnable @playwright/test spec for a page, using the case numbers of your test plan.",
  command: false,
  definition: `# playwright_script

Write one runnable \`@playwright/test\` spec for a page, using the case numbers
of your test plan.

1. **Survey the page first** with \`page_snapshot\`. Use \`page_screenshot\`,
   when it is offered, to see the layout.
2. **Get locators from \`page_generate_locator\`.** Do not write a locator by
   hand.
3. **Confirm checks with \`page_verify\`.** Each PASS result is journaled as a
   web-first assertion.
4. **Build the file with \`export_test\`** (\`format: "playwright"\`) instead of
   writing it by hand. Use your test plan's case ids, for example \`TC-01\`, and
   map each step to the journal ids from its tool results.
5. **After the spec, give the command to run it:**
   \`npx playwright test <file name>.spec.ts\`
`,
};
