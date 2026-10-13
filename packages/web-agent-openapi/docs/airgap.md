---
title: Airgap and bundling
---

# Airgap and bundling

This page explains how the package ships inside an airgapped host that has
no network access at install or at runtime.

## The resolver has no way to reach the network

`$ref` resolution lives in `src/resolve-local-refs.ts`, inside this package.
It follows a `$ref` only when the ref starts with `#`, and resolves it against
the same in-memory document. The module contains no `fetch`, no `import()`,
no file API and no URL handling, so an external reference cannot be followed. This
is a property of the code, not a setting — there is nothing to misconfigure.

The package has one runtime dependency, `@cuatoi/web-agent-core`.

## What an external `$ref` does

The resolver leaves it in the document exactly as written. It reports no error
because it has no error channel at all: `resolveLocalRefs` returns only the
resolved document (`src/resolve-local-refs.ts:146-152`). Instead the parse function walks the schemas each **whitelisted** operation
reaches, using `findUnresolvedRef`. If a whitelisted operation's schema still
holds a `$ref`, the source load throws `… references an unresolved external
$ref "<ref>". External references are not fetched.` An external `$ref` reached
**only** by a non-whitelisted operation is ignored and the load succeeds (test
case "ignores an external `$ref` that only a non-whitelisted operation
reaches").

A local pointer that addresses nothing — for example `#/components/schemas/Gone`
— is treated the same way: left in place, and rejected only if a whitelisted
operation reaches it.

## The guard

The "rejects an external `$ref` reached by a whitelisted operation and never
fetches it" test spies on `globalThis.fetch` and asserts
`expect(fetchSpy).not.toHaveBeenCalled()`. **This test must never be weakened
to make an example work** — it is the standing proof that the package makes
zero network calls while parsing.

## Nothing is fetched at install or build

At runtime this package requests only two things: the host's own `specUrl`,
and the operation URLs derived from it. Those are the two `resolveApiFetch`
call sites — `fetchOpenApiDocument` for the document, and the operation
executor for each request. Everything else ships in the npm tarball, and the
only runtime dependency is `@cuatoi/web-agent-core`.

## Bundling

The resolver is a first-party module of this package, reached through a normal
static import. There is no dynamic `import()` and no separate chunk to configure,
so a host bundler needs no special setting for it.

The dynamic `import()` this package used before was removed in task 006 because
it was measured to buy nothing: `apps/docs-site/webpack.config.cjs` sets
`parser: { javascript: { dynamicImportMode: "eager" } }`, which inlines every
dynamic import, and `apps/cat-store/webpack.config.js` sets
`splitChunks.chunks: 'all'` with a fixed `vendors` chunk name, which hoists
asynchronously imported `node_modules` code into the one initial bundle. Neither
host ever loaded the parser lazily.

## Documents must be objects, not strings

`parseOpenApiOperations` takes a parsed document (`Record<string, unknown>`).
`fetchOpenApiDocument` produces one with `response.json()`. A YAML or JSON
**string** is not parsed — the previous third-party parser did that, and dropping
it dropped the `yaml` dependency with it.