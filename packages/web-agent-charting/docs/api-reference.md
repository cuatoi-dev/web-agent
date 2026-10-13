---
title: Charting API reference
---

# API reference

This page lists every export of `src/index.ts` (the `.` entry),
`src/datasource/index.ts` (the `./datasource` entry), and `src/lit/index.ts`
(the `./lit` entry), with its signature and behavior.
Source files are cited per symbol. No citation includes a line number, so a
citation cannot become wrong when lines shift.

The cited file is where the symbol is declared. Several modules re-export
symbols that they do not declare: `src/ui-blocks/chart-schema.ts` re-exports
the chart types from `src/ui-blocks/types.ts`, and `src/ui-blocks/chart-spec.ts`
re-exports the sanitizer, financial, payoff, P&L and waterfall helpers from
their own modules. You import every symbol on this page from the entry point
named in its section heading, never from a source file.

## `@cuatoi/web-agent-charting` (the `.` entry)

### Tool and skill factories

| Export | Signature | Source file | What it does |
|---|---|---|---|
| `chartingTools` | `() => CustomToolDef[]` | `src/index.ts` / `src/tools/show-chart.ts` / `src/tools/show-live-chart.ts` | Builds the `show_chart` and `show_live_chart` tool definitions — spread into a host's `tools:`. |
| `chartingSkills` | `() => SkillDef[]` | `src/index.ts` / `src/skills/chart-skill.ts` | Builds an array holding `chartSkill` — spread into a host's `skills:`. |
| `runShowChart` | `(input: Record<string, unknown>) => Promise<ToolOutcome>` | `src/tools/show-chart.ts` | The `show_chart` executor: normalizes XML-wrapped values (`normalizeChartConfig`), ajv-validates the result against `ChartConfigSchema`, rejects remote URLs, >2 000 rows, or undeclared axis ids, sanitizes, and returns `{ content: "chart rendered", block }`. On validation error, returns `{ content: msg, isError: true }`. |
| `SHOW_CHART_SCHEMA` | Draft 2020-12 JSON Schema object: `{ title?: string; config: ChartConfigSchema }`, `additionalProperties: false` | `src/tools/show-chart.ts` | The tool's input schema. |
| `runShowLiveChart` | `(input: Record<string, unknown>) => Promise<ToolOutcome>` | `src/tools/show-live-chart.ts` | The `show_live_chart` executor: ajv-validates `{ query, encoding, refresh?, title? }` against `SHOW_LIVE_CHART_SCHEMA`, then validates `query` with core's `validateDataQuery`, and returns `{ content: "live chart rendered", block }`. On validation error, returns `{ content: msg, isError: true }`. A schema error has no prefix (`encoding.mark: …`). A query error starts with `query: `. If `validateDataQuery` throws instead of returning a verdict, the executor logs a `console.warn` and builds the block without the query check. |
| `SHOW_LIVE_CHART_SCHEMA` | Draft 2020-12 JSON Schema object: `{ title?: string; query: object (structural only); encoding: ChartEncodingSchema; refresh?: ChartRefreshSchema }`, `additionalProperties: false` | `src/tools/show-live-chart.ts` | The tool's input schema. The `query` field is structural only (`type: "object"`); `runShowLiveChart` validates the query body with core's `validateDataQuery` (Draft 2020-12 JSON Schema) immediately after the ajv gate, which applies the same query-language gate as `query_data`. |
| `chartSkill` | `SkillDef` | `src/skills/chart-skill.ts` | The `chart` skill — covers both tools: config shape, data rules, and examples for `show_chart`, and encoding shape, field mappings, and label rules for `show_live_chart`. `name` is `"chart"`. |

### Chart config schema

