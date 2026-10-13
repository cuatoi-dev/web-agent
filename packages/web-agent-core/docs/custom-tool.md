---
title: Custom tools (CustomToolDef)
---

# Custom tools (CustomToolDef)

Hosts extend the agent's capabilities via `AgentConfig.tools?: (ctx) =>
CustomToolDef[]` — a builder function returning the full tool list for a turn.
Custom tools are indistinguishable from core tools from the model's
perspective. See [Composing tools, skills & renderers](./composition.md) for
the full builder-function model.

For the built-in tool set, see [Tools & data sources](./tools.md). For
on-demand instruction blocks, see [Skills](./skill.md).

---

## CustomToolDef shape

From `packages/web-agent-core/src/tools/types.ts:37-67`:

```ts
interface CustomToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodType | { type: "object"; [key: string]: unknown };
  promptSnippet?: string;
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome>;
  /** Optional friendly tool-call renderer for the tool-step row. */
  renderer?: (input: Record<string, unknown>, result: string) => string;
  /** Optional readable wording for this call, used as `summary` in onPreTool. */
  summarize?: (input: Record<string, unknown>, ctx: ToolContext) => string;
  /** Keep the newest N results of this tool per argument set. null = never. */
  ttl?: number | null;
  /** A result of this tool lives N user turns. null = never. */
  uttl?: number | null;
}
```

| Field | Description |
|-------|-------------|
| `name` | Tool name the LLM uses in tool calls. Must not clash with a core tool name. `defaultTools(ctx)` ships ten always: `wait`, `get_time`, `list_data_sources`, `get_field_details`, `sample_field_values`, `query_data`, `show_generative_ui`, `search_skills`, `load_skill`, `compact_conversation` — plus `set_schedule`, `list_schedules` and `cancel_schedule` when `ctx._scheduler` is present, `todo_write` and `todo_read` when `ctx._todos` is present, `create_skill` when `ctx.skillRegistry` exposes a `save` method, and `delete_skill` when it exposes a `remove` method. |
| `description` | Natural-language description sent to the model in the tool definition. Core builds its own `Tool` shape (`src/types.ts:16`); there is no vendor SDK. |
| `inputSchema` | Zod schema (use `.strict()` to reject unknown fields), **or** a raw JSON Schema object. Core validates arguments against either kind before `execute` runs, and returns `isError: true` with the failing field path when they do not match. `.strict()` therefore rejects an unknown key instead of passing it through. |
| `promptSnippet` | Optional short guideline included in the system prompt (same role as core tools' `promptSnippet`). |
| `execute` | Async function receiving validated input and `ToolContext`. Must return `ToolOutcome`. |
| `renderer` | Optional friendly HTML renderer for the tool-step row, given the input and the result text. |
| `summarize` | Optional readable wording for this call, surfaced as `summary` in the `onPreTool` hook payload. See [Lifecycle hooks](./hooks.md#onpretool). |
| `ttl` | Optional. Keep only the newest `ttl` results of this tool **per argument set** — the tool name plus its arguments, with object keys sorted, so `snapshot_page({ref:"main"})` and `snapshot_page({ref:"side"})` hold separate windows. Older results are replaced in place by a short note naming the tool, so the model can see the call happened and run it again. `null` or absent means never. |
| `uttl` | Optional. A result of this tool lives `uttl` **user** turns; one user message that drives twenty tool calls is one turn. `null` or absent means never. `ttl` and `uttl` are independent tests, not a fallback chain — whichever expires first redacts the result. |

Both fields default to never. A tool that declares neither keeps every result
for the whole conversation, which is how every tool behaved before these fields
existed. `@cuatoi/web-agent-dom` sets `ttl: 1, uttl: 2` on `snapshot_page` and
`ttl: 3, uttl: 2` on `query_state`; no other shipped tool sets either field.

---

## ToolOutcome contract

```ts
// packages/web-agent-core/src/tool-hooks.types.ts
interface ToolOutcome {
  content: string;        // text returned to the LLM on success or failure
  isError?: boolean;      // true to signal tool failure
  images?: { dataUrl: string; mediaType: string }[]; // optional images to send to the model
  block?: RenderableBlock; // optional UI block to render inline at this call position
}
```

- Always return a descriptive `content` string — the LLM reads this.
- Never throw from `execute`; any thrown error is caught by `wrapExecutor()`
  and returned as `{ content: <message>, isError: true }` automatically.
- `isError` reaches the model. A result you mark `isError: true` arrives as an
  Anthropic `tool_result` block with `is_error: true`, so the model knows the
  call failed instead of guessing from the wording. An
  [`onPostTool` hook](./hooks.md#onposttool) cannot change it.
- `images` is how a tool sends pictures to the model. `wrapExecutor()`
  downscales each one with `downscaleToolImage` (1536 px long edge, 1 MB;
  a JPEG stays JPEG, other types become PNG, a PNG still over 1 MB is
  halved once) and returns them on the executor result
  (`src/tools/build-tools.ts`). The agent loop sends every image from
  every tool in a step as one user message on the next step, each after
  the label `Image from tool <name>:` (`src/loop/agent.ts`). An image that
  cannot be decoded is dropped with a `[web-agent] tool image dropped`
  warning; the text result still reaches the model. Any tool can set it,
  not only `see` — see [Image support](./image-support.md).
- To render a chart or form inline, set `block` to a `ChartBlock` or
  `FormBlock` / `ButtonsBlock` (see [Generative UI](./generative-ui.md)).

---

## ToolContext fields

```ts
// packages/web-agent-core/src/tool-hooks.types.ts:48-94
interface ToolContext {
  dataSource?: DataSourceProvider;  // query registered data sources
  app: AppContext;                  // appName, appDescription, appInstructions, route, userName, userInfo
  signal: AbortSignal;              // honour turn-level cancellation
  imageInput?: boolean;             // whether image input is enabled
  skills?: SkillDef[];              // merged skill registry
  hooks?: AgentHooks;               // lifecycle hooks from AgentConfig.hooks
  queryResultMaxChars?: number;     // max chars of a serialized query_data result; default 6000
  wideSourceFieldThreshold?: number; // a wider source needs an explicit `select`; default 40
  skillRegistry?: SkillRegistry;    // create_skill needs `save` on this; delete_skill needs `remove`
  confirmInteraction?: (detail: ConfirmInteractionDetail) => Promise<boolean>; // confirmation gate
  _onToolBlock?: ...;               // internal — core handles block routing
  _requestCompaction?: ...;         // internal — compact_conversation asks the controller
  _scheduler?: ...;                 // internal — the set_schedule/list_schedules/cancel_schedule seam
  _todos?: ...;                     // internal — the todo_write/todo_read seam
}
```

A custom tool that needs the DOM gets it from `@cuatoi/web-agent-dom`,
which builds its own adapters — core no longer puts them on `ToolContext`.

Important fields for custom tools:

- `ctx.signal.aborted` — check before any long operation; return early with
  `{ content: "Aborted.", isError: true }` if true.
- `ctx.dataSource?.query()` — access registered data sources.
- `ctx.app` — current route, app name, app description, and the host's
  `appInstructions`, `userName` and `userInfo` when set.
- `ctx.imageInput` — whether vision tools are active.
- `ctx.hooks` — the host's lifecycle hooks. Core already runs `onPreTool` and
  `onPostTool` around your `execute`, so a tool does not call them. See
  [Lifecycle hooks](./hooks.md).

---

## Merge and shadowing behavior

`buildTools(ctx, defs)` iterates the `defs` array you return from
`AgentConfig.tools`. If a def's `name` matches an **already-registered** tool
(an earlier entry in the same array), a `console.warn` is emitted and the
duplicate is **skipped** — the first registration wins. Check the browser
console if a custom tool appears absent.

---

## Worked example

```ts
import { z } from "zod";
import type { CustomToolDef } from "@cuatoi/web-agent-core";

