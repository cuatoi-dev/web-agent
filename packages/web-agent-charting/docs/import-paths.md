---
title: Import paths and dependencies
---

# Import paths and dependencies

This package exposes three entry points: a framework-agnostic `.` entry, a Lit
binding behind the `/lit` subpath, and a dependency-free data-source subpath at
`/datasource`. Unit tests enforce the split (see below). Importing the
`.` entry cannot pull a framework package, and importing `/datasource` cannot
pull anything at all.

## The three entry points

| Import | What you get | Needs a framework? |
|---|---|---|
| `@cuatoi/web-agent-charting` | `chartingTools()`, `chartingSkills()`, the Chart.js config schema, the config transforms and the sanitizer helpers | No |
| `@cuatoi/web-agent-charting/datasource` | The `DataQuery` → Elasticsearch translator (`toEsSearchBody`, `fromEsResponses`, `esSchemaFromMapping`) and `createEsSourceEntry`, a ready `SourceEntry` that runs in the browser and reads Elasticsearch through a proxy | No — and no runtime dependency either |
| `@cuatoi/web-agent-charting/lit` | `chartingRenderers`, `chartRenderer`, `AgentChartBlock`, and the `<agent-chart-block>` registration | Yes — `@cuatoi/web-agent-lit` |

```ts
// framework-agnostic: tools + skills, no UI, no Lit
import { chartingTools, chartingSkills } from "@cuatoi/web-agent-charting";

// DataQuery <-> Elasticsearch translator, no UI, no runtime dependency
import { toEsSearchBody, fromEsResponses } from "@cuatoi/web-agent-charting/datasource";

// lit-html renderers; also registers <agent-chart-block>
import { chartingRenderers } from "@cuatoi/web-agent-charting/lit";
```

## The data-source subpath

- **`createEsSourceEntry` is the entry point.** Give it the proxy base URL and
  the index name; it does schema discovery, translation, composite paging and
  decoding, and returns a ready `SourceEntry`:

  ```ts
  import { createEsSourceEntry } from "@cuatoi/web-agent-charting/datasource";

  const source = createEsSourceEntry({
    endpoint: "/api/es-orders", // the proxy that attaches credentials
    index: "catstore-orders-v1",
    name: "orders",             // optional, defaults to "es-orders"
    description: "Cat orders",  // optional
  });
  ```

- **Schema discovery handles aliases and data streams.** `esSchemaFromMapping`
  reads `GET /<target>/_mapping`. When `<target>` is an alias or data stream,
  Elasticsearch keys the response by concrete backing index names rather than
  the requested alias. Discovery merges mapping properties across backing
  indices in key order, with earlier entries taking precedence for identical field
  names.
- **Mapping types become query types.** `keyword`, `text`, `constant_keyword`,
  `wildcard`, `match_only_text`, `flattened`, `ip` and `version` become
  `string`. `date` and `date_nanos` become `date`. `boolean` stays `boolean`.
  `long`, `integer`, `short`, `byte`, `double`, `float`, `half_float`,
  `scaled_float` and `unsigned_long` become `number`. An object property with
  nested `properties` becomes dotted field names, such as `customer.name`.
- **Some text fields cannot be filtered, sorted or grouped.** A `text` field
  with a `keyword` subfield uses that subfield for filters, sorts, groups and
  sampling. A `text` field without one, and every `match_only_text` field, has
  no term path. Its `FieldSchema.limitation` explains why, so the agent sees
  it in `list_data_sources`. A query that filters, sorts or groups on such a
  field is rejected. The error suggests `search` and names up to 10 fields
  that do work.
- **Field aliases are resolved.** Top-level properties with `type: "alias"`
  inherit the target field's data type, term path, and limitations. Because
  Elasticsearch does not serialize field aliases into `_source`, the
  translator records the target field as `sourcePath` and re-keys the
  returned hit back to the alias name in the query result. An alias nested
  inside an object property is not resolved and does not appear in `fields`
  or in `unsupportedFields`.
- **Unsupported mapping types are reported, never dropped.** Properties with
  types that have no `DataQuery` equivalent (such as `geo_point` or `rank_feature`,
  or aliases pointing to missing targets) are recorded in `unsupportedFields` on
  `SourceInfo` (`EsUnsupportedField` objects with `name`, `esType`, and `reason`).
  The discovery call never throws on unmapped types.
