---
title: Tool providers (async tool sources)
---

# Tool providers

`config.tools` is synchronous, so tools that must be discovered over a network
cannot come from it. `SessionConfig.toolProviders` is the async seam next to
it (`src/config.types.ts:151`, inherited from `AgentConfig`).

## The interface

From `packages/web-agent-core/src/tools/types.ts:107-127`:

```ts
interface ToolProvider {
  name: string;                                   // short id, used in log and error text
  required: boolean;                              // true → a load failure is a hard startup error
  load(): Promise<CustomToolDef[]>;               // called once, at session start
  attachmentProviders?: AttachmentProvider[];     // merged once this provider has loaded
  hooks?: {
    onUserPrompt?: HookHandler<UserPromptPayload, UserPromptResult | void>;
    onPostTool?: HookHandler<PostToolPayload, PostToolResult | void>;
  };
  dispose?(): Promise<void> | void;               // called from the session's dispose()
}
```

A loaded provider's `onPostTool` handlers run before the host's, and later
handlers see an earlier handler's replaced outcome
(`src/controller-config.ts:33-52`). See
[the lifecycle hooks reference](./hooks.md) for the payload and result shapes.

Core exports the type and the loader from the package entry point
(`src/index.ts`): `loadToolProviders`, `RequiredToolProviderError`, and the
types `ToolProvider`, `ToolProviderFailure`, `LoadToolProvidersResult`.

## When `load()` runs

`loadConfiguredToolProviders()` (`src/controller.ts`) is awaited by
`initPromise` at session start. `updateConfig()` with a different
`toolProviders` array disposes every loaded provider (and the attachment
providers it registered), then loads the new list through the same function.
The same array loads nothing again. A load that a newer `updateConfig()`
replaced while it ran is dropped, and its providers are disposed. The
conversation is kept in every case.

## The `required` degrade rule

From `src/tools/tool-provider.ts:40-81`: a `required: false` provider that fails is
`console.warn`-logged and contributes no tools; the session continues.
A `required: true` provider that fails disposes every provider that already
loaded and throws `RequiredToolProviderError`; the session's `initPromise`
rejects and `state.error` is set (`src/controller.ts:176-185`).

## Providers load concurrently, and their tools come last

`loadToolProviders()` starts every `load()` in the same tick
(`src/tools/tool-provider.ts:47`), so a slow provider never serializes a fast one.
`src/controller-config.ts:196-235` appends provider tools **after** whatever
`config.tools` produced, and `buildTools` keeps the first tool of a duplicate
name — so a built-in of the same name wins.

## `toolProviders` versus `config.tools`

| | `config.tools` (`src/config.types.ts:112`) | `toolProviders` (`src/config.types.ts:151`) |
|---|---|---|
| Shape | sync factory `(ctx) => CustomToolDef[]` | `ToolProvider[]` with async `load()` |
| Use when | the host already holds the tools | the tools must be discovered (MCP, OpenAPI, DOM) |

## `dispose()`

Called from the session's `dispose()` (`src/controller.ts:243-255`), via
`Promise.allSettled` over the providers that loaded.

## Who implements this

`@cuatoi/web-agent-mcp` (`mcpToolProviders`), `@cuatoi/web-agent-openapi`
(`openApiToolProviders`), `@cuatoi/web-agent-dom` (`domTools`).
