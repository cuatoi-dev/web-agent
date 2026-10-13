---
title: Chart (Chart.js integration)
---

# Chart (Chart.js integration)

The agent renders charts inline in the conversation through the `show_chart`
tool. This package pins `chart.js` to **2.7.3** as a direct dependency, so
you do not need a separate install. Configs use the **Chart.js 2.x**
shape — axes are the `options.scales.xAxes` / `yAxes` **arrays**. A Chart.js
3.x or 4.x config (keyed `scales.x` / `scales.y`) does not work here.

---

## How to use

1. Call `load_skill("chart")` before the first `show_chart` call. The chart
   skill teaches the model the config shape, per-type data rules, and worked
   examples.
2. Call `show_chart({ title?, config })` with a Chart.js 2.x config object.
3. On success the tool returns `"chart rendered"` and a `ChartBlock`. The
   block appears inline in the chat at the tool-call position.
4. On invalid config the tool returns a precise `config.<field-path>: <reason>`
   error — the model should read it, fix the field, and retry.

---

## show_chart tool

Defined in `packages/web-agent-charting/src/tools/show-chart.ts`.

```ts
show_chart({
  title?: string,   // optional chart heading shown above the canvas
  config: ChartConfig,
})
```

The tool is not built into core. A host opts in by spreading `chartingTools()`
into its tool list, and core's `buildTools()` then builds it with every other
host tool:

```ts
import { chartingTools, chartingSkills } from "@cuatoi/web-agent-charting";

panel.tools = [...chartingTools(), /* your own tools */];
panel.skills = [...coreSkills(), ...chartingSkills()];
```

The model should call `load_skill("chart")` first for full schema details.

---

## show_live_chart tool

Defined in `packages/web-agent-charting/src/tools/show-live-chart.ts`. Unlike
`show_chart`, this tool does not take a pre-built config — it binds a chart to
a data source query so the chart stays current.

```ts
show_live_chart({
  title?: string,
  query: DataQuery,             // same shape query_data takes
  encoding: ChartEncoding,      // mark + field-to-channel mapping
  refresh?: { mode: "auto" | "manual" | "off", intervalMs?: number },
})
```

`chartingTools()` includes both `show_chart` and `show_live_chart`. The tool
validates `query` and `encoding` and returns a `chart` block; it does not run
the query — `AgentChartBlock` (the `./lit` renderer) runs it and re-runs it on
`refresh.intervalMs` when `refresh.mode` is `"auto"`.

The tool validates in two steps, and each step returns its own error shape:

1. The whole input is checked against `SHOW_LIVE_CHART_SCHEMA`. An unknown key
   in `encoding` or at the top level fails here. The error has no prefix, for
   example `encoding.mark: must have required property 'mark'`.
2. `query` is checked with core's `validateDataQuery`, the same gate that
   `query_data` uses. The error starts with `query: `.

On success the tool returns `"live chart rendered"`. The tool does not check
that the fields in `query` exist in the data source. An unknown field fails
later, when the renderer runs the query, and the chart shows an error card.

When the data source has an allow-list, `encoding` fields resolve friendly axis
titles and dataset labels automatically from `QueryResult.fields[].label`; an
explicit `title` on a channel overrides the label. See
[Refresh and datasource charts](./refresh-and-datasource.md) for the full
field-mapping and label-resolution rules.

---

## ChartConfig shape

The TypeScript interfaces are in
`packages/web-agent-charting/src/ui-blocks/types.ts`. The JSON Schema that
`show_chart` validates against is in
`packages/web-agent-charting/src/ui-blocks/chart-schema.ts`. The shape below
follows the schema. The TypeScript type for a `data` element is looser:
`number | string | null | Record<string, unknown>`.

```ts
interface ChartConfig {
  type: ChartType;                    // required
  data: ChartData;                    // required
  options?: Record<string, unknown>;  // Chart.js 2.x options (JSON-only, no functions)
  [key: string]: unknown;
}

type ChartType =
  // Chart.js native
  "line" | "bar" | "horizontalBar" | "radar" |
  "doughnut" | "pie" | "polarArea" | "bubble" | "scatter" |
  // rewritten by this package into a native type before rendering
  "candlestick" | "ohlc" | "payoff" | "equity" | "drawdown" | "waterfall";

interface ChartData {
  labels?: (string | number)[];   // category labels
  datasets: ChartDataset[];       // max 50 datasets
}

interface ChartDataset {
  data: (
    | number
    | string
    | null
    | { x: number | string, y: number | string, r?: number }   // scatter / bubble
    | { x: number | string, o: number, h: number, l: number, c: number }  // candlestick / ohlc
  )[];
  label?: string;
  backgroundColor?: string | string[];
  borderColor?: string | string[];
  borderWidth?: number;
  fill?: boolean;
  type?: string;
  // + any other Chart.js 2.x dataset fields (schema uses additionalProperties: true)
}
```

