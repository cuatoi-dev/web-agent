import type { SkillDef } from "@cuatoi/web-agent-lit";

/* eslint-disable wa/no-raw-colour -- Chart.js paints this to a canvas from a JS option value, so a CSS custom property cannot resolve here (chart-theme.ts:9-10). Data-encoding colour, the same case DATA_ENCODING_FILES records for chart-skill.ts. */
const definition = `# Cat Store — Full Capability Demo

You are running a scripted product demo. Perform EACH step in order, narrate briefly in plain text before each tool call, and do not skip or reorder. Use the exact parameters given.

IMPORTANT — your narration lines must be plain text only: no markdown headings, and never wrap a word or phrase in a pair of asterisks for bold. The step titles below (e.g. "Step 1 — ...") are for YOUR reference only — never echo a step title into your own narration verbatim.

CRITICAL — do not stop early. In Branch A, Steps 1-8 run back-to-back in ONE turn (pausing only at Step 8's form). In Branch B, Steps 1-9 run back-to-back in ONE turn (pausing only at Step 9's form). After every tool result, immediately continue to the next step. Do NOT end your turn, do NOT write a wrap-up summary, and do NOT hand control back to the user before the form is on screen. The ONLY legitimate pause is the form step (Step 8 in Branch A, Step 9 in Branch B), where you wait for the user's form submission.

TOOL CHECK BEFORE STEP 1:
- If \`snapshot_page\` (or DOM interaction tools) is present in your tools list, follow BRANCH A (Storefront Guided Tour).
- If \`snapshot_page\` is ABSENT from your tools list (agent page mode), follow BRANCH B (Full-Page Capability Demo).

---

BRANCH A — Storefront Guided Tour (DOM Tools Present)

Step 0 — Seed the todo list
Before any other step in this branch, call \`todo_write\` once with these nine items, in this order:
\`\`\`
todo_write({
  items: [
    { text: "Read theme and flip twice" },
    { text: "Greet and show generative buttons" },
    { text: "Drive the storefront with DOM tools" },
    { text: "Contrast with direct typed tools" },
    { text: "Verify state and show a live chart" },
    { text: "Call the remote MCP server" },
    { text: "Call the OpenAPI REST service" },
    { text: "Show the checkout form" },
    { text: "Vision and closing summary" }
  ]
})
\`\`\`
The result lists every item with its id, shown as "(id: t1)". Keep those ids — you need them for every update below. Then call \`todo_write({ updates: [ { id: <the first item id>, status: "in_progress" } ] })\`.

TODO RULE FOR THIS BRANCH: after you finish each numbered step, call \`todo_write\` once with two updates — the item you just finished set to "done", and the next item set to "in_progress". On the last item, send only the "done" update. Never re-send the items array after Step 0; use updates only, or the ids change and the list restarts.

Step 1 — Read initial theme + flip twice
Call \`get_theme({})\` to read the active storefront theme. Then call \`set_theme({ theme: "dark" })\` to switch the Cat Store to dark theme and demonstrate theme-aware background/color changes. Next call \`wait({ seconds: 1 })\` to pause for UI update. Then call \`set_theme({ theme: "light" })\` to switch back to light theme. Call \`wait({ seconds: 1 })\` to pause for UI update.

Step 2 — Greet + generative buttons
Welcome the user to the Cat Store full capability demo. Then call:
\`\`\`
show_generative_ui({
  type: "buttons",
  options: [
    { label: "Show catalog", prompt: "show the catalog" },
    { label: "Best sellers chart", prompt: "show best sellers" },
    { label: "Build a cart", prompt: "build me a cart" }
  ]
})
\`\`\`
Then call \`wait({ seconds: 1 })\`.

Step 3 — DOM Interaction (driving UI like a human)
Call \`snapshot_page({})\` to observe the storefront layout and obtain interactive refs. Using a ref from the snapshot, call \`click\` on a product item or navigation button to view product details. Call \`wait({ seconds: 1 })\`. Call \`snapshot_page({})\` again to refresh refs, then \`click\` the "Add to cart" button on the page. Next call \`click\` on the cart icon in the navigation header to view the cart. Call \`wait({ seconds: 1 })\`.

Step 4 — Direct Tool Contrast (typed tool vs DOM)
Narrate: "Now, instead of manually clicking DOM elements, I'll use direct typed tools to achieve the same result!"
Call \`load_skill("promotions-assistant")\` to inspect active promotions. Call \`add_to_cart({ productId: "p01", qty: 3 })\` to add 3 Salmon Pâté directly. Call \`wait({ seconds: 1 })\`. Call \`add_to_cart({ productId: "p05", qty: 5 })\` to add 5 Toys. Call \`wait({ seconds: 1 })\`.

Step 5 — Verify state & data layer + live datasource chart
Call \`query_state({ path: "$.cart" })\` to read current Redux cart state. Call \`query_data({ source: "cart" })\` to cross-verify cart items via data layer. Call \`wait({ seconds: 1 })\`.
Narrate: "Now a chart that reads the orders data source directly and keeps itself up to date."
Call \`load_skill("chart")\`, then call \`show_live_chart\` with exactly this argument object — do not substitute \`show_chart\`:
\`\`\`
show_live_chart({
  title: "Monthly Order Revenue (Live Data)",
  query: { source: "orders", aggregate: { groupBy: [{ field: "createdAt", granularity: "month", as: "createdAt_month" }], measures: [{ op: "sum", field: "total", as: "revenue" }], sort: [{ field: "createdAt_month", dir: "asc" }] } },
  encoding: { mark: "line", x: { field: "createdAt_month", type: "temporal" }, y: { field: "revenue", type: "quantitative" }, tooltip: ["createdAt_month", "revenue"] },
  refresh: { mode: "auto", intervalMs: 30000 }
})
\`\`\`
Call \`wait({ seconds: 1 })\`.

Step 6 — Remote MCP integration
Narrate: "Next, exercising remote Model Context Protocol (MCP) integration via demomcp server."
Call \`demomcp_place_order({ customerName: "Demo User", shippingAddress: "123 Cat Way" })\`. Call \`wait({ seconds: 1 })\`.

Step 7 — OpenAPI REST integration
Narrate: "Exercising REST OpenAPI integration via ordersApi."
Call \`ordersApi_describeOrders({})\` to query the order service schema. Call \`wait({ seconds: 1 })\`.

Step 8 — Form (generative UI confirm/block)
Call \`load_skill("present_to_user")\`. Then call:
\`\`\`
show_generative_ui({
  type: "form",
  id: "checkout-demo",
  fields: [
    { kind: "text", name: "name", label: "Your name" },
    { kind: "select", name: "shipping", label: "Shipping", options: ["standard", "express"] },
    { kind: "checkbox", name: "gift", label: "Gift wrap" }
  ],
  submit_label: "Place demo order"
})
\`\`\`
Wait for the user's form submission before continuing.

Step 9 — Vision & closing summary
VISION STEP — only if this agent has image input enabled; if text-only model, SKIP and state "(vision skipped — text-only model)".
Call \`see({})\` to visually confirm the page layout.
Then, instead of saying the summary yourself, hand it to a one-off reminder. Call:
\`\`\`
set_schedule({
  name: "demo-closing",
  every: "20s",
  repeat: 1,
  prompt: "State a one-line summary of every capability demonstrated: get_theme, set_theme, wait, show_generative_ui (buttons + form), snapshot_page, click, promotions-assistant, add_to_cart, query_state, query_data, show_live_chart, demomcp_place_order, ordersApi_describeOrders, present_to_user, see, and sessions (persisted under session namespace cat-store). Then call todo_write with one update setting the last todo item to done."
})
\`\`\`
Then end your turn and wait. When the reminder fires, follow the prompt it carries.

---

BRANCH B — Full-Page Capability Demo (DOM Tools Absent)

Step 0 — Seed the todo list
Before any other step in this branch, call \`todo_write\` once with these ten items, in this order:
\`\`\`
todo_write({
  items: [
    { text: "Read theme and flip twice" },
    { text: "Greet and show generative buttons" },
    { text: "Load a skill and add to cart" },
    { text: "Verify state and data layer" },
    { text: "Call the remote MCP server" },
    { text: "Call the OpenAPI REST service" },
    { text: "Chart product prices and live revenue" },
    { text: "Render the order and stock report" },
    { text: "Show the checkout form" },
    { text: "Closing summary" }
  ]
})
\`\`\`
The result lists every item with its id, shown as "(id: t1)". Keep those ids — you need them for every update below. Then call \`todo_write({ updates: [ { id: <the first item id>, status: "in_progress" } ] })\`.

TODO RULE FOR THIS BRANCH: after you finish each numbered step, call \`todo_write\` once with two updates — the item you just finished set to "done", and the next item set to "in_progress". On the last item, send only the "done" update. Never re-send the items array after Step 0; use updates only, or the ids change and the list restarts.

Step 1 — Read initial theme + flip twice
Call \`get_theme({})\` to read active theme. Call \`set_theme({ theme: "dark" })\` to demonstrate dark theme in full-page mode. Call \`wait({ seconds: 1 })\`. Then call \`set_theme({ theme: "light" })\` to switch back to light theme. Call \`wait({ seconds: 1 })\`.

Step 2 — Greet + generative buttons
Welcome the user to the Cat Store full-page capability demo. Then call:
\`\`\`
show_generative_ui({
  type: "buttons",
  options: [
    { label: "Check promotions", prompt: "check promotions" },
    { label: "Inventory chart", prompt: "show inventory chart" },
    { label: "Query cart data", prompt: "query cart data" }
  ]
})
\`\`\`
Then call \`wait({ seconds: 1 })\`.

Step 3 — Typed Store Tools & Skill Loading
Call \`load_skill("promotions-assistant")\` to inspect active promotions. Call \`add_to_cart({ productId: "p01", qty: 3 })\` to add 3 Salmon Pâté directly. Call \`wait({ seconds: 1 })\`. Call \`add_to_cart({ productId: "p05", qty: 5 })\` to add 5 Toys. Call \`wait({ seconds: 1 })\`.

Step 4 — State & Data Layer Verification
Call \`query_state({ path: "$.cart" })\` to read cart state. Call \`query_data({ source: "cart" })\` to query cart data source. Call \`wait({ seconds: 1 })\`.

Step 5 — Remote MCP Integration
Narrate: "Exercising remote Model Context Protocol (MCP) integration via demomcp server."
Call \`demomcp_place_order({ customerName: "Demo User", shippingAddress: "123 Cat Way" })\`. Call \`wait({ seconds: 1 })\`.

Step 6 — OpenAPI REST Integration
Narrate: "Exercising REST OpenAPI integration via ordersApi."
Call \`ordersApi_describeOrders({})\` to query order service schema. Call \`wait({ seconds: 1 })\`.

Step 7 — Charting & Analytics
Narrate: "Exercising full-page charting integration by querying product catalog data and visualizing inventory levels."
Call \`query_data({ source: "products" })\` to fetch product catalog data. Call \`wait({ seconds: 1 })\`.
Then call \`show_chart\` with a bar chart visualizing the real product prices from the queried \`products\` data (using product names for \`labels\` and product prices for dataset \`data\`):
\`\`\`
show_chart({
  config: {
    type: "bar",
    data: {
      labels: ["Salmon Pâté", "Tuna Crunch", "Catnip Treat", "Feather Wand"],
      datasets: [
        { label: "Price ($)", data: [3.99, 4.49, 2.99, 5.99], backgroundColor: "rgba(98,0,238,0.6)" }
      ]
    },
    options: {
      title: { display: true, text: "Cat Store Product Prices" }
    }
  }
})
\`\`\`
Call \`wait({ seconds: 1 })\`.
Narrate: "That chart is a fixed snapshot. Next, the same data as a LIVE chart that re-queries the orders source on its own."
Call \`show_live_chart\` with exactly this argument object — do not substitute \`show_chart\`:
\`\`\`
show_live_chart({
  title: "Monthly Order Revenue (Live Data)",
  query: { source: "orders", aggregate: { groupBy: [{ field: "createdAt", granularity: "month", as: "createdAt_month" }], measures: [{ op: "sum", field: "total", as: "revenue" }], sort: [{ field: "createdAt_month", dir: "asc" }] } },
  encoding: { mark: "line", x: { field: "createdAt_month", type: "temporal" }, y: { field: "revenue", type: "quantitative" }, tooltip: ["createdAt_month", "revenue"] },
  refresh: { mode: "auto", intervalMs: 30000 }
})
\`\`\`
Call \`wait({ seconds: 1 })\`.

Step 8 — Generative UI Report (Order & Stock Report)
Narrate: "Now generating an executive order and stock report in the right panel based on the orders and products datasource."
Do NOT call query_data, list_data_sources, or any other tool before this one — Step 7 already queried everything this report needs. The report below is given to you pre-built instead of asking you to compose it, so this demo step renders the same report on every run: every figure and every stock status in it already came from the live orders and products datasource on the backend. Call \`render_agent_ui\` right now with EXACTLY the following source string, verbatim, unedited, as the \`source\` argument — do not recompute figures, do not rewrite sections, do not drop the stock-status column, and do not shorten the report:
\`\`\`
render_agent_ui({
  source: \`<div class="report">
  <style>
    .report {
      font-family: var(--wa-font-family, system-ui, -apple-system, sans-serif);
      color: var(--wa-text-color);
      background-color: var(--wa-background-color);
      padding: var(--wa-padding-xl, 16px);
      line-height: 1.5;
    }
    .header {
      border-bottom: 2px solid var(--wa-action-color-info);
      padding-bottom: var(--wa-padding-m, 8px);
      margin-bottom: var(--wa-padding-xl, 16px);
    }
    .title {
      margin: 0 0 var(--wa-padding-s, 4px) 0;
      font-size: 1.25rem;
      font-weight: 700;
    }
    .subtitle {
      margin: 0;
      font-size: 0.85rem;
      opacity: 0.8;
    }
    .section-title {
      font-size: 1rem;
      font-weight: 600;
      margin: var(--wa-padding-xl, 16px) 0 var(--wa-padding-m, 8px) 0;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--wa-padding-l, 12px);
      margin-bottom: var(--wa-padding-xl, 16px);
    }
    .kpi-card {
      border: 1px solid var(--wa-text-color);
      border-radius: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme border-radius ladder (between --wa-border-radius-m 4px and --wa-border-radius-l 8px); tokenizing would snap the rendered value and change the layout. */ ""}
      padding: 10px;${/* eslint-disable-line wa/no-raw-spacing -- 10px is not on the theme spacing ladder (between --wa-padding-m 8px and --wa-padding-l 12px); tokenizing would snap the rendered value and change the layout. */ ""}
    }
    .kpi-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      opacity: 0.8;
    }
    .kpi-value {
      font-size: 1.2rem;
      font-weight: bold;
      margin-top: var(--wa-padding-xs, 2px);
    }
    .table-container {
      overflow-x: auto;
      margin-bottom: var(--wa-padding-xl, 16px);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th, td {
      border: 1px solid var(--wa-text-color);
      padding: 6px var(--wa-padding-m, 8px);${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ ""}
      text-align: left;
    }
    th {
      background-color: var(--wa-background-color);
      font-weight: 600;
    }
    .status-ok {
      color: var(--wa-action-color-success);
      font-weight: 600;
    }
    .status-out {
      color: var(--wa-action-color-error);
      font-weight: 600;
    }
    @media print {
      .report {
        padding: 0;
      }
      .kpi-card, th, td {
        border-color: currentColor;
      }
    }
  </style>
  <div class="header">
    <div class="title">Cat Store Executive Order &amp; Stock Report</div>
    <div class="subtitle">Generated from live datasource orders &amp; products catalog</div>
  </div>
  <div class="section-title">Order Performance &amp; Revenue Trends</div>
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Total Orders</div>
      <div class="kpi-value">200 Records</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Top Category by Revenue</div>
      <div class="kpi-value">Food ($6,147.89)</div>
    </div>
  </div>
  <div class="section-title">Product Catalog &amp; Inventory Status</div>
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Code</th>
          <th>Product</th>
          <th>Price</th>
          <th>Stock Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>p01</td>
          <td>Salmon Pâté</td>
          <td>$3.99</td>
          <td><span class="status-ok">[In Stock]</span></td>
        </tr>
        <tr>
          <td>p02</td>
          <td>Tuna Crunchies</td>
          <td>$4.49</td>
          <td><span class="status-ok">[In Stock]</span></td>
        </tr>
        <tr>
          <td>p05</td>
          <td>Feather Wand</td>
          <td>$8.99</td>
          <td><span class="status-ok">[In Stock]</span></td>
        </tr>
        <tr>
          <td>p07</td>
          <td>Crinkle Ball Set</td>
          <td>$5.49</td>
          <td><span class="status-out">[Out of Stock]</span></td>
        </tr>
      </tbody>
    </table>
  </div>
  <div class="section-title">Restock Recommendations</div>
  <p style="margin: 0; font-size: 0.85rem;">
    Food remains the top revenue category and stays fully stocked. Immediate restock order recommended for Crinkle Ball Set (p07) to prevent Toys category fulfillment delays.
  </p>
</div>\`
})
\`\`\`
Call \`wait({ seconds: 1 })\`.

Step 9 — Form (generative UI confirm/block)
Call \`load_skill("present_to_user")\`. Then call \`show_generative_ui\` to show a form block (note: for select fields, options MUST be a flat array of plain strings; in XML tool calls write \`<options>standard</options><options>express</options>\` directly, and NEVER wrap in \`<item>\` tags):
\`\`\`
show_generative_ui({
  type: "form",
  id: "checkout-demo-fullpage",
  fields: [
    { kind: "text", name: "name", label: "Your name" },
    { kind: "select", name: "shipping", label: "Shipping", options: ["standard", "express"] },
    { kind: "checkbox", name: "gift", label: "Gift wrap" }
  ],
  submit_label: "Place demo order"
})
\`\`\`
Wait for the user's form submission before continuing.

Step 10 — Closing summary
Instead of saying the summary yourself, hand it to a one-off reminder. Call:
\`\`\`
set_schedule({
  name: "demo-closing",
  every: "20s",
  repeat: 1,
  prompt: "State a one-line summary of every capability demonstrated in full-page mode: get_theme, set_theme, wait, show_generative_ui (buttons + form), render_agent_ui, promotions-assistant, add_to_cart, query_state, query_data, demomcp_place_order, ordersApi_describeOrders, present_to_user, show_chart, show_live_chart, and sessions (persisted under session namespace cat-store). Then call todo_write with one update setting the last todo item to done."
})
\`\`\`
Then end your turn and wait. When the reminder fires, follow the prompt it carries.
`;
/* eslint-enable wa/no-raw-colour */

export const catStoreDemoSkill: SkillDef = {
  name: "demo",
  command: true,
  description:
    "Scripted full-capability demo of the Cat Store agent: adapts automatically based on tool presence (guided storefront tour with DOM tools in bubble mode, or full-page capability demo without DOM tools on #/agent). Trigger with /demo.",
  definition,
};
