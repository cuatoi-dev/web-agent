---
"@cuatoi/web-agent-core": major
"@cuatoi/web-agent-lit": major
"@cuatoi/web-agent-dom": minor
---

**Breaking:** core no longer ships the DOM and state tools.

`snapshot_page`, `query_state`, `click`, `fill`, `select_option`, `wait_for`
and `see` are gone from `defaultTools()`, together with `DomAdapter`,
`StateAdapter`, `RefTable`, `resolveAgentPermission`, the `domAdapter` and
`stateAdapter` fields on `ToolContext`, the `"pointed"` `MessagePart`, and the
`snapshotMaxChars`, `snapshotMaxDepth`, `snapshotSubtreeMaxNodes`,
`snapshotMaxNodes`, `images`, `actionCue` and `typingPaceMs` config fields.
`wait` stays. Core drops the `html-to-image` and `jsonpath-plus`
dependencies, going from 8 runtime dependencies to 6.

To keep the DOM tools, install `@cuatoi/web-agent-dom` and pass
`domTools({ … })` through `toolProviders`. The host now wires the agent cursor
itself by passing `actionCue`/`typingPaceMs` into `domTools`, and the
"ask"-tier confirm dialog by passing `confirmInteraction` (built from
`@cuatoi/web-agent-lit`'s `createConfirmScrim`) — `domTools()` calls it
before an "ask"-permission click/fill/select_option runs.

`@cuatoi/web-agent-lit` no longer re-exports the adapters and no longer
ships its own point-at-elements picker — that picker is now an attachment
provider registered by `domTools()`.
