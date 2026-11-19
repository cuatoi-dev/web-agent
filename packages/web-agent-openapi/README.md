# @cuatoi/web-agent-openapi

Declarative OpenAPI API-call tools for the web-agent in-app browser agent — reads an
OpenAPI 3.x document, turns a whitelist of operations into agent tools, and runs the
requests.

## Install

```bash
pnpm add @cuatoi/web-agent-openapi
```

## Usage

```ts
import { createAgentSession } from "@cuatoi/web-agent-core";
import { openApiToolProviders } from "@cuatoi/web-agent-openapi";

const session = createAgentSession({
  // …the rest of your SessionConfig…
  toolProviders: openApiToolProviders([
    {
      name: "cat-store",
      description: "Cat Store REST API",
      specUrl: "/cat-store/openapi.json",
      operations: ["listCats", "getCat"],
      credentials: "same-origin",   // required: no default
      required: true,               // true → hard startup error on failure
    },
  ]),
});

await session.initPromise;  // rejects if a required source fails to load
```

The whole source list becomes **one** `ToolProvider`. A tool name claimed by one
source is refused to a later source — a rule that needs a view across all sources. A
source with `required: true` that fails to load is a hard startup error. A
`required: false` source that fails is logged and skipped, and the rest still load.

`$ref` resolution is done by a module inside this package, so the only runtime
dependency is `@cuatoi/web-agent-core`. The resolver follows a `$ref` only
when it starts with `#`; it has no network or file access at all, so an external
`$ref` is never fetched — see [Airgap and bundling](./docs/airgap.md).

## Documentation

See [`docs/README.md`](./docs/README.md) — getting started, source configuration,
operations and responses, lifecycle and failures, airgap and bundling, and the full
API reference.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