---

## Per-type data rules

From `packages/web-agent-charting/src/skills/chart-skill.ts`:

| Chart type | `data.labels` | `datasets[i].data` element |
|------------|--------------|--------------------------|
| `line`, `bar`, `horizontalBar`, `radar`, `polarArea` | Required — category names | One number per label |
| `doughnut`, `pie` | Required — slice names | One dataset; one number per slice |
| `scatter` | Omit | `{ x: number, y: number }` objects |
| `bubble` | Omit | `{ x: number, y: number, r: number }` objects |
| area (filled line) | Required | Use `type: "line"` + `fill: true` on the dataset |
| multi-series | Required | Add multiple objects to `data.datasets` |
| `candlestick`, `ohlc` | Omit | `{ x, o, h, l, c }` objects; pair with `options.scales.xAxes: [{ type: "time" }]` |
| `payoff` | Omit | `data.datasets: []` — describe the strategy in `options.payoff.legs` |
| `equity`, `drawdown` | Omit | `data.datasets: []` — pass `options.pnl.returns` or `options.pnl.equity` |
| `waterfall` | Omit | `data.datasets: []` — pass `options.waterfall.steps` |
| volume under price | Required | Two datasets with `yAxisID`, each matching an `id` in `options.scales.yAxes` |

This package rewrites the six derived types (`candlestick`, `ohlc`, `payoff`,
`equity`, `drawdown`, `waterfall`) into a native Chart.js type before
rendering. The transforms are `transformFinancialConfig` in
`packages/web-agent-charting/src/ui-blocks/chart-financial.ts`, and
`transformPayoffConfig`, `transformPnlConfig` and `transformWaterfallConfig`
in `packages/web-agent-charting/src/ui-blocks/chart-spec.ts`.

---

## Validation and sanitizer limits

`packages/web-agent-charting/src/tools/show-chart.ts` runs these checks, with
the helpers in `packages/web-agent-charting/src/ui-blocks/chart-sanitize.ts`.
A violation returns an error to the model instead of a silent fix:

| Stage | Check | What the model gets back |
|---|---|---|
| 1. Schema | `normalizeChartConfig()` then `validateChartSchema("config", ChartConfigSchema, …)` | every issue joined, as `config.<field-path>: <message>; …` — an unknown `type` fails here. Error format is unchanged from the pre-migration zod path. |
| 2. Remote data URL | `hasDataUrl()` — the two known spots (`data.url`, `datasets[i].url`) **and** a recursive walk of every key | `config.data: external data URLs are not allowed; embed data values inline` |
| 3. Dataset > 2,000 rows | `checkRowCountExceeded()` | `config.data: a dataset exceeds the 2 000-row limit; reduce the dataset before charting` |
| 4. Undeclared axis id | `checkAxisIdMismatch()` | `config.data.datasets[i].yAxisID: "<id>" is not defined in options.scales.yAxes` (same for `xAxisID` / `xAxes`) |

Before stage 1, `normalizeChartConfig()` fixes values that models often send
in the wrong form. It does not report these changes:

- An object whose only key is `$text`, `$` or `_` (an XML-wrapped value) is
  replaced by that value, anywhere in the config.
- In `datasets[i].data`, a numeric string becomes a number. A leading `$` is
  removed first, so `"$12"` becomes `12`. On an object point this applies to
  `y`, `r`, `o`, `h`, `l` and `c`, not to `x`.
- In `options`, `"true"` and `"false"` become booleans, and numeric strings
  become numbers. An `xAxes` or `yAxes` object whose only key is `item` or
  `$text` becomes an array.

If `ajv` cannot be loaded or compiled in the host bundle, stage 1 logs a
`console.warn` and passes. Stages 2 to 4 still run.

After those checks, `sanitizeChartConfig()` runs:

- Deep-clones the config via `JSON.parse(JSON.stringify(...))` — strips
  functions, callbacks, and non-serializable values automatically.