- **Missing indices degrade gracefully.** When the proxy returns a 404
  `index_not_found_exception`, `describe()` returns a `SourceInfo` with
  `fields: []`, `rowCount: 0`, and an actionable `error` message instead of
  throwing. Discovery results for missing indices are not cached, so the source
  becomes functional immediately once the index is created. A mapping with no
  properties, or with only unsupported properties, also returns `fields: []`
  and an `error`. In every zero-field case, `query()` throws that `error`
  instead of returning an empty result.
- **Proxy failures are named.** Every request times out after 15 seconds. A
  network failure or timeout throws `Elasticsearch proxy at <endpoint> is
  unreachable: <cause>`. Any other non-OK answer throws `Elasticsearch proxy
  answered <status>: <body>`. `describe()` caches a schema only when it has
  at least one field.
- **Zero startup terms aggregations.** Schema discovery at session startup
  does not execute terms aggregations across string fields. The startup probe runs
  only a lightweight `POST /<index>/_search` with `size: 0` and
  `track_total_hits: true` to determine row count.
- **On-demand distinct value sampling.** `createEsSourceEntry` provides
  `sampleValues(field, limit = 20)`. It executes an on-demand `terms` aggregation
  against the field's `termPath` with `size: limit + 1`, returning
  `{ values, hasMore }`. `hasMore` is true when more than `limit` values came
  back or Elasticsearch reports documents in other buckets. Core's
  `sample_field_values` tool reaches this method through the data source
  provider. Fields without a `termPath` (such as `text` fields
  without keyword subfields) throw an informative error explaining why sampling
  is unavailable. An unknown field name throws an error that lists the fields.
- **No enum promotion.** `createEsSourceEntry` does not run the enum probe, so
  no field is reported as type `enum` and no field carries `enumValues`.
  `esEnumProbeBody` and `applyEsEnumProbe` stay exported for a host that wants
  it. The `enumMaxValues` option is not read.
- **Field pushdown via `_source.includes`.** Row queries with `select` push the
  requested field names (translated to `sourcePath` for field aliases) into
  `_source.includes` in the Elasticsearch request body. Unselected fields do not
  cross the network.
- **Honest delivered row counts.** `QueryResult.page.limit` reports the count
  of rows actually delivered in the response (`rows.length`), not the requested
  or clamped page limit. `page.hasMore` is a boolean flag that is true when
  rows remain beyond this page (`offset + delivered < total`).
- **Page sizes match core.** A row query returns `page.limit` rows, 50 by
  default, clamped to 1 to 500. An aggregate returns at most `aggregate.limit`
  groups, 100 by default, clamped to 1 to 500, and then pages them with the
  same `page` rule.
- **Long values are cut.** In every returned row, a string longer than 300
  characters is cut to 300 characters plus `…`. A value nested more than six
  levels deep becomes `…`.
- **Aggregate query guardrails.** Top-level `sort` and `select` properties on an
  aggregate query are rejected by `assertNoTopLevelSortOrSelect` with descriptive
  errors naming the invalid key and listing the available aggregate result
  columns. Aggregate queries must use `aggregate.sort` to order buckets. The
  guard is a local copy of core's guard, because this subpath cannot import
  core at runtime. Tests in `es-request.test.ts` check that both throw the
  same message.
- **Aggregates run as a composite aggregation.** Groups are read in pages of
  1,000 (`ES_COMPOSITE_PAGE_SIZE`), for at most 10 pages
  (`ES_MAX_COMPOSITE_PAGES`). A query with more than 10,000 groups throws
  `Grouped query produced more than 10000 groups. Add a filter, or group by
  fewer fields.` The translator applies `aggregate.sort`, `aggregate.limit`
  and `page` after it has all groups. `having` runs in Elasticsearch as a
  `bucket_selector`.
- **Some aggregate parts have limits.** `granularity` works only on `date`
  fields, and date buckets use UTC. `sum`, `avg`, `min`, `max`, `first` and
  `last` need a `number` field. `first` and `last` order by the first `date`
  field in the schema, or by index order when there is none. `having` on a
  `first` or `last` measure is rejected.
