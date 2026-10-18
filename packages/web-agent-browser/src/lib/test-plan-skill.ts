import type { SkillDef } from "@cuatoi/web-agent-core";

/** The side panel's `testing` skill group: plan, run and report a test suite. */
export const testPlanSkill: SkillDef = {
  name: "test_plan",
  description:
    "Plan a numbered test suite for a page, run every case with the page tools, report each case with evidence, and build a downloadable HTML report.",
  command: false,
  definition: `# test_plan

Plan a test suite for a page, run it, and report it.

1. **Start the run.** Note the start time as <stamp> (yyyy-mm-dd-hhmmss).
   Everything this run saves goes in /tmp/runs/<stamp>/.
2. **Plan as a suite.** Start with an overview of the application. Then write
   independent test cases that each start from a fresh state. Number them
   TC-01, TC-02, …. Give each case numbered steps and the expected result.
   Order them: the happy path first, then edge and error cases, then limit
   cases.
3. **Run each case** with page_snapshot, page_fill_form, page_click,
   page_select_option and page_verify. Read page_network and page_console.
   Answer dialogs with page_dialog.
4. **Capture the result of every case, right after its check, before the next
   case changes the page.** The picture must show what proves PASS or FAIL,
   not just the page:
   - Find the result element: the element whose state the check is about (the
     cart badge, the error message, the new table row, the disabled button).
     Take its ref from page_snapshot.
   - If that element alone shows the result, capture only it:
     page_screenshot { ref, save_to: "/tmp/runs/<stamp>/TC-<nn>-<slug>.png" }.
   - If the reader needs the area around it to understand the result (where
     the element sits, what changed next to it), capture the viewport with the
     element outlined:
     page_screenshot { highlight: [ref], save_to: "/tmp/runs/<stamp>/TC-<nn>-<slug>.png" }.
   - If the element has no ref, use its css or xpath from page_generate_locator
     instead of ref. If you need a ref for highlight, you may add a temporary
     aria-label with page_eval and remove it after the capture. A temporary
     attribute never goes into a test case file or a page table.
   - A plain viewport capture with nothing outlined is not evidence. Never use
     one for a case.
   - For a FAIL, capture the wrong state as it is.
5. **Report every case as one evidence report, in exactly this layout:**

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
         /tmp/runs/<stamp>/TC-04-long-code.png (element | highlight)

   Write "none" for Network or Console errors when there is nothing to show.
   Screenshot is never "none".
6. **Build the report.** When the run is over, call test_report and follow it.
   A run without /tmp/runs/<stamp>/report.html is not finished.
`,
};