| Export | Signature | Source file | What it does |
|---|---|---|---|
| `WRAPPED_SCALAR_SCHEMA` | Draft 2020-12 JSON Schema object | `src/ui-blocks/chart-schema.ts` | An XML-wrapped scalar as it arrives before normalization: exactly one of `$text` / `$` / `_`. Widens the schema so wrapped values pass the ajv gate before `normalizeChartConfig` unwraps them. |
| `ChartTypeSchema` | Draft 2020-12 JSON Schema `{ type: "string", enum: […15 values…] }` | `src/ui-blocks/chart-schema.ts` | The `type` union: the 9 Chart.js native types plus `candlestick`, `ohlc`, `payoff`, `equity`, `drawdown`, `waterfall`. |
| `ChartDatasetSchema` | Draft 2020-12 JSON Schema object | `src/ui-blocks/chart-schema.ts` | One dataset: `data` accepts `number | string | null | { x, y, r? } | { x, o, h, l, c }` (plus a wrapped-scalar form at each scalar position) plus `label?`, `backgroundColor?`, `borderColor?`, `borderWidth?`, `fill?`, `type?` — `additionalProperties: true` for any other Chart.js 2.x field. |
| `ChartDataSchema` | Draft 2020-12 JSON Schema object | `src/ui-blocks/chart-schema.ts` | `labels?` (category labels) + `datasets` capped at 50 (`maxItems`). |
| `ChartConfigSchema` | Draft 2020-12 JSON Schema object | `src/ui-blocks/chart-schema.ts` | `type` (from `ChartTypeSchema`), `data` (from `ChartDataSchema`), `options?` (JSON-only object). |
| `ChartRefreshModeSchema` | Draft 2020-12 JSON Schema `{ type: "string", enum: ["auto","manual","off"] }` | `src/ui-blocks/chart-schema.ts` | The refresh mode union. |
| `ChartRefreshSchema` | Draft 2020-12 JSON Schema object | `src/ui-blocks/chart-schema.ts` | `mode` (required) + `intervalMs?` (integer, `exclusiveMinimum: 0`). |
| `EncodingChannelSchema` | Draft 2020-12 JSON Schema object (`additionalProperties: false`) | `src/ui-blocks/chart-schema.ts` | An `x`/`y` channel: `field` (required) + `type?` (`nominal`\|`ordinal`\|`quantitative`\|`temporal`) + `title?`. |
| `EncodingSimpleChannelSchema` | Draft 2020-12 JSON Schema object (`additionalProperties: false`) | `src/ui-blocks/chart-schema.ts` | A `color`/`open`/`high`/`low`/`close`/`theta` channel: `field` (required) + `title?` — no `type`. |
| `ChartEncodingSchema` | Draft 2020-12 JSON Schema object (`additionalProperties: false`) | `src/ui-blocks/chart-schema.ts` | The `show_live_chart` encoding: `mark` (required) + `x?`/`y?`/`color?`/`open?`/`high?`/`low?`/`close?`/`theta?`/`tooltip?`/`title?`. No longer marked deprecated. |
| `ChartBlockSchema` | Draft 2020-12 JSON Schema object | `src/ui-blocks/chart-schema.ts` | The chart block; carries an `anyOf` over `required: ["spec"]` / `required: ["config"]` / `required: ["query"]`, rejecting a block with none of the three — the JSON Schema translation of the pre-migration `.refine()`. |
| `ChartBlockDiscriminant` | Draft 2020-12 JSON Schema object | `src/ui-blocks/chart-schema.ts` | The block object **without** the `anyOf` rule — the discriminated-union discriminant. |

### Chart config types

All ten types are declared in `src/ui-blocks/types.ts` and re-exported from
`src/ui-blocks/chart-schema.ts`. `ChartDataset`, `ChartData`, `ChartConfig` and
`ChartBlock` each extend a `…Fields` interface (for example
`ChartDatasetFields`) with an `[key: string]: unknown` index signature. The
`…Fields` interfaces are not exported. The drift witnesses are typed against
them.

