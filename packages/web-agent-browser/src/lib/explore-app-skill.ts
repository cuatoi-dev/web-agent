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
     - **One row per concrete element, one selector per row.** A row that
       breaks any rule below is a defect, not a note to pass on:
       - A row names one concrete element. When a list repeats the same
         control, write one row per item the cases use, named for that item
         (\`Add to cart (Salmon Pâté)\`, \`Product card (Salmon Pâté)\`).
         Never write one generic row for "the nth item", and never put a
         placeholder (\`<n>\`, \`<name>\`, \`…\`) in any cell: a placeholder is
         not a selector and can never match.
       - The CSS cell holds the selector only: no \`shadow: \` prefix, no
         comment, no ellipsis, nothing a reader must strip. It must be
         copy-pasteable exactly as written. The \`>>\` between steps is this
         table's own convention for "descend into the previous element's
         shadow root"; explain that in one line above the table, not inside a
         cell.
       - The chain starts at the document. When the page sits inside an app
         shell, the first step is the light-DOM host (for cat-store,
         \`#app > app-root\`), then one step per shadow root. A chain such as
         \`store-view >> #cat-filter\` resolves to 0 from \`document\`.
       - Before you write the row, walk the whole chain with \`page_eval\`
         from \`document\`, one step at a time, and check that the last step
         returns exactly one element.
       - Check the row in the page state where the element exists. If an
         element exists only in one state (the empty-cart message, an error
         line, a filtered grid), say the state in the Element name, for
         example \`Empty cart message (empty cart)\`, and check the row in that
         state.
     - Write \`W/apps/<app>/pages/<page>.md\` with the page title and path on
       line 1, a one-sentence purpose, and one locator table with the seven
       columns below. Give each row a clear \`Element\` name (disambiguating
       repeated controls such as \`Add to cart (Mochi)\`), and write \`—\` for
       any empty attribute cell:

       \`\`\`markdown
       # Store — /store
       Lists the cats for sale. Each card has an Add to cart button.
       Each CSS cell is a shadow chain: every >> step descends into the
       previous element's shadow root.

       | Element | Role + name | id | data-testid | name | CSS | XPath |
       |---|---|---|---|---|---|---|
       | Add to cart (Salmon Pâté) | button "Add Salmon Pâté to cart" (matches 1) | button | — | — | #app > app-root >> store-view >> product-card:nth-of-type(1) >> md-filled-button >> #button | — |
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
