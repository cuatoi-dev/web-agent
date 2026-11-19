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

See [Embedding Web Agent](../../../../packages/web-agent-lit/docs/embedding.md) for full mount details.

---

## AgentConfig reference

Fields from `packages/web-agent-core/src/config.ts` and `config.types.ts`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `baseURL` | `string` | `"/api/anthropic"` | Proxy endpoint for LLM calls |
| `model` | `string` | _(none — required)_ | Model identifier. Core ships no default; a session with no `model` throws at start. |
| `maxIterations` | `number` | `200` | Max tool-call steps per turn |
| `turnTimeoutMs` | `number` | `120000` | Per-turn timeout in ms |
| `wideSourceFieldThreshold` | `number` | `40` | A source with more fields than this needs an explicit `select` on a row query; without one, `query_data` returns an error naming the column count. Aggregates are unaffected. |
| `endpointType` | `"openai" \| "anthropic" \| "gemini" \| "mock" \| (string & {})` | `"anthropic"` | API format to use |
| `thinking` | `{ enabled: boolean, budgetTokens?: number }` | `{ enabled: false }` | Thinking mode |
| `generation` | `GenerationConfig` | `{ maxOutputTokens: 32000, maxRetries: 3 }` | Temperature, topP, seed, etc. |
| `cues` | `CuesConfig` | `{ enabled: true, speed: "slow" }` | Agent cursor behavior — see [Agent Cursor](../../../../packages/web-agent-core/docs/action-cue.md) |
| `imageInput` | `boolean` | `true` | Enable/disable image attachment and `see` tool — see [Image Support](../../../../packages/web-agent-core/docs/image-support.md) (image downscaling limits live on `<agent-chat-panel>`'s `images` property) |
| `appendSystemPrompt` | `string \| undefined` | `undefined` | Extra instructions appended to the system prompt |
| `blockGuidelines` | `string \| undefined` | `undefined` | Accepted by `AgentConfig`; see [Custom Tools](../../../../packages/web-agent-core/docs/custom-tool.md) |
| `tools` | `(ctx: ToolContext) => CustomToolDef[]` | `defaultTools` | Full tool composition — usually set indirectly via the component's `tools` property (extra tools; merged with `defaultTools(ctx)` automatically) — see [Custom Tools](../../../../packages/web-agent-core/docs/custom-tool.md) |
| `skills` | `SkillDef[] \| undefined` | `undefined` | Skill composition — see [Skills](../../../../packages/web-agent-core/docs/skill.md) |
| `sessionStore` | `SessionStore \| undefined` | `undefined` | Session persistence backend (used when `persist: true`) — see [Session Backend](../../../../packages/web-agent-core/docs/session-backend.md) |
| `sessionNamespace` | `string \| undefined` | `undefined` | Auto-creates `IdbSessionStore` with this namespace when `persist: true` |
| `hooks` | `AgentHooks \| undefined` | `undefined` | Lifecycle hooks (`onPreTool`, `onPostTool`, `onUserPrompt`, …) |

---

## Endpoint types

Core ships built-in `fetch` providers with no external LLM SDK:

- **`"anthropic"` (default)** — calls the Anthropic Messages API. Supports
  extended thinking via `thinking: { enabled: true, budgetTokens: 10000 }`.
- **`"openai"`** — calls any OpenAI-compatible Chat Completions proxy
  (Ollama, LiteLLM, etc.).
- **`"gemini"`** — calls the Gemini generateContent API.

`defaultBaseURLFor(type)` (`packages/web-agent-core/src/config.ts:26-30`) returns the default proxy path:
- `"anthropic"` → `/api/anthropic`
- `"openai"` → `/api/openai/v1`
- `"gemini"` → `/api/gemini`

---

## Proxy setup

The agent calls `baseURL` (default `/api/anthropic`) from the browser. This
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
- **`ask`** — the agent must be confirmed via `confirmInteraction` before acting.
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

`AgentChatPanel` exposes a built-in confirm dialog via `panel.confirmInteraction(detail)`
(`packages/web-agent-lit/src/chat-ui/chat-panel-fields.ts:48-52`). Pass it into
`domTools({ confirmInteraction: (d) => panel.confirmInteraction(d) })` so
`"ask"`-tier `click`/`fill`/`select_option` calls prompt the user. You can still
attach `panel.hooks.onPreTool` for logging or extra guards:

```ts
panel.hooks = {
  onPreTool: async (p) => {
    console.log(`about to run ${p.name}`, p.input);
  },
};
```

---

## Cross-links

- [Embedding Web Agent](../../../../packages/web-agent-lit/docs/embedding.md) — full mount options
- [Session Backend](../../../../packages/web-agent-core/docs/session-backend.md) — session persistence
- [Image Support](../../../../packages/web-agent-core/docs/image-support.md) — `imageInput` and `images` config
- [Theming](./theming.md) — CSS custom properties
