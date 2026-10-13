---
title: Moving from core
---

# Moving from core

`@cuatoi/web-agent-core` used to ship these seven tools itself. Core now
ships only their **schemas**, in
`TOOL_DEFS` (`packages/web-agent-core/src/tools/definitions.ts`). The
executors live in this package. Core's runtime dependencies dropped from 8
to 5 — `html-to-image` and `jsonpath-plus` moved into this package
(`@cuatoi/web-agent-dom`'s `package.json` `dependencies`), leaving `ajv`,
`expr-eval-fork`, `idb-keyval`, `zod`, and `zod-to-json-schema` in core.

## What a host upgrading from an older core must add

1. `pnpm add @cuatoi/web-agent-dom`.
2. Pass `...domTools({ … })` on `SessionConfig.toolProviders` — the tools are
   no longer in core's `defaultTools()`.
3. Pass `getState` if you want `query_state` to see your store. Core no
   longer holds a `stateAdapter` of its own.
4. Pass `actionCue` / `typingPaceMs` if you want the cursor and typing
   animation. The host owns that wiring now.
5. Pass `confirmInteraction` to keep the `"ask"`-tier confirm dialog. The
   core-side hook that used to do this is gone.

## What is gone from core

- `ToolContext.domAdapter` and `ToolContext.stateAdapter` — removed with no
  replacement slot (verified absent from `ToolContext` in
  `packages/web-agent-core/src/tool-hooks.types.ts`).
- The `"pointed"` `MessagePart` variant — verified absent from both
  `packages/web-agent-core/src` and `packages/web-agent-lit/src`.
- The state-shape line the system prompt used to add. `query_state`'s
  state-shape summary now rides in its own `promptSnippet` instead
  (`stateAdapter.describeShape()` folded in by `domTools()`).

## What replaced lit's old picker

`@cuatoi/web-agent-lit`'s `PointerController` was deleted.
`pickerAttachmentProvider` (this package) is the only picker now. The
replacement is less capable: no numbered chips, no "keep pinned after send",
and no detached-pin handling.
