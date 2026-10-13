---
title: OpenAPI operations and responses
---

# OpenAPI operations and responses

## What the parser accepts

`parseOpenApiOperations` is strict about the shapes it turns into tools. A
whitelisted operation that violates any rule fails the whole source load with
the message below.

| Rule | On violation | Mechanism |
|---|---|---|
| Only `path` and `query` parameters | throws `… uses unsupported parameter location "<in>" for parameter "<name>". Only "path" and "query" parameters and an application/json request body are supported.` | the `SUPPORTED_LOCATIONS` list in `parseOpenApiOperations` |
| Request bodies must declare `application/json` | throws `… has a request body with no "application/json" media type (found: …). Only JSON request bodies are supported.` | the `content["application/json"]` lookup in `parseOpenApiOperations`' `requestBody` handling |
| Every whitelisted `operationId` must exist in the document | throws `… whitelists operation "<id>", which the OpenAPI document does not define.` | `index.get(operationId)` inside `parseOpenApiOperations`' whitelist loop |
| A duplicate `operationId` in the document | first occurrence in document order wins; not an error | `indexOperations` keeps the first `Map.set` |
| Path-item-level `parameters` | merged into every operation under that path; operation-level entries override by `(in, name)` | `effectiveParameters` |
| Descriptor order | whitelist order, not document order | `parseOpenApiOperations` iterates `source.operations` in order (test case "returns one descriptor per whitelisted operationId, in whitelist order") |

A `requestBody` whose `content` is empty or absent is ignored — the
`if (mediaTypes.length > 0)` branch in `parseOpenApiOperations` is skipped and
the operation becomes a body-less tool.

## Tool name and input schema

The tool is named `{sanitized name}_{sanitized operationId}`, e.g.
`ordersApi_describeOrders` — `operationToToolDef` builds `toolName` by joining
`sanitizeName(source.name, "api")` and
`sanitizeName(descriptor.operationId, "op")` with an underscore
(`src/operation-to-tool-def.ts:24-26`). Core's `sanitizeName` keeps case and
turns every other character into `_`, then strips leading and trailing
underscores; when nothing is left it returns the fallback
(`packages/web-agent-core/src/utils/sanitize-name.ts:5-7`). A source named
`_orders_` gives the prefix `orders`; a source named `***` gives `api`, and an
`operationId` of `***` gives `op`.

The tool description is the operation's `summary`. When `summary` is absent or
blank, the tool uses the operation's `description`. When both are absent or
blank, it uses `API operation <operationId> from <source name>`
(`src/operation-to-tool-def.ts:28-31`).

The generated input schema is assembled in `operationToToolDef`'s
properties loop:

- path parameters are always `required` in the generated schema — the URL cannot
  be built without them (the `in === "path"` branch pushes `name` into
  `required`);
- query parameters are `required` only when the spec marks them so (the
  `in === "query"` branch pushes only under `param.required`);
- a JSON request body appears as the property `body`, required only when the
  spec says so (the `requestBody.required` branch);
- a parameter named `body` colliding with a request body throws
  (`… parameter "body" collides with requestBody.`), and a duplicate
  parameter name across locations throws
  (`… has duplicate parameter name "<name>" across parameter locations.`).

Each property is the parameter's dereferenced `schema`, or `{}` when the spec
gives no schema (`src/parse-openapi.ts:160`). A parameter's own `description`
field is kept on the descriptor, but it is not copied into the input schema
(`src/operation-to-tool-def.ts:47`). If you want the agent to see a parameter
description, write it inside the parameter's `schema`.

## How the request URL is built

The base of every operation URL is the **spec URL**. `buildApiRequest`
calls `resolveApiSourceUrl(source.specUrl, …)`, then resolves the bound path
against it with `new URL(boundPath, base)` (`src/execute-operation.ts:80-81`).
A path that starts with `/` keeps only the origin of the spec URL. The
document's `servers` list (an OpenAPI concept) is ignored entirely; this
package never reads it.

