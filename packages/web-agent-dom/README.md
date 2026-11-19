# @cuatoi/web-agent-dom

DOM interaction and state inspection tools for the web-agent in-app browser
agent. It gives the agent seven DOM and state tools — `snapshot_page`,
`query_state`, `click`, `fill`, `select_option`, `wait_for` and `see` — plus
the point-at-elements picker, through `@cuatoi/web-agent-core`'s
`ToolProvider` seam.

## Install

```bash
pnpm add @cuatoi/web-agent-dom
```

## Usage

```ts
import { createAgentSession, coreSkills } from "@cuatoi/web-agent-core";
import { domTools, domSkills } from "@cuatoi/web-agent-dom";

const session = createAgentSession({
  // …the rest of your SessionConfig…
  toolProviders: domTools({
    getState: () => store.getState(),   // powers query_state
  }),
  skills: [...coreSkills(), ...domSkills()],
});
```

`domTools()` returns **one** provider named `"dom"` with `required: true`, so
a load failure is a hard startup error. It also registers the picker as an
attachment provider.

## Documentation

See [`docs/README.md`](./docs/README.md).

## License

Apache-2.0 — see [LICENSE](./LICENSE).