| Type | Source file | What it is |
|---|---|---|
| `ChartType` | `src/ui-blocks/types.ts` | Hand-written union; `CHART_TYPE_MEMBERS` and `chart-schema-drift.test.ts` keep it in step with `ChartTypeSchema`. |
| `ChartDataset` | `src/ui-blocks/types.ts` | Hand-written interface; `CHART_DATASET_KEYS` and `chart-schema-drift.test.ts` keep it in step with `ChartDatasetSchema`. Its `data` elements are typed `number \| string \| null \| Record<string, unknown>`; the schema is stricter about object shapes. |
| `ChartData` | `src/ui-blocks/types.ts` | Hand-written interface; `CHART_DATA_KEYS` and `chart-schema-drift.test.ts` keep it in step with `ChartDataSchema`. |
| `ChartConfig` | `src/ui-blocks/types.ts` | Hand-written interface; `CHART_CONFIG_KEYS` and `chart-schema-drift.test.ts` keep it in step with `ChartConfigSchema`. |
| `ChartRefreshMode` | `src/ui-blocks/types.ts` | Hand-written union; `CHART_REFRESH_MODE_MEMBERS` and `chart-schema-drift.test.ts` keep it in step with `ChartRefreshModeSchema`. |
| `ChartRefresh` | `src/ui-blocks/types.ts` | Hand-written interface; `CHART_REFRESH_KEYS` and `chart-schema-drift.test.ts` keep it in step with `ChartRefreshSchema`. |
| `EncodingChannel` | `src/ui-blocks/types.ts` | Hand-written interface; `ENCODING_CHANNEL_KEYS` and `chart-schema-drift.test.ts` keep it in step with `EncodingChannelSchema`. |
| `EncodingSimpleChannel` | `src/ui-blocks/types.ts` | Hand-written interface; `ENCODING_SIMPLE_CHANNEL_KEYS` and `chart-schema-drift.test.ts` keep it in step with `EncodingSimpleChannelSchema`. |
| `ChartEncoding` | `src/ui-blocks/types.ts` | Hand-written interface; `CHART_ENCODING_KEYS` and `chart-schema-drift.test.ts` keep it in step with `ChartEncodingSchema`. |
| `ChartBlock` | `src/ui-blocks/types.ts` | The documented block shape (interface, with `query?: DataQuery`, `encoding?: ChartEncoding`, `refresh?`). `CHART_BLOCK_KEYS` and `chart-schema-drift.test.ts` keep it in step with `ChartBlockDiscriminant`. |

### Normalization and validation

| Export | Signature | Source file | What it does |
|---|---|---|---|
| `normalizeChartConfig` | `(raw: unknown) => unknown` | `src/ui-blocks/chart-normalize.ts` | Applies, in order, the coercions the pre-migration `z.preprocess` steps performed: whole-config XML unwrap, then label unwrap, then per-data-point coercion, then options coercion. `runShowChart` (`src/tools/show-chart.ts`) runs it BEFORE ajv validation, so wrapped scalars and strings are coerced before schema validation. |
| `unwrapXmlText` | `(val: unknown) => unknown` | `src/ui-blocks/chart-normalize.ts` | Recursively replaces every object whose only key is `$text`, `$` or `_` with that key's value. |
| `coerceDataPoint` | `(val: unknown) => unknown` | `src/ui-blocks/chart-normalize.ts` | Unwraps XML, then turns a numeric string (an optional leading `$` is removed) into a number. On an object point it does the same for the `y`, `r`, `o`, `h`, `l` and `c` keys. It leaves `x` as it is. |
| `coerceOptions` | `(val: unknown) => unknown` | `src/ui-blocks/chart-normalize.ts` | Recursively unwraps XML, turns `"true"` / `"false"` into booleans and numeric strings into numbers, and turns an `xAxes` / `yAxes` object whose only key is `item` or `$text` into an array. |
| `validateChartSchema` | `(prefix: string, schema: object, input: unknown) => Promise<string \| null>` | `src/ui-blocks/validate-chart.ts` | ajv-validates `input` against `schema` with `allErrors: true`, dynamically importing `ajv` so it stays out of charting's static import graph. Returns `null` on accept, or every violation joined as `<prefix>.<field-path>: <message>; …` (no leading dot when `prefix` is `""`) on reject. A `required` error names the missing key in the path. If `ajv` cannot be loaded or the schema cannot be compiled, it logs a `console.warn` and returns `null`, so the input runs unvalidated. |
| `validateChartBlock` | `(raw: unknown) => Promise<{ ok: true; value: ChartBlock } \| { ok: false; message: string }>` | `src/ui-blocks/validate-chart.ts` | Async replacement for the pre-migration `ChartBlockSchema.safeParse`. |

### Drift witnesses

Each pairs a hand-written interface or union with its schema. `tsc` forces
the witness to track the type; `chart-schema-drift.test.ts` forces the
schema's property (or enum) set to track the witness. Neither side can drift
alone — see **Design decisions D3** in the migration task for the full chain.

