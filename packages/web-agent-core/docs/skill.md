---
title: Skills (search_skills, load_skill, create_skill & delete_skill)
---

# Skills (search_skills, load_skill, create_skill & delete_skill)

A skill is a named, on-demand instruction block. The model finds skills with
`search_skills` and loads the full definition with `load_skill`. Core injects
the definition into the conversation only when the model asks for it, not
upfront in the system prompt, so the prompt stays smaller. When the host
configures a writable [`SkillRegistry`](#the-skillregistry-seam), the model
can also save a new skill itself with `create_skill`, and delete one with
`delete_skill`.

---

## SkillDef shape

From `packages/web-agent-core/src/tools/skill-def.types.ts:5-31`:

```ts
interface SkillDef {
  name: string;
  description: string;
  definition: string;   // markdown body loaded on demand

  command?: boolean;               // invocable as /name
  argumentHint?: string;           // shown after the name, e.g. "[month]"
  aliases?: string[];              // extra names that resolve to this skill
  disableModelInvocation?: boolean; // hide from the model, keep for the user
  owner?: string;                  // agent id; absent = shared
}
```

The last five fields are optional. A skill that sets none behaves exactly as it
always has: the model reaches it with `load_skill`, and the user never sees it.

---

## Slash commands

Set `command: true` to let the user run a skill by typing `/name` in the
composer. Core resolves the name, sends the skill's `definition` as the prompt,
and shows `/name` as the user's message.

```ts
{
  name: "summary",
  description: "Summarise this month's orders",
  definition: "Summarise the orders for the month the user names…",
  command: true,
  argumentHint: "[month]",
  aliases: ["sum"],
}
```

- **`argumentHint`** is display text only. There is no substitution and no
  template language. Anything typed after the name is appended to the
  definition as a separate paragraph.
- **`aliases`** resolve to the same skill. They are matched when the user types
  and when core checks for name collisions.
- **`disableModelInvocation: true`** hides the skill from `search_skills`,
  `load_skill` and the `# Skills` prompt section. The user can still run it with
  `/name`. Use it for a command that only makes sense when a person asks for it.

Core ships two commands of its own:

| Command | What it does |
|---|---|
| `/compact` | Summarises the conversation to free up context |
| `/new` (or `/clear`) | Starts a fresh session |

When scheduling is on, core also adds `/schedule`, `/schedule-list` and
`/schedule-cancel`. See [Scheduler commands](./scheduler.md#scheduler-commands).

Core's own names — `compact`, `new` and `clear` — are reserved
(`src/commands/slash-commands.ts:37-39`). A skill cannot claim them. If a skill
is named `new`, or has `clear` as an alias, `/new` and `/clear` still run
core's reset, and core logs
`skill '<name>' cannot claim reserved command '<name>'; core keeps it`. The skill
still appears in the command list, and it still answers to any of its names
that are not reserved (`src/commands/slash-commands.ts:60-70`). This rule also
covers skills from a `SkillRegistry`, so a stored skill cannot make `/new`
unreachable.

For every other name, the first skill that registers it wins.

The model gets the compaction action as the `compact_conversation` tool, which
requests a compaction that runs when the current turn ends. The tool takes two
optional inputs:

| Input | Type | What it does |
|---|---|---|
| `confirmation` | boolean | Set `true` only when the user or a skill asked for compaction. Without it the tool compacts nothing and asks who requested it. |
| `followUp` | string | The prompt to run in the next turn, once the context is compacted. Recorded only on an accepted request. |

The gate stops the agent compacting on its own initiative, because compaction is
lossy. A skill that needs room before a long process sets `confirmation: true`
and `followUp` in one call, so it pays nothing for the gate. `/compact` is not
gated — a person who types it has by definition asked.

`/new` and `/clear` are **user-only** and are never exposed to the model.

---

## search_skills tool

```ts
search_skills({ query: string })
```

Case-insensitive substring match on `name` + `description` across the merged
skill registry. Returns matching `"name — description"` lines separated by
newlines, or `"No skills matched the query."` if nothing matches.

Example:

```
search_skills({ query: "chart" })
→ "chart — Chart.js 2.x config shape, supported types …"
```

---

## load_skill tool

```ts
load_skill({ name: string })
```

Exact name match. Returns the full `skill.definition` (markdown).

`name` is required. A call with no `name`, or with an empty one, is rejected:
the tool returns an error that says the `name` argument is required, and does
not attempt a lookup. A call with a name that matches no skill returns an error
with a hint to use `search_skills`. Both failures set the tool result's error
flag, so the model sees them as failures rather than as content.

Example:

```
load_skill({ name: "chart" })
→ "# Chart Skill\nUse `show_chart` to render charts …"
```

---

## The SkillRegistry seam

`config.skills` is a synchronous array, so skills held in browser storage or
on a host's server cannot go through it. `SessionConfig.skillRegistry` is a
second, async seam:

```ts
interface SkillRegistry {
  list(): Promise<SkillDef[]>;                 // required
  get(name: string): Promise<SkillDef | undefined>;  // required
  save?(skill: SkillDef, options?: { shared?: boolean }): Promise<void>; // optional — present = writable
  remove?(name: string): Promise<void>;        // optional
  supportsOwner?: boolean;                     // optional — true = create_skill offers `shared`
  ownerLabel?: string;                         // optional — owner's display name for the confirm
}
```

Core reads it once at session start, merges the result **over** `config.skills`
(a name clash: the registry entry wins), and re-runs `initAgent()` so turn 1
has the skills in `ctx.skills` and the `# Skills` prompt section. A `list()`
that rejects is logged and contributes no skills; it never fails the session.

Core ships `LocalStorageSkillRegistry(namespace?)`, a `localStorage`-backed
registry:

```ts
import { LocalStorageSkillRegistry } from "@cuatoi/web-agent-core";

panel.skillRegistry = new LocalStorageSkillRegistry("cat-store");
```

**`save` and `remove` are optional — there is no separate writable flag.** A
registry that omits `save` is read-only, and that omission is exactly what
`skillTools(ctx)` checks to decide whether to offer `create_skill` (see
below). `remove` is checked the same way and gates `delete_skill`. A registry
can expose one without the other: with `save` only, the model can create but
not delete; with `remove` only, it can delete but not create. The model has no
tool to rename a skill.

**Owners are optional.** A registry that sets `supportsOwner: true` stores an
owner per skill. `create_skill` then adds an optional boolean `shared` to its
input schema and calls `save(skill, { shared })`, where `shared` is `false`
only when the model passed `shared: false`. `ownerLabel` is the owner's
display name, shown in the confirm summary. A registry without
`supportsOwner` gets no `shared` input and the one-argument `save(skill)`.
The registry decides what `shared: false` means and which skills `list()`
returns.

---

## create_skill tool

```ts
create_skill({ name: string, description: string, definition: string, shared?: boolean })
```

`shared` is in the schema only when `ctx.skillRegistry.supportsOwner` is `true`.

Saves a new skill, or overwrites an existing one, in the configured
`SkillRegistry`. **Present only when `ctx.skillRegistry?.save` is a
function** — a host with no registry, or a read-only one, never sees this
tool in the list sent to the model.

Before writing, the tool calls the host's `confirmInteraction` (the same
gate `domTools()` uses for "ask"-tier DOM interactions):

```ts
confirmInteraction({
  action: "create skill" | "overwrite skill",
  name: string,
  reason?: string,
  summary?: string,
})
```

`summary` is `Overwrite existing skill "<name>"` on an overwrite. Otherwise
it is `Create skill "<name>"`, or — for a registry with `supportsOwner` —
`Create skill "<name>" for all agents` or
`Create skill "<name>" for <ownerLabel> only`.

`action` is `"overwrite skill"` when `name` already matches an entry in
`ctx.skills`, and `"create skill"` otherwise — the confirmation always says
which case it is and, on an overwrite, what will be replaced. A host with no
`confirmInteraction` wired saves without asking, matching how an unwired
`domTools()` leaves "ask"-tier actions unconfirmed.

Outcomes:

- **Declined** — `registry.save` is never called, `ctx.skills` is unchanged,
  and the tool returns an error result telling the model the user declined.
- **Confirmed** — `registry.save` is called once with the trimmed
  `{ name, description, definition }`. On success, the same object is pushed
  into `ctx.skills` immediately, so `load_skill` and `search_skills` find it
  in the **same turn** — no new session required.
- **`registry.save` rejects** — the tool returns an error naming the
  failure; the session keeps running and `ctx.skills` is not touched.
- **An empty or whitespace-only `name`, `description` or `definition`** is
  rejected before `confirmInteraction` or `registry.save` is called.

The `# Skills` prompt section itself is part of the static system-prompt
block and is **not** rebuilt mid-turn — it refreshes only at the next
`initAgent()` (a new session, or a reload). This keeps the prompt-cache
breakpoint stable within a turn.

---

## delete_skill tool

```ts
delete_skill({ name: string })
```

Deletes a saved skill from the configured `SkillRegistry`. **Present only when
`ctx.skillRegistry?.remove` is a function** — a host with no registry, or one
that cannot remove, never sees this tool in the list sent to the model.

Before deleting, the tool calls the host's `confirmInteraction`, the same gate
`create_skill` uses:

```ts
confirmInteraction({
  action: "delete skill",
  name: string,
  summary: `Delete skill "<name>"`,
})
```

A host with no `confirmInteraction` wired deletes without asking, matching how
an unwired `domTools()` leaves "ask"-tier actions unconfirmed.

Outcomes:

- **An empty or whitespace-only `name`** is rejected before
  `confirmInteraction` or `registry.remove` is called.
- **A name that is not in `ctx.skills`** returns an error naming the skill and
  pointing the model at `search_skills`. Nothing is removed.
- **Declined** — `registry.remove` is never called, `ctx.skills` is unchanged,
  and the tool returns an error telling the model the user declined.
- **Confirmed** — `registry.remove` is called once with the trimmed name. On
  success the entry is spliced out of `ctx.skills` immediately, so `load_skill`
  and `search_skills` stop finding it in the **same turn**.
- **`registry.remove` rejects** — the tool returns an error naming the failure;
  the session keeps running and `ctx.skills` is not touched.

---

## coreSkills()

Two built-in skills ship with core
(`packages/web-agent-core/src/skills/default-skills.ts`), returned by the
`coreSkills()` helper:

| Name | Description |
|------|-------------|
| `query_data_advanced` | Guide for complex data queries: MongoDB-style filters, aggregation (groupBy + measures), sorting, pagination with examples. |
| `present_to_user` | When and how to call `show_generative_ui` (and `show_chart`, if composed) using the intent→render→confirm pattern. See [Generative UI](./generative-ui.md). |

The `multi_step_ui` skill is **not** part of `coreSkills()` — it moved to
`@cuatoi/web-agent-dom` with the DOM tools it describes, and ships as
`domSkills()`. Hosts that wire `domTools()` spread `domSkills()` too.

The `chart` skill is **not** part of `coreSkills()` — it ships with the
optional `@cuatoi/web-agent-charting` package's `chartingSkills()` and is
only present on hosts that compose it in (e.g. `cat-store`; this docs site
does not). See the `@cuatoi/web-agent-charting` package docs.

---

## Registering skills

Set `AgentConfig.skills: SkillDef[]` (or `panel.skills` / `bubble.skills` on
the lit UI). This is the **full** skill list for the agent — core no longer
merges anything in automatically, so a host that wants the built-ins spreads
`coreSkills()` alongside its own:

```ts
import { coreSkills } from "@cuatoi/web-agent-core";

panel.skills = [
  ...coreSkills(),
  {
    name: "product-catalog",
    description: "Guide for querying the product catalog data source.",
    definition: `# Product Catalog Queries\n\nUse \`query_data\` with source "products" …`,
  },
];
```

---

## Example: docs-guide skill

The docs-site defines its own skill in
`apps/docs-site/src/docs-guide-skill.ts`:

```ts
export const docsGuideSkill: SkillDef = {
  name: "docs-guide",
  description:
    "Guide the user through Web Agent docs. Determines their UI framework (Lit 1 vs Lit 3) " +
    "before searching so results are version-correct.",
  definition: `# Docs Search Guide\n\n…`,
};
```

This skill teaches the docs-site agent to ask about the user's UI framework
before routing them to the correct registry page.

---

## Cross-links

- [Custom tools](./custom-tool.md) — host-defined tools
- [Generative UI](./generative-ui.md) — `present_to_user` skill
- `chart` skill — ships with `@cuatoi/web-agent-charting`
- [Composing tools, skills & renderers](./composition.md) — `SkillDef`/`coreSkills()` merge behavior
