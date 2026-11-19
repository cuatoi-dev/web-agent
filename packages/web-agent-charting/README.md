# @cuatoi/web-agent-charting

Chart.js tools, skills and lit-html chart blocks for the web-agent in-app
browser agent. The agent uses them to render charts in its replies.

## Install

```bash
pnpm add @cuatoi/web-agent-charting
# or
npm install @cuatoi/web-agent-charting
```

The `.` entry is framework-agnostic — the `show_chart` and `show_live_chart`
tools, the `chart` skill, the Chart.js config schema and the config
transforms. The `./datasource` entry provides a dependency-free Elasticsearch
data-source adapter. Both need no framework.

The `./lit` entry needs `@cuatoi/web-agent-lit`, declared as an **optional**
peer dependency. Install it only if you use the Lit binding:

```bash
pnpm add @cuatoi/web-agent-lit
# or
npm install @cuatoi/web-agent-lit
```

## Usage

Wire the tool, skill and renderer into a host panel:

```ts
import { coreSkills } from "@cuatoi/web-agent-core";
import { chartingTools, chartingSkills } from "@cuatoi/web-agent-charting";
import { chartingRenderers } from "@cuatoi/web-agent-charting/lit";

panel.tools = [...chartingTools()];
panel.skills = [...coreSkills(), ...chartingSkills()];
panel.renderers = [...chartingRenderers];
```

`chartingTools()` already includes `show_live_chart`, a generic live chart tool
that binds a chart to a data source query and self-refreshes — so registering
`chartingSkills()` alongside `chartingTools()` satisfies the chart skill's
requirement for a live chart tool out of the box. See
[Refresh and datasource charts](./docs/refresh-and-datasource.md).

The `./lit` entry point has side effects (custom-element registration). The
package declares them, so bundlers do not tree-shake the registration away.

## Documentation

Full guides live in [`docs/`](./docs/README.md) — the `show_chart` tool and
config shape, import paths and dependencies, refresh and datasource charts, and
the API reference.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
