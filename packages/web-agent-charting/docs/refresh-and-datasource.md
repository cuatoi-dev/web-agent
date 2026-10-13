---
title: Refresh and datasource charts
---

# Refresh and datasource charts

A `ChartBlock` can carry a static Chart.js config, which is what `show_chart`
produces. It can instead carry a live **datasource path**: a `query` against
a `DataSourceProvider` plus an `encoding` that maps the returned rows to
chart marks. `show_live_chart` is the built-in tool that produces this path —
it validates `{ query, encoding, refresh?, title? }` and returns a `chart`
block; it does not run the query itself, so the renderer (`AgentChartBlock`)
runs it and manages refresh.

## Host requirement: ship a live chart tool with the chart skill

If your host registers the chart skill (`chartingSkills()`), it must also
register at least one **live chart tool** — a host tool that returns a chart
block carrying `query` and `encoding`.

`chartingTools()` now includes `show_live_chart`, so any host that spreads
`chartingTools()` into its `tools:` already satisfies this requirement — no
host-specific tool is required. A host may still ship its own specialized live
chart tool alongside it; the chart skill's guidance ("the data is in a data
source: use `show_live_chart`") assumes the generic tool's name, so a
host-specific tool should say in its own description when the model should
reach for it instead.

cat-store registers `show_live_chart` from `chartingTools()` on its panel
alongside the `chart` skill. The test
`apps/cat-store/src/web/agent-panel-config.test.ts` checks that the skill and
`show_live_chart` are registered on the same panel (and confirms
`show_orders_revenue_chart` is no longer present).

This is a documented requirement, not a runtime check. Nothing validates it at
startup.

## `ChartBlock` fields

The interface is in `packages/web-agent-charting/src/ui-blocks/types.ts`. The
schema is in `packages/web-agent-charting/src/ui-blocks/chart-schema.ts`.

| Field | Type | Notes |
|---|---|---|
| `type` | `"chart"` | discriminant |
| `title` | `string?` | rendered as an `<h3>` above the canvas |
| `config` | `ChartConfig?` | the Chart.js 2.x config — what `show_chart` produces |
| `query` | `DataQuery?` | datasource path; pairs with `encoding` |
| `refresh` | `{ mode, intervalMs? }?` | see below |
| `spec` | `object?` | **deprecated** — renders an error card telling you to use `config` |
| `encoding` | `ChartEncoding?` | the datasource path's mark/field mapping — `mark` plus `x`/`y`/`color`/`open`/`high`/`low`/`close`/`theta`/`tooltip`/`title` channels. No longer deprecated. |

`ChartBlockSchema` refuses a block with none of `spec`, `config` or `query`.
The rule is a Draft 2020-12 `anyOf` over three `required` variants
(`required: ["spec"]` / `["config"]` / `["query"]`), not a zod `.refine()`.

## Refresh

From `packages/web-agent-charting/src/lit/chart-block.ts`:

- `mode` is `"auto" | "manual" | "off"` (`ChartRefreshModeSchema`, a Draft
  2020-12 `{ type: "string", enum: [...] }`), defaulting
  to `"auto"`.
- `intervalMs` defaults to **60 000 ms** (`DEFAULT_INTERVAL_MS`) and is clamped
  to a floor of **5 000 ms** (`MIN_INTERVAL_MS`) — a smaller value is raised,
  not rejected.
- The timer runs only when **all** of these hold: the block has `query`
  **and** `encoding`, mode is `auto`, the element is intersecting the viewport
  (`IntersectionObserver`), `document.visibilityState === "visible"`, and the
  element is not `disabled`. An off-screen chart or a hidden tab therefore
  stops polling.
- **A tick is skipped while the previous query is still running.** The element
  never has two data source queries in flight at once. Against a source slower
  than the interval the chart therefore refreshes as fast as the source allows,
  not as fast as the timer fires. The flag is released when the query succeeds,
  fails or is aborted, and when the element is disconnected or its block is
  replaced, so a failed query cannot stop the chart refreshing.
- The refresh controls (the `Auto` / `Manual` / `Off` indicator, the
  `Refresh` button in manual mode, and the `Updated <time>` stamp) render
  only for the datasource path — a `config` chart shows none of them.
- **Select the mode indicator to change the mode.** Each click moves to the
  next mode in the order `Auto` → `Manual` → `Off` → `Auto`, and starts or
  stops the timer. The change stays in the element only. It does not change
  `block.refresh`, and a new block resets the mode to its own
  `refresh.mode`, or to `auto`.
