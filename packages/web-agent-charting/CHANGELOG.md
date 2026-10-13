# @cuatoi/web-agent-charting

## Unreleased

Changes on `master` since 2026-08-15 that are not yet in a published version.

### New features

- Add the `show_live_chart` tool to `chartingTools()`. It binds a chart to a
  data source `query` and an `encoding`, and the chart refreshes itself.
- Add the `./datasource` entry. `createEsSourceEntry` reads an Elasticsearch
  index, alias or data stream through a proxy, in the browser, with no runtime
  dependency. The pure translator functions are exported too.
- Schema discovery resolves aliases, data streams and field aliases, reports
  unsupported mapping types in `unsupportedFields`, and returns an `error`
  instead of throwing when the index is missing.
- `createEsSourceEntry` adds `sampleValues(field, limit)` for on-demand
  distinct values. Discovery no longer runs `terms` aggregations at startup,
  so no field is promoted to `enum`.
- The chart skill tells the model to prefer `show_live_chart` for data-source
  data, which discovery calls to make first, and how aggregate aliases and
  `aggregate.sort` work.

### Changes

- Replace the `zod` chart schemas with Draft 2020-12 JSON Schema objects,
  validated by `ajv`, with hand-written TypeScript types. Add
  `normalizeChartConfig`, `validateChartSchema`, `validateChartBlock` and the
  drift witness constants. Validation error messages keep the old format.
- When `ajv` cannot load in the host bundle, `show_chart` and
  `show_live_chart` log a warning and run without schema validation instead of
  failing.
- An aggregate query with a top-level `sort` or `select` is rejected with an
  error that lists the result columns.
- `QueryResult.page.limit` reports the number of rows delivered, and
  `page.hasMore` is set from it.

### Fixes

- A live chart skips a refresh tick while the previous query is still running.
- A live `bar` chart starts its y-axis at zero.
- A live chart with `encoding.color` places each group's values under the
  correct x-axis label.
- The `Auto` mode label and the `Updated` stamp mix in the theme text color
  to raise their contrast.
- `fromEsResponses` treats a response without the composite aggregation
  result as zero groups instead of throwing.

## 0.1.0

### Minor Changes

- First coordinated release 0.1.0 carrying NodeNext module resolution, CommonJS compatibility, stripped vendored assets from lit, and cleaned publish tarballs.

### Patch Changes

- Updated dependencies
  - @cuatoi/web-agent-core@0.1.0
  - @cuatoi/web-agent-lit@0.1.0
