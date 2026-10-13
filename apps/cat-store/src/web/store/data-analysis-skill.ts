import type { SkillDef } from "@cuatoi/web-agent-lit";

const definition = `# Cat Store — Data Analysis Demo

You are running a scripted data-analysis demo on the Cat Store order data. Perform EACH step in order, narrate one or two plain-text lines before each tool call, and do not skip or reorder. Use the exact argument objects given.

IMPORTANT — your narration must be plain text only: no markdown headings, and never wrap a word or phrase in a pair of asterisks for bold. The step titles below are for YOUR reference only — never echo a step title into your narration verbatim.

CRITICAL — do not stop early. Steps 1-7 run back-to-back in ONE turn. After every tool result, immediately continue to the next step. Do NOT end your turn, do NOT write a wrap-up summary, and do NOT hand control back to the user before Step 7. There is no pause in this demo.

CRITICAL — never state a number, a customer name, a category or a product name that did not come back in a tool result in THIS turn. If you want to say a figure, it must be visible in a tool result above. Do not estimate, do not round a number you did not receive, and do not fill a gap from memory.

CRITICAL — every chart in this demo is a live chart bound to a query you pass to the chart tool. Never build a chart from an array of values you wrote yourself.

---

Step 1 — Discover the data before querying it
Call \`load_skill("chart")\` to learn the live-chart contract. Then call \`load_skill("query_data_advanced")\` to learn how aggregate queries name their result columns. Then call \`list_data_sources({})\` to see every source. Then call \`list_data_sources({ source: "es-orders" })\` to read the order source's field names and types.
Narrate one line naming how many sources you found and how many fields \`es-orders\` has. Every field name you use from here on MUST appear in that reply. Do not guess a field name.

Step 2 — Revenue over time
Narrate that you are charting revenue per month straight from the order source. Call \`show_live_chart\` with exactly this argument object:
\`\`\`json
{
  "title": "Revenue by month",
  "query": {
    "source": "es-orders",
    "aggregate": {
      "groupBy": [{ "field": "createdAt", "granularity": "month", "as": "month" }],
      "measures": [{ "op": "sum", "field": "total", "as": "revenue" }],
      "sort": [{ "field": "month", "dir": "asc" }]
    }
  },
  "encoding": {
    "mark": "line",
    "x": { "field": "month", "type": "temporal", "title": "Month" },
    "y": { "field": "revenue", "type": "quantitative", "title": "Revenue" },
    "tooltip": ["month", "revenue"]
  },
  "refresh": { "mode": "auto", "intervalMs": 30000 }
}
\`\`\`
\`month\` and \`revenue\` are the aliases this query creates. The sort is inside \`aggregate\` and names \`month\`, the alias — not \`createdAt\`, the source field.

Step 3 — Revenue by category
Narrate that you are breaking the same revenue down by product category. Call \`show_live_chart\` with exactly this argument object:
\`\`\`json
{
  "title": "Revenue by category",
  "query": {
    "source": "es-orders",
    "aggregate": {
      "groupBy": [{ "field": "category", "as": "category" }],
      "measures": [{ "op": "sum", "field": "total", "as": "revenue" }],
      "sort": [{ "field": "revenue", "dir": "desc" }]
    }
  },
  "encoding": {
    "mark": "bar",
    "x": { "field": "category", "type": "nominal", "title": "Category" },
    "y": { "field": "revenue", "type": "quantitative", "title": "Revenue" },
    "tooltip": ["category", "revenue"]
  },
  "refresh": { "mode": "auto", "intervalMs": 30000 }
}
\`\`\`

Step 4 — Where and how customers order
Narrate that you are putting two dimensions in one chart: order count per region, split by sales channel. The filter drops the few orders that carry no region, so every bar has a readable label. Call \`show_live_chart\` with exactly this argument object:
\`\`\`json
{
  "title": "Orders by region and channel",
  "query": {
    "source": "es-orders",
    "filter": { "region": { "$exists": true } },
    "aggregate": {
      "groupBy": [
        { "field": "region", "as": "region" },
        { "field": "channel", "as": "channel" }
      ],
      "measures": [{ "op": "count", "as": "orders" }],
      "sort": [{ "field": "region", "dir": "asc" }]
    }
  },
  "encoding": {
    "mark": "bar",
    "x": { "field": "region", "type": "nominal", "title": "Region" },
    "y": { "field": "orders", "type": "quantitative", "title": "Orders" },
    "color": { "field": "channel", "title": "Channel" },
    "tooltip": ["region", "channel", "orders"]
  },
  "refresh": { "mode": "auto", "intervalMs": 30000 }
}
\`\`\`

Step 5 — Who the best customers are
Narrate that a chart shows the shape but you also need the names. Call \`query_data\` with exactly this argument object:
\`\`\`json
{
  "source": "es-orders",
  "aggregate": {
    "groupBy": [{ "field": "customer", "as": "customer" }],
    "measures": [
      { "op": "sum", "field": "total", "as": "spend" },
      { "op": "count", "as": "orders" }
    ],
    "sort": [{ "field": "spend", "dir": "desc" }],
    "limit": 5
  }
}
\`\`\`
Then state the five customers in order, each with the spend and order count exactly as the tool returned them.

Step 6 — Order and restock recommendation
Call \`query_data\` with exactly this argument object to read the product catalog:
\`\`\`json
{
  "source": "products",
  "select": ["id", "name", "category", "price", "inStock"],
  "sort": [{ "field": "price", "dir": "desc" }],
  "page": { "limit": 20 }
}
\`\`\`
Then give a recommendation in four short plain-text lines:
- Trend: what Step 2's monthly revenue does, described from the months you can see in that query's result.
- Demand: the categories from Step 3, strongest first, and the regions and channels from Step 4 that carry the most orders.
- Customers: the Step 5 names, and one sentence on what to offer them.
- Restock: name real products from the Step 6 result. Start with the products the query returned with \`inStock\` false, then add in-stock products from the categories that Step 3 showed as strongest. Give each product's stock status exactly as the query returned it.
One thing you MUST say plainly rather than work around:
- The two sources do not use the same category names. Say which order categories have no matching catalog category, and do not invent a match for them.
State no figure that is not in a tool result above.

Step 7 — Close
State one plain-text line naming what this demo showed: schema discovery with list_data_sources, three live charts bound to queries with show_live_chart, an aggregated read with query_data, and a recommendation built only from queried values.
`;

export const dataAnalysisDemoSkill: SkillDef = {
  name: "data-analysis",
  description:
    "Scripted data-analysis demo of the Cat Store order data: discovers the es-orders schema, charts revenue over time, revenue by category and orders by region and channel with live query-bound charts, reads the top customers, then gives an order and restock recommendation using only queried values.",
  definition,
};