- **`search` is a substring match.** It matches the search text, without case,
  anywhere in any `string` or `enum` field that has a term path. When no such
  field exists, the search matches no rows.
- The pure translator functions (`toEsSearchBody`, `fromEsResponses`,
  `esSchemaFromMapping`, `nextEsCompositeBody`, `bucketDateUtc`, …) stay
  exported, so a host that wants custom transport or orchestration can call them
  directly.
- **The module holds no credentials and must never be given one.** It is
  bundled into the page and runs in the browser. The proxy attaches the
  Elasticsearch credentials server-side; nothing here sends an `Authorization`
  header.
- The translator imports `@cuatoi/web-agent-core` **for types only**, so its
  compiled graph has zero runtime imports — verified by
  `entry-no-runtime-deps.test.ts`.
- **`countDistinct` is approximate.** It compiles to the Elasticsearch
  `cardinality` aggregation, which uses a HyperLogLog++ sketch. Counts are exact
  for small groups and approximate on large groups.
- `$regex` uses Lucene regular expression syntax, which matches entire field
  values and does not support lookahead or backreferences. The translator wraps
  patterns in `.*` to match JavaScript substring behavior where possible. A
  leading `^` or a trailing `$` turns off the wrap at that end. A pattern
  written as `/pattern/i` matches without case. A pattern longer than 200
  characters is rejected. The translator does not reject a lookahead or a
  backreference; it sends the pattern to Elasticsearch as it is.

## Dependencies

Quoted from `packages/web-agent-charting/package.json`:

| Package | Kind | Version | Needed for |
|---|---|---|---|
| `@cuatoi/web-agent-core` | dependency | workspace | everything |
| `ajv` | dependency | `^8.20.0` | schema validation |
| `chart.js` | dependency | `2.7.3` (exact) | rendering |
| `@cuatoi/web-agent-lit` | **optional** peer dependency | `^0.1.0` | the `/lit` entry only |

Importing `@cuatoi/web-agent-charting` does **not** pull Lit. Install
`@cuatoi/web-agent-lit` only if you import the `/lit` entry. Because the
peer is optional (`peerDependenciesMeta` marks it `optional: true`), a package
manager does not warn when it is absent. The `/datasource` entry adds no
dependency of any kind — not `chart.js`, not `ajv`, not even a runtime import
of `@cuatoi/web-agent-core` (it imports core's types only, which TypeScript
erases at compile time).

## Why the binding lives here

`AGENTS.md` at the repository root states the architecture rule: **the binding
belongs with the feature it binds.** If the chart binding lived in
`web-agent-lit`, every Lit host would carry `chart.js`. With N frameworks ×
M features, each framework package would accumulate every binding. Adding
React later is one new `charting/react` subpath — not an edit to every
framework package.

## The guard

`packages/web-agent-charting/src/entry-framework-agnostic.test.ts` walks the
real import graph with esbuild and asserts the `.` entry reaches no framework
package (`@cuatoi/web-agent-lit`, `lit-html`, `lit`, `@lit/`). The `./lit`
entry is the positive control: the same detector must find
`@cuatoi/web-agent-lit` there. That control is what makes a passing first
test meaningful. Type-only imports do not count, because esbuild erases them.

`packages/web-agent-charting/src/datasource/entry-no-runtime-deps.test.ts` runs
the same kind of walk but records **every** bare specifier, not only framework
ones, and asserts the `./datasource` entry reaches **zero** — no `chart.js`, no
`ajv`, no `@cuatoi/web-agent-core`. Its positive control is the `.` entry,
which is measured to reach `ajv` (not `chart.js` — `chart.js` is imported only
by the `./lit` entry for rendering; the `.` entry provides only tool definitions,
schemas, and validation).

## Side effects

`package.json` `sideEffects` lists `src/lit/chart-block.ts`, `src/lit/index.ts`
and `src/chart/register-finance-plugin.ts`, plus their `dist` twins. A bundler
therefore does not tree-shake away the custom-element registration or the
Chart.js plugin registration.

## Airgap

Nothing here fetches at install or runtime. `chart.js` is a plain JS dependency
with no download step. No example may show fetching a config or a dataset from
a URL, because remote data URLs are rejected outright (see
[chart.md](./chart.md)).