- **`Refresh` runs the query again and draws a new chart.** It runs even when
  a timer query is still in flight.
- **An auto-refresh tick updates the existing chart in place.** It replaces
  the chart's `data` and calls Chart.js `update()`. It does not rebuild the
  chart options. When a chart is already on screen, a failed tick query is
  logged with `console.error` and the last chart stays; no error card is shown.

## The datasource path

The datasource path combines `block.query`, `block.encoding` and a
`DataSourceProvider` on the renderer context. The element runs the query and
passes the rows to `buildChartJsConfig` in
`packages/web-agent-charting/src/lit/chart-config-builder.ts`, which turns
the `encoding` into a Chart.js config. The marks it handles:

- `candlestick` / `ohlc` — channels `x`, `open`, `high`, `low`, `close`. A
  channel you omit reads the row key of the same name (`x`, `open`, …). Values
  of `open`, `high`, `low` and `close` are converted to numbers.
- `arc` / `pie` / `doughnut` — `arc` is drawn as `pie`. Slice names come from
  `color.field`, else `x.field`, else the row key `label`. Slice values come
  from `theta.field`, else `y.field`, else the row key `value`. Slice colors
  come from `CHART_PALETTE`.
- `area` — rendered as a `line` with `fill: true`;
- any other mark — passed through as the Chart.js type. `x` and `y` default to
  the row keys `x` and `y`.
- **A `bar` mark always starts its y-axis at zero** (`ticks.beginAtZero:
  true`), with or without a y-axis title.

After the config is built, the element runs the URL and row-count checks on
it, then the same type transforms as a `config` chart. So a `candlestick` or
`ohlc` mark is drawn by the finance plugin.

For Elasticsearch-backed sources, `@cuatoi/web-agent-charting/datasource`
provides `createEsSourceEntry`, which integrates schema discovery, alias and
data stream resolution, field projection pushdown, on-demand value sampling,
and query translation. See
[Import paths and dependencies](./import-paths.md) and the
[API reference](./api-reference.md).

`encoding.color.field` groups rows into one dataset per distinct value. It
supports long-format rows, where an aggregate returns one row per `x` and
`color` pair:

- The x-axis labels are the **distinct** `x` values, in the order they first
  appear in the rows.
- Each group's values are placed under their own `x` label. When a group has
  no row for an `x` value, its value there is `null`.
- Datasets take colors from `CHART_PALETTE` in order, and start again at the
  first color after the last one.

With `query` + `encoding` but **no** `dataSource`, the element shows `Chart
requires a dataSource but none is configured.` When the query throws, the
element shows an error card with the error message.

### Friendly labels

`dataSource.query(query)` returns a `QueryResult` whose `fields` are
`FieldSchema[]`; each field can carry an optional `label` (populated by the
data source's allow-list — see the datasource allow-list docs).
`buildChartJsConfig` picks each text in this order. An explicit `title`
always wins over a field's `label`.

| Text | 1st choice | 2nd choice | If neither is set |
|---|---|---|---|
| x-axis title (`options.scales.xAxes[0].scaleLabel.labelString`) | `encoding.x.title` | `label` of the `x` field | no x-axis title |
| y-axis title (`options.scales.yAxes[0].scaleLabel.labelString`) | `encoding.y.title` | `label` of the `y` field | no y-axis title |
| dataset label, one series | `encoding.y.title` | `label` of the `y` field | the raw `y` field name |
| dataset label, `candlestick` / `ohlc` | `encoding.title` | `label` of the `close` field | `OHLC` |

Axis titles apply to every mark except `candlestick`, `ohlc`, `arc`, `pie`
and `doughnut`, which get no axis title. With `encoding.color`, each dataset
label is its group value, not a title.
A pie or doughnut dataset has no label. Chart.js also shows the dataset label
in tooltips.

## Theme

The element re-renders the chart when `data-theme` changes on
`document.documentElement` (a `MutationObserver`). Before each render,
`applyChartDefaults` writes the resolved `--wa-text-color`,
`--wa-border-color`, `--wa-label-color` and `--wa-font-family`
values into Chart.js global defaults. The data-series colors
(`CHART_PALETTE`) are deliberately **not** themed. They exist to keep N
series distinguishable.