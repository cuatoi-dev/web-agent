---
title: DOM and state tools
---

# DOM and state tools

`domTools()` (`src/tool-provider.ts`) supplies the executors for seven tools.
Every tool's `name`, `description`, `inputSchema` and `promptSnippet` come
from core's `TOOL_DEFS` (`packages/web-agent-core/src/tools/definitions.ts`).
This package owns only the `execute` implementations. `query_state` is the
one exception: its `promptSnippet` is core's snippet plus
`" State shape summary: " + stateAdapter.describeShape()`.

## The seven tools

| Tool | What it does | Inputs |
|---|---|---|
| `snapshot_page` | Take a snapshot of the page as a compact, breadth-first outline with numbered refs on interactive elements and any collapsed container | `scope?: string` (a ref, to snapshot only that subtree), `interactive_only?: boolean` (default `false`), `include_text?: string` (a case-insensitive substring — keeps only elements whose text or label contains it, plus the ancestors leading to them) |
| `query_state` | Query the app's state with a JSONPath expression | `path: string`, `keys_only?: boolean` (default `false`), `limit?: number` (1-100, default 20) |
| `click` | Click an interactive element by its ref from the most recent snapshot | `ref: string` |
| `fill` | Set the value of a text input, textarea, or contenteditable, replacing existing content | `ref: string`, `value: string` |
| `select_option` | Choose an option in a native `<select>` by visible label or value | `ref: string`, `option: string` |
| `wait_for` | Wait until a condition is met | `condition: "dom_idle" \| "text_present" \| "state_path_truthy"`, `argument?: string`, `timeout_ms?: number` (100-15000, default 5000) |
| `see` | Render the page (or an element by ref) to an image and look at it | `ref?: string` |

(Descriptions above are based on `TOOL_DEFS.<name>.description` from
`packages/web-agent-core/src/tools/definitions.ts`.)

## Refs and generations

Refs come from `RefTable` (`src/adapters/ref-table.ts`). Every `snapshot()`
call invokes `invalidateAll()`, which bumps the generation, clears the
current-generation map and resets the ref counter to `1` (except when `scope`
specifies a stale, detached, or unknown ref, where an error is returned
immediately without invalidating existing refs). Refs are **1-based
per generation** and held as `WeakRef`, so a garbage-collected element
resolves as detached rather than leaking.

`RefTable.resolve(ref)` returns one of four outcomes:

- `ok` — the element is live in the current generation.
- `stale` — the ref existed in a prior generation; take a new snapshot.
- `detached` — the `WeakRef` cleared, or the element is no longer connected
  to the document.
- `unknown` — the ref was never assigned, or is not a valid ref number.

A snapshot's first line is always `generation: N` (`DomAdapter.snapshot`).

## What gets a ref

`snapshot_page` puts a `[N]` ref on an element it judges interactive:

- a native control — `<a href>`, `<button>`, `<input>`, `<select>`, `<textarea>`
- `contenteditable="true"`
- an `onclick` attribute
- `role` of button, link, tab, menuitem, checkbox, radio, combobox or switch
- `tabindex` of 0 or more
- failing all of those, an element with `cursor: pointer`, an accessible name,
  no interactive ancestor and no interactive descendant

A handler attached with `addEventListener` leaves nothing in the DOM to read,
and no standard API lists registered listeners. If your control is a `div` or a
custom element with a bound click handler and none of the signals above, the
snapshot cannot see it. Give it `role="button"` and `tabindex="0"` — that also
makes it reachable by keyboard and screen reader.

## Snapshot limits

`DomAdapter`'s constructor (`src/adapters/dom-adapter.ts:45-48`) sets four
budgets:

| Limit | Default | Effect |
|---|---|---|
| `snapshotMaxChars` | `12_000` | Character budget for one snapshot, including the `generation: N` line |
| `snapshotMaxDepth` | `12` | Max significant nesting depth emitted |
| `snapshotSubtreeMaxNodes` | `50` | Max child nodes of one parent that the snapshot considers; the rest are not shown |
| `snapshotMaxNodes` | `400` | Overall cap on the nodes one snapshot selects |

### How the snapshot spends its budget

The walk in `src/adapters/snapshot-walk.ts` (`walkFromRoot`) runs in three
passes:

1. **Select, breadth-first.** A first-in, first-out queue visits the page
   level by level, and each significant node it visits is selected until
   `snapshotMaxNodes` is reached (`snapshot-walk.ts:104-159`). The node budget
   is spread across the whole page, so one long branch that comes first in
   document order does not use all of it.
2. **Render in document order.** The selected nodes print as a nested,
   indented tree in the order they appear in the page, not in level order
   (`snapshot-walk.ts:171-276`).
