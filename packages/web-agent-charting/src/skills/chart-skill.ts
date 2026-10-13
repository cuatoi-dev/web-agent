import type { SkillDef } from "@cuatoi/web-agent-core";

const definition = `# Chart Skill

Load this skill before your first chart call.

## Pick the chart tool first

- **The data is in a data source** — anything you can reach with
  \`list_data_sources\` or \`query_data\`: use \`show_live_chart\`. It binds directly
  to the query and re-queries automatically on an interval, keeping the chart fresh.
- **The data is not in a data source** — numbers the user typed, a figure you
  computed, or static conversation values: use \`show_chart\`.

Why this matters: \`show_chart\` draws a **frozen snapshot** that never refreshes.
\`show_live_chart\` binds directly to the data source and stays up to date.

For a data-source chart the order is always: \`list_data_sources\` to pick the
source → \`get_field_details({ source: "<name>", filter: "..." })\` or \`list_data_sources({ source: "<name>" })\` for its field names → build
the query from those names → \`show_live_chart\`. The no-argument call returns counts only, never field names.

## show_live_chart — live, query-bound charts

\`\`\`
show_live_chart({
  title?: string,
  query: DataQuery,        // same shape query_data takes
  encoding: ChartEncoding,
  refresh?: { mode: "auto" | "manual" | "off", intervalMs?: number },
})
\`\`\`

The tool does not run the query itself — it validates \`query\` and \`encoding\` and
returns a chart block. The renderer runs the query, binds the rows, and — when
\`refresh.mode\` is \`"auto"\` — re-queries on \`intervalMs\` (default 60000) so the
chart stays current without another model turn. Omit \`refresh\` for a chart that
queries once and does not poll.

### Read the schema before you build the query

Call \`list_data_sources({ source: "<name>" })\` in this turn, before your first
\`show_live_chart\` call on that source. Copy every field name from its reply
exactly as written. Do not guess a name from the source name, from the user's
words, or from what the field is usually called somewhere else.

A name that does not exist is rejected and no chart renders:

\`\`\`
Unknown groupBy field "order_date". Fields: id, created_at, customer, total
\`\`\`

### Aggregated queries — the result columns are aliases

When \`query.aggregate\` is present the result has **new columns**, not the source
fields. Each column is named by its alias:

| Aggregate part | Column name with \`as\` | Column name without \`as\` |
|---|---|---|
| \`groupBy\` entry with \`granularity\` | your \`as\` | \`<field>_<granularity>\` — \`created_at\` + \`month\` → \`created_at_month\` |
| \`groupBy\` entry without \`granularity\` | your \`as\` | \`<field>\` |
| \`measures\` entry with a \`field\` | your \`as\` | \`<op>_<field>\` — \`sum\` of \`total\` → \`sum_total\` |
| \`measures\` entry with \`op: "count"\` and no \`field\` | your \`as\` | \`count\` |

**CRITICAL: After an aggregate query, the result columns are the aliases, NOT the
source fields.** In \`aggregate.sort\`, \`encoding.x.field\`, \`encoding.y.field\`,
and every other field reference, you MUST use the alias name — never the original
source field name. Setting \`as\` on every groupBy and every measure makes this
easy: you control the alias, and you know exactly what to write.

Wrong: \`sort: [{ field: "created_at", dir: "asc" }]\` — "created_at" is the
source field, not a result column → **HTTP 400 error, chart fails**.
Right: \`sort: [{ field: "created_at_month", dir: "asc" }]\` — the alias that the
groupBy with granularity month produces.

### Aggregated queries — put the sort inside \`aggregate\`

\`\`\`
query: {
  source: "...",
  aggregate: {
    groupBy: [ ... ],
    measures: [ ... ],
    sort: [{ field: "<alias>", dir: "asc" }]     // ← the sort goes HERE
  }
}
\`\`\`

Two mistakes come from getting this wrong:

- **Sort placed at the query top level.** When \`aggregate\` is present a
  top-level \`query.sort\` is rejected and no chart renders. The error names the
  fields you sorted on and lists this query's result columns: move the sort
  inside \`aggregate\` and name one of those columns. A top-level
  \`query.select\` next to \`aggregate\` is rejected too — remove it.
- **Sort on the source field instead of the alias.** This is rejected and no
  chart renders: \`Unknown sort field "created_at" in aggregate sort. Available:
  created_at_month, revenue\`.

**A chart over a date bucket always needs an ascending sort on the bucket
alias**, or the x-axis runs newest to oldest.

### encoding shape

\`encoding\` maps result fields to chart channels — it replaces a hand-built
Chart.js config:

| Key | Shape | Meaning |
|---|---|---|
| \`mark\` | string | \`bar\` · \`line\` · \`area\` · \`arc\`/\`pie\`/\`doughnut\` · \`scatter\` · \`candlestick\` · \`ohlc\` |
| \`x\` | \`{ field, type?, title? }\` | X-axis / category field |
| \`y\` | \`{ field, type?, title? }\` | Y-axis / value field |
| \`color\` | \`{ field, title? }\` | Splits rows into one dataset per distinct value — multi-series |
| \`open\`/\`high\`/\`low\`/\`close\` | \`{ field, title? }\` | Candlestick/OHLC fields |
| \`theta\` | \`{ field, title? }\` | Slice-value field for \`arc\`/\`pie\` |
| \`tooltip\` | \`string[]\` or \`boolean\` | Extra tooltip fields, or hide tooltips with \`false\` |
| \`title\` | string | Series title, used on candlestick/ohlc datasets |

Unknown keys anywhere in \`query\` or \`encoding\` are rejected with a field-path
error — fix the named field and retry.

### Friendly labels

If the data source has an allow-list (call \`list_data_sources({ source: "<name>" })\`
to check — the no-argument listing carries no labels), each
field the query returns can carry a friendly \`label\` (e.g. \`price\` →
"Shelf price"). The renderer uses that label for axis titles, dataset labels,
and tooltips automatically — you do not need to pass \`title\` to get it.

**An explicit \`title\` on a channel always wins over the field's label.** Set
\`encoding.x.title\` / \`encoding.y.title\` (or top-level \`encoding.title\` for
candlestick/ohlc) only when you want to override the label; otherwise omit
\`title\` and let the friendly label show. With no label and no explicit title,
the raw field name is the fallback.

### Worked examples

**Aggregated bar chart, friendly labels from the source**
\`\`\`json
{
  "query": { "source": "products", "aggregate": {
               "groupBy": [{ "field": "category" }],
               "measures": [{ "field": "price", "op": "avg", "as": "avg_price" }] } },
  "encoding": { "mark": "bar", "x": { "field": "category" }, "y": { "field": "avg_price" } }
}
\`\`\`
If \`products\` has an allow-list, the x-axis and y-axis titles come from the
labels for \`category\` and \`avg_price\` — no \`title\` needed.
Note the column names: \`category\` has no \`as\`, so its column keeps the field
name, and \`avg_price\` is the alias for the measure. The encoding names both
columns as the aggregate produces them.

**Auto-refreshing line chart — an aggregated time series**

\`list_data_sources({ source: "orders" })\` reported a date field \`created_at\` and
a number field \`total\`, so the query uses those names and no others:

\`\`\`json
{
  "title": "Monthly order revenue",
  "query": { "source": "orders", "aggregate": {
               "groupBy": [{ "field": "created_at", "granularity": "month", "as": "month" }],
               "measures": [{ "field": "total", "op": "sum", "as": "revenue" }],
               "sort": [{ "field": "month", "dir": "asc" }] } },
  "encoding": { "mark": "line", "x": { "field": "month", "type": "temporal" },
                "y": { "field": "revenue", "title": "Revenue" } },
  "refresh": { "mode": "auto", "intervalMs": 30000 }
}
\`\`\`
\`month\` and \`revenue\` are the aliases this query creates. The sort sits inside
\`aggregate\` and names \`month\`, the alias — not \`created_at\`, the source field.
The explicit \`y.title\` here overrides any field label, so the axis always reads
"Revenue" regardless of what the source's allow-list says.

**Candlestick**
\`\`\`json
{
  "query": { "source": "prices", "filter": { "field": "symbol", "op": "eq", "value": "ACME" } },
  "encoding": { "mark": "candlestick", "x": { "field": "date" },
                "open": { "field": "open" }, "high": { "field": "high" },
                "low": { "field": "low" }, "close": { "field": "close" },
                "title": "ACME" }
}
\`\`\`

## show_chart — frozen snapshots

The rest of this skill describes \`show_chart\`.

## Tool signature

\`\`\`
show_chart({ title?: string, config: ChartConfig })
\`\`\`

On error the tool returns a precise field-path message — fix the field and retry.

## Config shape

| Key | Type | Required |
|---|---|---|
| \`type\` | string | yes |
| \`data\` | object | yes |
| \`options\` | object | no (JSON-only, no functions) |

### Supported type values
\`line\` · \`bar\` · \`horizontalBar\` · \`radar\` · \`doughnut\` · \`pie\` · \`polarArea\` · \`bubble\` · \`scatter\` · \`candlestick\` · \`ohlc\` · \`payoff\` · \`equity\` · \`drawdown\` · \`waterfall\`

### data.labels
Array of string or number labels — one per category/data point.
- **Required for:** line, bar, horizontalBar, radar, doughnut, pie, polarArea
- **Omit for:** scatter, bubble (use {x,y} or {x,y,r} point objects instead)

### data.datasets[]
Each dataset object:

\`\`\`json
{
  "label": "Series A",
  "data": [],
  "backgroundColor": "#4caf50",
  "borderColor": "#388e3c",
  "borderWidth": 1,
  "fill": false
}
\`\`\`

---

## Per-type data rules

**line / bar / horizontalBar / radar / polarArea**
- \`data.labels\`: category names, e.g. \`["Jan","Feb","Mar"]\`
- \`datasets[i].data\`: one number per label, e.g. \`[120, 95, 140]\`

**doughnut / pie**
- \`data.labels\`: slice names
- ONE dataset; \`data\`: one number per slice

**scatter**
- No \`data.labels\`
- \`datasets[i].data\`: array of \`{ "x": number, "y": number }\`

**bubble**
- No \`data.labels\`
- \`datasets[i].data\`: array of \`{ "x": number, "y": number, "r": number }\`

**area (filled line)**
- Use \`"type": "line"\` with \`"fill": true\` on the dataset

**multi-series**
- Add multiple objects to \`data.datasets\`, one per series

---

## Worked examples

### Bar chart — monthly revenue
\`\`\`json
{
  "type": "bar",
  "data": {
    "labels": ["Jan", "Feb", "Mar", "Apr"],
    "datasets": [{
      "label": "Revenue ($)",
      "data": [4200, 3800, 5100, 4700],
      "backgroundColor": "rgba(33,150,243,0.7)",
      "borderColor": "#1976d2",
      "borderWidth": 1
    }]
  },
  "options": {
    "scales": {
      "yAxes": [{ "ticks": { "beginAtZero": true } }]
    }
  }
}
\`\`\`

### Pie chart — market share
\`\`\`json
{
  "type": "pie",
  "data": {
    "labels": ["Product A", "Product B", "Product C"],
    "datasets": [{
      "data": [45, 30, 25],
      "backgroundColor": ["#4caf50", "#2196f3", "#ff9800"]
    }]
  }
}
\`\`\`

### Line chart (area) — weekly visits
\`\`\`json
{
  "type": "line",
  "data": {
    "labels": ["Mon", "Tue", "Wed", "Thu", "Fri"],
    "datasets": [{
      "label": "Visits",
      "data": [320, 410, 390, 480, 520],
      "borderColor": "#9c27b0",
      "backgroundColor": "rgba(156,39,176,0.2)",
      "fill": true
    }]
  }
}
\`\`\`

### Time-series (temporal x-axis) — opt-in
Set the x-axis \`type: "time"\` and pass ISO date strings (or ms timestamps) as the
point \`x\`. Categorical \`labels\` are NOT used in this mode.
\`\`\`json
{
  "type": "line",
  "data": {
    "datasets": [{
      "label": "Price",
      "data": [
        { "x": "2026-01-15T08:00:00Z", "y": 101.2 },
        { "x": "2026-01-15T09:00:00Z", "y": 103.5 },
        { "x": "2026-01-15T10:00:00Z", "y": 102.1 }
      ],
      "borderColor": "#1976d2",
      "fill": false
    }]
  },
  "options": {
    "scales": {
      "xAxes": [{ "type": "time", "time": { "unit": "hour" } }]
    }
  }
}
\`\`\`

### Candlestick / OHLC
Each dataset \`data\` point is \`{ "x": <ISO date | number>, "o": open, "h": high, "l": low, "c": close }\`.
Use \`type: "candlestick"\` (filled bodies) or \`type: "ohlc"\` (open/close ticks).
Pair with a temporal x-axis: \`options.scales.xAxes:[{ "type":"time", "time":{ "unit":"day" } }]\`.
Up candles (close ≥ open) render green, down candles red.

\`\`\`json
{
  "type": "candlestick",
  "data": {
    "datasets": [{
      "label": "ACME",
      "data": [
        { "x": "2026-01-05", "o": 100, "h": 104, "l": 99, "c": 103 },
        { "x": "2026-01-06", "o": 103, "h": 106, "l": 102, "c": 102.5 },
        { "x": "2026-01-07", "o": 102.5, "h": 103, "l": 98, "c": 99 },
        { "x": "2026-01-08", "o": 99, "h": 101, "l": 97.5, "c": 100.5 },
        { "x": "2026-01-09", "o": 100.5, "h": 108, "l": 100, "c": 107 }
      ]
    }]
  },
  "options": {
    "scales": { "xAxes": [{ "type": "time", "time": { "unit": "day" } }] },
    "annotation": {
      "lines": [{ "axis": "y", "value": 103, "color": "#6200ee", "label": "entry", "dash": [4, 4] }]
    }
  }
}
\`\`\`

### Reference lines & shaded zones (annotations)
Add \`options.annotation\`:
\`\`\`json
{ "lines": [{ "axis":"y", "value":101.5, "color":"#888", "label":"cost basis", "dash":[4,4] }],
  "boxes": [{ "axis":"y", "from":100, "to":105, "color":"rgba(38,166,154,0.12)" }] }
\`\`\`
\`axis:"y"\` = horizontal price line / band; \`axis:"x"\` = vertical date marker / band.
Works with any chart type (candlestick or otherwise) as a shared overlay.

### Payoff diagram (options P/L at expiry)
Use \`type: "payoff"\` with \`data.datasets: []\` and describe the strategy in
\`options.payoff.legs\` — the chart auto-draws the P/L curve, a zero baseline,
strike lines, breakeven markers, and shaded profit (green) / loss (red) regions.
Each leg: \`{ "kind":"call"|"put", "strike":num, "premium":num, "qty":num?, "side":"long"|"short"? }\`
(\`qty\` default 1, \`side\` default "long"). \`options.payoff.priceRange:[lo,hi]\` is
optional (auto-derived from the strikes if omitted).
\`\`\`json
{
  "type": "payoff",
  "data": { "datasets": [] },
  "options": {
    "payoff": {
      "legs": [
        { "kind": "call", "strike": 100, "premium": 5, "side": "long" },
        { "kind": "call", "strike": 110, "premium": 2, "side": "short" }
      ],
      "priceRange": [90, 120]
    }
  }
}
\`\`\`
To supply a pre-computed curve instead of legs: omit \`legs\` and pass
\`options.payoff.points: [{ "x":price, "y":pnl }, …]\` (plus optional
\`options.payoff.strikes:[…]\` for strike lines).

### Equity curve & drawdown (P&L over time)
Use \`type: "equity"\` for a cumulative P&L / equity curve — pass per-period P&L in
\`options.pnl.returns\` (auto-summed to a running total) or pre-computed levels in
\`options.pnl.equity\`. The area fill is split at zero: **green above, red below**,
with a zero baseline. Use \`type: "drawdown"\` for the underwater chart (area below
the running peak); add \`"percent": true\` for percent-of-peak. Supply optional ISO
dates in \`options.pnl.x\` for a temporal x-axis. \`data.datasets\` stays \`[]\`.
\`\`\`json
{ "type": "equity",
  "data": { "datasets": [] },
  "options": { "pnl": {
    "returns": [200, -150, -180, 120, 260, -90, 300],
    "x": ["2026-01-02","2026-01-09","2026-01-16","2026-01-23","2026-01-30","2026-02-06","2026-02-13"]
  } } }
\`\`\`
\`\`\`json
{ "type": "drawdown",
  "data": { "datasets": [] },
  "options": { "pnl": { "equity": [10000,10250,10120,9800,9950,10400,10150,10600], "percent": true } } }
\`\`\`

### Volume under price (dual y-axis)
Native combo: a price **line** on the left axis + **volume bars** on a secondary
right axis. Give each dataset a \`yAxisID\` and declare matching axes in
\`options.scales.yAxes\` (each with an \`id\`). Cap the volume axis so bars stay in
the lower band.
\`\`\`json
{
  "type": "bar",
  "data": {
    "labels": ["Mon","Tue","Wed","Thu","Fri"],
    "datasets": [
      { "type": "line", "label": "Price", "yAxisID": "price",
        "data": [101,103,102.5,104,107], "borderColor": "#37474f", "fill": false, "pointRadius": 0 },
      { "type": "bar", "label": "Volume", "yAxisID": "volume",
        "data": [1200,1800,900,1500,2100], "backgroundColor": "rgba(38,166,154,0.4)" }
    ]
  },
  "options": {
    "scales": {
      "yAxes": [
        { "id": "price", "position": "left" },
        { "id": "volume", "position": "right", "ticks": { "beginAtZero": true, "max": 8000 }, "gridLines": { "display": false } }
      ]
    }
  }
}
\`\`\`

### Waterfall / P&L bridge
Use \`type: "waterfall"\` with \`data.datasets: []\` and describe the steps in
\`options.waterfall.steps\` — each \`{ "label": string, "value": signed number }\`
(a positive \`value\` rises green, negative falls red). Add \`"isTotal": true\` on a
step for a full-height total bar, or \`options.waterfall.total: true | "Net"\` to
auto-append one. \`options.waterfall.start\` sets the opening level (default 0);
\`options.waterfall.showTotalLine: true\` draws a dashed total reference line.
\`\`\`json
{
  "type": "waterfall",
  "data": { "datasets": [] },
  "options": {
    "waterfall": {
      "start": 0,
      "steps": [
        { "label": "Open", "value": 1000 },
        { "label": "Fees", "value": -120 },
        { "label": "Gains", "value": 640 },
        { "label": "Slippage", "value": -80 }
      ],
      "total": "Net P&L",
      "showTotalLine": true
    }
  }
}
\`\`\`

---

## Sanitizer hard limits (violations return an error)

1. **JSON-only** — no function values or callbacks anywhere in the config
2. **No remote data URL** — no \`{ "url": "https://..." }\` inside datasets or data
3. **Max 50 datasets** per chart
4. **Max 2 000 data points** per dataset \`data\` array
`;

export const chartSkill: SkillDef = {
  name: "chart",
  description:
    "Chart.js 2.x config shape, supported types (line/bar/pie/etc.), per-type data rules, " +
    "worked examples, and sanitizer limits for show_chart; encoding shape, field mapping, " +
    "and friendly-label rules for show_live_chart. Load before calling either tool.",
  definition,
};