- path values are `encodeURIComponent`-escaped, never interpolated raw. A
  missing path value throws (`… is missing required path parameter "<name>".`),
  and an empty path value is rejected because an empty segment would change the
  fixed path (`buildApiRequest`'s path-binding branch);
- a leftover `{placeholder}` with no matching parameter throws
  (`… path template "…" has placeholder "…" with no matching parameter.`);
- query values are encoded by `URLSearchParams`, an array value repeats the
  key, and an absent (`undefined` or `null`) value or array item is omitted
  (the query-binding loop);
- the URL is concatenated rather than fed back through the URL parser, so
  `URLSearchParams`' encoding is never re-encoded.

A measured example is the `buildApiRequest` unit test "substitutes a path
parameter into the fixed template": the fixture's `specUrl` field is
`http://localhost:28780/cat-store/openapi.json` and its `path` field is
`/api/orders/{id}`, so an input of `{ id: "ORD-1001" }` builds
`http://localhost:28780/api/orders/ORD-1001`.

The request itself is built the same way for every call
(`src/execute-operation.ts:88-95`):

- the method is the spec method in upper case, for example `GET`;
- `credentials` is the source's `credentials` value;
- when the tool has a `body` property and the agent supplies `body`, the body
  is sent as `JSON.stringify(body)` with the header
  `Content-Type: application/json`. No other header is set.

The executor passes the tool context's abort signal (`ctx.signal`) to the
fetch call, so aborting that signal aborts the request
(`src/execute-operation.ts:132`).

## Errors the agent sees

A request problem never throws out of the tool. The executor returns it as a
tool result with `isError: true`:

- **A binding error** — a missing or empty path value, or a leftover
  placeholder — returns the error message from `buildApiRequest`. No request is
  sent (`src/execute-operation.ts:123-127`).
- **A network error** — the fetch call rejects — returns
  `Request failed: <METHOD> <url>: <message>`
  (`src/execute-operation.ts:133-138`).
- **A non-2xx response** returns the status line and the body, as described in
  the next section.

## What comes back

The tool result is the response body with four defined transformations, all in
`createApiOperationExecutor`:

1. **Re-serialized.** The content-type check is a **substring** match, not an
   exact or a suffix match: a body counts as JSON when its lower-cased
   `content-type` **contains** `application/json`, or **contains** `+json`
   anywhere (`src/execute-operation.ts:143`). So
   `application/hal+json; charset=utf-8` is treated as JSON even though it does
   not end in `+json`. A JSON body is parsed and re-stringified via
   `JSON.stringify(JSON.parse(raw))`, so server whitespace and formatting are
   not preserved.
2. **Capped.** `capBody` truncates the body to `maxChars` with the suffix
   `\n… TRUNCATED (char cap N; full body was M characters).`, where `maxChars`
   is the constant read at the top of the executor —
   `source.maxResponseChars ?? DEFAULT_MAX_RESPONSE_CHARS`.
3. **Status-prefixed on failure, and on any empty body.** A non-2xx response is
   prefixed with `HTTP <status> <statusText>` (status text omitted when empty)
   and returned with `isError: true`. An **empty** body becomes
   `HTTP <status> <statusText> (empty response body)`, and that message is also
   returned for a **successful** 2xx with an empty body — without `isError`, so
   the agent sees a success (`src/execute-operation.ts:155-161`). A 2xx with a
   non-empty body carries no status prefix. All variants are formatted by
   `statusLine` in the executor.
4. **Malformed JSON survives.** If the body looks like JSON but does not
   parse, the executor's `catch` hands the agent the raw body unchanged rather
   than hiding it.

There is no field selection, filtering, or schema-shaping. The agent sees
whatever the server returned, transformed only by the four rules above.

## Non-goals

- **No authentication.** The tool performs no auth of any kind.
- **No `securitySchemes` handling.** OpenAPI `securitySchemes` / `security`
  fields in the document are ignored (`src/types.ts` documents this in the
  `ApiSourceConfig` comment).
- **No confirm gate.** Mutating operations (POST/PUT/DELETE) are not gated
  behind a user confirmation step.
- **No retry or caching.** Every tool call is a single request — the executor
  makes exactly one `fetchFn(request.url, …)` call per invocation; failures
  surface to the agent as-is.