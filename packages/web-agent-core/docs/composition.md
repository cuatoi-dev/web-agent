---
title: Composing tools, skills & renderers
---

# Composing tools, skills & renderers

The agent's capabilities — tools, skills, and generative-UI block renderers —
are all **plain arrays you assemble by spreading builder functions**. There is
no registration API and no `customTools`/`customSkills` config field. This page is the single copy-paste reference tying together
[Tools & data sources](./tools.md), [Custom tools](./custom-tool.md),
[Skills](./skill.md), and [Generative UI](./generative-ui.md).

---

## The builder-function model

`AgentConfig` exposes two composition fields:

```ts
interface AgentConfig {
  /** Returns the FULL explicit tool-def list for a turn. Unset → defaultTools(ctx). */
  tools?: (ctx: ToolContext) => CustomToolDef[];
  /** Full skill list. Unset → coreSkills(). NOT merged automatically with your list. */
  skills?: SkillDef[];
  // …
}
```

Both are **explicit, full-replacement lists**. If you provide `tools`, you
own the complete array: spread the core builders you want, then add your own
defs. There is nothing to register. A tool, skill or renderer that is not in
the array you return does not exist for that turn.

---

## Core builders reference

All exported from `@cuatoi/web-agent-core`:

| Builder | Signature | Provides |
|---|---|---|
| `waitTools()` | `() => CustomToolDef[]` | `wait` (an unconditional pause) |
| `timeTools()` | `() => CustomToolDef[]` | `get_time` (current date and time, with one optional IANA `timezone`; the system zone when omitted) |
| `dataTools()` | `() => CustomToolDef[]` | `list_data_sources`, `get_field_details`, `sample_field_values`, `query_data` |
| `genuiTools()` | `() => CustomToolDef[]` | `show_generative_ui` (buttons/forms) |
| `skillTools(ctx?)` | `(ctx?: ToolContext) => CustomToolDef[]` | `search_skills`, `load_skill` (reads `ctx.skills` at execute time), plus `create_skill` when `ctx?.skillRegistry?.save` is a function and `delete_skill` when `ctx?.skillRegistry?.remove` is a function |
| `compactionTools()` | `() => CustomToolDef[]` | `compact_conversation` (reads `ctx._requestCompaction` at execute time; reports compaction unavailable when no controller owns the context) |
| `schedulerTools(ctx?)` | `(ctx?: ToolContext) => CustomToolDef[]` | `set_schedule`, `list_schedules`, `cancel_schedule` — returned only when `ctx?._scheduler` is present. With no seam (or no `ctx`) it returns an empty array, so a host with scheduling off never offers them. Each tool still reads `ctx._scheduler` at execute time and reports that scheduling is off if the seam has gone since registration. |
| `todoTools(ctx?)` | `(ctx?: ToolContext) => CustomToolDef[]` | `todo_write`, `todo_read` — returned only when `ctx?._todos` is present. With no seam (or no `ctx`) it returns an empty array, so a host with todo off never offers them. |
| `defaultTools(ctx)` | `(ctx: ToolContext) => CustomToolDef[]` | `waitTools()`, `timeTools()`, `dataTools()`, `genuiTools()`, `skillTools(ctx)`, `compactionTools()`, `schedulerTools(ctx)` and `todoTools(ctx)` concatenated, in that order |
| `coreSkills()` | `() => SkillDef[]` | The built-in `SkillDef[]` (`query_data_advanced`, `present_to_user`, …) — the `skills` default when unset |

DOM tools are not core builders. `@cuatoi/web-agent-dom` exports
`domTools(options?)`, which returns `ToolProvider[]` for
`SessionConfig.toolProviders` — not `CustomToolDef[]` for `config.tools`.

---

## Recipes

Each recipe is self-contained — copy the imports as shown.

### Full agent (defaults)

Leave `tools`/`skills` unset — core falls back to `defaultTools(ctx)` and
`coreSkills()` (`packages/web-agent-core/src/loop/agent.ts:49`,
`packages/web-agent-core/src/loop/agent.ts:121`,
`packages/web-agent-core/src/loop/agent.ts:129`):

```ts
const panel = document.createElement("agent-chat-panel") as any;
panel.path = "/api/anthropic";
panel.model = "m";
panel.config = { persist: true };
// tools/skills left unset — core uses defaultTools(ctx) and coreSkills()
document.body.appendChild(panel);
```

> **`panel.tools` and `panel.skills` are convenience properties, not the raw
> config.** `panel.tools = [...]` is **additive** — the panel always computes
> `tools: (ctx) => [...defaultTools(ctx), ...(panel.tools ?? [])]` internally
> (`packages/web-agent-lit/src/chat-ui/chat-panel-session.ts:63-66`). `panel.skills`,
> by contrast, is passed straight through as `cfg.skills` with **no**
> auto-merge (`packages/web-agent-lit/src/chat-ui/chat-panel-session.ts:67`) — if you set it, you must spread
> `coreSkills()` yourself to keep the built-in skills (see cat-store/docs-site
> examples below). To fully **replace** the tool list (read-only, headless,
> vanilla below), set `panel.config = { tools: yourFn }` directly — `_config`
> is spread after `tools` in `buildSessionConfig()`
> (`packages/web-agent-lit/src/chat-ui/chat-panel-session.ts:73`) so it wins
> over the panel's computed default.

