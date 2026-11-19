---
title: DOM package API reference
---

# DOM package API reference

Every export of `src/index.ts` — 24 entries: 11 functions, 3 classes, 1 const
and 9 types (some grouped below by the class or function they belong to).

Each type is declared in a types file (`src/types.ts`,
`src/adapters/types.ts`, `src/adapters/ref-table.types.ts` or
`src/utils/types.ts`). The module that uses it re-exports it, and
`src/index.ts` re-exports it from that module. The file named below is the
file that declares the type.

## `domTools`

`domTools(options?: DomToolsOptions): ToolProvider[]`
(`src/tool-provider.ts`)

Returns an array with one `ToolProvider` named `"dom"`, `required: true`. See
[Getting started](./getting-started.md) and [Options](./options.md).

### `DomToolsOptions` — type, `src/types.ts`

Every field documented in [Options and defaults](./options.md).

### `ConfirmInteractionDetail` — type, `src/types.ts`

```ts
interface ConfirmInteractionDetail {
  action: string;
  ref: string;
  name?: string;
  reason?: string;
}
```

## `DomAdapter`

`class DomAdapter` (`src/adapters/dom-adapter.ts`)

| Member | Signature | Notes |
|---|---|---|
| constructor | `constructor(opts?: DomAdapterOptions)` | Builds its own `RefTable` unless one is passed |
| `snapshot` | `snapshot(input: SnapshotInput): Promise<string>` | `input` is `{ scope?, interactive_only?, include_text? }`. See [Tools](./tools.md) — refs, snapshot limits and `include_text` |
| `snapshotFocused` | `snapshotFocused(elements: Element[]): Promise<{ ref: number; text: string }[]>` | One generation for the whole batch — used by the picker |
| `screenshot` | `screenshot(scope?: string): Promise<{ dataUrl: string; mediaType: string; width: number; height: number; warning?: string }>` | Implements `see` through `captureScreenshot` (`src/adapters/screenshot.ts`); filters out `agentUiSelector`, downscales via core's `downscaleToolImage` |
| `describeElement` | `describeElement(el: Element): string` | `"role \"name\""` or just `role` |
| `describeRef` | `describeRef(ref: string): { name: string; permission: AgentPermission; permissionReason?: string } \| undefined` | Non-throwing lookup used for the `"ask"`-tier gate |
| `click` | `click(ref: string, signal?: AbortSignal): Promise<string>` | Dispatches pointer/mouse events |
| `fill` | `fill(ref: string, value: string, signal?: AbortSignal): Promise<string>` | See [Tools](./tools.md) — `fill` and `select_option` |
| `selectOption` | `selectOption(ref: string, option: string, signal?: AbortSignal): Promise<string>` | Matches by label, then value |
| `waitForIdle` | `waitForIdle(timeoutMs: number, signal?: AbortSignal): Promise<boolean>` | 300 ms quiet-window mutation observer |
| `waitForText` | `waitForText(text: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean>` | 250 ms polling substring match |

Readonly fields: `refTable`, `root`, `snapshotMaxChars`, `snapshotMaxDepth`,
`snapshotSubtreeMaxNodes`, `snapshotMaxNodes`, `agentUiSelector`,
`actionCue`, `typingPaceMs`.

### `describeElementParts` — function, `src/adapters/element-semantics.ts`

`describeElementParts(el: Element): { role: string; name: string }` — the
pure `{role, name}` computation `DomAdapter` uses internally, exported so UI
(the picker) can label elements without a `DomAdapter` instance.
`src/adapters/dom-adapter.ts` re-exports it.

### `getRole` and `getName` — functions, `src/adapters/element-semantics.ts`

`getRole(el: Element): string` and `getName(el: Element): string` are the two
halves of `describeElementParts`, exported on their own so a host can label an
element without a `DomAdapter` instance. `getName` returns an empty string when
the element has no accessible name.

