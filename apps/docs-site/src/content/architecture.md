---
title: Architecture
---

# Architecture

This page walks through how the agent works end-to-end: the tool-call loop,
message flow, tool execution, and the data-source system.

## High-level flow

```
User types message
       │
       ▼
  runTurn()                  ← src/loop/run-turn.ts
       │
       ├── 1. Append user message to ContextManager
       ├── 2. agent.generate({ messages })        ← hand-built tool loop (agent.ts)
       │         │
       │         ├── Step 1: LLM decides to call a tool (or reply)
       │         ├── Step 2: buildTools() executes the tool
       │         ├── Step 3: result sent back to LLM
       │         └── … repeats until stop
       │
       ├── 3. cm.commitTurn()                     ← persist messages
```

The entry point is `runTurn()` in `src/loop/run-turn.ts`. It:

1. Appends the user's text to the `ContextManager` (`src/loop/context-manager.ts`)
2. Calls `agent.generate()` — the hand-built multi-step tool loop in
   `src/loop/agent.ts`, which drives the LLM via the `LanguageModel` provider
   abstraction
3. Commits the turn's messages back to the `ContextManager`

## The agent loop

Created by `createPageAgent()` in `src/loop/agent.ts`:

```ts
// src/loop/agent.ts
export function createPageAgent(cfg: AgentConfig, ctx: ToolContext, cm: ContextManager) {
  const settings = buildGenerateSettings(cfg, ctx.app);
  const defs = (cfg.tools ?? defaultTools)(ctx);
  const { tools: toolDefs, executors } = buildTools(ctx, defs);
  let _model: LanguageModel = providerRegistry.get(cfg, { fetch });
  // ...
  return {
    async generate({ messages, abortSignal, onStep }) {
      for (let i = 0; i < cfg.maxIterations; i++) {
        // Call the LLM with _model.generate(), one request per step
        // Execute tool calls, append results, loop until finishReason !== "tool-calls"
      }
    }
  };
}
```

- **`buildGenerateSettings()`** (`src/loop/agent.ts`) — builds the model,
  system instructions (base prompt + optional `appendSystemPrompt`), and
  generation knobs (temperature, topP, maxOutputTokens, etc.) from `AgentConfig`.
- **`buildTools(ctx, defs)`** (`src/tools/build-tools.ts`) — takes a flat
  `CustomToolDef[]` (`cfg.tools`, defaulting to `defaultTools(ctx)`) and
  returns a JSON-schema `toolDefs` array for the LLM and an `executors` map.
  `defaultTools(ctx)` registers the core DOM/data tools plus `search_skills`,
  `load_skill`, and `show_generative_ui`; optional tools like `show_chart` and
  any host-defined tools are appended by the caller (`<agent-chat-panel>`
  merges `panel.tools` in automatically).
- **`providerRegistry.get(cfg)`** — resolves the `LanguageModel` for
  `cfg.endpointType` and wraps it with retry/timeout middleware.
- **`cm.recordStep()`** — appends the step's new messages and audit entries to
  the `ContextManager` after each LLM call.

### Step lifecycle

Each step in the loop:

1. The LLM receives the conversation history plus system prompt
2. The LLM either replies with text or requests a tool call
3. If a tool call: the appropriate executor runs (with abort-check + catch-all)
4. The tool result is fed back to the LLM as a new message
5. The loop continues until the LLM replies with text or `maxIterations` is hit

## Context management

`ContextManager` (`src/loop/context-manager.ts`) tracks every message with
metadata:

- **JournalEntry** — each message plus a `meta` object with `turnId`, `stepNo`,
  `kinds` (classifying the part: `user_prose`, `tool_call`,
  `tool_result_snapshot`, etc.), character count, and timestamp.
- **Composition** (`cm.compose()`) — builds the message array for the SDK. With
  no compaction tombstone it returns every turn. After a compaction it returns
  the summary, the 2 turns before the tombstone, and everything after it.
- **Result expiry** (`cm.redactExpiredResults()`) — runs between user turns,
  before the compaction check. A tool declares `ttl` (keep the newest N results
  per argument set) and `uttl` (a result lives N user turns) on its definition;
  an expired result is replaced in place by a short note naming the tool. A tool
  that declares neither is never touched.
