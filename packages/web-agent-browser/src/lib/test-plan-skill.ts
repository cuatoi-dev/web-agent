import type { SkillDef } from "@cuatoi/web-agent-core";

/** The side panel's `testing` skill group: plan, run and report a test suite. */
export const testPlanSkill: SkillDef = {
  name: "test_plan",
  description:
    "Plan a numbered test suite for a page, run every case with the page tools, report each case with evidence, and build a downloadable HTML report.",
  command: false,
  definition: `# test_plan

Plan a test suite for a page, run it, and report it.

1. **Plan as a suite.** Start with an overview of the application. Then write
   independent test cases that each start from a fresh state. Number them
   \`TC-01\`, \`TC-02\`, …. Give each case numbered steps and the expected
   result of each step.
2. **Order the cases:** the happy path first, then edge and error cases, then
   limit cases.
3. **Run the cases in order** with \`page_snapshot\`, \`page_fill_form\`,
   \`page_click\`, \`page_select_option\` and \`page_verify\`. Read
   \`page_network\` and \`page_console\`. Answer dialogs with \`page_dialog\`.
   Take a \`page_screenshot\` when that tool is offered.
4. **Report every case as one evidence report, in exactly this layout:**

   \`\`\`
   TC-04 Limit: 2,000-character code — FAIL
   Steps
     1. fill [7] textbox "Coupon" with 2,000 × "A"
     2. click [8] button "Apply"
   Checks
     FAIL expected text "Code too long"; found none
   Network
     #14 POST /api/coupon → 500 (812 ms)
   Console errors
     Uncaught TypeError: cannot read 'total' of undefined
   Screenshot
     taken after step 2
   \`\`\`

   Omit \`Network\`, \`Console errors\` or \`Screenshot\` only when there is
   nothing to show, and write "none" instead.
5. **Build the report.** When the run is over, call \`test_report\` and follow
   it. It writes the run's \`report.src.html\`, bundles it into
   \`report.html\`, and gives you the one-line-per-case summary to send. A run
   without \`report.html\` is not finished.
`,
};
