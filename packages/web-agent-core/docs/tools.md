---
title: Tools & data sources
---

# Tools & data sources

Core itself ships **ten** tools always, returned by `defaultTools(ctx)`:
`wait`, `get_time`, `list_data_sources`, `get_field_details`,
`sample_field_values`, `query_data`, `show_generative_ui`, `search_skills`,
`load_skill` and `compact_conversation`.
Three more — `set_schedule`, `list_schedules` and `cancel_schedule` — are added
only when the context carries the `_scheduler` seam, which the controller sets
from `config.scheduler.enabled`. A host with scheduling off is never offered
them.
Two more — `todo_write` and `todo_read` — are added only when the context
carries the `_todos` seam, which the controller sets from `config.todo.enabled`.
A host with todo off is never offered them. See [Scheduler](./scheduler.md) and
[Todo tracking](./todo.md).
Two more, `create_skill` and `delete_skill`, are added when the host's
`ctx.skillRegistry` exposes a `save` method and a `remove` method respectively — see [Skills](./skill.md#create_skill-tool). The DOM tools
(`snapshot_page`, `query_state`, `click`, `fill`, `select_option`, `wait_for`,
`see`) moved to the separate `@cuatoi/web-agent-dom` package. Core keeps only
their **schemas** (see below).

Core also exports one tool that `defaultTools(ctx)` does not include: `calcTool`
(`calc`). Add it yourself; see [The calc tool](#the-calc-tool). This page shows how tools are defined, how to wire
custom data sources, and a worked example from the cat-store app. For host-defined
custom tools, see [Custom tools](./custom-tool.md).

## Built-in tool definitions

All tool schemas live in `src/tools/definitions.ts` as `ToolDef` objects whose
`inputSchema` is a raw JSON Schema object (`JsonSchemaObject`). Each `ToolDef` has:

- **`name`** — the tool name the LLM uses (e.g. `snapshot_page`)
- **`description`** — natural-language description the LLM sees
- **`inputSchema`** — a `JsonSchemaObject`. Core's own defs set
  `additionalProperties: false`, which rejects an unknown key. A host tool may
  pass a Zod schema instead — see [Custom tools](./custom-tool.md)
- **`promptSnippet`** — short guideline injected into the system prompt

Example — the `wait` tool, a core-owned `ToolDef`:

```ts
// packages/web-agent-core/src/tools/definitions.ts:122-134
export const waitSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    seconds: {
      type: "integer",
      minimum: 1,
      maximum: WAIT_MAX_SECONDS,
      description: `Seconds to pause, unconditionally. 1-${WAIT_MAX_SECONDS}.`,
    },
  },
  required: ["seconds"],
  additionalProperties: false,
};

// packages/web-agent-core/src/tools/definitions.ts:207-216
export const WAIT_DEF: ToolDef = {
  name: "wait",
  description:
    `Pause for a fixed number of seconds (1-${WAIT_MAX_SECONDS}), unconditionally. ` +
    "Use only when there is no observable condition to wait on — prefer wait_for when one exists.",
  inputSchema: waitSchema,
  promptSnippet:
    `wait: pause for a fixed number of seconds (max ${WAIT_MAX_SECONDS}s) with no condition to check. ` +
    "Prefer wait_for when a condition is knowable; use wait only for genuine unconditional pacing.",
};
```

The full tool map `TOOL_DEFS` is exported so consumers can inspect or extend it:

```ts
// packages/web-agent-core/src/tools/definitions.ts
export const TOOL_DEFS: Record<string, ToolDef> = {
  snapshot_page: SNAPSHOT_PAGE_DEF,
  query_state: QUERY_STATE_DEF,
  click: CLICK_DEF,
  fill: FILL_DEF,
  select_option: SELECT_OPTION_DEF,
  wait_for: WAIT_FOR_DEF,
  wait: WAIT_DEF,
  see: SEE_DEF,
  list_data_sources: LIST_DATA_SOURCES_DEF,
  get_field_details: GET_FIELD_DETAILS_DEF,
  sample_field_values: SAMPLE_FIELD_VALUES_DEF,
  query_data: QUERY_DATA_DEF,
};
// TOOL_DEFS is a SCHEMA table, not the tool set core executes. Since the
// previous batch's task 007, the DOM entries (snapshot_page, query_state,
// click, fill, select_option, wait_for, see) carry no executor in core —
// `@cuatoi/web-agent-dom` imports these schemas and supplies the
// executors via a ToolProvider. `see` is omitted when a host passes
// domTools({ images: false }).
export const TOOL_NAMES: string[] = Object.keys(TOOL_DEFS);
```

### Validation

`buildTools()` validates a tool's arguments before `execute` runs, whichever way
the tool declared its schema. The check lives in `wrapExecutor`
(`src/tools/build-tools.ts`):

- **zod schema** — `validateZodInput()` (`src/tools/validate-zod-schema.ts`)
  runs `safeParse` and reports every failure as `path: message`, for example
  `config.data.datasets.0: Expected number, received string`.
- **raw JSON Schema** — `validateJsonSchemaInput()`
  (`src/tools/validate-json-schema.ts`) compiles the schema with ajv. That
  module is reached only through a dynamic `import()`, so a host with no
  JSON-Schema tool never loads ajv. If that import or the validator itself
  fails to load, core logs a `console.warn` and runs the call **without**
  argument validation (`src/tools/build-tools.ts:45-66`). Only a real schema
  violation rejects the call.

Both produce the same wording, `Invalid input for {name}: {detail}.`, and both
return `isError: true`, so the model receives `is_error` on the tool result.
The value the model sent is passed to `execute` unchanged — validation never
substitutes zod's parsed output.

A tool call whose argument JSON could not be parsed at all is answered earlier,
in the agent loop, with a different message that does not blame the schema. See
`argumentsUnparsable()` in `src/tools/error-messages.ts`.

## Building the tool map (`buildTools()`)

The `buildTools()` function in `src/tools/build-tools.ts` converts a
`CustomToolDef[]` into `{ tools: Tool[]; executors }`. `Tool` is a hand-rolled
interface (`name`, `description`, `input_schema`) in `src/types.ts`, not a
Vercel AI SDK type. Core has no dependency on the `ai` package:

```ts
// packages/web-agent-core/src/tools/build-tools.ts
export function buildTools(
  ctx: ToolContext,
  defs: CustomToolDef[],
): { tools: Tool[]; executors: Record<string, ToolExecutor> } {
  const toolsArr: Tool[] = [];
  const executors: Record<string, ToolExecutor> = {};
  for (const def of defs) {
    if (executors[def.name]) {
      console.warn(`Tool "${def.name}" is already defined — skipping duplicate.`);
      continue;
    }
    toolsArr.push({ name: def.name, description: def.description, ... });
    executors[def.name] = ...;
  }
  return { tools: toolsArr, executors };
}
```

`buildTools()` takes a flat `CustomToolDef[]`. `<agent-chat-panel>` builds this
internally as `[...defaultTools(ctx), ...panel.tools]`
(`packages/web-agent-lit/src/chat-ui/chat-panel-session.ts:64-67`). `defaultTools(ctx)`
supplies `wait`, `get_time`, the four data tools, `show_generative_ui`, `search_skills`,
`load_skill`, `compact_conversation`, the three scheduler tools, the two todo
tools and — with a writable `skillRegistry` — `create_skill` and
`delete_skill`. The three scheduler tools appear only when the host enabled scheduling, and the two todo
tools appear only when the host enabled todo tracking. It
supplies **no** DOM tools. A host that wants those installs
`@cuatoi/web-agent-dom` and passes `domTools()` through
`SessionConfig.toolProviders`. Set the panel's `tools` property to add
host-defined tools (see [Custom tools](./custom-tool.md)).

Each executor is wrapped with:
1. Abort signal check (honours turn-level cancellation)
2. Catch-all that converts any thrown error to `{ content: <message>, isError: true }`
   (never exposes stack traces). The loop copies `isError` onto the `tool-result`
   part, and `message-converter.ts` turns it into `is_error` on the Anthropic wire.

## Executor pattern

Every tool executor receives the parsed input and a `ToolContext`:

```ts
// packages/web-agent-core/src/tool-hooks.types.ts:48-94
export interface ToolContext {
  dataSource?: DataSourceProvider;
  app: AppContext;
  signal: AbortSignal;
  imageInput?: boolean;
  skills?: SkillDef[];                                            // merged skill registry
  _onToolBlock?: (toolCallId: string, block: RenderableBlock) => void; // internal
  /** Lifecycle hooks, assigned by `createPageAgent` from `AgentConfig.hooks`. */
  hooks?: AgentHooks;
  /** Maximum characters for a serialized query_data result, propagated from
   *  `AgentConfig.queryResultMaxChars`. Defaults to 6000 when unset. */
  queryResultMaxChars?: number;
  /** A source with MORE fields than this needs an explicit `select` on a row
   *  query, propagated from `AgentConfig.wideSourceFieldThreshold`. Defaults
   *  to `DEFAULT_WIDE_SOURCE_FIELD_THRESHOLD` (40) when unset. */
  wideSourceFieldThreshold?: number;
  /** The host's configured skill registry, propagated from
   *  `AgentConfig.skillRegistry`. `create_skill` is offered only when this
   *  exposes a `save` method, `delete_skill` only when it exposes `remove`. */
  skillRegistry?: SkillRegistry;
  /** Confirmation gate for a sensitive action (e.g. `create_skill`,
   *  `delete_skill`), propagated from `AgentConfig.confirmInteraction`. */
  confirmInteraction?: (detail: ConfirmInteractionDetail) => Promise<boolean>;
  /** Internal — ask the controller to compact once the current turn ends.
   *  Absent when no controller owns this context, and `compact_conversation`
   *  then reports that compaction is unavailable. */
  _requestCompaction?: (
    confirmed: boolean,
    followUp?: string,
  ) => CompactionRequestOutcome;
  /** Internal — the session-owned scheduler seam read by `set_schedule`,
   *  `list_schedules` and `cancel_schedule`. Absent when scheduling is not
   *  configured or is disabled. */
  _scheduler?: SchedulerControllerSeam;
  /** Internal — the session-owned todo seam read by `todo_write` and
   *  `todo_read`. Absent when todo is not configured or is disabled. */
  _todos?: TodoControllerSeam;
}
```

`ctx.hooks` holds the host's lifecycle hooks. Core runs `onPreTool` before and
`onPostTool` after every tool call. See [Lifecycle hooks](./hooks.md).

`buildTools()` does not dispatch by name — it wraps each def's own `execute`
function directly (`src/tools/build-tools.ts:237` calls `wrapExecutor`, defined at
`src/tools/build-tools.ts:32`). (A separate, name-based
`getHandler()`/`executeToolByName()` pair exists in the same file for the four
core tool builders, but it isn't in `buildTools()`'s call path — it's only
exercised by `build-tools.test.ts`.) A core executor is a plain function
taking `(input, ctx)`, e.g. `src/tools/query-data.ts`:

```ts
// packages/web-agent-core/src/tools/query-data.ts
export async function runQueryData(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const { dataSource } = ctx;
  if (!dataSource) {
    return { content: "Error: dataSource not available in context." };
  }
  if (ctx.signal.aborted) {
    return { content: "Tool execution aborted." };
  }
  const query = input as unknown as DataQuery;
  if (!query.aggregate && (!query.select || query.select.length === 0)) {
    const threshold = ctx.wideSourceFieldThreshold ?? DEFAULT_WIDE_SOURCE_FIELD_THRESHOLD;
    const info = await dataSource.describeSource(query.source);
    if (info.fields.length > threshold) {
      return {
        content: selectRequiredForWideSource(query.source, info.fields.length, threshold, info.fields.map((f) => f.name)),
        isError: true,
      };
    }
  }
  const result = await dataSource.query(query);
  const maxChars = ctx.queryResultMaxChars ?? 6000;
  return { content: serializeResult(result, maxChars) };
}
```

`serializeResult` is width-aware: it measures actual row width up front,
lightens optional field-schema metadata (`label`, `enumValues`, `description`,
`limitation`) when the schema itself is wide, and computes the exact row
count that fits `maxChars`. Output is always valid JSON. When rows are
dropped, the result carries a `truncation` report
(`requested`/`included`/`dropped`/`reason`/`hint`/`fieldsTruncated`) so the
model reports the honest cause — e.g. row width exceeding the budget —
instead of inventing one.

A row query against a source with more fields than
`AgentConfig.wideSourceFieldThreshold` (default 40) and no `select` never
reaches `serializeResult`: `query_data` answers with the column count and
how to pick columns.

## Wiring data sources

Data sources are the extension point most hosts use. You provide an array of
`SourceEntry` objects:

```ts
// packages/web-agent-core/src/datasource/registry.ts
export interface SourceEntry {
  describe(): SourceInfo | Promise<SourceInfo>;
  query(q: DataQuery): Promise<QueryResult>;
  /** Optional field allow-list: only these fields are discoverable and
   *  queryable, in this order, each with a friendly label. Omit it and the
   *  source exposes every field it describes. */
  allowFields?: FieldAllowEntry[];
}

// packages/web-agent-core/src/datasource/types.ts
export interface SourceInfo {
  name: string;
  description: string;
  fields: FieldSchema[];
  rowCount: number;
}
```

`list_data_sources` does not send `SourceInfo` to the model unless you ask
for one source by name. Called with no argument it returns a
`SourceSummary` per source — enough to choose a source, and no field
detail:

```ts
// packages/web-agent-core/src/datasource/types.ts
export interface SourceSummary {
  name: string;
  description: string;
  rowCount: number;
  fieldCount: number;                        // allow-listed fields only
  fieldTypes: Partial<Record<FieldType, number>>;
  error?: string;                            // copied from SourceInfo.error
}
```

For a 300-column source that is 334 characters instead of 34,859. The
agent uses `get_field_details({ source: "<name>", filter: "..." })` to search
and page field schemas on demand, `sample_field_values({ source: "<name>", field: "<field>" })`
to sample distinct values, or `list_data_sources({ source: "<name>" })` for the full
`SourceInfo` when it needs all field names.

A source can hold fields that it cannot expose, for example an Elasticsearch
field whose type the query engine cannot use. The source lists them in
`SourceInfo.unsupportedFields`, each as `{ name, esType, reason }`
(`src/datasource/types.ts:57-61`). `get_field_details` returns the matching
entries in `unsupportedFields`, narrowed by the same `filter` and by the
allow-list, so the agent can tell the user that the field exists and why it
cannot be used (`src/datasource/types.ts:126`).

### Cat-store worked example

The cat-store app (`apps/cat-store/src/web/orders-backend/datasource-sources.ts`)
registers three data sources: orders, products, and cart.

Here is the **products** source — it reads from the Redux store and uses the
core `runQuery()` engine:

```ts
// apps/cat-store/src/web/orders-backend/datasource-sources.ts
import { SourceEntry, SourceInfo, DataQuery, QueryResult, FieldSchema, runQuery } from "@cuatoi/web-agent-core";

export const PRODUCT_FIELDS: FieldSchema[] = [
  { name: "id", type: "string" },
  { name: "name", type: "string" },
  { name: "category", type: "enum", enumValues: ["Food", "Toys", "Beds", "Grooming", "Health"] },
  { name: "price", type: "number" },
  { name: "cost", type: "number" },
  { name: "inStock", type: "boolean" },
];

// What the agent may see, and what it calls each field. This host exposes
// every field; a host that wants to hide one simply leaves it out.
export const PRODUCT_ALLOW_FIELDS: FieldAllowEntry[] = [
  { name: "id", label: "Product code" },
  { name: "name", label: "Product name" },
  { name: "category", label: "Product type" },
  { name: "price", label: "Shelf price" },
  { name: "cost", label: "Unit cost" },
  { name: "inStock", label: "In stock" },
];

export function getCatSources(getState: () => any): SourceEntry[] {
  const productsSource: SourceEntry = {
    allowFields: PRODUCT_ALLOW_FIELDS,
    describe(): SourceInfo {
      const state = getState();
      const items = state?.products?.items ?? [];
      return {
        name: "products",
        description: "Live product catalog",
        fields: PRODUCT_FIELDS,
        rowCount: items.length,
      };
    },
    async query(q: DataQuery): Promise<QueryResult> {
      const state = getState();
      const items = state?.products?.items ?? [];
      return runQuery(items, PRODUCT_FIELDS, q);
    },
  };

  const cartSource: SourceEntry = {
    describe(): SourceInfo {
      const state = getState();
      const items = state?.cart?.items ?? [];
      return {
        name: "cart",
        description: "Current shopping cart contents",
        fields: CART_FIELDS,
        rowCount: items.length,
      };
    },
    async query(q: DataQuery): Promise<QueryResult> {
      const state = getState();
      const items = state?.cart?.items ?? [];
      return runQuery(items, CART_FIELDS, q);
    },
  };

  // ordersSource omitted for brevity — see datasource-sources.ts full file

  return [ordersSource, productsSource, cartSource];
}
```

With `allowFields` set, the agent queries by `name` and speaks about the field
using its `label`. A source with no `allowFields` behaves exactly as before —
every field it describes is discoverable and queryable, with no label.

The sources are then wired to the panel:

```ts
// apps/cat-store/src/web/agent-panel-config.ts:198
panel.sources = getCatSources(() => store.getState());
```

### Using runQuery()

The `runQuery()` function (`src/datasource/query-engine.ts`) accepts raw data
rows, a field schema, and a `DataQuery`:

```ts
import { runQuery } from "@cuatoi/web-agent-core";

const result = await runQuery(myRows, myFields, {
  source: "mySource",
  filter: { status: { $in: ["active", "pending"] } },
  page: { offset: 0, limit: 20 },
  sort: [{ field: "createdAt", dir: "desc" }],
});

// An aggregate query is a different shape. Its sort lives INSIDE `aggregate`
// and names a result column; a top-level `sort` or `select` alongside
// `aggregate` is rejected.
const byCategory = await runQuery(myRows, myFields, {
  source: "mySource",
  aggregate: {
    groupBy: [{ field: "category" }],
    measures: [{ op: "sum", field: "total", as: "revenue" }, { op: "count" }],
    sort: [{ field: "revenue", dir: "desc" }],
  },
});
```

### Query features

- **Free-text search**: `search` — a case-insensitive substring matched across
  every `string` and `enum` field of the source. It combines with `filter` as
  AND and applies before aggregation.
- **Filters**: MongoDB-style — `$and`, `$or`, `$gt`, `$gte`, `$lt`, `$lte`,
  `$eq`, `$ne`, `$in`, `$nin`, `$regex`, `$exists`
- **Sorting**: multi-field with `asc`/`desc` direction. A top-level `sort` is
  for row queries only; with `aggregate` present it is rejected, not applied.
- **Aggregation**: Cube-style `groupBy` + measures (`count`, `sum`, `avg`,
  `min`, `max`, `countDistinct`) with optional `having`, sort, and limit.
  Order an aggregate result with `sort` inside `aggregate`, naming a result
  column (the groupBy or measure alias); an aggregate needs no `select` —
  rename a column with `as`.
- **Pagination**: `offset`/`limit` with `hasMore` flag

## The calc tool

`calcTool` evaluates an arithmetic expression, so the model does not calculate
in its own text (`src/tools/calc.ts:86-102`). It is not part of
`defaultTools(ctx)`. Add it to your tool list:

```ts
import { calcTool } from "@cuatoi/web-agent-core";

panel.tools = [calcTool];
```

```ts
calc({ expression: string })   // for example "(15 * 3.5) / 2" or "sqrt(144) + 5"
```

It uses the `expr-eval-fork` parser and applies these limits
(`src/tools/calc.ts:5-7`):

| Limit | Value | What happens |
|---|---|---|
| `MAX_CALC_EXPRESSION_LENGTH` | 1000 characters | A longer expression is rejected before parsing. |
| `MAX_CALC_TIMEOUT_MS` | 1000 ms | Evaluation runs synchronously and cannot be stopped. A run that took longer returns an error instead of the result. |
| `MAX_CALC_OUTPUT_LENGTH` | 500 characters | A longer result is cut and marked as truncated. |

A missing or empty `expression` returns an error that names the `expression`
argument and shows an example call. A parse or evaluation failure returns
`Calculation error: <message>`. All failures set `isError: true`.

The package also exports `runCalc`, `calcInputSchema` and the three limit
constants.

## Adding a custom tool

Custom tool authoring — including the `CustomToolDef` shape, `ToolOutcome`
contract, `ToolContext` fields, merge/shadowing behavior, and a worked example
— is covered on its own page:

→ **[Custom tools (CustomToolDef)](./custom-tool.md)**

Set `panel.tools = [myCustomTool]` on the component — the panel merges it
with `defaultTools(ctx)` automatically.

## Related pages

- [Custom tools](./custom-tool.md) — host-defined tool authoring
- [Skills](./skill.md) — `search_skills` / `load_skill` on-demand instructions
- [Scheduler](./scheduler.md) — `set_schedule`, `list_schedules`, `cancel_schedule`
- [Todo tracking](./todo.md) — `todo_write`, `todo_read`
- `show_chart` — the optional `@cuatoi/web-agent-charting` package; see its own `docs/`
- [Generative UI](./generative-ui.md) — `show_generative_ui` tool
- [Composing tools, skills & renderers](./composition.md) — the core builders + recipe cookbook
