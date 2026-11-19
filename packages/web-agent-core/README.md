# @cuatoi/web-agent-core

Framework-agnostic core for the web-agent in-app browser agent: the agent loop,
tool and skill definitions, the datasource query engine, provider transports and
session storage.

No UI. This package renders nothing — pair it with the
`@cuatoi/web-agent-lit` package for a chat interface, and
`@cuatoi/web-agent-dom` for the DOM and state tools.

ESM-only (`"type": "module"`), targets ES2022 with the DOM libs, and runs in the
browser. Nothing is fetched at install or at runtime.

## Install

```bash
pnpm add @cuatoi/web-agent-core
# or
npm install @cuatoi/web-agent-core
```

## Usage

```ts
import { createAgentSession } from "@cuatoi/web-agent-core";

const session = createAgentSession({
  baseURL: "/api/anthropic",
  model: "claude-sonnet-4-5",
  endpointType: "anthropic",
});

session.subscribe((state) => {
  console.log(state.messages);
});

await session.send([{ type: "text", text: "Hello" }]);
```

## Documentation

Full guides live in [`docs/README.md`](./docs/README.md): composition, tools,
custom tools, skills, generative UI, image support, sessions, compaction,
providers, [lifecycle hooks](./docs/hooks.md), the agent cursor, the UI registry seam, tool providers, the
[scheduler](./docs/scheduler.md) and [todo tracking](./docs/todo.md).

## License

Apache-2.0 — see [LICENSE](./LICENSE).
