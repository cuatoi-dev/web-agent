---
title: MCP lifecycle and failures
---

# MCP lifecycle and failures

## One provider per server — and why OpenAPI is different

`mcpToolProviders` returns `servers.map(…)` — one `ToolProvider` per server,
each carrying that server's `name` and `required`
(`src/tool-providers.ts:28-32`; test `src/tool-providers.test.ts:23-34`).

`openApiToolProviders` returns **one** provider for the whole source list
(`packages/web-agent-openapi/src/tool-providers.ts:23-40`). The reason, from
that file's own comment: a tool name claimed by one source is refused to a
later source. Enforcing that rule needs a view across every source, and a
per-source provider cannot have that view. MCP has no cross-server naming rule
to enforce, because core handles collisions generically (see below). A
per-server provider is therefore the better fit: each one reports its own name
in errors and disposes only its own connection.

See core's [`ToolProvider`](../../web-agent-core/docs/tool-provider.md) seam
page for the interface itself, rather than repeating it here.

## Providers load once, at session start, concurrently

`loadToolProviders` runs `Promise.allSettled(providers.map((p) => p.load()))`
(`packages/web-agent-core/src/tools/tool-provider.ts:47`).
`loadConfiguredToolProviders` calls it at session start
(`packages/web-agent-core/src/controller.ts:137-153, 177`). When the providers
return at least one tool, core rebuilds the agent, so the first turn already
has the MCP tools and their `# Tool guidelines` line. The rebuild keeps the
conversation journal, so a `send()` that starts while the servers are still
connecting is not lost (`packages/web-agent-core/src/controller.ts:146-152`).
If no provider returns a tool, core does not rebuild the agent.

## Assigning a new `toolProviders` list reloads it

`doUpdateConfig` compares the patch's `toolProviders` with the current array.
When it is a different array, core disposes every loaded provider — each MCP
client is closed — and loads the new list through
`loadConfiguredToolProviders()`, the same path session start uses
(`packages/web-agent-core/src/controller.ts`). The Lit `toolProviders` setter
queues that update (`packages/web-agent-lit/src/chat-ui/chat-panel-props.ts`),
so assigning `panel.toolProviders` after the session exists connects the new
servers. The conversation is kept. Assigning the same array again does
nothing.

## `required: false` — degrade

Core logs the failure with `console.warn`:

```
[tools] optional tool provider "<name>" failed to load — its tools are
unavailable this session: <message>
```

and the provider contributes no tools. The session starts normally
(`packages/web-agent-core/src/tools/tool-provider.ts:63-72`). The e2e spec
`apps/cat-store/e2e/mcp-remote-tool.mock.spec.ts:54-74` covers this: the
`unreachable` server fails and the chat still answers.

## `required: true` — hard startup error

Core disposes every provider that already loaded, then throws a
`RequiredToolProviderError`:

```
Required tool provider(s) failed to load — "<name>": <message>
```

(`packages/web-agent-core/src/tools/tool-provider.ts:14-24, 75-78`). The
controller catches it, logs `[tools] tool provider startup failed:`, sets
`state.error`, notifies listeners, and re-throws so `session.initPromise`
rejects (`packages/web-agent-core/src/controller.ts:178-185`).

## `dispose()`

`dispose()` closes the MCP client and clears the handle. It is a safe no-op
before `load()` (`src/tool-providers.ts:42-46`; test
`src/tool-providers.test.ts:72-90`). Core calls it from the session's
`dispose()` for every provider that loaded. The session's `dispose()` does not
wait for these calls to finish
(`packages/web-agent-core/src/controller.ts:243-251`). Core also calls it for
every already-loaded provider when a required one fails
(`packages/web-agent-core/src/tools/tool-provider.ts:76`).

## Tool-name collisions

Two servers whose prefixed names collide do not error. `buildTools` warns
`` Tool "<name>" is already defined — skipping duplicate. `` and keeps the
first (`packages/web-agent-core/src/tools/build-tools.ts:219-223`; test
`src/client.test.ts:88-98`). Give distinct `name`s to avoid it.

Core appends provider tools after the host's own tools
(`packages/web-agent-core/src/controller-config.ts:191-196, 223-228`). So when
an MCP tool has the same name as a built-in or host tool, the built-in or host
tool stays and the MCP tool is skipped with the same warning.

## What a tool call returns

Only `text` content blocks survive. The package joins them with `\n` and trims
the result. A thrown error becomes `{ content: <message>, isError: true }`
rather than a rejection (`src/client.ts:30-38, 54-67`; tests
`src/client.test.ts:34-48, 77-85`).

## Bundling

This package reaches the MCP SDK through two dynamic `import()` calls with
**literal** specifiers and `webpackChunkName` comments (`src/client.ts:83-90`).
The literal specifier is required, because a variable one makes webpack emit
`Critical dependency: the request of a dependency is an expression` and drop
the module. Whether the SDK loads only on connect is the **host's** choice,
made in its webpack configuration:

- A host that sets `parser: { javascript: { dynamicImportMode: "eager" } }`
  inlines every dynamic import into the bundle that references it.
  `apps/docs-site/webpack.config.cjs:50` sets this mode. The docs-site does not
  use this package.
- A `splitChunks` cache group with a fixed `name` also moves the SDK out of its
  own chunk. `apps/cat-store/webpack.config.js:29-38` puts every `node_modules`
  module into one `vendors` chunk, and its `index.html` loads `vendors.js` with
  a `<script>` tag at page start. In the cat-store build, the MCP SDK is in
  `vendors.js`, and no separate `mcp-sdk-client` or `mcp-sdk-transport` file
  exists.
