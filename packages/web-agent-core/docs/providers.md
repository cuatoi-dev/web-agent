---
title: Endpoint types
---

# Endpoint types

`AgentConfig.endpointType` selects the transport core uses to reach a model.
Four values ship with the package. You can add your own by registering a
provider; see [Custom providers](#custom-providers).

## Built-in endpoint types

| `endpointType` | Implementation | Wire format |
|---|---|---|
| `"anthropic"` (default) | `AnthropicLanguageModel` (`src/transport/anthropic-provider.ts:23`) | Anthropic Messages, built in this package (`src/transport/wire.types.ts`) |
| `"openai"` | `OpenAILanguageModel` (`src/transport/openai-provider.ts:32`) | OpenAI chat completions, translated to and from the Anthropic shape (`src/transport/openai-to-anthropic.ts`, `src/transport/openai-wire.types.ts`) |
| `"gemini"` | `GeminiLanguageModel` (`src/transport/gemini-provider.ts:33`) | Google Gemini `generateContent`, translated to and from the Anthropic shape (`src/transport/gemini-to-anthropic.ts`, `src/transport/gemini-wire.types.ts`) |
| `"mock"` | `createMockProvider()` — deterministic, network-free; drive it with `setMockScript()` | none — no network |

Core depends on no vendor software development kit (SDK). All three real
providers send their requests through `requestJson()` in
`src/transport/anthropic-request.ts`, which calls `fetch` directly. Every call
sends one request and reads one complete response.

## Retry and timeout behavior

All three real providers are automatically wrapped with retry middleware: 5
retries by default, with fixed back-off delays of 1s, 1s, 2s, 3s, 5s — not
exponential (`BACKOFF_SEQ` and `withRetry` in `src/transport/middleware.ts`).
This wrapping is part of the registry's built-in entries. A provider you
register yourself is not wrapped; compose `withRetry` if you want the same
behavior (see [Custom providers](#custom-providers)).

One setting guards each attempt:

| Setting | Default | What it does |
|---|---|---|
| `requestTimeoutMs` | 900000 | hard deadline per request attempt |

The deadline is 15 minutes from the start of the attempt. Nothing restarts it
while the response arrives, so a response that is not complete by then is
aborted. Every retry has its own full deadline. An attempt that reaches the
deadline is a retryable failure and goes through the same attempt loop and
back-off as any other transport error. Compaction uses the same default unless
you give it its own timeout. The default is in `DEFAULT_CONFIG`
(`src/config.ts`), and it is a plain `AgentConfig` field you can override
(`src/config.types.ts`).

### Empty responses

The retry middleware retries an attempt that returns no content, because an
incomplete response with nothing in it is a failed attempt. There is one
exception. When the model ends its turn normally (Anthropic `end_turn` or
`stop_sequence`, mapped to the finish reason `"stop"`), the attempt is a
completed turn, even with no content, and core does not retry it
(`isEmptyResult` in `src/transport/middleware.ts`).
A response cut off at the token limit (`"length"`) or with an unknown finish
reason is still retried.

Core keeps the empty assistant message in the conversation, and the session
shows a notice with a Retry action. See
[Retry the last turn](./session-handling.md#retry-the-last-turn). Core removes
empty assistant messages from the next request it sends, so the model never
receives them (`src/transport/message-filters.ts:18-24`).

### Request bodies

The Anthropic and OpenAI providers always send `"stream": false` in the request
body (`src/transport/anthropic-provider.ts`, `src/transport/openai-provider.ts`).
The real APIs treat a missing field as `false`, but a gateway can read a missing
field as a request for an event stream and return a server-sent-events body
that core cannot read.
The Gemini provider calls the `generateContent` endpoint, which always returns
one complete response.

## Choosing `path` / `baseURL`

Core builds each request URL itself, as `baseURL + path`
(`send` in `src/transport/anthropic-request.ts`). Each provider owns its own suffix, so
the `path` / `baseURL` you configure must differ:

- **Anthropic** — the provider appends `/v1/messages`
  (`src/transport/anthropic-provider.ts:133,162`) → set
  `path = "/api/anthropic"` (no trailing `/v1`). If you do include `/v1`, the
  provider strips it (`src/transport/anthropic-provider.ts:176`), so both forms
  reach the same URL.
- **OpenAI** — the provider appends `/chat/completions`
  (`src/transport/openai-provider.ts:163,212`) → set
  `path = "/api/openai/v1"` (include `/v1`).
- **Gemini** — the provider appends
  `/v1beta/models/{model}:generateContent`
  (`src/transport/gemini-provider.ts`) → set `path = "/api/gemini"`
  (no `/v1`). The model id goes in `model`, not in the path.

If you use `/api/openai` without the `/v1`, core sends the request to
`/api/openai/chat/completions`, which returns 404.

These are also the defaults. `defaultBaseURLFor()` returns `/api/anthropic` for
`"anthropic"`, `/api/openai/v1` for `"openai"`, and `/api/gemini` for
`"gemini"` (`src/config.ts:26-30`).

## Live host transport configuration

The host apps and the browser extension set these defaults. Paths are relative
to the site that serves the host, except in the extension, which calls the
local gateway by full URL.

| Host | `endpointType` | `path` (baseURL) | `model` | Source |
|---|---|---|---|---|
| cat-store | `"anthropic"` | `/api/anthropic` | `sonnet` | `apps/cat-store/src/web/agent-panel-config.ts:54-61`, applied at `:181` |
| docs-site | `"openai"` | `/api/openai/v1` | `sonnet` | `apps/docs-site/src/docs-embed.ts:55-56`, `:160-161` |
| web-agent-browser | `"anthropic"` | `http://localhost:30000/api/anthropic` | `sonnet` | `packages/web-agent-browser/brand/model.yml:22-29` |

cat-store's provider switcher offers four entries
(`apps/cat-store/src/web/agent-panel-config.ts`, the `PROVIDER_ENTRIES` list):
Anthropic and OpenAI on `sonnet`, Gemini on `gemini-flash-lite-latest`, plus
**Any model**. **Any model** uses the host's `"fallback-chain"` endpoint type,
which tries the other three routes in order. cat-store registers that endpoint
type itself (`apps/cat-store/src/web/any-model-chain.ts`, `ANY_MODEL_CHAIN`
and the `providerRegistry.register` call below it).

The browser extension uses the first entry of the brand's model list on a fresh
profile, and the options page offers the whole list
(`packages/web-agent-browser/src/lib/brand-models.ts:17-31`). A value the user
saves replaces the default, field by field
(`packages/web-agent-browser/src/lib/settings.ts:18-39`). When the brand has no
model list, the compiled presets in
`packages/web-agent-browser/src/lib/presets.ts:16-23` apply.

In the mock end-to-end tier, all three hosts replace the transport with
`type: "mock"`
(`apps/cat-store/src/web/agent-panel-config.ts:187-194`,
`apps/docs-site/src/docs-embed.ts:150-158`,
`packages/web-agent-browser/src/sidepanel.ts:114-119`).

### Reverse proxy routes

The browser never holds a provider API key. The host apps call three routes on
their own origin, and a reverse proxy forwards each one to the model provider
and adds the key on the server side. Any reverse proxy can do this, for example
Apache, nginx, Caddy or Traefik.

Set up one route per provider:

| Route the browser calls | Forward to | Header the proxy sets |
|---|---|---|
| `/api/anthropic/v1/*` | `<ANTHROPIC_URL>/v1/*` | `X-Api-Key: <ANTHROPIC_API_KEY>` and `Anthropic-Version: 2023-06-01` |
| `/api/openai/v1/*` | `<OPENAI_URL>/v1/*` | `Authorization: Bearer <OPENAI_API_KEY>` |
| `/api/gemini/*` | `<GEMINI_URL>/*`, with the rest of the path unchanged | `x-goog-api-key: <GEMINI_API_KEY>` |

For each route, the proxy must:

1. Strip the route prefix and forward the rest of the path, as the table shows.
2. Remove the `Origin` header and any auth header the client sent, then set the
   provider's auth header from a server-side secret. Keep the keys in the
   proxy's environment or secret store, never in the proxy config file.
3. Reject the request with `401 Unauthorized` unless the route's own auth
   header carries the gateway key, `WEB_AGENT_TOKEN`:
   `Authorization: Bearer <key>` (openai), `x-api-key: <key>` (anthropic),
   `x-goog-api-key: <key>` (gemini). Reject every request when that key is
   not set, so the proxy fails closed.

cat-store and docs-site add that header in their `fetch` wrapper
(`apps/cat-store/src/web/gateway-auth.ts`,
`apps/docs-site/src/gateway-auth.ts`). The extension sends the brand's
default key from `brand/model.yml`, or the user's key in its place
(`packages/web-agent-browser/src/lib/auth-headers.ts`).

## Custom providers

You can add your own `endpointType`. The package entry point exports
`providerRegistry`, the three built-in factory functions
(`createAnthropicLanguageModel`, `createOpenAILanguageModel`,
`createGeminiLanguageModel`), the `ProviderFactory` type, `wrapProvider`, and
`withRetry`. A host application can import any of them.

A custom provider is a factory. It receives the agent config and an optional
`fetch` override, and it returns a `LanguageModel`:

```ts
type ProviderFactory = (
  cfg: AgentConfig,
  opts?: { fetch?: typeof fetch },
) => LanguageModel;
```

`endpointType` accepts any string, so you can register under a name of your
choice. The editor still suggests the built-in names first.

### Register a provider

```ts
import { providerRegistry } from "@cuatoi/web-agent-core";

providerRegistry.register("my-gateway", (cfg, opts) => {
  // return a LanguageModel
});
```

Register before the session starts. After registration, set
`panel.type = "my-gateway"`, or `endpointType: "my-gateway"` when you build a
session directly, and the agent uses your provider.

### Wrap a built-in provider

The simplest custom provider wraps a built-in one and changes one thing. Pass a
custom `fetch` to the factory to change a header, the base URL, or a request
body field:

```ts
import { createAnthropicLanguageModel, providerRegistry } from "@cuatoi/web-agent-core";

providerRegistry.register("my-gateway", (cfg, opts) => {
  const fetchWithAuth: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set("X-API-Key", await getToken());
    return (opts?.fetch ?? fetch)(url, { ...init, headers });
  };
  return createAnthropicLanguageModel(
    { ...cfg, baseURL: "https://my-gateway.example.com" },
    { fetch: fetchWithAuth },
  );
});
```

Change the base URL in the config you pass to the factory, change headers in
the custom `fetch`, or change request body fields by editing `init.body`
before you forward it.

### Compose several providers

`wrapProvider` composes middleware around one model. To combine several
providers — for example a fallback chain — write a factory that returns one
`LanguageModel` which delegates to others:

```ts
import {
  createAnthropicLanguageModel,
  createOpenAILanguageModel,
  providerRegistry,
  withRetry,
  wrapProvider,
} from "@cuatoi/web-agent-core";

providerRegistry.register("combo", (cfg, opts) => {
  // Build each model, wrapped with the same retry middleware the registry
  // applies to its built-in entries.
  const primary = wrapProvider(createAnthropicLanguageModel(cfg, opts), withRetry(cfg));
  const backup = wrapProvider(createOpenAILanguageModel(cfg, opts), withRetry(cfg));

  return {
    provider: "combo",
    modelId: cfg.model,
    supportedUrls: {},
    async generate(params) {
      try {
        return await primary.generate(params);
      } catch (err) {
        return backup.generate(params);
      }
    },
  };
});
```

`withRetry` is a middleware, not a model. Wrap each model with retry behavior
the same way the registry does, so a composed provider keeps the built-in
timeout and retry guarantees.

### Built-in fallback chain

For the common case — try an ordered list of provider-and-model entries and
return the first success — core ships `createFallbackProviderFactory`, so a
host does not need to hand-roll the pattern above.

```ts
import {
  createFallbackProviderFactory,
  providerRegistry,
  type FallbackChainEntry,
} from "@cuatoi/web-agent-core";

const CHAIN: FallbackChainEntry[] = [
  { endpointType: "anthropic", model: "sonnet", baseURL: "/api/anthropic" },
  { endpointType: "openai", model: "sonnet", baseURL: "/api/openai/v1" },
];

providerRegistry.register("my-chain", createFallbackProviderFactory(CHAIN));
```

Set `AgentConfig.endpointType` to `"my-chain"` to select it. The chain keeps
one cursor, sticky in memory for the page load and never persisted to
storage — it moves to the next entry on a failure and does not reset on a new
chat session. Each entry gets exactly one complete-result attempt and keeps the
transport's hard `requestTimeoutMs` deadline (default 900000, 15 minutes);
failed entries are not retried (`modelFor` in
`src/transport/fallback-provider.ts`).

A failed attempt falls back to the next entry. A response that ends normally
with no content is not a failure: the chain returns it and does not try the next
entry. A user cancellation is rethrown and does not advance the cursor, so a
completed tool call is never re-executed.

Every fallback is reported through the session's `provider:fallback` event
(`AgentSession.subscribeEvents`), naming which entries failed and which
entry answered. It never appears in the conversation.

## Customizing authentication with fetch injection

Hosts can supply a custom `fetch` implementation to intercept outgoing model
API requests and inject authentication headers or perform request logging.
The library calls the function you provide; it never reads, stores, or
defaults a credential.

### Using `<agent-chat-panel>`

`fetch` is a JavaScript property on `AgentChatPanel`. It cannot be set as an
HTML attribute, because it is a function. Set it from code:

```js
const panel = document.querySelector("agent-chat-panel");
panel.fetch = async (url, init) => {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${await getToken()}`);
  return window.fetch(url, { ...init, headers });
};
```

### Timing guarantees

- **Before session start**: Set `panel.fetch` before the panel creates its
  session (or before the first `send`), and every turn uses the custom fetch.
- **Dynamic update**: Set `panel.fetch` on an existing active panel, and the
  session configuration updates through `updateConfig()`. The next turn uses
  the custom fetch.

### Using `createAgentSession` directly

Hosts building a custom UI pass `fetch` directly in `SessionConfig`:

```js
const session = createAgentSession({
  model: "my-model",
  endpointType: "anthropic",
  fetch: async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${await getToken()}`);
    return window.fetch(url, { ...init, headers });
  },
});
```

> **Note**: Always retrieve tokens dynamically (for example `await
> getToken()`). The library does not hold or persist authentication
> credentials.
