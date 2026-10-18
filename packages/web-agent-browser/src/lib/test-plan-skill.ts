import type { SkillDef } from "@cuatoi/web-agent-core";

/** The side panel's `testing` skill group: run and maintain an app's BDD test suite. */
export const testPlanSkill: SkillDef = {
  name: "test_plan",
  description:
    "Run and maintain an app's saved BDD test cases (or explore the app first), check results with page_verify, update TC files, page locator tables and Known defects, run a limit pass, and build a downloadable HTML report.",
  command: false,
  definition: `# test_plan

Run and maintain an app's test suite, or explore the app first, then report it.

1. **Start the run.** Note the start time as <stamp> (yyyy-mm-dd-hhmmss).
   Everything this run saves goes in /tmp/runs/<stamp>/. Find the workspace W
   (/home/agent or an attached /share/<name>) whose AGENTS.md lists the app
   under ## Apps. When the user asks to rerun a suite (such as "Rerun the
   checkout suite") and only one app in the workspace has that suite (or only
   one app is listed in ## Apps), use that app directly without asking which
   app. If the current page's host is a new host for that same app, add the
   host under ## Environments in W/apps/<app>/AGENTS.md and on the app's line
   under ## Apps in W/AGENTS.md.
2. **Check the site map and suite files.**
   - If the app is not in ## Apps, or W/apps/<app>/AGENTS.md has no ## Site map
     entries, load and run explore_app first.
   - List W/apps/<app>/<suite>/TC-*.md in number order (TC-01, TC-02, …). If
     the suite has no TC-*.md files yet, follow explore_app to propose suites
     and case titles in chat and wait for the user's OK before writing TC files
     and running them.
3. **Run each case** with page_snapshot, page_fill_form, page_click,
   page_select_option and page_verify. Read page_network and page_console.
   Answer dialogs with page_dialog:
   - For each TC-<nn>-<slug>.md file in number order, read the TC file and the
     W/apps/<app>/pages/<page>.md files it names on its Pages line.
   - Do each Given and When step with the page tools, matching elements by the
     Element column and Role + name column of the page table. Read
     W/apps/<app>/secrets.md only when a login step needs a password, and never
     copy a password into another file or the chat.
   - Check each Then step with page_verify.
   - Update the files with one edit_file change at a time (using today's date
     <date> as yyyy-mm-dd):
     - **All Then checks pass:** edit_file the TC file to
       "Last result: PASS <date>". If ## Known defects in
       W/apps/<app>/AGENTS.md has a line for this TC, remove that line.
     - **Element not found by its table row, but the same element is on the
       page and behaviour is right:** call page_generate_locator on the
       element's current ref, edit_file that row in W/apps/<app>/pages/<page>.md,
       edit_file the TC file to "Last result: PASS <date>", and mark the case
       as "updated: locator".
     - **A step's wording no longer fits the page, and behaviour is right:**
       edit_file the scenario line in the TC file, edit_file the TC file to
       "Last result: PASS <date>", and mark the case as "updated: steps".
     - **Behaviour is wrong:** edit_file the TC file to
       "Last result: FAIL <date>", and add "<date> TC-<nn>: <what is wrong>"
       under ## Known defects in W/apps/<app>/AGENTS.md.
4. **Capture the result of every case, right after its check, before the next
   case changes the page.** The picture must show what proves PASS or FAIL,
   not just the page:
   - Find the result element: the element whose state the check is about (the
     cart badge, the error message, the new table row, the disabled button).
     Take its ref from page_snapshot.
   - If that element alone shows the result, capture only it:
     page_screenshot { ref, save_to: "/tmp/runs/<stamp>/TC-<nn>-<slug>.png" }
     (or TC-<nn>-<step>.png).
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
     /tmp/runs/<stamp>/TC-04-long-code.png (element | highlight)
   \`\`\`

   Write "none" for Network or Console errors when there is nothing to show.
   Screenshot is never "none".
   After the saved TC files finish, run a **limit pass** (empty and very long
   input, unexpected characters, rapid repeated clicks, many items). When a
   limit finding is a real defect, add "<date> TC-<nn>: <what is wrong>" under
   ## Known defects, propose the new TC file in chat, and write it on the
   user's OK.
6. **Build the report.** When the run is over, call test_report and follow it.
   A run without /tmp/runs/<stamp>/report.html is not finished.
   In your final chat reply after test_report finishes, output one line per
   case ("TC-<nn> <title> — PASS|FAIL|updated: locator|updated: steps"), the
   saved file paths, "Download them from Files.", and the restart reminder
   "The run folder is gone after a browser restart; ask me to keep it."
   Do not output a code block or the full HTML report in chat.
`,
};