### `DomAdapterOptions` — type, `src/adapters/types.ts`

The fields `refTable`, `root`, `snapshotMaxChars`,
`snapshotMaxDepth`, `snapshotSubtreeMaxNodes`, `snapshotMaxNodes`,
`agentUiSelector`, `actionCue`, and `typingPaceMs?: () => number` (note the
supplier function signature, unlike `DomToolsOptions.typingPaceMs` which is a
`number`). `DomAdapterOptions` does not include `images`, `getState`, or
`confirmInteraction`, which are handled by `DomToolsOptions` (`src/types.ts`).

### `ActionCueFn` — type, `src/adapters/types.ts`

```ts
type ActionCueFn = (
  el: Element | undefined,
  kind: CueKind,
  detail?: { value?: string; speedMs?: number; point?: { x: number; y: number }; rect?: { x: number; y: number; width: number; height: number } },
  signal?: AbortSignal,
) => Promise<void>;
```

`click`, `fill` and `selectOption` pass the run's `signal` to the cue. `see`
calls the cue with no `signal` (`src/adapters/screenshot.ts`). The adapter
checks `signal.aborted` after the cue resolves. If the run was stopped, it does
not dispatch the action and returns the `stoppedByUser` result instead
(`src/adapters/interactions.ts:55`, `:124`, `:212`).

A host writing a cue should accept `signal?: AbortSignal` and skip any step that
runs after the animation, such as a click pulse, once `signal.aborted` is true.
The cue animation itself is not expected to stop part way. The signal only
stops a late cue call from drawing on the page after the run has ended
(`src/adapters/types.ts`, the `ActionCueFn` comment).

## `StateAdapter`

`class StateAdapter` (`src/adapters/state-adapter.ts`)

| Member | Signature | Notes |
|---|---|---|
| constructor | `constructor(getState: () => unknown, opts?: { queryResultMaxChars?: number })` | `queryResultMaxChars` defaults to `6000` |
| `query` | `query(input: QueryInput): Promise<string>` | See [Tools](./tools.md) — `query_state` |
| `describeShape` | `describeShape(): string` | Types-only summary, capped at 1000 chars |
| `waitForPathTruthy` | `waitForPathTruthy(path: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean>` | 500 ms polling |

## `RefTable`

`class RefTable` (`src/adapters/ref-table.ts`)

| Member | Signature | Notes |
|---|---|---|
| `generation` | `get generation(): number` | Current generation number |
| `invalidateAll` | `invalidateAll(): number` | Bumps generation, clears the map, resets the ref counter to 1 |
| `assign` | `assign(el: Element): number` | 1-based per generation |
| `resolve` | `resolve(ref: number \| string): ResolveResult` | `ok` / `stale` / `detached` / `unknown` |

### `ResolveResult` — type, `src/adapters/ref-table.types.ts`

Discriminated union over `status`: `"ok"` (`el`, `generation`), `"stale"`
(`fromGeneration`, `generation`), `"detached"`, `"unknown"`.

## `resolveAgentPermission`

`resolveAgentPermission(el: Element): PermissionResolution`
(`src/adapters/permission-resolver.ts`) — see
[Permissions and confirmation](./permissions.md).

### `AgentPermission` — type, `src/adapters/types.ts`

`"allow" | "ask" | "block"`

### `PermissionResolution` — type, `src/adapters/types.ts`

```ts
interface PermissionResolution {
  permission: AgentPermission;
  reason?: string;
}
```

## `isElementVisible`

`isElementVisible(el: Element): boolean` (`src/utils/visibility.ts`) — uses
`Element.checkVisibility` with the opacity and CSS checks where the platform has
it, and an ancestor walk on the same three conditions where it does not. It
does not measure the element's box; `DomAdapter` checks a zero-size box
separately.

## `buildPointedElementsBlock`

`buildPointedElementsBlock(snapshots: PointedElementSnapshot[]): string`
(`src/utils/pointed-elements.ts`) — formats focused per-element snapshots
into the `# Pointed elements (the user clicked these)` block. See
[Point at elements](./picker.md).

