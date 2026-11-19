---
title: Getting started with the DOM package
---

# Getting started with `@cuatoi/web-agent-dom`

```bash
pnpm add @cuatoi/web-agent-dom
```

The package depends on `@cuatoi/web-agent-core` (`package.json`
`dependencies`) and imports `TOOL_DEFS` and `downscaleToolImage` from it
(`src/tool-provider.ts`, `src/adapters/screenshot.ts`). Install core
alongside it.

## What you get

`domTools(options?)` returns a single `ToolProvider` (`src/tool-provider.ts`,
`domTools`) whose `load()` resolves to these tools, in this order:

1. `snapshot_page`
2. `query_state`
3. `click`
4. `fill`
5. `select_option`
6. `wait_for`
7. `see` — included **unless** `options.images` is `false`

It also registers `pickerAttachmentProvider(...)` as an `attachmentProvider`,
**unconditionally**, independent of `images` — see
[Point at elements](./picker.md).

Two of those tools limit how long their results stay in the conversation.
`snapshot_page` declares `ttl: 1, uttl: 2` and `query_state` declares
`ttl: 3, uttl: 2` (`src/tool-provider.ts:122-123` and `:135-136`), so an old
snapshot or query result is replaced automatically once a newer one for the same
arguments arrives, or once it is more than two user turns old. The other five
tools keep every result. See [Result lifetime](./tools.md) for the numbers and
what each one counts.

## Wiring into a host

Two real hosts wire it today, quoted verbatim from source:

```ts
// apps/cat-store/src/web/agent-panel-config.ts:258-266 — full wiring
panel.toolProviders = [
  ...(domAccess
    ? domTools({
        getState: () => store.getState(),
        actionCue: createActionCue({ getCursor: () => getAgentCursor(), speed: () => CUE_SPEED }),
        typingPaceMs: SPEED_PRESETS[CUE_SPEED].msPerWord,
        confirmInteraction: target ? target.confirmInteraction.bind(target) : undefined,
      })
    : []),
  // …mcp and openapi providers…
];
// apps/cat-store/src/web/agent-panel-config.ts:227-232
panel.skills = [
  ...coreSkills(),
  ...chartingSkills(),
  ...(domAccess ? domSkills() : []),
  /* …host skills… */
];
```

```ts
// apps/docs-site/src/docs-embed.ts:59-64 — no Redux store, no images
bubble.toolProviders = domTools({
  images: false,                 // matches imageInput: false — no `see`
  actionCue: createActionCue({ getCursor: () => getAgentCursor(), speed: () => CUE_SPEED }),
  typingPaceMs: SPEED_PRESETS[CUE_SPEED].msPerWord,
  confirmInteraction: bubble.confirmInteraction.bind(bubble),
});
bubble.skills = [...coreSkills(), ...domSkills(), /* …host skills… */];
```

`domSkills()` returns the `multi_step_ui` skill — the snapshot → act → verify
guidance the DOM tools need. Compose it alongside `coreSkills()` wherever you
set `toolProviders`, so the model gets the guidance for the tools it just
gained.

`docs-embed.ts` passes no `getState`: with none, `query_state` queries `{}`
and returns no matches (`options.getState ?? (() => ({}))` in
`src/tool-provider.ts`, `domTools`).

## What happens at session start

`ToolProvider`s load at session start, and again when `updateConfig` receives
a different `toolProviders` array. `required: true` on the `"dom"` provider means a `load()` failure is a
hard startup error, not a silent degrade.
