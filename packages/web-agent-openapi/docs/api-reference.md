---
title: OpenAPI API reference
---

# OpenAPI API reference

Every export in `src/index.ts` — the provider factory, the source
connectors, the parsing and request-building helpers, the fetch seam, and the
types they take and return.

## Functions and constants

| Export | Signature | Source |
|---|---|---|
| `openApiToolProviders` | `(sources: ApiSourceConfig[], options?: ApiRequestOptions & { load?: typeof loadApiSource }) => ToolProvider[]` | `src/tool-providers.ts` |
| `connectApiSources` | `(sources: ApiSourceConfig[] \| undefined, options?: ApiRequestOptions & { load?: typeof loadApiSource }) => Promise<ConnectApiSourcesResult>` | `src/connect-sources.ts` |
| `loadApiSource` | `(source: ApiSourceConfig, options?: ApiRequestOptions) => Promise<ApiToolDef[]>` | `src/connect-sources.ts` |
| `ApiRequiredSourceError` | `class extends Error { readonly failures: ApiSourceFailure[] }` | `src/connect-sources.ts` |
| `parseOpenApiOperations` | `(source: ApiSourceConfig, doc: Record<string, unknown>) => Promise<ApiOperationDescriptor[]>` | `src/parse-openapi.ts` |
| `operationToToolDef` | `(source, descriptor, execute?) => ApiToolDef` | `src/operation-to-tool-def.ts` |
| `buildApiTool` | `(source, descriptor, options?) => ApiToolDef` | `src/execute-operation.ts` |
| `buildApiRequest` | `(source, descriptor, paramLocations, input, options?) => { url: string; init: RequestInit }` | `src/execute-operation.ts` |
| `createApiOperationExecutor` | `(source, descriptor, paramLocations, options?) => (input, ctx) => Promise<ToolOutcome>` | `src/execute-operation.ts` |
| `DEFAULT_MAX_RESPONSE_CHARS` | `12_000` | `src/execute-operation.ts` |
| `resolveApiSourceUrl` / `resolveApiFetch` / `fetchOpenApiDocument` | `(url, baseUrl?) => string` / `(source) => typeof fetch` / `(source, options?) => Promise<Record<string, unknown>>` | `src/fetch-seam.ts` |

`openApiToolProviders` is the entry point hosts use — one provider for the
whole source list (see [Lifecycle and failures](./lifecycle-and-failures.md)
for why and for the `required` degrade rule).

`connectApiSources` is the engine behind it: it loads every source
concurrently via `Promise.allSettled`, collects tools and optional-source
failures, and throws `ApiRequiredSourceError` when any required source fails.
`loadApiSource` performs one source's three stages — fetch the document,
resolve the whitelist, build the tools — and is also the default `load` test
seam.

`parseOpenApiOperations` turns one fetched document plus the whitelist into
descriptors (see [Operations and responses](./operations-and-responses.md) for
the acceptance rules). `operationToToolDef` maps one descriptor to a
`CustomToolDef` with a default no-op executor; `buildApiTool` is the real
composition that wires in the live executor.

`buildApiRequest` builds `{ url, init }` for one call without touching the
network — it is ctx-free on purpose so it is directly unit-testable.
`createApiOperationExecutor` returns the async `(input, ctx) => Promise<ToolOutcome>`
handler that performs the request and applies the four response
transformations (re-serialize, cap, status prefix, keep malformed JSON).
`DEFAULT_MAX_RESPONSE_CHARS` is the 12,000-character cap `source.maxResponseChars`
falls back to.

The fetch seam is a trio. `resolveApiSourceUrl` resolves a relative or absolute
spec URL. `resolveApiFetch` returns the host override, else `window.fetch`
bound to `window`, else `globalThis.fetch`. `fetchOpenApiDocument` fetches the
document and parses it as JSON, with descriptive errors — see
[Source configuration](./source-config.md).

## Types

| Type | Source | What it is |
|---|---|---|
| `ApiSourceConfig` | `src/types.ts` | The host's declarative source: `name`, `description`, `specUrl`, `operations`, `credentials`, `required`, `fetch?`, `maxResponseChars?` |
| `ApiParameterLocation` | `src/types.ts` | `"path" \| "query"` — header and cookie are rejected at parse time |
| `ApiHttpMethod` | `src/types.ts` | `get` / `put` / `post` / `delete` / `options` / `head` / `patch` / `trace` |
| `ApiOperationParameter` | `src/types.ts` | One `path` or `query` parameter with its dereferenced schema |
| `ApiOperationRequestBody` | `src/types.ts` | The `application/json` request body and its schema |
| `ApiOperationDescriptor` | `src/types.ts` | One whitelisted operation: `operationId`, `method`, `path`, parameters, optional body |
| `ApiToolParameterLocationMap` | `src/types.ts` | Which input properties map to `path`, `query` or `body` |
| `ApiToolDef` | `src/types.ts` | The `CustomToolDef` plus its descriptor and location metadata |
| `ApiRequestOptions` | `src/types.ts` (re-exported from `src/execute-operation.ts`) | Optional `baseUrl` the spec URL resolves against |
| `ApiSourceFailure` | `src/types.ts` (re-exported from `src/connect-sources.ts`) | A failed source and the error it threw |
| `ConnectApiSourcesResult` | `src/types.ts` (re-exported from `src/connect-sources.ts`) | `tools` in configured source order plus `failures` (optional sources only) — deliberately no `sessions` field |

No export is listed here that `src/index.ts` does not re-export, and none of
`src/index.ts`'s exports is omitted.