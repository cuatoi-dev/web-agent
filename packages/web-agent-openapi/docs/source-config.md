---
title: OpenAPI source configuration
---

# OpenAPI source configuration

## The `ApiSourceConfig` block

From `src/types.ts`:

```ts
interface ApiSourceConfig {
  name: string;                                   // tool-name prefix, e.g. "ordersApi"
  description: string;                            // becomes the promptSnippet
  specUrl: string;                                 // OpenAPI 3.x document URL
  operations: string[];                            // whitelist of operationIds
  credentials: "omit" | "same-origin" | "include"; // required, no default
  required: boolean;                               // any load failure: hard error vs. skip
  fetch?: typeof fetch;                             // optional host-owned request hook
  maxResponseChars?: number;                        // response char cap; default 12,000
}
```

The default cap is the exported `DEFAULT_MAX_RESPONSE_CHARS = 12_000`
characters, applied per source — the executor initializes
`maxChars = source.maxResponseChars ?? DEFAULT_MAX_RESPONSE_CHARS` at the top
of `createApiOperationExecutor`. It was chosen to match
`DomAdapter.snapshotMaxChars` (also `12_000` in `packages/web-agent-dom`), so
an API response can never cost the model more context than a page snapshot.

## `specUrl` resolution

Absolute URLs pass through; a relative URL resolves against
`ApiRequestOptions.baseUrl`, defaulting to `window.location.href` — this is
`resolveApiSourceUrl` (in `src/fetch-seam.ts`) delegating to core's
`resolveRelativeUrl`. Cross-reference: operation URLs resolve against this
**same** spec URL, and the document's `servers` array is ignored entirely —
full detail in [Operations and responses](./operations-and-responses.md).

## `credentials` is required — no default

`ApiSourceConfig.credentials` has no default value. The host must state
explicitly whether requests send cookies (`"same-origin"`, `"include"`) or not
(`"omit"`). This is deliberate: silently defaulting credential handling would
either leak cookies to hosts that did not ask for them, or silently break APIs
that need them. The same mode is used for the spec fetch itself, not just the
operation requests — `fetchOpenApiDocument` passes
`credentials: source.credentials` on the document request too (proven by the
"passes credentials %s verbatim" unit test, which asserts the mode reached the
fetch call).

## `fetch?` is host-owned request customization, not an auth mechanism

The optional `fetch` override lets a host inject headers, swap the runtime
(e.g. Node vs. browser `fetch`), or point requests at a different origin
during tests. It is **not** an authentication seam — the tool does not read,
generate, or manage credentials, tokens, or auth headers on the host's behalf.
Any auth the host wants must be added inside its own `fetch` implementation.

The override replaces the fetch call for **both** the spec fetch and every
operation request — `resolveApiFetch` is called from `fetchOpenApiDocument`
for the document and from the operation executor for each request. With no
override, `window.fetch` bound to `window` is used, falling back to
`globalThis.fetch` (the branches of `resolveApiFetch` itself). The custom path
is exercised by the "invokes custom fetch instead of global fetch" unit test.

## CORS requirement matrix (cross-origin sources)

REST tools perform no cross-origin demo in this repo — this matrix documents
what a cross-origin deployment needs; it is not exercised live here.

| Requirement | Detail |
|---|---|
| `Access-Control-Allow-Origin` | Must be the exact calling origin — never `*` — when credentials are sent. |
| `Access-Control-Allow-Credentials` | Must be `true` on every credentialed response, including the preflight response. |
| `Access-Control-Allow-Headers` / `-Methods` / `Expose-Headers` | No `*` wildcard is allowed once credentials are involved; list exact values. |
| Preflight `OPTIONS` | Required for every JSON-body operation, because `Content-Type: application/json` is **not** a CORS-safelisted header/value combination — the browser sends a preflight `OPTIONS` request before the real one. |
| Preflight credentials | The preflight request itself carries no credentials, but its response still must include `Access-Control-Allow-Credentials: true` for the follow-up credentialed request to proceed. |

A server missing any one of these rejects the request (or the browser blocks
the response) even when the operation itself would have succeeded.

## Limitation: third-party cookie policy

Even a server that implements the CORS matrix correctly is not guaranteed to
receive cookies cross-site. Browsers apply their own third-party cookie
policy on top of CORS:

- A cross-site cookie needs `SameSite=None; Secure` to be sent at all.
- Browsers may still block it under stricter third-party cookie policies,
  regardless of what the server allows.

**Practical consequence:** cookie-based `credentials: "include"` is dependable
for same-origin sources (as in the cat-store demo, `credentials:
"same-origin"`), and fragile for cross-origin sources — test against the
actual target browser/policy before relying on it.