3. **Add collapse markers** to nodes that have significant descendants that
   were not rendered (`snapshot-walk.ts:290-345`).

Two rules shape the selection:

- **`snapshotSubtreeMaxNodes` caps each parent's children.** Only the first
  `snapshotSubtreeMaxNodes` child nodes of a parent enter the queue
  (`snapshot-walk.ts:146-148`). This includes text nodes and nodes that have no
  role. The rest are never selected. Without this cap, one parent with hundreds
  of children (for example a long list of language links) would use the whole
  node budget at one level. A snapshot with `include_text` set does not apply
  this cap (see [Find an element with `include_text`](#find-an-element-with-include_text)).
- **Only significant nodes add depth.** An element with no role that is not
  interactive adds no indentation, so its children stay at the same depth
  (`snapshot-walk.ts:149-153`).

When some of a node's significant descendants are not rendered, the node gets
a ref (even if it is not interactive) and its line ends with:

```
… +N nodes hidden — snapshot_page(scope="<ref>") to expand
```

(`TOOL_DEFS.snapshot_page.description`; emitted in pass 3 at
`snapshot-walk.ts:342`.) Call `snapshot_page` again with `scope` set to that
ref to drill in, rather than re-snapshotting the whole page.

When the node budget stops the selection before every significant node is
shown, the snapshot ends with (`snapshot-walk.ts:350-355`):

```
… TRUNCATED: N more significant nodes not shown (node budget M reached). Narrow with scope="<ref>" on a section above, or interactive_only=true.
```

When the text is still longer than `snapshotMaxChars`, it is cut at that length
and ends with (`snapshot-walk.ts:361-365`):

```
… TRUNCATED (char cap C). Use scope or interactive_only to narrow.
```

On a large page, the first unscoped snapshot can reach the character cap before
it reaches the main content. Use `scope` on a section, or `include_text`, to
see the part you need.

## Find an element with `include_text`

`include_text` keeps only the nodes that contain a term, so you can find one
control on a large page without paging through the whole tree
(`src/adapters/snapshot-match.ts`, `src/adapters/snapshot-walk.ts`).

```ts
snapshot_page({ include_text: "wikidata" })
```

How a node matches (`makeTermMatcher` and `searchText`,
`snapshot-match.ts:12-48`):

- The test is a case-insensitive substring match. The term is trimmed first.
- An element matches on its full text content (which includes its
  descendants' text), its own `title`, `aria-label`, `alt` and `placeholder`
  attributes, and its current `value` when it is an `<input>`, `<textarea>` or
  `<select>`.
- A text node matches on its own text.
- An absent, empty or whitespace-only term turns the filter off. The output is
  then the same as a snapshot without `include_text`.

What the result contains:

- Every selected match, plus the significant ancestors that lead to it, so the
  result is still a tree (`snapshot-walk.ts:209-210`). Because an element's
  text content includes its descendants' text, the ancestors of a text match
  usually match too.
- The term decides only what is selected. The walk still visits every branch,
  so a control that matches only through an attribute stays reachable
  (`snapshot-walk.ts:118-124`).
- The per-parent `snapshotSubtreeMaxNodes` cap does not apply, so a match past
  that cap is not lost (`snapshot-walk.ts:146-148`). `snapshotMaxNodes`,
  `snapshotMaxDepth` and `snapshotMaxChars` still apply.
- The `+N nodes hidden` markers and the `TRUNCATED` line count only matching
  nodes (`countSignificant`, `snapshot-format.ts:69-116`).

When nothing matches, the tool returns this text instead of an empty tree
(`snapshot-walk.ts:164-169`):

```
generation: N
No element contains "X". Take a snapshot without include_text to see the page, or try a shorter term.
```

A filtered snapshot is still a new generation. It invalidates the refs from
every earlier snapshot, the same as an unfiltered one
(`src/adapters/dom-adapter.ts:84`).

`include_text` works with `scope` and `interactive_only`. With
`interactive_only: true`, text nodes are not selected, so only interactive and
role-bearing elements can match.

## `query_state`

`StateAdapter.query` (`src/adapters/state-adapter.ts`) returns a JSON object
shaped `{ total_matches, returned, results }`.

- `limit` defaults to `20` (`DEFAULT_LIMIT`), capped at `100` (`MAX_LIMIT`).
- Serialization depth caps at `6` (`DEPTH_LIMIT`).
- Each leaf string caps at `300` chars (`LEAF_CHAR_LIMIT`).
- The whole output caps at `6000` chars (`DEFAULT_QUERY_RESULT_MAX_CHARS`).
  Over that cap, `StateAdapter.query` drops results first, then
  hard-truncates the output.
- Arrays print at most 20 items, then `…+N more`.

A path not starting with `$` returns:

```
Invalid JSONPath: Path must start with $. Paths must start with $.
```

(`invalidJsonPath` in `src/tools/error-messages.ts`.)

`StateAdapter.describeShape()` emits a types-only summary of the state,
capped at `1000` chars (`DESCRIBE_SHAPE_MAX_CHARS`), folded into
`query_state`'s prompt snippet.

## Result lifetime: `ttl` and `uttl`

`snapshot_page` and `query_state` are the only two DOM tools that limit how long
their results stay in the conversation. They set core's `ttl` and `uttl` fields
on their tool definition (`src/tool-provider.ts:122-123` and `:135-136`):

| Tool | `ttl` | `uttl` |
|---|---|---|
| `snapshot_page` | `1` | `2` |
| `query_state` | `3` | `2` |

`ttl` counts **results per argument set**: with `ttl: 1`, only the newest
`snapshot_page` result for the same arguments stays; an older one with those
same arguments is replaced. Every argument counts — `scope`,
`interactive_only` and `include_text` for `snapshot_page`, and `path`,
`keys_only` and `limit` for `query_state`. Core compares the whole argument
object, with keys sorted (`hashArgs`,
`packages/web-agent-core/src/loop/context-helpers.ts:41-44`). So a snapshot
with a different `scope` or a different `include_text` term has its own window
and does not push this one out.

`uttl` counts **user turns**: with `uttl: 2`, a result is replaced once it is
more than two user turns old. One user message that drives twenty tool calls is
one turn.

The two are independent tests, not a fallback chain — whichever expires first
replaces the result. A replaced result is not deleted; its text becomes a short
note naming the tool, so the model can see the call happened and run it again.

If the agent seems to have "lost" a snapshot it just took, this is why: take a
new one rather than expecting the old text to still be there.

The five other DOM tools set neither field, so their results are kept for the
whole conversation.

For the mechanism itself — how core stores, matches and replaces a result — see
[core's custom tools page](../../web-agent-core/docs/custom-tool.md).

## `wait_for`

`runWaitFor` (`src/tool-provider.ts`) supports three conditions:

- `dom_idle` — resolves after a **300 ms** quiet window with no mutations
  outside the agent UI (`waitForIdle` in `src/adapters/waiters.ts`).
- `text_present` — polls every **250 ms** for a case-sensitive text substring
  in the page, outside the agent UI (`waitForText` in `src/adapters/waiters.ts`).
- `state_path_truthy` — polls every **500 ms** for a JSONPath match to be
  truthy (`waitForPathTruthy` in `state-adapter.ts`).

`timeout_ms` defaults to `5000` in `runWaitFor`. Core's schema
(`waitForSchema`, `definitions.ts`) allows `100`–`15000`. A timeout is **not**
an error — the tool returns:

```
Timed out after <ms>ms waiting for <condition> …. Condition not met.
```

## `click`

`click` (`DomAdapter.click`) resolves the ref, checks the interaction
permission, plays the action cue when there is one, dispatches the pointer and
mouse sequence, and returns:

```
Clicked [N] <description>. Page may have changed; snapshot again if you need to verify.
```

**When the target is not visible, the click still happens and the result is
still a success** — a short note is appended after the first sentence:

```
Clicked [N] <description>. Note: ref N ("name") is not visible on screen. Page may have changed; snapshot again if you need to verify.
```

"Not visible" here means either of two things: CSS hides the element
(`display: none`, `visibility: hidden`, or a computed opacity of `0`), or its
box measures zero in width or height. Both are checked in
`performClick` (`src/adapters/interactions.ts:39-43` and `:93`). The string itself is built by
`invisibleTargetNote` in `src/tools/error-messages.ts:76-80`.

This is a note on a success, not an error. The action ran. If you are a host
asserting on the exact text of a `click` result, an equality check against the
old string fails once this note appears — match on a substring instead.

The action cue is skipped for a CSS-hidden target, because there is nothing on
screen to animate.

## `fill` and `select_option`

`fill` (`DomAdapter.fill`) replaces existing content and drives the field
through the same event sequence a person produces: `pointerdown`, `mousedown`,
`focus`, then per typed chunk `keydown`, `beforeinput`, `input`, `keyup`, then
`change`, then `blur` and `focusout`. `beforeinput` and `input` are
`InputEvent`s with `inputType: "insertText"`. The value itself is written
through the native prototype value setter, so controlled React inputs still
see it. A contenteditable gets the same sequence without `change`, because a
browser fires no `change` on one. After typing, `fill` reads the value back. A
mismatch returns:

```
… set "X" but value read back as "Y" (input may have validation/mask).
```

Typing is instant when `typingPaceMs <= 0`, when the value is empty, or under
`prefers-reduced-motion`. Otherwise it types word-by-word at the configured
pace.

When the field is not visible — CSS-hidden or a zero-size box — `fill` still
fills it, and appends the same success note `click` uses
(`src/adapters/interactions.ts:172`):

```
Filled [N] <description> → value="X". Note: ref N ("name") is not visible on screen.
```

The `click` section above lists what "not visible" covers. This is a success,
not a failure.

`select_option` (`DomAdapter.selectOption`) matches an option in three steps,
in order: visible label (case-sensitive), then value (case-sensitive), then
visible label again (case-insensitive). It dispatches `focus`, then `input`,
`change`, `blur` and `focusout`.
No match returns:

```
No option "X". Available: …
```

(`selectOptionMissing`, listing up to 20 options then `…+N more`.)

`select_option` appends the same invisible-target note on success when the
`<select>` is not visible (`src/adapters/interactions.ts:240`):

```
Selected "X" in [N] <description>. Note: ref N ("name") is not visible on screen.
```

## `see`

`see` (`src/tool-provider.ts`, the `includeImages` branch) calls
`DomAdapter.screenshot()`, which runs `captureScreenshot`
(`src/adapters/screenshot.ts`). That function rasterizes the target with
`html-to-image`'s `toPng`, filters out `[data-agent-ui]`, then downscales
through core's `downscaleToolImage`: a 1536 px long edge and 1 MB at most
(`TOOL_IMAGE_LIMITS`). The capture stays PNG; a PNG still over 1 MB at
1536 px is halved once, to a 768 px long edge.

Three outcomes are possible:
- **Error** — the element cannot be photographed at all (zero-size rect or empty
  rasterization result). No image is returned.
- **Image and warning** — the capture succeeded but probably does not show the
  scoped element (CSS says hidden, or alpha scan finds 0 visible pixels). The
  text appends:
  ```
  Warning: ref N ("name") is hidden, so this screenshot may not contain the element. Treat what you see as the surrounding page, not as the element.
  ```
- **Image alone** — clean capture of a visible element or unscoped page.

`see` returns the base text:

```
Screenshot captured. A screenshot has been added as a user image message for visual analysis.
```

plus an `images` payload with one image. When a warning fires, it is appended after a space.
`see` is absent from `load()`'s result entirely when `images: false`.

## Error and warning messages

All from `src/tools/error-messages.ts`, quoted exactly (placeholders shown as
`N`/`X`/`Y`). Not every row is a failure. The **Outcome** column says which of
three things happened:

- **Error** — the message is thrown, and the tool call comes back as an error.
  The action did not run.
- **Result, no action** — the tool returns normally, but nothing was changed on
  the page.
- **Success + note** — the action ran and worked. The message is appended to the
  successful result.

| Case | Outcome | Message |
|---|---|---|
| Stale ref | Error | `Ref N is stale (generation G, current C). Take a new snapshot.` |
| Detached ref | Error | `Ref N no longer exists in the DOM. Take a new snapshot.` |
| Disabled ref | Error | `Ref N ("name") is disabled. Inspect the form for unmet requirements.` |
| No matching option | Error | `No option "X". Available: …` |
| User pressed Stop mid-cue | Result, no action | `Stopped by the user before the action on ref N ran. Nothing was changed on the page.` |
| `see` target not visible | Error | `Ref N ("name") is not visible, so there is nothing to capture. Call see without a scope to capture the page, or take a new snapshot and pick a visible element.` |
| `see` produced no image bytes (unscoped) | Error | `The screenshot came back empty and was discarded, so no image was sent. Call see without a scope to capture the page, or use snapshot to read the page as text.` |
| `see` target hidden warning | Success + note | `Warning: ref N ("name") is hidden, so this screenshot may not contain the element. Treat what you see as the surrounding page, not as the element.` |
| `click`, `fill` or `select_option` target not visible | Success + note | `Note: ref N ("name") is not visible on screen.` |

Three outcomes are easy to confuse with each other, so to be explicit:

- A `see` on a hidden element is an **error** — there is nothing to photograph.
- A `click`, `fill` or `select_option` on a hidden element is a **success** —
  the element is still in the DOM and the action still runs. Only the note is
  added.
- `Stopped by the user` is neither. The user pressed Stop before the action ran,
  so the page is unchanged, and the tool reports that as an ordinary result.

See [core's Tools page](../../web-agent-core/docs/tools.md) for how
`ToolDef`s are defined and built.
