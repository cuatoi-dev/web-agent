import type { SkillDef } from "@cuatoi/web-agent-core";

/** 124/004 — the side panel's `playwright` skill group: what to do when a test
 *  step fails (idea 122). */
export const testHealerSkill: SkillDef = {
  name: "test_healer",
  description:
    "Fix a failed test step: take a new snapshot, generate the locator again, retry once, or report an application defect.",
  command: false,
  definition: `# test_healer

Use this when a test step fails.

1. Take a new \`page_snapshot\` and call \`page_generate_locator\` again.
2. Use a regular expression for dynamic data in the exported spec.
3. Never wait for "network idle".
4. Retry the step once.
5. When the application itself is wrong, report an application defect. In the
   exported spec, mark that case \`test.fixme()\` with a comment that says why.
`,
};
