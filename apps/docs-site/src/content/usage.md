---
title: Usage & Quick Start
---

# Usage & Quick Start

This page covers the minimal embed and the full `AgentConfig` reference.

---

## Quick start

Import the embed widget and place the `<web-agent-bubble>` custom element:

```html
<script type="module">
  import "@cuatoi/web-agent-lit/embed/web-agent-embed";
</script>
<web-agent-bubble></web-agent-bubble>
```

The embed script registers `<web-agent-bubble>`, which mounts a floating chat
bubble backed by the agent. Configure it via the `config` property:

```js
const bubble = document.querySelector("web-agent-bubble");
bubble.config = {
  baseURL: "/api/openai/v1",
  model: "your-model-id",
  maxIterations: 200,
  turnTimeoutMs: 120000,
  endpointType: "openai",
  thinking: { enabled: false },
  generation: { maxOutputTokens: 4096, maxRetries: 3 },
};
```

See [Embedding Web Agent](#/lit/embedding) for full mount details.

---

## AgentConfig reference

All fields from `packages/web-agent-core/src/config.ts`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `baseURL` | `string` | `"/api/openai/v1"` | Proxy endpoint for LLM calls |
| `model` | `string` | _(none — required)_ | Model identifier. Core ships no default; a session with no `model` throws at start. |
| `maxIterations` | `number` | `200` | Max tool-call steps per turn |
| `turnTimeoutMs` | `number` | `120000` | Per-turn timeout in ms |
| `wideSourceFieldThreshold` | `number` | `40` | A source with more fields than this needs an explicit `select` on a row query; without one, `query_data` returns an error naming the column count. Aggregates are unaffected. |
| `endpointType` | `"openai" \| "anthropic"` | `"openai"` | API format to use |
| `thinking` | `{ enabled: boolean, budgetTokens?: number }` | `{ enabled: false }` | Thinking mode (Anthropic endpoint only) |
| `generation` | `GenerationConfig` | `{ maxOutputTokens: 4096, maxRetries: 3 }` | Temperature, topP, seed, etc. |
| `cues` | `CuesConfig` | `{ enabled: true, speed: "slow" }` | Agent cursor behavior — see [Agent Cursor](#/core/action-cue) |
| `images` | `ImageConfig` | `{ maxDimension: 1024, maxBytes: 524288, quality: 0.82 }` | Image downscaling limits — see [Image Support](#/core/image-support) |
| `imageInput` | `boolean` | `true` | Enable/disable image attachment and `see` tool |
| `appendSystemPrompt` | `string \| undefined` | `undefined` | Extra instructions appended to the system prompt |
| `blockGuidelines` | `string \| undefined` | `undefined` | UI block guidelines appended to system prompt |
| `tools` | `(ctx: ToolContext) => CustomToolDef[]` | `defaultTools` | Full tool composition — usually set indirectly via the component's `tools` property (extra tools; merged with `defaultTools(ctx)` automatically) — see [Custom Tools](#/core/custom-tool) |
| `skills` | `SkillDef[]` | `coreSkills()` | Full skill composition — see [Skills](#/core/skill) |
| `sessionStore` | `SessionStore \| undefined` | `undefined` | Session persistence backend — see [Session Backend](#/core/session-backend) |
| `sessionNamespace` | `string \| undefined` | `undefined` | Auto-creates `IdbSessionStore` with this namespace |
| `hooks` | `AgentHooks \| undefined` | `undefined` | Lifecycle hooks (`onPreTool`, `onPostTool`, `onUserPrompt`, …) — see Fenced UI below |

---

## Endpoint types

- **`"openai"` (default)** — uses `@ai-sdk/openai-compatible`. Works with any
  OpenAI-compatible proxy: Ollama, LiteLLM, etc. The `thinking` config is
  ignored for this type.
- **`"anthropic"`** — uses `@ai-sdk/anthropic` directly. Supports thinking/
  extended budget tokens via `thinking: { enabled: true, budgetTokens: 10000 }`.

`defaultBaseURLFor(type)` returns the default proxy path:
- `"openai"` → `/api/openai/v1`
- `"anthropic"` → `/api/anthropic/v1`

---

## Proxy setup

The agent calls `baseURL` (default `/api/openai/v1`) from the browser. This
path must be reverse-proxied server-side to your actual LLM endpoint. The
agent never calls the LLM directly — it always goes through the proxy.

Example (Express):

```js
app.use("/api/openai/v1", createProxyMiddleware({
  target: "http://localhost:11434/v1",  // Ollama
  changeOrigin: true,
}));
```

---

## Fenced UI — interaction policies

Host apps mark DOM controls with `data-agent-permission` to set an interaction
policy for the agent:

- **`allow`** (default when absent) — the agent can operate the control freely.
- **`ask`** — the agent must be confirmed via an `onPreTool` hook before acting.
- **`block`** — the agent cannot operate the control; it returns a terminal
  "Blocked by interaction policy" message.

The attribute is inherited via `closest()` — set it on a `<fieldset>` or `<form>`
to fence a group of controls:

```html
<form data-agent-permission="block" data-agent-permission-reason="Admin only">
  <button>Delete user</button>
  <input name="admin-email" />
</form>
```

`AgentChatPanel` always installs a default `onPreTool` hook that shows a confirm
dialog for `"ask"`-tier `click`/`fill`/`select_option` calls — no host wiring is
required to get a working confirmation UI. A host's own `panel.hooks.onPreTool`
is MERGED with this default (run alongside it, not replacing it), so a host can
add its own pre-tool logic (logging, an extra guard) without losing the built-in
confirmation:

```ts
panel.hooks = {
  onPreTool: async (p) => {
    console.log(`about to run ${p.name}`, p.input);
  },
};
```

---

## Cross-links

- [Embedding Web Agent](#/lit/embedding) — full mount options
- [Session Backend](#/core/session-backend) — session persistence
- [Image Support](#/core/image-support) — `imageInput` and `images` config
- [Theming](./theming.md) — CSS custom properties
