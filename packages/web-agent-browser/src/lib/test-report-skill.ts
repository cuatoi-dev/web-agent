/* eslint-disable wa/no-raw-colour, wa/no-untokenized-font, wa/no-raw-spacing */
import type { SkillDef } from "@cuatoi/web-agent-core";

/** The side panel's `testing` skill group: the run's HTML report. */
export const testReportSkill: SkillDef = {
  name: "test_report",
  description:
    "Build the run's self-contained HTML report, with one table row per case and every screenshot inlined, and tell the user where to download it.",
  command: false,
  definition: `# test_report

Build the self-contained HTML report for a test run, then hand it to the user.

1. **Collect the cases.** One row per case, in the order they ran: its id
   (TC-01, TC-02, …), the title with its Given and When steps (from the
   TC-<nn>-<slug>.md files), the expected result (Then), the real result you
   observed, the word PASS or FAIL, and the screenshot path from the run.
2. **Every row needs a result capture.** It is the element capture or the
   outlined viewport that test_plan step 4 saved in /tmp/runs/<stamp>/. If a
   case has none, or only a plain viewport capture with nothing outlined, and
   the page still shows its result, take it now the same way
   (page_screenshot with ref, css or xpath, or with highlight) before you write
   the report. If the result is gone, write "no result capture" in that row's
   Screenshot cell instead of an image.
3. **A format from the user wins.** When the user gives a sample HTML file or
   describes a layout, follow that exactly. Otherwise use the starter template
   below.
4. **Write /tmp/runs/<stamp>/report.src.html** with write_file. Use inline
   style attributes and a table: no stylesheet, no script and no web font,
   because the user pastes one file into a mail. Write each image as
   <img src="/tmp/runs/<stamp>/TC-01-….png" width="480"> with an absolute
   file-system path — never a relative path and never a file:// URL. Escape
   less-than, greater-than and ampersand in case text.
5. **Bundle it:**
   bundle_html("/tmp/runs/<stamp>/report.src.html", "/tmp/runs/<stamp>/report.html").
   It replaces every file-system image with base64 data. An error that names a
   missing image means that file is not there: fix the path, do not drop the
   image.
6. **Answer with a list, one item per case**, so each case is on its own line,
   then the saved paths and the two reminders:

       - TC-01 Add a cat to the cart — PASS
       - TC-02 Cart count updates — updated: locator
       - TC-03 Out-of-stock item has no button — FAIL

   Then these lines:

       Saved: apps/<app>/<suite>/TC-01-….md, /tmp/runs/<stamp>/report.html
       Download them from Files.
       The run folder is gone after a browser restart; ask me to keep it.

   You may also note on the report line that the user can open
   /tmp/runs/<stamp>/report.html in the browser, select all and paste it into
   Outlook. Do not wrap the summary in a code block, and do not repeat the
   full HTML report in the chat reply.

## Starter template

Replace every placeholder. The header needs the suite name, the app, the
environment host, the date and the totals, for example "5 passed, 1 failed".
The status column carries the word PASS or FAIL, so the table still reads in
greyscale or in a black-and-white print.

<!doctype html>
<html>
<head><meta charset="utf-8"><title>Suite — test report</title></head>
<body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff">
  <h1 style="font-size:20px;margin:0 0 4px">Suite name</h1>
  <p style="font-size:12px;margin:0 0 16px">App · environment host · date</p>
  <p style="font-size:13px;margin:0 0 12px"><strong>5 passed, 1 failed</strong> (6 cases)</p>
  <table style="border-collapse:collapse;width:100%;font-size:12px">
    <thead>
      <tr>
        <th style="border:1px solid #999;padding:4px 6px;text-align:left">TC</th>
        <th style="border:1px solid #999;padding:4px 6px;text-align:left">Test case</th>
        <th style="border:1px solid #999;padding:4px 6px;text-align:left">Expected result</th>
        <th style="border:1px solid #999;padding:4px 6px;text-align:left">Real result</th>
        <th style="border:1px solid #999;padding:4px 6px;text-align:left">Status</th>
        <th style="border:1px solid #999;padding:4px 6px;text-align:left">Screenshot</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="border:1px solid #999;padding:4px 6px">TC-01</td>
        <td style="border:1px solid #999;padding:4px 6px">Cart opens with the item<br><em>Given</em> … <em>When</em> …</td>
        <td style="border:1px solid #999;padding:4px 6px">…</td>
        <td style="border:1px solid #999;padding:4px 6px">…</td>
        <td style="border:1px solid #999;padding:4px 6px;font-weight:bold">PASS</td>
        <td style="border:1px solid #999;padding:4px 6px"><img src="/tmp/runs/2026-10-19-101500/TC-01-cart-open.png" width="480" alt="TC-01 screenshot"></td>
      </tr>
    </tbody>
  </table>
</body>
</html>
`,
};
