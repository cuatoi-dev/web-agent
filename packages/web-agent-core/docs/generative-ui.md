---
title: Generative UI (show_generative_ui & present_to_user)
---

# Generative UI (show_generative_ui & present_to_user)

The agent presents rich UI through tool calls, not fenced code blocks. Core
ships `show_generative_ui` (buttons and forms). The optional
`@cuatoi/web-agent-charting` package adds `show_chart` (Chart.js charts).
Both emit `RenderableBlock` objects placed inline in the chat at the tool-call
position.

---

## present_to_user skill

The model should call `load_skill("present_to_user")` to learn the correct
interaction pattern. The skill (defined in
`packages/web-agent-core/src/skills/default-skills.ts`) teaches:

1. Send a short intro line describing what you are about to show.
2. Call the tool — the block renders inline at that position.
3. Send a brief closing line.

**On error:** the tool returns an `Invalid input for show_generative_ui: <reason>.`
message that names the failing field path. Read
it, fix the offending field, and call the tool again. Do not fall back to fenced
blocks or markdown tables.

---

## show_generative_ui tool

Defined in `packages/web-agent-core/src/tools/show-generative-ui.ts`.

Input schema (top level):

```ts
{
  type: string;             // "buttons" or "form"
  // ButtonsBlock fields:
  options?: { label: string, prompt: string }[];
  // FormBlock fields:
  id?: string;
  title?: string;
  fields?: { kind: string, name: string, label: string, ...}[];
  submit_label?: string;
}
```

Returns `"ui rendered"` + a `RenderableBlock` on success; a field-path error
string on invalid spec.

---

## ButtonsBlock

Schema from `packages/web-agent-core/src/ui-blocks/schema.ts`:

```ts
{
  type: "buttons";
  options: {
    label: string;
    prompt: string;   // max 500 chars — sent to agent when button is clicked
  }[];   // max 6 options
}
```

Rendered by the `agent-buttons-block` custom element
(`packages/web-agent-lit/src/ui-blocks/renderer/buttons-block.ts`). When the
user clicks a button, its `prompt` string is submitted to the agent as a new
user message, prefixed `[ui_action:button] `
(`packages/web-agent-core/src/ui-blocks/bridge.ts`).

---

## FormBlock

```ts
{
  type: "form";
  id: string;          // must be unique per turn
  title?: string;
  fields: FormField[];
  submit_label?: string;
}
```

**FormField kinds** (discriminated union):

| `kind` | Extra fields |
|--------|-------------|
| `"text"` | `placeholder?`, `required?` |
| `"number"` | `min?`, `max?`, `required?` |
| `"select"` | `options: string[]`, `default?: string` |
| `"checkbox"` | `default?: boolean` |
| `"date"` | `required?` |

All kinds have `name: string` and `label: string`.

Form submission sends the collected field values back to the agent as
`[ui_action:form_submit id=<id>]` followed by the values as pretty-printed
JSON (`formSubmitToMessage()`, `packages/web-agent-core/src/ui-blocks/bridge.ts`).

---

## Interleaving text and UI

Within a single turn the model can send text and tool calls in any order; blocks
render at their call position in the message list. This lets the model narrate
before and after a chart or form:

```
[assistant text] "Here is the monthly breakdown:"
[tool call]      show_chart({ config: ... })   → renders chart here
[assistant text] "The spike in March reflects the product launch."
```

Block placement is keyed by `toolCallId` via `_onToolBlock` in `ToolContext`.

---

## show_chart (brief)

`show_chart({ title?, config })` — full details in the `@cuatoi/web-agent-charting`
package docs. Cross-calls `load_skill("chart")` for the config shape.

---

## ErrorCardBlock

`ErrorCardBlock` is a block type that the Lit renderer shows as an error card
when it receives one:

```ts
{
  type: "error_card";
  raw: string;    // the raw tool output
  error: string;  // validation message
}
```

Core does not create this block. An invalid `show_generative_ui` spec does not
render a block. The tool returns an error result to the model instead, and the
model can retry with a corrected spec.

---

## blockGuidelines

`AgentConfig.blockGuidelines?: string` is accepted, but core does not add it
to the system prompt. To give the model host-specific UI guidelines (for
example "always use primary brand colors in charts"), use
`AgentConfig.appendSystemPrompt`.

---

## Cross-links

- `show_chart` — see the `@cuatoi/web-agent-charting` package docs
- [Skills](./skill.md) — `present_to_user` and `load_skill`
- [Composing tools, skills & renderers](./composition.md) — registering a custom block renderer
