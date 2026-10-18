/* eslint-disable wa/no-raw-colour -- the page-locator example contains the id selector "#add-1", which the rule reads as a raw colour. */
import type { SkillDef } from "@cuatoi/web-agent-core";

/** The side panel's `testing` skill group: explore an app, write page locator tables, and create BDD test cases. */
export const exploreAppSkill: SkillDef = {
  name: "explore_app",
  description:
    "Explore an application before testing: create or update its app AGENTS.md and Apps index entry, capture each page and write its locator table in pages/<page>.md, then propose suites and test cases and write TC-<nn>-<slug>.md files after user approval.",
  command: false,
  definition: `# explore_app

Explore an application, record its site map and per-page locator tables, and
write one BDD test case per file after the user approves the proposed list.

1. **Resolve the workspace folder \`W\` and the app entry.**
   - Read \`AGENTS.md\` in \`/home/agent/\` and in every attached folder under
     \`/share/<name>/\`.
   - Look in each file's \`## Apps\` section for a line whose \`hosts\` include
     the current page's \`url.host\`.
   - **If a line matches:** \`W\` is the folder holding that \`AGENTS.md\`, and
     \`<app>\` is that line's app name. If \`url.host\` is not yet listed for
     that app (for example the user opened the same app on a second host or
     path), add \`url.host\` under \`## Environments\` in
     \`W/apps/<app>/AGENTS.md\` and append it to the hosts on that app's line
     under \`## Apps\` in \`W/AGENTS.md\`.
   - **If no line matches:** put the new app where the user asks; if they do
     not say, use the attached read-and-write folder under \`/share/<name>\`
     when there is one, otherwise \`/home/agent\`. Choose a short kebab-case
     \`<name>\` for the product (never the host or port, for example
     \`cat-store\`, not \`localhost-20030\`). Write \`W/apps/<name>/AGENTS.md\`
     with these five headings:

     \`\`\`markdown
     # <App title>

     ## Site map

     ## Environments

     - <url.host> (<starting URL>)

     ## Login

     - (none)

     ## Test data

     ## Known defects

     - (none)
     \`\`\`

     Then add \`- <name> · <url.host> · apps/<name>/\` under \`## Apps\` in
     \`W/AGENTS.md\` (replacing \`- (none yet)\` when it is the first app).

2. **Explore each page and write \`W/apps/<app>/pages/<page>.md\`.**
   - Note the start time as \`<stamp>\` (\`yyyy-mm-dd-hhmmss\`).
   - Call \`start_debugging\` on the tab if debugging is not started yet.
   - For the current page, each navigation link, and each form reached from
     those pages:
     - Call \`page_snapshot\` and save a viewport screenshot with
       \`page_screenshot { save_to: "/tmp/runs/<stamp>/<page>.png" }\`.
     - For every element a test would use (navigation links, buttons, form
       fields, select boxes, and result text elements), call
       \`page_generate_locator\` with its \`ref\` from \`page_snapshot\`. Do
       not add temporary attributes before calling \`page_generate_locator\`,
       so every CSS and XPath in the table matches the real page element.
     - Write \`W/apps/<app>/pages/<page>.md\` with the page title and path on
       line 1, a one-sentence purpose, and one locator table with the seven
       columns below. Give each row a clear \`Element\` name (disambiguating
       repeated controls such as \`Add to cart (Mochi)\`), and write \`—\` for
       any empty attribute cell:

       \`\`\`markdown
       # Store — /store
       Lists the cats for sale. Each card has an Add to cart button.

       | Element | Role + name | id | data-testid | name | CSS | XPath |
       |---|---|---|---|---|---|---|
       | Add to cart (Mochi) | button "Add to cart" (matches 3) | add-1 | — | — | #add-1 | //*[@id='add-1'] |
       \`\`\`

     - Add or replace the page's line under \`## Site map\` in
       \`W/apps/<app>/AGENTS.md\`:
       \`- <path> · <purpose> · pages/<page>.md\`.

3. **Propose suites and test case titles in chat, and wait for the user's OK.**
   - Group the proposed cases by suite (\`<suite>\`, a kebab-case folder name
     such as \`checkout\`) and list the proposed case titles in chat.
   - Stop and wait for the user's approval. **Never write any \`TC-*.md\` file
     before the user says OK.**

4. **Write one \`TC-<nn>-<slug>.md\` file per approved case.**
   - For each suite, check existing \`TC-<nn>-*.md\` files in
     \`W/apps/<app>/<suite>/\` with \`glob_files\`.
   - Number each new case \`nextTc(suiteDir) = 1 + highest <nn>\` among
     \`TC-<nn>-*.md\` in \`suiteDir\` (\`01\` when none). \`<nn>\` is two
     digits (\`01\`–\`99\`), or three digits (\`100\`+) when it passes 99. A
     number is never reused, even after a case file is deleted. \`<slug>\` is
     the case title in kebab-case.
   - Write \`W/apps/<app>/<suite>/TC-<nn>-<slug>.md\` with the title line, the
     \`Suite\` / \`Pages\` / \`Last result\` line (\`Last result: not run\`
     until \`test_plan\` runs it, or \`PASS <yyyy-mm-dd>\` /
     \`FAIL <yyyy-mm-dd>\` after a run), and one \`Scenario\` in
     \`Given\` / \`When\` / \`Then\`. Steps name elements by the \`Element\`
     column of the named \`pages/<page>.md\` tables; locators stay only in the
     page tables:

     \`\`\`markdown
     # TC-01 Add a cat to the cart
     Suite: checkout · Pages: store, cart · Last result: PASS 2026-10-18

     Scenario: Add Mochi to the cart
       Given I am on the "store" page
       When I click "Add to cart (Mochi)"
       Then "Cart link" on the "store" page shows "Cart (1)"
     \`\`\`
`,
};
