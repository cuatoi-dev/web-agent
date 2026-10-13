---
title: DOM tool options
---

# `DomToolsOptions`

Read from `src/types.ts` (`DomToolsOptions`), `src/tool-provider.ts`
(`domTools`) and `src/adapters/dom-adapter.ts` (`DomAdapter` constructor).

| Option | Type | Default | Effect |
|---|---|---|---|
| `snapshotMaxChars` | `number` | `12_000` | Character budget for one snapshot |
| `snapshotMaxDepth` | `number` | `12` | Max significant nesting depth emitted |
| `snapshotSubtreeMaxNodes` | `number` | `50` | Max child nodes of one parent that the breadth-first walk considers; the rest are not shown. Not applied when `include_text` is set |
| `snapshotMaxNodes` | `number` | `400` | Overall cap on the nodes one snapshot selects |
| `images` | `boolean` | `true` | `false` omits the `see` tool |
| `actionCue` | `ActionCueFn` | none | Awaited before a synthetic click/fill/select and before a `see` capture |
| `typingPaceMs` | `number` | `0` | ms per word for `fill`; `0`/undefined ⇒ instant set |
| `agentUiSelector` | `string` | `"[data-agent-ui]"` | Subtree excluded from snapshots, screenshots and picking |
| `getState` | `() => unknown` | `() => ({})` | State source for `query_state`, read fresh on every call |
| `confirmInteraction` | `(d: ConfirmInteractionDetail) => Promise<boolean>` | none | The `"ask"`-tier gate |

`images: false` omits the `see` tool definition from `load()`'s result and
nothing else. The picker registers unconditionally, regardless of `images`
(see [Point at elements](./picker.md)).

See [Snapshot limits](./tools.md#snapshot-limits) for how the four snapshot
budgets work together.

`ConfirmInteractionDetail` is:

```ts
interface ConfirmInteractionDetail {
  action: string;
  ref: string;
  name?: string;
  reason?: string;
}
```

(declared in `src/types.ts`, re-exported from `src/tool-provider.ts`)

## Fields `DomToolsOptions` does not forward

`DomAdapterOptions` (`src/adapters/types.ts`) has two fields
`DomToolsOptions` does not expose: `refTable` and `root`.
Reach them only by constructing a `DomAdapter` directly. Screenshot size is
not an option: `see` always uses core's tool-image limits (1536 px, 1 MB).