### `PointedElementSnapshot` — type, `src/utils/types.ts`

```ts
interface PointedElementSnapshot {
  ref: number;
  text: string;
}
```

## `pickerAttachmentProvider`

`pickerAttachmentProvider(opts?: PickerProviderOptions): AttachmentProvider`
(`src/picker-provider.ts`) — see [Point at elements](./picker.md).

### `PickerProviderOptions` — type, `src/types.ts`

| Field | Type | Default |
|---|---|---|
| `agentUiSelector` | `string` | `"[data-agent-ui]"` |
| `maxItems` | `number` | `8` |
| `getDomAdapter` | `() => DomAdapter` | none |

## `disabledRef` and `blockedByPolicy`

`disabledRef(ref: string, name: string): string` and
`blockedByPolicy(ref: string, name: string, reason?: string): string`
(`src/tools/error-messages.ts`) build the "is disabled" error text and the
`"block"`-tier refusal text. Both are exported byte-identical to the strings
`DomAdapter` and the browser extension already return, so a caller can reuse
them rather than copy the wording.

## `domSkills`

`domSkills(): SkillDef[]`

Returns the package's skills for a host's `skills:` list — currently one,
`multi_step_ui`. Spread it wherever you spread `coreSkills()`:

```ts
panel.skills = [...coreSkills(), ...domSkills()];
```

### `multiStepUiSkill` — const, `src/skills/multi-step-ui-skill.ts`

The `SkillDef` `domSkills()` returns. It teaches the snapshot → act → verify
cycle, stale-ref recovery, and multi-step form flows.

## Not exported from the entry point

These exist in the source but are **not** re-exported from `src/index.ts` —
do not import them from the package root:

- `ConfirmInteractionFn`, `SnapshotInput`, `QueryInput`, `QueueItem`,
  `InteractiveCache` (`src/adapters/types.ts`)
- `SnapshotWalkContext`, `ScreenshotContext`, `InteractionContext`,
  `WaitContext` (`src/adapters/adapter-contexts.types.ts`)
- `RefEntry` (`src/adapters/ref-table.types.ts`)
- `PickedEntry` (`src/types.ts`), `CheckVisibilityCapable` (`src/utils/types.ts`)
- `evaluateJsonPath` (`src/adapters/state-adapter.ts`)
- The modules `DomAdapter` delegates to: `walkFromRoot`
  (`src/adapters/snapshot-walk.ts`), `makeTermMatcher` and `searchText`
  (`src/adapters/snapshot-match.ts`), `countSignificant`, `stateTags`,
  `skipElement` and `esc` (`src/adapters/snapshot-format.ts`), `isInteractive`
  and `tagLC` (`src/adapters/element-semantics.ts`),
  `captureScreenshot` (`src/adapters/screenshot.ts`), `performClick`,
  `performFill` and `performSelectOption` (`src/adapters/interactions.ts`), and
  `waitForIdle` and `waitForText` (`src/adapters/waiters.ts`)
- `isElementVisibleFallback` (`src/utils/visibility.ts`)
- `hasVisiblePixels`, `ALPHA_SCAN_MAX_EDGE` (`src/utils/image-alpha.ts`)
- `holdsFocus`, `focusLikeHuman`, `typeChunkLikeHuman`, `dispatchChangeLikeHuman`, `blurLikeHuman` (`src/utils/human-input-events.ts`)
- The `src/tools/error-messages.ts` builders: `staleRef`, `detachedRef`,
  `disabledRef`, `unknownTool`, `schemaViolation`, `waitTimeout`,
  `invalidJsonPath`, `selectOptionMissing`, `navigationBlocked`,
  `stoppedByUser`, `elementNotVisible`, `screenshotMayNotContainElement`,
  `emptyScreenshot`, `invisibleTargetNote`
