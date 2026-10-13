---
title: Agent cursor (action cues)
---

# Agent cursor (action cues)

The agent cursor is a fixed-position SVG overlay that shows the user what the
agent is doing — moving to a target element, clicking, or filling text. The
cursor itself lives in `web-agent-lit`, but the panel does not connect it to
the tools. Your host connects it: build an `ActionCueFn` with
`createActionCue()` and pass it to `domTools({ actionCue })`. All three hosts do
this (`apps/cat-store/src/web/agent-panel-config.ts:241`,
`apps/docs-site/src/docs-embed.ts:69`,
`packages/web-agent-browser/src/content.ts:104`). You never call cursor methods
yourself.

---

## How it works

`createCursor()` in `packages/web-agent-lit/src/chat-ui/agent-cursor.ts`
injects a `.wa-agent-cursor-layer` `<div>` into `document.body` on first use.
The cursor is a singleton — `agentCursor` is a `Proxy` that lazily calls
`getOrCreateCursor()` on every access, so all tool-executor code shares the
same cursor without explicit setup.

When a run ends, `agent-chat-panel` calls `destroy()`, so a finished or stopped
run leaves no `.wa-agent-cursor-layer` on the page. It does this only when the
panel's own `cues` property has `enabled: true`
(`packages/web-agent-lit/src/chat-ui/chat-panel-session.ts:83-93`).

---

## AgentCursor interface

All public methods on the `AgentCursor` interface:

| Method | Signature | Description |
|--------|-----------|-------------|
| `moveTo` | `(point: {x, y}, speed?: "slow" \| "fast") => Promise<void>` | Animate cursor to absolute page coordinates; resolves when animation completes |
| `clickPulse` | `() => void` | Emit a 600 ms scale-ring pulse at the current cursor position |
| `flash` | `(rect: {x, y, width, height}) => void` | Overlay a 500 ms opacity flash over a rect (used by `see`) |
| `show` | `() => void` | Make the cursor visible |
| `hide` | `() => void` | Hide the cursor |
| `reset` | `() => void` | Alias for `clear()` |
| `clear` | `() => void` | Cancel all pending timers, abort any in-progress move, hide cursor, remove transient pulse/flash elements |
| `destroy` | `() => void` | `clear()`, then remove the `.wa-agent-cursor-layer` element from `document.body`. The next cue rebuilds it. |

---

## Speed presets

`CuesConfig.speed: "slow" | "fast"` maps to `SPEED_PRESETS` in
`packages/web-agent-core/src/config.ts`:

| Preset | `travelPxPerSec` | `msPerWord` |
|--------|-----------------|-------------|
| `"slow"` | 600 px/s | 220 ms/word |
| `"fast"` | 1400 px/s | 90 ms/word |

Travel duration is `distance / pxPerMs`, clamped to **[120 ms, 1200 ms]** per
move. The clamp keeps very short and very long moves within the same time
range.

---

## Visual effects

Three animation classes come from a `<style>` element the cursor renders inside
its own `.wa-agent-cursor-layer`. Nothing is written to `document.head`, so the
rules reach the cursor wherever the layer is placed:

- **`wa-cursor-pulse`** — 600 ms `scale(0.2→2.4)` ring fired by `clickPulse()`.
  Appended to the cursor layer, then self-removed on `animationend` (with a
  timer fallback at 600 ms).
- **`wa-cursor-flash`** — 500 ms opacity fade over a bounding rect, fired by
  `flash()`. Self-removed on `animationend` (fallback at 500 ms).
- **CSS `transform` transition** on `.wa-agent-cursor` — smooth pointer
  movement driven by `translate(x, y)` with duration calculated per-move.

---

## Lifecycle

- **Show on move** — `moveTo()` calls `show()` before animating.
- **Hide on clear** — `clear()` / `reset()` calls `hide()` after cancelling
  timers.
- **Transient elements** — pulse and flash `<span>` elements are appended to
  the cursor layer and removed automatically; they do not accumulate.
- **Interrupted move** — if a new `moveTo()` is called before the previous one
  resolves, the previous `Promise` resolves immediately and the new animation
  starts.

---

## Accessibility

When `window.matchMedia("(prefers-reduced-motion: reduce)")` matches:

- `clickPulse()` and `flash()` return without adding an element
  (`packages/web-agent-lit/src/chat-ui/agent-cursor.ts:173`, `:186`). The
  stylesheet also sets `animation: none !important` on `.wa-cursor-pulse` and
  `.wa-cursor-flash`.
- The CSS `transition` on `.wa-agent-cursor` is set to `none !important`.
- `moveTo()` skips the animation entirely and repositions the cursor instantly.
- Cursor position **still updates** — the agent's actions remain visible without
  motion.

---

## Turn the cursor on or off

The cursor appears only when a DOM tool receives an `actionCue`. To turn it
off, do not pass `actionCue` to `domTools()`.

`CuesConfig` (`{ enabled, speed }`) does **not** control the cursor.
`createActionCue()` has no `enabled` check, and it takes its speed from the
`speed()` function you pass, not from `CuesConfig`
(`packages/web-agent-lit/src/chat-ui/cue-actions.ts:6-15`). Core passes
`cues` through its config (`src/controller-config.ts:55`, default
`{ enabled: true, speed: "slow" }` at `src/config.ts:63`), but no code in core
or in `@cuatoi/web-agent-dom` reads it.

The Lit panel reads its own `cues` property, not `panel.config.cues`:

```ts
panel.cues = { enabled: true, speed: "slow" };
panel.onCuesChange = ({ enabled, speed }) => {
  // Store the user's choice. Your actionCue must read it to change behavior.
};
```

- The **Settings** screen shows a "Show the agent cursor while it works"
  checkbox and **Slow** / **Fast** buttons. They read `panel.cues`, and show
  `enabled: false` when `panel.cues` is not set
  (`packages/web-agent-lit/src/chat-ui/chat-panel-screens.ts:14-19`, `:62-79`).
- A change in Settings updates `panel.cues`, calls `onCuesChange`, and calls
  `clear()` on the cursor when you turn it off
  (`packages/web-agent-lit/src/chat-ui/chat-panel-screens.ts:34-42`).
- The panel removes the cursor layer at the end of a run only when
  `panel.cues.enabled` is `true` (see [How it works](#how-it-works)).

---

## Relationship to built-in tools

The agent cursor is driven by tool executors, not directly by user code. Core
owns the `CueKind` / `CuesConfig` types and the speed presets; the executors
that fire the cues ship with `@cuatoi/web-agent-dom`, which receives the
`ActionCueFn` through `domTools({ actionCue })`.

| Tool | Cue kind | Effect |
|------|----------|--------|
| `click` | `"click"` | `moveTo` the target element's center, then `clickPulse` |
| `fill` | `"fill"` | `moveTo` the field's center, then focus the element — **no** `flash` |
| `select_option` | `"select"` | `moveTo` the select element's center |
| `see` | `"see"` | `moveTo` the captured region's center, then `flash` over that region |

Each executor calls the `ActionCueFn` from `createActionCue()` before the
actual DOM interaction. The host never needs to call cursor methods directly.

`createActionCue()`'s per-kind switch (`cue-actions.ts`) is the source of
truth for the table above; `click`/`fill`/`select` derive their point from
`detail.point`, `detail.rect`'s center, or the target element's own bounding
rect — whichever is supplied. `see` is the only kind called with `rect` (no
`point`) and the only kind that fires `flash`.