> **The read-only, headless and vanilla recipes below replace the whole tool
> list, so they drop the core tools they do not name.** The read-only recipe
> keeps `waitTools()`, `dataTools()`, `genuiTools()` and `skillTools(ctx)`; the
> headless recipe also drops `waitTools()`; the vanilla recipe keeps no core
> tool. Each one omits `get_time` (from `timeTools()`),
> `compact_conversation` (from `compactionTools()`), `set_schedule` /
> `list_schedules` / `cancel_schedule` (from `schedulerTools(ctx)`) and
> `todo_write` / `todo_read` (from `todoTools(ctx)`). That is deliberate: a recipe
> shows the smallest shape, not the default shape. To keep any of these groups,
> spread its builder — all are exported from the package entry point:
>
> ```ts
> import { compactionTools, schedulerTools, timeTools, todoTools } from "@cuatoi/web-agent-core";
> // …then add `...timeTools(), ...compactionTools(), ...schedulerTools(ctx), ...todoTools(ctx),`
> // to the array below. `schedulerTools` and `todoTools` need the ctx: with no
> // `ctx._scheduler` or `ctx._todos` seam they return nothing, which is what a
> // host with that feature turned off wants.
> ```
>
> There is no other way in: the package exports only its root entry point, so a
> deep import such as `@cuatoi/web-agent-core/tools/builders.js` throws
> `ERR_PACKAGE_PATH_NOT_EXPORTED` (`packages/web-agent-core/package.json:24-31`).

### Read-only agent (no DOM-write)

```ts
import { dataTools, genuiTools, skillTools, waitTools } from "@cuatoi/web-agent-core";
import { domTools } from "@cuatoi/web-agent-dom";
import type { ToolContext } from "@cuatoi/web-agent-core";

panel.config = {
  tools: (ctx: ToolContext) => [
    ...waitTools(),
    ...dataTools(),
    ...genuiTools(),
    ...skillTools(ctx),
  ],
  // DOM tools come from a provider, not from `tools`. Omit this line entirely
  // for a headless agent — then snapshot_page/query_state/click/fill/
  // select_option/wait_for/see do not exist for the model.
  // domTools() has no read-only option. Wrap its provider and keep only the read tools.
  toolProviders: domTools().map((p) => ({
    ...p,
    load: async () =>
      (await p.load()).filter((t) => ["snapshot_page", "query_state", "see"].includes(t.name)),
  })),
};
```

`apps/docs-site/src/docs-embed.ts:13` imports `domTools` the same way, but it is
**not** an example of full replacement: it sets `bubble.tools = [searchDocsTool]`
(`apps/docs-site/src/docs-embed.ts:53`), which is additive, and never sets
`config.tools`, so it keeps the whole of `defaultTools(ctx)`. For full-replacement
`tools` factories, see `mountAgentRunDemo` in
`apps/cat-store/src/web/dev/gallery-demos-agent-run.ts:196`, which drives
`createPageAgent` directly, and the browser extension's side panel
(`packages/web-agent-browser/src/sidepanel.ts:161`).

The system prompt automatically drops DOM-write operating rules when these
tool names are absent (see "Disabling a capability" below).

### Headless agent (no DOM at all)

```ts
import { dataTools, genuiTools, skillTools } from "@cuatoi/web-agent-core";
import type { ToolContext } from "@cuatoi/web-agent-core";

panel.config = {
  tools: (ctx: ToolContext) => [...dataTools(), ...genuiTools(), ...skillTools(ctx)],
  // no toolProviders — no DOM tools at all
};
```

### Vanilla agent (host-only tools)

Zero core tools — every tool is yours:

```ts
import type { ToolContext, CustomToolDef } from "@cuatoi/web-agent-core";
import { myCustomTool } from "./my-tools";

panel.config = {
  tools: (_ctx: ToolContext): CustomToolDef[] => [myCustomTool],
  skills: [], // see gotcha below — skills is independent of tools
};
```

> **`skills` and `tools` are independent.** If you omit `skillTools()`
> (no `search_skills`/`load_skill`) but leave `skills` unset, it still
> defaults to `coreSkills()` and the `# Skills` system-prompt section still
> lists skills the model has no tool to load. Pass `skills: []` explicitly in
> a vanilla/no-skill-tools setup.

### Adding the charting package

`@cuatoi/web-agent-charting` is an optional, separately-installed package
— omit the import entirely and it tree-shakes out of your bundle (see
"Real host examples" below). To add it:

```ts
import { chartingTools, chartingSkills } from "@cuatoi/web-agent-charting";
import { chartingRenderers } from "@cuatoi/web-agent-charting/lit";
import { genuiRenderers } from "@cuatoi/web-agent-lit";
import { coreSkills } from "@cuatoi/web-agent-core";

panel.tools = [...chartingTools()];              // additive — merges with defaultTools(ctx)
panel.skills = [...coreSkills(), ...chartingSkills()]; // NOT additive — spread coreSkills() yourself
panel.renderers = [...genuiRenderers, ...chartingRenderers];
```