- **Compaction** (`src/loop/compaction.ts`) — when the context exceeds
  `autoCompactPercent` of `contextLength`, a foreground summarizer runs before the turn
  (`summariseInCachedConversation()`) appends one summarising turn to the
  cached conversation (a prompt-cache read, not a detached prompt) and
  compresses older turns into a single `summary_stub` message.

## Tool execution

All tools are defined in `src/tools/definitions.ts` with Zod schemas. The
`buildTools()` function in `src/tools/build-tools.ts`:

1. Iterates over `TOOL_DEFS` (a `Record<string, ToolDef>`)
2. Wraps each executor via `wrapExecutor()` which:
   - Checks the abort signal before executing
   - Catches all thrown errors and returns them as strings (never raw stack traces)
3. Returns a JSON-schema `Tool[]` array for the provider and an `executors` map
   called by the agent loop when the model issues a tool call

Each tool executor receives a `ToolContext`:

```ts
// src/tools/build-tools.ts
export interface ToolContext {
  domAdapter: DomAdapter;
  stateAdapter: StateAdapter;
  dataSource?: DataSourceProvider;
  app: AppContext;
  signal: AbortSignal;
  imageInput?: boolean;             // when false, see tool is omitted
  skills?: SkillDef[];              // merged skill registry
  _onToolBlock?: (toolCallId: string, block: RenderableBlock) => void; // internal
}
```

The built-in tools and their executors live in `src/tools/*.ts`:

| Tool | Executor file | Delegates to |
|------|--------------|--------------|
| `snapshot_page` | `snapshot-page.ts` | `domAdapter.snapshot()` |
| `query_state` | `query-state.ts` | `stateAdapter.query()` |
| `click` | `click.ts` | `domAdapter.click()` |
| `fill` | `fill.ts` | `domAdapter.fill()` |
| `select_option` | `select-option.ts` | `domAdapter.selectOption()` |
| `wait_for` | `wait-for.ts` | `domAdapter` / `stateAdapter` |
| `wait` | `wait.ts` | none (pure timer, races `ctx.signal`) |
| `see` | `see.ts` | `domAdapter.screenshot()` (vision; omitted when `imageInput: false`) |
| `list_data_sources` | `list-data-sources.ts` | `DataSourceProvider` |
| `get_field_details` | `get-field-details.ts` | `DataSourceProvider` |
| `sample_field_values` | `sample-field-values.ts` | `DataSourceProvider` |
| `query_data` | `query-data.ts` | `DataSourceProvider` |
| `show_chart` | `show-chart.ts` | inline — produces a `ChartBlock` |
| `show_generative_ui` | `show-generative-ui.ts` | inline — produces a `FormBlock` / `ButtonsBlock` |
| `search_skills` | built into `build-tools.ts` | in-memory skill registry |
| `load_skill` | built into `build-tools.ts` | in-memory skill registry |

## Error classification

Errors from the LLM provider are classified in `src/loop/errors.ts`:

- `rate_limit` — HTTP 429
- `fatal_auth` — HTTP 401/403
- `bad_request` — HTTP 400
- `network` — everything else (timeout, DNS, 5xx)
- `aborted` — user cancellation

## Data source system

Data sources power `list_data_sources`, `get_field_details`, `sample_field_values`, and `query_data`. They are registered
as `SourceEntry[]` on the panel's `sources` property.

### SourceEntry interface

Each entry has two methods:

- **`describe(): SourceInfo | Promise<SourceInfo>`** — returns name, description,
  field schemas, row count; may be async (the provider awaits it during registration)
- **`query(q: DataQuery): Promise<QueryResult>`** — executes a query with
  filtering, sorting, pagination, and aggregation
- **`sampleValues?(field: string, limit?: number)`** — optional distinct value
  sampling for a field

`DataSourceProvider.listSources()` does **not** hand these `SourceInfo`
objects to the model. It returns a `SourceSummary` per source — name,
description, row count, field count and a count of fields per type — so a
wide source costs a few hundred characters at session start instead of tens
of thousands. The agent searches and pages field schemas using `get_field_details`,
samples distinct values with `sample_field_values`, or fetches full `SourceInfo`
via `list_data_sources({ source })`.

