import type { SkillDef } from "@cuatoi/web-agent-lit";

const definition = `# Panel Chart Reference Skill

Load this skill before rendering charts into the generative UI panel.

## Decide First: Panel or Chat? (Read This Before Anything Else)

Decide where the chart goes BEFORE you write any markup. This rule is the whole point of the skill.

- A chart request that names the **panel, the right-hand side, a dashboard, a screen, a report view, or the generative UI** MUST be rendered with \`render_agent_ui\` and an \`<agent-chart-block>\` inside it. Do NOT satisfy it with \`show_live_chart\` or \`show_chart\`.
- Use \`show_live_chart\` or \`show_chart\` ONLY when the user asks for a chart as a direct, inline chat reply and does not mention the panel or a dashboard.
- Trigger words for the panel path: "panel", "dashboard", "right-hand side", "screen", "generate a report view", "in the panel".
- Trigger words for the chat path: "show me a chart", "here in the chat", "as a message".

If in doubt, the panel path is the default: when a user asks for a chart and names the panel or a dashboard, you MUST call \`render_agent_ui\` with an \`<agent-chart-block>\` child. Drawing a panel request into the chat transcript with \`show_live_chart\` is wrong even when the chart itself is correct.

## Purpose and Scope

- Use \`<agent-chart-block>\` inside \`render_agent_ui\` when a chart belongs in the generative UI panel (on the right-hand side of the page) alongside document elements, cards, metrics, or forms.
- Use \`show_live_chart\` or \`show_chart\` when presenting a chart directly as an inline chat message response.
- Do not use \`<agent-chart-block>\` for inline chat responses, and do not use \`show_live_chart\` when asked to build or update a panel screen.

## Declarative Tag & No-JavaScript Rule

- The panel chart component is \`<agent-chart-block>\`.
- The component expects exactly ONE child element: \`<script type="application/json">\` containing a JSON configuration object.
- CRITICAL: NEVER write JavaScript (such as \`new Chart(...)\`, DOM manipulation, or event listeners) to create or update charts in the generative UI panel. The frame automatically parses the JSON child, binds the data source, manages the Chart.js lifecycle, and handles auto-refresh. Writing JavaScript for chart rendering causes syntax errors, security violations, or frame freezing.

## JSON Child Specification

The \`<script type="application/json">\` child must contain a valid JSON object matching this schema:

\`\`\`json
{
  "type": "chart",
  "title": "Optional Chart Title",
  "refresh": {
    "mode": "auto",
    "intervalMs": 30000
  },
  "query": {
    "source": "orders",
    "aggregate": {
      "groupBy": [{ "field": "createdAt", "granularity": "month", "as": "createdAt_month" }],
      "measures": [{ "op": "sum", "field": "total", "as": "revenue" }],
      "sort": [{ "field": "createdAt_month", "dir": "asc" }]
    }
  },
  "encoding": {
    "mark": "line",
    "x": { "field": "createdAt_month", "type": "temporal", "title": "Month" },
    "y": { "field": "revenue", "type": "quantitative", "title": "Revenue ($)" },
    "tooltip": ["createdAt_month", "revenue"]
  }
}
\`\`\`

### Top-Level Properties

| Key | Type | Required | Description |
|---|---|---|---|
| \`type\` | string | No (default \`"chart"\`) | Block type identifier (\`"chart"\`). |
| \`title\` | string | No | Optional chart title displayed in the chart block header. |
| \`query\` | object (\`DataQuery\`) | Yes (for live query-bound charts) | The query sent to the data source provider. |
| \`encoding\` | object (\`ChartEncoding\`) | Yes (for live query-bound charts) | Mapping of query result fields/aliases to visual channels. |
| \`refresh\` | object | No | \`{ mode: "auto" | "manual" | "off", intervalMs?: number }\`. When \`mode: "auto"\`, re-queries on \`intervalMs\` (default 60000 ms). |

## Available Data Sources

A panel chart may bind to any registered host data source:

1. \`orders\` (Primary in-memory source) — Customer orders store. Best for live demos and auto-refresh because new orders placed via the store or API immediately change query results.
   - Fields: \`id\` (string), \`createdAt\` (date), \`customer\` (string), \`category\` (enum: "Food", "Toys", "Beds", "Grooming", "Health"), \`total\` (number), \`status\` (enum: "placed", "shipped", "delivered", "cancelled"), \`itemCount\` (number), \`items\` (string).
2. \`products\` — Live product catalog from store state.
   - Allowed fields: \`id\` ("Product code"), \`name\` ("Product name"), \`category\` ("Product type"), \`price\` ("Shelf price"), \`cost\` ("Unit cost"), \`inStock\` ("In stock").
3. \`cart\` — Current user shopping cart contents from store state.
   - Fields: \`productId\`, \`name\`, \`price\`, \`qty\`, \`lineTotal\`.
4. \`es-orders\` — Elasticsearch order analytics index.

## Query & Encoding Field Rules

### 1. Result Columns from Aggregation are Aliases
When \`query.aggregate\` is used, the query result columns are the aliases defined in \`as\`, or auto-generated defaults:
- \`groupBy\` with \`granularity\`: alias specified by \`as\`, or \`<field>_<granularity>\` (e.g. \`createdAt\` + \`month\` -> \`createdAt_month\`).
- \`groupBy\` without \`granularity\`: alias specified by \`as\`, or \`<field>\`.
- \`measures\` with \`field\`: alias specified by \`as\`, or \`<op>_<field>\` (e.g. \`sum\` of \`total\` -> \`sum_total\`).
- \`measures\` with \`op: "count"\` and no \`field\`: alias specified by \`as\`, or \`count\`.

CRITICAL: In \`aggregate.sort\`, \`encoding.x.field\`, \`encoding.y.field\`, \`encoding.color.field\`, and \`encoding.tooltip\`, ALWAYS use the alias name — NEVER the source field name.

### 2. Put Sort Inside \`aggregate\`
For aggregated queries, put \`sort\` inside the \`aggregate\` object (i.e. \`query.aggregate.sort\`). A top-level \`query.sort\` alongside \`aggregate\` is rejected by the schema.

### 3. Date Buckets Require Ascending Sort
Always specify \`sort: [{ field: "<date_alias>", dir: "asc" }]\` inside \`aggregate\` for temporal groupBys so the timeline runs chronologically left-to-right.

### 4. Encoding Marks & Channels
- Supported \`mark\` types: \`line\`, \`bar\`, \`area\`, \`arc\` / \`pie\` / \`doughnut\`, \`scatter\`, \`candlestick\`, \`ohlc\`.
- \`x\`: category / time dimension (\`{ field, type?: "temporal" | "nominal" | "quantitative", title? }\`).
- \`y\`: metric value (\`{ field, type?: "quantitative", title? }\`).
- \`color\`: series grouping (\`{ field, title? }\`).
- \`tooltip\`: array of field/alias names to display on hover.

## Worked Examples

### Example 1: Monthly Order Revenue Line Chart (Auto-Refreshing)
\`\`\`html
<agent-chart-block>
  <script type="application/json">
  {
    "type": "chart",
    "title": "Monthly Order Revenue",
    "refresh": { "mode": "auto", "intervalMs": 30000 },
    "query": {
      "source": "orders",
      "aggregate": {
        "groupBy": [{ "field": "createdAt", "granularity": "month", "as": "createdAt_month" }],
        "measures": [{ "op": "sum", "field": "total", "as": "revenue" }],
        "sort": [{ "field": "createdAt_month", "dir": "asc" }]
      }
    },
    "encoding": {
      "mark": "line",
      "x": { "field": "createdAt_month", "type": "temporal", "title": "Month" },
      "y": { "field": "revenue", "type": "quantitative", "title": "Revenue ($)" },
      "tooltip": ["createdAt_month", "revenue"]
    }
  }
  </script>
</agent-chart-block>
\`\`\`

### Example 2: Revenue by Category Bar Chart
\`\`\`html
<agent-chart-block>
  <script type="application/json">
  {
    "type": "chart",
    "title": "Revenue by Category",
    "query": {
      "source": "orders",
      "aggregate": {
        "groupBy": [{ "field": "category", "as": "category" }],
        "measures": [{ "op": "sum", "field": "total", "as": "revenue" }],
        "sort": [{ "field": "revenue", "dir": "desc" }]
      }
    },
    "encoding": {
      "mark": "bar",
      "x": { "field": "category", "type": "nominal", "title": "Category" },
      "y": { "field": "revenue", "type": "quantitative", "title": "Revenue ($)" },
      "tooltip": ["category", "revenue"]
    }
  }
  </script>
</agent-chart-block>
\`\`\`

### Example 3: Full Generative UI Panel with Card Layout & Chart Block
\`\`\`html
<div style="padding: var(--wa-padding-xl, 16px); font-family: var(--wa-font-family, sans-serif); color: var(--wa-text-color);">
  <h2 style="margin: 0 0 var(--wa-padding-xl, 16px) 0;">Store Analytics Dashboard</h2>
  <div style="display: flex; gap: var(--wa-padding-xl, 16px); margin-bottom: 24px;">${/* eslint-disable-line wa/no-raw-spacing -- 24px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ ""}
    <div style="flex: 1; padding: var(--wa-padding-l, 12px); background: var(--wa-background-color); border: 1px solid var(--wa-action-color-info); border-radius: var(--wa-border-radius-l, 8px);">
      <div style="font-size: 12px; opacity: 0.8;">Status</div>
      <div style="font-size: 18px; font-weight: bold; color: var(--wa-action-color-success);">Live Monitoring</div>
    </div>
  </div>
  <agent-chart-block>
    <script type="application/json">
    {
      "type": "chart",
      "title": "Order Revenue Trend",
      "refresh": { "mode": "auto", "intervalMs": 30000 },
      "query": {
        "source": "orders",
        "aggregate": {
          "groupBy": [{ "field": "createdAt", "granularity": "month", "as": "createdAt_month" }],
          "measures": [{ "op": "sum", "field": "total", "as": "revenue" }],
          "sort": [{ "field": "createdAt_month", "dir": "asc" }]
        }
      },
      "encoding": {
        "mark": "line",
        "x": { "field": "createdAt_month", "type": "temporal" },
        "y": { "field": "revenue", "type": "quantitative" },
        "tooltip": ["createdAt_month", "revenue"]
      }
    }
    </script>
  </agent-chart-block>
</div>
\`\`\`
`;

export const panelChartSkill: SkillDef = {
  name: "panel-chart",
  command: true,
  description:
    "Reference guide for rendering live data-bound charts in the generative UI panel via render_agent_ui. " +
    'Documents the <agent-chart-block> custom element, <script type="application/json"> child shape ' +
    "(title, query, encoding, refresh), allowed data sources (orders, products, cart, es-orders), " +
    "field and alias rules, no-JavaScript constraint, and worked examples.",
  definition,
};