const getPromotionsTool: CustomToolDef = {
  name: "get_promotions",
  description: "List active promotions. Returns a markdown list of current discounts.",
  inputSchema: z.object({
    category: z.string().optional().describe("Filter to this category"),
  }).strict(),
  promptSnippet: "get_promotions: call to retrieve current discount offers.",
  async execute(input, ctx) {
    if (ctx.signal.aborted) return { content: "Aborted.", isError: true };
    const cat = input.category as string | undefined;
    const promos = await fetchPromotions(cat);  // your host logic
    if (!promos.length) return { content: "No active promotions." };
    return {
      content: promos.map(p => `- ${p.title}: ${p.discount}%`).join("\n"),
    };
  },
};

// Register on the panel:
panel.tools = [getPromotionsTool];
```

---

## Registering on the panel

Set the `tools` property on `<agent-chat-panel>` or the bubble to your
*extra* tools — the panel merges them with `defaultTools(ctx)` internally
(see `chat-panel.ts`) before calling `buildTools()`.

```ts
panel.config = {
  baseURL: "/api/openai/v1",
  model: "your-model-id",
  maxIterations: 50,
  // ...
};
panel.tools = [getPromotionsTool, anotherTool];
```

---

## Cross-links

- [Tools & data sources](./tools.md) — built-in tool reference
- [Skills](./skill.md) — on-demand instruction blocks
- [Generative UI](./generative-ui.md) — returning a `block` from `execute`
- [Composing tools, skills & renderers](./composition.md) — the full builder-function model