Row queries against a wide source must project. When a `query_data` call
names no columns and the source has more fields than
`AgentConfig.wideSourceFieldThreshold` (default 40), the tool returns the
source's column count and how to choose columns instead of rows. The
selection is pushed into the Elasticsearch request as `_source.includes`,
so unselected fields never cross the network.

The `createDataSourceProvider()` factory in `src/datasource/provider.ts`
registers a list of `SourceEntry` into a `SourceRegistry` and exposes a
`DataSourceProvider` interface consumed by the tool executors.

### Query engine

`runQuery()` in `src/datasource/query-engine.ts` is the workhorse:

1. **Filter** — MongoDB-style expressions (`$and`, `$or`, `$gt`, `$lt`, `$in`,
   `$regex`, etc.)
2. **Sort** — multi-field sort with direction
3. **Aggregate** (optional) — Cube-style `groupBy` + measures (`count`, `sum`,
   `avg`, `min`, `max`, `countDistinct`) with `having`, sort, and limit
4. **Paginate** — offset/limit with `hasMore`

### Cat-store example

The cat-store app registers three data sources in
`apps/cat-store/src/web/orders-backend/datasource-sources.ts`:

- **orders** — fetched over HTTP from the cat-store Express API (`/api/orders`)
- **products** — reads from the Redux `products` slice
- **cart** — reads from the Redux `cart` slice

Each source's `query()` method calls `runQuery()` from core, passing the raw
data rows, field schemas, and the incoming `DataQuery` object.

### Generative UI tools

The model calls **`show_chart`** and **`show_generative_ui`** tools to present
rich UI (charts, buttons, forms) to the user. These are the ONLY path for rich
UI — the model never writes fenced ui blocks.

Blocks are rendered by the `generativeUiRenderer` (buttons, forms) and
`chartRenderer` (Chart.js 2.x charts) from the tool's output.

The block schema supports:
- **forms** — text inputs, number, select, checkbox, date fields
- **buttons** — quick-reply button rows (up to 6)
- **charts** — Chart.js 2.x configs (`line`, `bar`, `pie`, `scatter`, etc.)

Block interactions bridge back to the agent via `buttonToMessage()` and
`formSubmitToMessage()` in `src/ui-blocks/bridge.ts`, which prefix replies with
`[ui_action:...]` so the LLM understands the context.

See [Generative UI](#/core/generative-ui) and [Chart](#/charting/chart) for full details.

## Persistence

When `persist: true` is set in `AgentConfig`, the conversation is saved to
IndexedDB via the `attachPersistence()` / `rehydrate()` functions in
`src/loop/persistence.ts`. On page reload, `loadPersisted()` restores the
`ContextManager` state so the conversation continues where it left off.

## Transport

The core ships a hand-built provider abstraction with zero external LLM-SDK
runtime dependencies. The central piece is the `LanguageModel` interface in
`src/transport/provider.types.ts`:

```ts
interface LanguageModel {
  readonly provider: string;
  readonly modelId: string;
  generate(opts: ProviderCallOptions): Promise<ProviderResult>;
}
```

`providerRegistry` (`src/transport/registry.ts`) maps `cfg.endpointType` to a
provider factory. Two providers are built in:

- **Anthropic** (`endpointType: "anthropic"`) — uses `@anthropic-ai/sdk`. Every
  call sends `stream: false` and reads one complete JSON response.
- **OpenAI-compatible** (`endpointType: "openai"`) — uses `openai` v6. Works
  with any OpenAI-compatible proxy (Ollama, LiteLLM, etc.). Reasoning models
  (`o1`/`o3`) receive the system prompt as the `"developer"` role.

Both are automatically wrapped with `withRetry` middleware
(`src/transport/middleware.ts`): a 30 s per-attempt timeout (via a combined
`AbortController`) plus up to 2 retries with exponential back-off, covering
empty/dead streams and transient network failures.

A deterministic `"mock"` provider is also registered for unit tests.

See [Custom Providers](#/core/providers) for the step-by-step guide to writing
and registering your own provider.