| Export | Kind | Source file | Guards |
|---|---|---|---|
| `CHART_TYPE_MEMBERS` | `Record<ChartType, true>` | `src/ui-blocks/chart-schema.ts` | `ChartType` ↔ `ChartTypeSchema.enum` |
| `CHART_DATASET_KEYS` | `Record<…, true>` | `src/ui-blocks/chart-schema.ts` | `ChartDataset` ↔ `ChartDatasetSchema.properties` |
| `CHART_DATA_KEYS` | `Record<…, true>` | `src/ui-blocks/chart-schema.ts` | `ChartData` ↔ `ChartDataSchema.properties` |
| `CHART_CONFIG_KEYS` | `Record<…, true>` | `src/ui-blocks/chart-schema.ts` | `ChartConfig` ↔ `ChartConfigSchema.properties` |
| `CHART_REFRESH_MODE_MEMBERS` | `Record<ChartRefreshMode, true>` | `src/ui-blocks/chart-schema.ts` | `ChartRefreshMode` ↔ `ChartRefreshModeSchema.enum` |
| `CHART_REFRESH_KEYS` | `Record<keyof ChartRefresh, true>` | `src/ui-blocks/chart-schema.ts` | `ChartRefresh` ↔ `ChartRefreshSchema.properties` |
| `ENCODING_CHANNEL_KEYS` | `Record<keyof EncodingChannel, true>` | `src/ui-blocks/chart-schema.ts` | `EncodingChannel` ↔ `EncodingChannelSchema.properties` |
| `ENCODING_SIMPLE_CHANNEL_KEYS` | `Record<keyof EncodingSimpleChannel, true>` | `src/ui-blocks/chart-schema.ts` | `EncodingSimpleChannel` ↔ `EncodingSimpleChannelSchema.properties` |
| `CHART_ENCODING_KEYS` | `Record<keyof ChartEncoding, true>` | `src/ui-blocks/chart-schema.ts` | `ChartEncoding` ↔ `ChartEncodingSchema.properties` |
| `CHART_BLOCK_KEYS` | `Record<…, true>` | `src/ui-blocks/chart-schema.ts` | `ChartBlock` ↔ `ChartBlockDiscriminant.properties` |

### Config transforms and sanitizer

| Export | Signature | Source file | What it does |
|---|---|---|---|
| `hasDataUrl` | `(obj: unknown) => boolean` | `src/ui-blocks/chart-sanitize.ts` | True when a `url` exists at `data.url`, `datasets[i].url`, or **any** nested key. |
| `checkRowCountExceeded` | `(obj: unknown) => boolean` | `src/ui-blocks/chart-sanitize.ts` | True when any dataset's `data` (or Vega-style `values` / `datasets[k]`) exceeds 2,000 entries. |
| `checkAxisIdMismatch` | `(config: unknown) => string \| null` | `src/ui-blocks/chart-sanitize.ts` | Returns the field-path message when a dataset `xAxisID`/`yAxisID` is not declared in `options.scales.xAxes`/`yAxes`, else null. |
| `sanitizeChartConfig` | `(config: unknown) => unknown` | `src/ui-blocks/chart-sanitize.ts` | Deep-clone via JSON (strips functions), caps `datasets` at 50 and each `data` at 2,000, removes `http`-prefixed `url`s. |
| `transformFinancialConfig` | `(config: unknown) => unknown` | `src/ui-blocks/chart-financial.ts` | Rewrites `candlestick` / `ohlc` into a native scatter carrier with `_ohlc` stashed for the renderer. |
| `transformPayoffConfig` | `(config: unknown) => unknown` | `src/ui-blocks/chart-spec.ts` | Rewrites `payoff` into a scatter line + zero/strike/breakeven annotations and profit/loss shaded boxes. |
| `transformPnlConfig` | `(config: unknown) => unknown` | `src/ui-blocks/chart-spec.ts` | Rewrites `equity` / `drawdown` into scatter lines (split-at-zero fill, optional percent) + zero-line annotation. |
| `transformWaterfallConfig` | `(config: unknown) => unknown` | `src/ui-blocks/chart-spec.ts` | Rewrites `waterfall` into a stacked bar with a transparent base carrier. |
| `payoffAt` | `(legs: OptionLeg[], S: number) => number` | `src/ui-blocks/chart-payoff-series.ts` | Total strategy P/L at underlying price `S`. |
| `payoffSeries` | `(legs: OptionLeg[], range?: [number, number]) => PayoffSeries` | `src/ui-blocks/chart-payoff-series.ts` | Payoff vertices, breakevens and strikes across a price range. |
| `cumulativeSeries` | `(returns: number[], opts?: { x?: (number \| string)[]; start?: number }) => { x: number; y: number }[]` | `src/ui-blocks/chart-pnl-series.ts` | Running total of per-period P&L. |
| `pnlSeries` | `(src: { returns?, equity?, points?, x?, start? }) => { points: { x, y }[]; temporal: boolean }` | `src/ui-blocks/chart-pnl-series.ts` | Normalizes a `returns[]` / `equity[]` / `points[]` source into a numeric level series. |
| `splitAtZero` | `(points: { x: number; y: number }[]) => { line; positive; negative }` | `src/ui-blocks/chart-pnl-series.ts` | Inserts y=0 vertices at sign changes for signed area fill. |
| `runningPeak` | `(ys: number[]) => number[]` | `src/ui-blocks/chart-pnl-series.ts` | Running high-water mark of a level series. |
| `drawdownSeries` | `(points: { x: number; y: number }[], opts?: { percent?: boolean }) => { x: number; y: number }[]` | `src/ui-blocks/chart-pnl-series.ts` | Underwater curve from a level series (absolute or percent of peak). |
| `waterfallSeries` | `(steps: WaterfallStep[], opts?: { start?: number; total?: boolean \| string }) => { bars: WaterfallBar[]; labels: string[]; total: number }` | `src/ui-blocks/chart-waterfall-series.ts` | Per-bar base/delta/cumulative inputs for a waterfall from signed deltas. |