- Caps `datasets` at 50 (silently truncates).
- Caps each dataset's `data` array at 2,000 entries (silently truncates).
- Removes any `url` property that starts with `"http"`.

---

## chart skill

The model should call `load_skill("chart")` before the first `show_chart` or
`show_live_chart` call. The skill
(`packages/web-agent-charting/src/skills/chart-skill.ts`) covers both tools.

For choosing a tool and building a live chart, it provides:

- A rule for picking the tool: data in a data source goes to
  `show_live_chart`; numbers the user typed or the model computed go to
  `show_chart`, which draws a snapshot that never refreshes.
- The discovery order for a data-source chart: `list_data_sources` to pick
  the source, then `get_field_details({ source, filter })` or
  `list_data_sources({ source })` for the field names, then the query, then
  `show_live_chart`. It warns that the call with no arguments returns counts
  only, not field names.
- An instruction to copy field names exactly from the schema reply, with an
  example of the `Unknown groupBy field` error.
- The alias rules for aggregate queries: the result columns are the `as`
  names, or `<field>_<granularity>`, `<field>`, `<op>_<field>` and `count`
  when `as` is not set. Every later field reference must use these names.
- The rule that an aggregate sort goes inside `aggregate`, that a top-level
  `sort` or `select` next to `aggregate` is rejected, and that a chart over a
  date bucket needs an ascending sort on the bucket alias.
- The `encoding` table, the friendly-label rules, and worked examples.

For `show_chart`, it provides:

- Full config shape table
- All 15 supported `type` values
- Per-type data rules
- Worked examples for bar, pie, area line, time-series, candlestick and OHLC,
  reference lines and shaded zones, payoff, equity, drawdown, dual-axis
  volume, and waterfall
- Validation and sanitizer limit reminders

Discover it with `search_skills({ query: "chart" })`.

---

## AgentChartBlock custom element

This package's Lit subpath registers `<agent-chart-block>`. Importing
`@cuatoi/web-agent-charting/lit` runs the `customElements.define` in
`packages/web-agent-charting/src/lit/chart-block.ts` as a side effect. The
host never instantiates the element directly — `chartRenderer` creates it
when a `ChartBlock` is placed in the chat.

`chartRenderer` sets three properties on the element:

| Property | Source | Effect |
|---|---|---|
| `block` | the `ChartBlock` | Setting a different block object destroys the old chart and renders again. |
| `dataSource` | `ctx.dataSource` | Runs the query for a `query` + `encoding` block. |
| `disabled` | `ctx.disabled` | Greys out the chart, blocks pointer input, and stops auto-refresh. |

The element checks a `config` block again at render time, because a block can
reach the renderer without passing through `show_chart`. It runs the same
URL, row-count and axis-id checks, then sanitizes the config and sets
`responsive: true` and `maintainAspectRatio: false` unless the config sets
them. A failed check shows an error card with one of these messages:

- `chart used a forbidden data.url`
- `chart exceeded 2000-row cap`
- `data.datasets[i].yAxisID: "<id>" is not defined in options.scales.yAxes`
  (or the `xAxisID` form)
- `Deprecated chart spec: use block.config (Chart.js config) instead.`
- `Invalid chart block: missing config or query+encoding`
- the message of an error that Chart.js throws while it builds the chart

The error card has a **View Block JSON** section that shows the block.

The element dispatches `chart-error` when its error message changes to a new
non-empty value. The event bubbles and is composed, and `detail` is
`{ error: string, block: ChartBlock }`:

```ts
panel.addEventListener("chart-error", (e: CustomEvent) => {
  console.error("Chart render failed:", e.detail.error, e.detail.block);
});
```

The element resizes its chart with a `ResizeObserver` on itself. Chart.js 2.x
resize detection does not work reliably inside a shadow root, so the chart
still fits its container when the element is placed inside a shadow-DOM host.

---

## Cross-links

Inside this package:

- [Import paths and dependencies](./import-paths.md)
- [Refresh and datasource charts](./refresh-and-datasource.md)
- [API reference](./api-reference.md)

`@cuatoi/web-agent-core`'s docs (`docs/generative-ui.md`, `docs/skill.md`,
`docs/tools.md`, `docs/composition.md`) cover generative UI, how `load_skill`
works, the built-in tool reference, and composing tools, skills and renderers
in a host.