See the `@cuatoi/web-agent-charting` package docs for the `show_chart` config shape and sanitizer limits.

### Authoring a custom tool from the sample defs

Copy `packages/web-agent-core/src/tools/sample-tools.ts` (exports
`sampleGreetingTool` — minimal text-returning shape — and
`sampleQuickReplyTool` — demonstrates `outcome.block`), rename, and add to
your tools array. See [Custom tools](./custom-tool.md) for the full
`CustomToolDef`/`ToolOutcome`/`ToolContext` reference.

```ts
import { sampleGreetingTool, sampleQuickReplyTool } from "@cuatoi/web-agent-core";

panel.tools = [sampleGreetingTool, sampleQuickReplyTool /* , yourRenamedCopy */];
```

### Adding a custom skill

```ts
import type { SkillDef } from "@cuatoi/web-agent-core";
import { coreSkills } from "@cuatoi/web-agent-core";

const mySkill: SkillDef = {
  name: "my-skill",
  description: "One-line description shown in search_skills results.",
  definition: `# My Skill\n\nFull markdown loaded on demand via load_skill("my-skill").`,
};

panel.skills = [...coreSkills(), mySkill]; // spread coreSkills() yourself — not auto-merged
```

### Registering a custom block renderer

A tool returns `outcome.block` with any `type` core doesn't own — core
validates it with `PluginBlockSchema`, a JSON Schema object that requires a
string `type` and allows every other field through
(`packages/web-agent-core/src/ui-blocks/schema.ts:153-160`):

```ts
// packages/web-agent-core/src/ui-blocks/schema.ts:153-160
export const PluginBlockSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    type: { type: "string" },
  },
  required: ["type"],
  additionalProperties: true,
};
```

So unknown shapes pass through core → lit unchanged. Register a matching
`BlockRenderer`:

```ts
import { z } from "zod";
import type { CustomToolDef, RenderableBlock } from "@cuatoi/web-agent-core";
import type { BlockRenderer, RenderCtx } from "@cuatoi/web-agent-lit";
import { genuiRenderers } from "@cuatoi/web-agent-lit";

const myTool: CustomToolDef = {
  name: "show_status_badge",
  description: "Render a colored status badge.",
  inputSchema: z.object({ label: z.string(), color: z.enum(["green", "red", "yellow"]) }).strict(),
  execute: async (input) => ({
    content: `Rendered status badge: ${input.label}`,
    block: { type: "status_badge", label: input.label, color: input.color } as RenderableBlock,
  }),
};

const statusBadgeRenderer: BlockRenderer = {
  types: ["status_badge"],
  render(block: RenderableBlock, _ctx: RenderCtx): Node {
    const el = document.createElement("span");
    el.textContent = String((block as any).label);
    el.style.background = String((block as any).color);
    return el;
  },
};

panel.tools = [myTool];
panel.renderers = [...genuiRenderers, statusBadgeRenderer];
```

See `packages/web-agent-charting/src/lit/chart-renderer.ts` in
`@cuatoi/web-agent-charting` for a shipped, real-world `BlockRenderer`.

---

## Config fields & defaults

| Field | Type | Default when unset |
|---|---|---|
| `AgentConfig.tools` | `(ctx: ToolContext) => CustomToolDef[]` | `defaultTools(ctx)` |
| `AgentConfig.skills` | `SkillDef[]` | `coreSkills()` |

`customTools`/`customSkills` **no longer exist** on `AgentConfig` — they were
replaced by `tools`/`skills` above.

---

## Disabling a capability & prompt pruning

Omitting a builder removes both the tool **and** its system-prompt guidance —
`buildSystemPrompt()` prunes operating-rules and the `# Presenting rich UI`
section based on which tool *names* are present in `toolNames`
(`packages/web-agent-core/src/prompt/system-prompt.ts:40-102`). For example, a
read-only toolset (no `click`/`fill`/`select_option`/`wait_for`) drops the
DOM-write operating rules entirely, and a toolset with neither `show_chart`
nor `show_generative_ui` drops the whole rich-UI section.

---

## Real host examples

- **cat-store (charting present)** — `apps/cat-store/src/web/agent-panel-config.ts:14-15,201-210,227-241`
- **docs-site (charting absent)** — `apps/docs-site/src/docs-embed.ts:4-13,53,65-66`

Compare them to see the present and absent patterns in full, including the
tree-shaking result (`apps/docs-site/src/bundle-absence.test.ts` asserts that
`chart.js` code is entirely absent from the docs-site bundle).

---

## Cross-links

- [Tools & data sources](./tools.md) — built-in tool reference
- [Custom tools](./custom-tool.md) — `CustomToolDef`/`ToolOutcome`/`ToolContext` shapes
- [Skills](./skill.md) — `search_skills`/`load_skill`, `SkillDef` shape
- `@cuatoi/web-agent-charting` — the charting package in detail
- [Generative UI](./generative-ui.md) — `show_generative_ui`, `RenderableBlock`