### Transform types

All four types are declared in `src/ui-blocks/types.ts` and re-exported from
`src/ui-blocks/chart-spec.ts`.

| Type | Source file | What it is |
|---|---|---|
| `OptionLeg` | `src/ui-blocks/types.ts` | One option leg: `kind` (`"call" \| "put"`), `strike`, `premium`, `qty?` (default 1), `side?` (default `"long"`). |
| `PayoffSeries` | `src/ui-blocks/types.ts` | `points`, `breakevens`, `strikes`, `minY`, `maxY` — the payoff curve summary. |
| `WaterfallStep` | `src/ui-blocks/types.ts` | `label`, signed `value`, optional `isTotal`. |
| `WaterfallBar` | `src/ui-blocks/types.ts` | One rendered bar: `label`, `base`, `delta`, `cumulative`, `kind` (`"increase" \| "decrease" \| "total"`). |

## `@cuatoi/web-agent-charting/datasource` (the `./datasource` entry)

### Source entry factory and query translators

| Export | Signature | Source file | What it does |
|---|---|---|---|
| `createEsSourceEntry` | `(options: EsSourceOptions) => SourceEntry` | `src/datasource/es-source.ts` | Creates a self-contained browser `SourceEntry` backed by an Elasticsearch index or alias via proxy. Implements `describe()`, `sampleValues()`, and `query()`. Every request to the proxy times out after 15 seconds. It does not run the enum probe: no field becomes type `"enum"` through this factory. |
| `toEsSearchBody` | `(q: DataQuery, schema: EsSchema) => EsSearchPlan` | `src/datasource/es-request.ts` | Translates a `DataQuery` into an Elasticsearch `_search` body, handling filter operators, field pushdown (`_source.includes`), search wildcards, and composite aggregations. Enforces `assertNoTopLevelSortOrSelect`. |
| `nextEsCompositeBody` | `(plan: EsSearchPlan, afterKey: Record<string, unknown>) => Record<string, unknown>` | `src/datasource/es-request.ts` | Clones an aggregated search plan and attaches the composite `after` key for next-page paging. |
| `fromEsResponses` | `(plan: EsSearchPlan, q: DataQuery, schema: EsSchema, responses: unknown[]) => QueryResult` | `src/datasource/es-response.ts` | Decodes row hits or composite aggregation buckets into a `QueryResult`. Applies aggregate sorting, limit, pagination, leaf truncation, and reports delivered row count in `page.limit`. |
| `esSchemaFromMapping` | `(body: unknown, indexName: string) => EsSchema` | `src/datasource/es-mapping.ts` | Parses a `GET /_mapping` response for an index, alias, or data stream. Flattens properties, maps data types, resolves field aliases, and records unsupported fields. |
| `esEnumProbeBody` | `(schema: EsSchema, maxValues?: number) => Record<string, unknown> \| null` | `src/datasource/es-mapping.ts` | Builds a `size: 0` search body with `terms` aggregations for candidate string fields to probe distinct enum values. `createEsSourceEntry` does not call it; call it yourself if you want enum promotion. |
| `applyEsEnumProbe` | `(schema: EsSchema, body: unknown, maxValues?: number) => EsSchema` | `src/datasource/es-mapping.ts` | Returns a new `EsSchema` promoting candidate fields with distinct count <= `maxValues` and `sum_other_doc_count` of 0 to type `"enum"` with `enumValues`. `createEsSourceEntry` does not call it. |
| `bucketDateUtc` | `(epochMillis: number, granularity: string) => string` | `src/datasource/es-response.ts` | Formats UTC millisecond timestamps to date bucket strings (`minute`, `hour`, `day`, `week`, `month`, `quarter`, `year`). |

