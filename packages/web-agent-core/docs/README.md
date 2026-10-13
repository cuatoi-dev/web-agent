---
title: Core package docs
---

# @cuatoi/web-agent-core — documentation

Framework-agnostic core of the web-agent in-app browser agent: the agent loop,
tool and skill definitions, the datasource query engine, provider transports and
session storage. It renders nothing on its own.

## Guides

| Page | What it covers |
|---|---|
| [Composing tools, skills & renderers](./composition.md) | The builder-function model, the core builders, and copy-paste recipes |
| [Tools & data sources](./tools.md) | The tools core ships, the `ToolDef` schema table, the `calc` tool, and wiring data sources |
| [Custom tools](./custom-tool.md) | `CustomToolDef`, `ToolOutcome`, `ToolContext`, and a worked example |
| [Skills](./skill.md) | `search_skills` / `load_skill`, `SkillDef`, and `coreSkills()` |
| [Generative UI](./generative-ui.md) | `show_generative_ui`, buttons and form blocks, `RenderableBlock` |
| [Image support](./image-support.md) | The `imageInput` toggle, attachments, downscaling, and which models get images |
| [Session handling](./session-handling.md) | Multi-session UI lifecycle, `SessionMeta`, `AgentSession` methods, `SessionState`, and retrying a failed turn |
| [Lifecycle hooks](./hooks.md) | `onPreTool`, `onPostTool`, `onUserPrompt`, `onTurnEnd`, `onPreCompact`, `onPostCompact` and `onSessionStart`: when each fires, what it returns, and what happens when it throws |
| [Compaction](./compaction.md) | History compaction triggers, `CompactionStats`, transcript parts, and reload behavior |
| [Session backend](./session-backend.md) | The `SessionStore` seam and `IdbSessionStore` |
| [Endpoint types](./providers.md) | The built-in `endpointType` values, how to configure each, and how to register your own provider |
| [Agent cursor](./action-cue.md) | `CuesConfig`, speed presets, and how cues are fired |
| [UI registry seam](./registry.md) | Why the seam exists and where the interface lives (the framework binding, not core) |
| [Tool providers](./tool-provider.md) | The async `ToolProvider` seam: `load()`, the `required` rule, and `dispose()` |
| [Scheduler](./scheduler.md) | `scheduler` config, `set_schedule` / `list_schedules` / `cancel_schedule`, and the `/schedule` commands |
| [Todo tracking](./todo.md) | `todo` config, `todo_write` / `todo_read`, and how the list is saved with the session |

## Related packages

- `@cuatoi/web-agent-dom` — the DOM and state tools (`snapshot_page`,
  `query_state`, `click`, `fill`, `select_option`, `wait_for`, `see`)
- `@cuatoi/web-agent-lit` — the sample Lit chat UI binding
- `@cuatoi/web-agent-mcp` — MCP servers as tool providers
- `@cuatoi/web-agent-openapi` — OpenAPI documents as tool providers
- `@cuatoi/web-agent-charting` — the `show_chart` tool and Chart.js renderer
