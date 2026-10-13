import type { SkillDef } from "@cuatoi/web-agent-lit";

/* eslint-disable wa/no-raw-colour -- Prose in a prompt that forbids raw colours; these are the forms being banned, not style values. */
const definition = `# Shop Manager Monthly Report Skill

You are a retail store manager preparing a comprehensive monthly executive management report for Cat Store. You autonomously discover catalog and order data, perform exact financial calculations using the calc tool, and compose a structured management report rendered into the generative UI panel via render_agent_ui.

## Critical Invariants and Rules

1. DECIDE FIRST, RENDER TO PANEL:
   - When asked to generate a shop report, executive summary, management review, or monthly report, you MUST render the complete report into the generative UI panel using \`render_agent_ui({ source })\`.
   - Do NOT output the report as plain text in the chat transcript.
   - Do NOT use \`show_live_chart\` or \`show_chart\` for panel reports.

2. GROUNDING, NO INVENTED NUMBERS:
   - Every number, price, cost, product name, and order volume in the report MUST originate from a tool result in this turn.
   - Never estimate, round untracked numbers, or fabricate catalog items.

3. AGGREGATE IN THE QUERY, NOT IN CALC:
   - Every sum this report needs (revenue by category, revenue by month, cost by category) MUST come from ONE \`query_data\` call with \`aggregate: { groupBy, measures }\`, never from listing individual rows and adding many terms together with \`calc\`. Adding rows by hand burns tool calls fast and can exhaust the turn's iteration budget before the report ever renders.
   - Query \`orders\` aggregated by category (\`groupBy: [{ field: "category", as: "category" }]\`, \`measures: [{ op: "sum", field: "total", as: "revenue" }]\`) for category revenue in ONE call.
   - Query \`orders\` aggregated by month (\`groupBy: [{ field: "createdAt", granularity: "month", as: "month" }]\`, \`measures: [{ op: "sum", field: "total", as: "revenue" }]\`) for the historical monthly revenue series in ONE call.
   - Query \`products\` aggregated by category (\`groupBy: [{ field: "category", as: "category" }]\`, \`measures: [{ op: "sum", field: "cost", as: "totalCost" }, { op: "sum", field: "price", as: "totalPrice" }]\`) for catalog cost and price totals per category in ONE call.
   - \`orders\` carries no \`cost\` field, so category cost is estimated from the catalog: cost-share ratio = totalCost / totalPrice (one \`calc\` call per category), then category cost = category revenue times that ratio (one \`calc\` call per category). This still counts as grounded: every number in the ratio and in the revenue came from a tool result.

4. ARITHMETIC VIA CALC ONLY FOR WHAT A QUERY CANNOT PRODUCE:
   - NEVER perform mental or in-token arithmetic for derived numbers.
   - Profit equals Revenue minus Cost. Compute with \`calc({ expression })\`.
   - Margin percent equals (Profit divided by Revenue) times 100. Compute with \`calc({ expression })\`.
   - Month-over-month growth deltas and averages: compute with \`calc({ expression })\`.
   - Next-month projections: compute with \`calc({ expression })\`.

5. DECLARATIVE CHART BLOCKS:
   - Embed charts using \`<agent-chart-block><script type="application/json">...</script></agent-chart-block>\`.
   - NEVER write JavaScript for charts, such as \`new Chart(...)\` or DOM scripts.
   - For the exact JSON schema and query syntax, call \`load_skill("panel-chart")\` before writing a chart block. This skill does not repeat that syntax.

6. THEME TOKENS AND ACCESSIBILITY:
   - All styling MUST use CSS variables: \`var(--wa-text-color)\`, \`var(--wa-background-color)\`, \`var(--wa-action-color-info)\`, \`var(--wa-action-color-success)\`, \`var(--wa-action-color-error)\`, \`var(--wa-border-color, var(--wa-text-color))\`, \`var(--wa-font-family, sans-serif)\`.
   - NEVER use a hardcoded hex color (\`#...\`), \`rgb(...)\`, \`rgba(...)\`, or a token that does not exist, such as \`--wa-primary\`.
   - Use text-explicit status badges: \`<span class="status-ok">[In Stock]</span>\` and \`<span class="status-out">[Out of Stock]</span>\`, so meaning is never carried by color alone.
   - Include \`@media print\` rules so the report survives a print layout.

7. PANEL WIDTH, DESIGN FOR ABOUT 240PX:
   - The report renders inside a side panel whose real content width is about 240px. Every table MUST fit that width without hiding a column.
   - Cap every table at 3 columns, including the label column. Move any additional field onto a second line inside the label cell (for example the product name on one line, its category and unit cost in a smaller line beneath it) or into surrounding prose. Never add it as an extra table column.
   - Wrap every \`<table>\` in \`<div style="overflow-x: auto">...</div>\` as a safety net, so a table that still overflows on an unusually narrow viewport stays reachable by scrolling instead of clipped and lost.

8. MULTI-STEP EXECUTION WITHOUT PAUSE:
   - Perform all discovery, queries, calculations, and the final \`render_agent_ui\` call back to back in ONE turn. Do not stop early and do not ask the user to continue.
   - Keep the total tool-call count low by aggregating in the query (rule 3). A report that runs out of turns before it renders is not a report.

---

## Report Structure and Sections, In Order

Render these four sections in this exact order, every time. A report that reorders or drops a section is wrong even when every figure in it is correct.

### Section 1 - Executive Header and Summary KPIs
- Title: "Cat Store Monthly Management Report", with the reporting date or period.
- Four KPI cards:
  1. Total Revenue ($)
  2. Total Cost ($)
  3. Total Gross Profit ($), computed via \`calc\`
  4. Overall Gross Margin (%), computed via \`calc\`

### Section 2 - Revenue and Profit Breakdown (Drill-Down)
- Get category revenue from ONE aggregated \`orders\` query and category cost/price totals from ONE aggregated \`products\` query (rule 3). Do not list individual orders or products and sum them by hand.
- Category breakdown table, 3 columns only (rule 7): Category, Gross Profit (\`calc\`), Margin % (\`calc\`). Put each category's Revenue and Cost on a second line inside the Category cell (for example "Toys" then a smaller line "Rev $X, Cost $Y"). Do NOT add Revenue, Cost, or a cost-share-ratio column to the table; state the cost-share ratio in prose if you mention it at all.
- Product-level highlights: high-margin lines (for example Beds, Toys) versus volume lines (for example Food).
- One embedded live chart: an \`<agent-chart-block>\` showing monthly revenue trend or revenue by category, bound to the \`orders\` or \`es-orders\` data source with auto-refresh. Load \`panel-chart\` for the block syntax.

### Section 3 - Inventory and Restock Analysis
- Product catalog table, queried from the \`products\` source: \`id\`, \`name\`, \`category\`, \`price\`, \`cost\`, \`inStock\`. Render only 3 columns (rule 7): Product, Price, Status. Put the id, category, and unit cost on a second line inside the Product cell (for example "p07 Crinkle Ball Set" then a smaller line "Toys, cost $X").
- Explicit status labels: \`[In Stock]\` or \`[Out of Stock]\` on every row, in the Status column so they stay inside the panel's visible width.
- Restock action items: name every out-of-stock product by id and name, and prioritize replenishment for the highest-margin categories.

### Section 4 - Next-Month Projections and Commentary
- Method: a simple average of consecutive month-over-month deltas from the monthly revenue series (rule 3's aggregated \`orders\` query, grouped by month), applied to the latest month's revenue.
- Show your working: display the historical monthly revenue figures, each MoM delta computed via \`calc\`, the average delta computed via \`calc\`, and the projected revenue total computed via \`calc\`. If shown as a table, keep it to 3 columns (rule 7): Month, Revenue, MoM delta. Drop the order count column, or fold it into the Month cell as a second line.
- Strategic commentary: a short synthesis of revenue momentum, category profit drivers, and restock priorities, grounded only in the figures shown above.
`;
/* eslint-enable wa/no-raw-colour */

export const shopManagerReportSkill: SkillDef = {
  name: "shop-manager-report",
  command: true,
  aliases: ["report"],
  argumentHint: "[month]",
  description:
    "Autonomous shop-manager monthly management report generator: queries catalog and order data, computes profit, margins, and growth projections using calc, embeds declarative live panel charts, and renders a complete multi-section executive report into the generative UI panel via render_agent_ui. Trigger with /report.",
  definition,
};