### Datasource constants

| Export | Type / Value | Source file | What it is |
|---|---|---|---|
| `ES_SOURCE_NAME` | `string` (`"es-orders"`) | `src/datasource/es-source.ts` | Default data source name. |
| `ES_SOURCE_DESCRIPTION` | `string` | `src/datasource/es-source.ts` | Default data source description. |
| `ES_ENUM_MAX_VALUES` | `number` (`50`) | `src/datasource/es-mapping.ts` | Default threshold for promoting string fields to enum. |
| `ES_COMPOSITE_PAGE_SIZE` | `number` (`1000`) | `src/datasource/types.ts` | Page size for composite aggregation buckets. |
| `ES_MAX_COMPOSITE_PAGES` | `number` (`10`) | `src/datasource/types.ts` | Maximum number of composite pages before raising an error. |

### Datasource types

| Type | Source file | What it is |
|---|---|---|
| `EsSourceOptions` | `src/datasource/types.ts` (re-exported from `src/datasource/es-source.ts`) | Configuration options for `createEsSourceEntry` (`endpoint`, `index`, `name?`, `description?`, `fetchImpl?`, `enumMaxValues?`). `createEsSourceEntry` does not read `enumMaxValues`, so setting it has no effect. |
| `EsFieldInfo` | `src/datasource/types.ts` | Mapping metadata for one field (`name`, `type`, `esType`, `termPath?`, `sourcePath?`, `limitation?`). |
| `EsUnsupportedField` | `src/datasource/types.ts` | Unmapped field description (`name`, `esType`, `reason`). |
| `EsSchema` | `src/datasource/types.ts` | Parsed Elasticsearch schema (`fields`, `byName`, `unsupported`). |
| `EsSearchPlan` | `src/datasource/types.ts` | Planned `_search` request (`body`, `aggregated`, `dimensionAliases?`, `measureAliases?`). |

## `@cuatoi/web-agent-charting/lit` (the `./lit` entry)

Importing this subpath also **registers `<agent-chart-block>`** (side-effect in
`src/lit/chart-block.ts`) and **registers the Chart.js finance plugin**
(side-effect in `src/chart/register-finance-plugin.ts`).

| Export | Signature | Source file | What it does |
|---|---|---|---|
| `chartingRenderers` | `BlockRenderer[]` | `src/lit/index.ts` | The renderers to spread into a host panel's `renderers` — currently `[chartRenderer]`. |
| `chartRenderer` | `BlockRenderer` | `src/lit/chart-renderer.ts` | Renders a `ChartBlock` by creating an `<agent-chart-block>` element and setting its `block`, `dataSource` (from `ctx.dataSource`) and `disabled` (from `ctx.disabled`) properties; `types: ["chart"]`. Its `promptSnippet` describes the chart block, tells the model to prefer the host's live chart tool for data from a data source, and to call `load_skill("chart")`. |
| `AgentChartBlock` | `class` | `src/lit/chart-block.ts` | The custom element — handles `config` charts, the `query` + `encoding` datasource path, refresh, and the `chart-error` event. |

Importing `./lit` also loads `src/lit/chart-block-global.types.ts`, which adds
`"agent-chart-block": AgentChartBlock` to TypeScript's `HTMLElementTagNameMap`.
So `document.createElement("agent-chart-block")` returns an `AgentChartBlock`
type.

## Not exported

Do not plan against these — they are internal to the Lit binding:

- `CHART_PALETTE` (`src/chart/chart-palette.ts`) — data-series colors
- `applyChartDefaults` and `resolveCssColour` (`src/chart/chart-theme.ts`) — theme → Chart.js defaults
- `financePlugin` (`src/chart/finance-charts.ts`) — the finance draw plugin
- `buildChartJsConfig` (`src/lit/chart-config-builder.ts`) — builds a Chart.js config from an `encoding` and query rows
- `CHART_BLOCK_STYLES` (`src/lit/chart-block-styles.ts`) — the element's `<style>` block
- `yAtPoints` (`src/ui-blocks/chart-payoff-series.ts`) and `isObj` / `get` / `arr` (`src/ui-blocks/chart-config-utils.ts`) — transform helpers

`src/index.ts` does not re-export them and `package.json` `exports` declares no
subpath for them, so no consumer can import them.