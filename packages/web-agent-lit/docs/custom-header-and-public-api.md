---
title: Custom header & panel API
---

# Custom header & panel API

`<agent-chat-panel>` ships with a built-in header: the session title, a new-session
button, a history button, and a kebab menu for configuration, debug, and model
choice. A host can turn that header off and build its own, driving the panel
through a small set of public methods.

## Hiding the built-in header

Set `hideHeader` to `true` on the panel:

```js
const panel = document.querySelector("agent-chat-panel");
panel.hideHeader = true;
```

`hideHeader` also works as the HTML attribute `hide-header`. The panel observes
it (`chat-panel.ts:20-22`), reads any value other than `"false"` as true
(`chat-panel.ts:33-38`), and reflects the property back to the attribute
(`chat-panel-props.ts:123-133`), so the two stay in sync:

```html
<!-- header hidden -->
<agent-chat-panel hide-header></agent-chat-panel>

<!-- header shown; "false" is the one value that turns it off -->
<agent-chat-panel hide-header="false"></agent-chat-panel>
```

`path`, `model`, `type` and `thinking` are observed attributes too
(`chat-panel.ts:20-22`). `debug` is not: it is a property only. `hideHeader` defaults to `false`, so a host that sets
nothing gets today's panel, header included.

When `hideHeader` is `true`, the panel renders only the message list and the
composer. The built-in history panel, configuration view, and debug view do not
render either — build equivalent controls in your own header and drive the panel
through the methods below.

`<agent-chat-panel>` renders into light DOM, so it has no `<slot>` for a header
element placed inside it — a child element you place inside the panel is
destroyed on the next render. Put your header **outside** the panel, in your own
page layout, not inside the `<agent-chat-panel>` tag.

## Sizing the panel for your layout

The panel does not place or size itself. It is `position: relative` and fills
the box you give it — `width: 100%; height: 100%`
(`src/chat-ui/chat-panel-shell-css.ts:7-28`). Put it in a wrapper of your own and
size the wrapper:

```css
.my-agent-slot {
  position: relative;   /* or absolute, or fixed — your layout decides */
  width: 420px;
  height: 640px;
}
```

```html
<div class="my-agent-slot">
  <agent-chat-panel></agent-chat-panel>
</div>
```

**Do not override `position` on `agent-chat-panel` itself.** `relative` is
deliberate: it makes the panel the containing block for the confirm scrim, which
is appended to the panel element as an absolutely positioned overlay pinned to
all four edges (`src/chat-ui/confirm-scrim.ts:45-46`, appended at `:135`).
Setting `position: static` on the panel removes that containing block, so the
scrim resolves against some ancestor instead and no longer covers the panel —
and the scrim is what gates destructive tool calls.

`<web-agent-bubble>` sizes the panel the same way: the bubble's
`#panel-container` carries the width and height
(`src/embed/bubble-shadow-template.ts:8-25`) and the panel fills it.

## Slash-command popup menu

The chat composer includes a popup slash-command menu
(`src/chat-ui/slash-menu.ts`, `src/chat-ui/chat-panel-composer.ts:24-134`). When
the user types `/` as the first character in the composer, the panel opens a
listbox above the composer. The menu closes when the text contains a space,
because the user has moved on to the argument.

- **Entries**: The menu lists action commands (for example `/new` and
  `/compact`) and skill commands. A chevron icon marks an action and a page
  icon marks a skill (`SLASH_ICON_ACTION` and `SLASH_ICON_SKILL`,
  `src/chat-ui/slash-menu.ts:16-22`). A row also shows other names that run the
  same command (for example `or /clear`), the command's argument hint, and its
  description. A legend under the list explains the two icons and the keys
  (`src/chat-ui/slash-menu.ts:73-147`).
- **Filtering**: The menu matches the text after `/` against, in order, the
  start of the command name, the start of another name for the command, any
  part of the name, and the description. It shows only the matches from the
  best of those four groups (`src/chat-ui/slash-menu.ts:32-54`). With no
  match, the menu closes and Enter sends the text as usual.
- **Keyboard navigation**: `ArrowUp` and `ArrowDown` move the highlight, `Tab`
  and `Enter` pick the highlighted command, and `Escape` closes the menu
  (`src/chat-ui/chat-panel-composer.ts:136-170`).
- **Command insertion**: Picking a command does not run it. The panel inserts
  `/<name> ` with a trailing space into the composer and puts the caret after it
  (`src/chat-ui/chat-panel-composer.ts:109-119`). The user can add an argument,
  then press Enter again to send.
- **Running a command**: On send, the panel checks the text against the
  session's commands before it sends anything to the model. A known command
  runs. If a turn is running, the command waits in the queue and runs when the
  turn ends. Text that matches no command is sent as an ordinary message
  (`src/chat-ui/chat-panel-composer.ts:194-213`).
- **Theming**: The menu uses `--wa-*` CSS variables only
  (`src/chat-ui/chat-panel-composer-css.ts:48-158`).

For the other built-in behavior of the panel, such as the message window,
status notices, and composer indicators, see
[Built-in chat panel features](./chat-panel-features.md).

## Public panel methods

These methods cover everything the built-in header offers, so a host header can
reproduce it:

| Method | Signature | What it does |
|---|---|---|
| `createSession` | `() => Promise<string>` | Creates a session, makes it active, and resolves to its id. Resolves to `""` when the panel has no session to create one from. |
| `switchSession` | `(id: string) => Promise<void>` | Makes an existing session the active one. |
| `renameSession` | `(id: string, title: string) => Promise<void>` | Renames a session and marks the title as manual if it is the active session, so auto-titling does not overwrite it. |
| `deleteSession` | `(id: string) => Promise<void>` | Deletes one session. |
| `clearAllSessions` | `() => Promise<void>` | Deletes every stored session. |
| `listSessions` | `() => SessionMeta[]` | Returns the sessions the built-in history panel lists, read live from the session. The array is the one core holds, so copy it before you sort or splice it. |
| `send` | `(input: string \| { text: string; images?: { dataUrl: string; mediaType: string }[] }, opts?: { userDisplayText?: string }) => Promise<SendOutcome>` | Sends a user message and runs a turn. Pass a string for text only, or the object form to attach images. `opts.userDisplayText` overrides what the message list shows, without changing what the model receives. The text goes through the same slash-command parser as the composer, so `send("/compact")` runs the command instead of posting the text. The promise resolves to what happened: `{ ran: "command", command }`, `{ ran: "message" }`, or `{ ran: "none" }` when there is no session (`src/chat-ui/types.ts:135-138`, `src/chat-ui/chat-panel-session.ts:221-262`). |
| `stop` | `() => void` | Aborts the turn that is running. |
| `retryLast` | `() => Promise<void>` | Retries the last turn, the same way the built-in retry control does. A turn that failed part-way through CONTINUES from its last completed step, so a tool that already ran is not run again. It does nothing while a turn is running. |
| `compactSession` | `() => Promise<void>` | Compacts the active session's context, the same way the built-in menu does. |
| `setModel` | `(id: string) => void` | Switches the model for the next turn without rebuilding the session's transport or losing the conversation. |
| `getDebugLog` | `() => string` | Returns the full debug log text — the host and agent config, the provider fallbacks in this page load, then every message and tool call (`src/chat-ui/chat-panel-screens.ts:142-171`). |
| `confirmInteraction` | `(detail: ConfirmScrimDetail) => Promise<boolean>` | Raises the built-in "ask"-tier confirm scrim and resolves to the user's answer. A host wires it into the DOM tools — `domTools({ confirmInteraction: panel.confirmInteraction.bind(panel) })` — so an "ask"-tier click, fill or select is gated by the dialog. |

### Public getters and properties

In addition to methods, `<agent-chat-panel>` exposes getters and properties used by custom headers and integrations:

| Property | Type | Access | What it does |
|---|---|---|---|
| `canCompact` | `boolean` | get | True when the active session has enough context history to be compacted (`src/chat-ui/chat-panel-state.ts:158-160`). A custom header uses this to enable or disable its own compact button. |
| `compacting` | `boolean` | get | True while context compaction is in flight (`src/chat-ui/chat-panel-state.ts:154-156`). A custom header uses this to show a busy spinner or disable controls during compaction. |
| `running` | `boolean` | get | True while a turn is running (`src/chat-ui/chat-panel-state.ts:149-151`). |
| `messages` | `SessionMessage[]` | get | The active session's messages (`src/chat-ui/chat-panel-state.ts:140-142`). |
| `skillRegistry` | `SkillRegistry \| undefined` | get/set | Host skill registry providing skills the agent can execute, save via `create_skill`, and delete via `delete_skill` (`src/chat-ui/chat-panel-props.ts:202-207`). |
| `attachmentProviders` | `AttachmentProvider[] \| undefined` | get/set | Host attachment providers appended to built-in providers for custom attachment pickers (`src/chat-ui/chat-panel-props.ts:216-224`). |
| `type` | `"openai" \| "anthropic" \| "gemini" \| "mock"` | get/set | Backend provider protocol type (`src/chat-ui/chat-panel-props.ts:82-87`). Accepts `"gemini"` alongside `"openai"` and `"anthropic"`. |
| `config` | `Partial<SessionConfig> \| undefined` | get/set | Session config passed to core. The panel itself also reads `persist`, `messageWindow`, `todo`, `scheduler` and `context.autoCompactPercent` from it. See [Built-in chat panel features](./chat-panel-features.md). |

See the JSDoc comments above each method in
`packages/web-agent-lit/src/chat-ui/chat-panel-session.ts` for the full behavior notes,
including why `setModel` and assigning the `model` property are not
interchangeable.

## Authenticating requests

`fetch` is a property, not a method: assign your own `fetch` to
`panel.fetch` (`src/chat-ui/chat-panel-props.ts:89-94`) or to `<web-agent-bubble>`
(`src/embed/web-agent-embed.ts:112-121`, forwarded at `:392`). When assigned to the bubble,
it forwards directly to the inner panel. The panel injects it into the session,
allowing hosts to supply authentication headers or token refresh logic for
token-gated API routes. See
[Endpoint types](../../web-agent-core/docs/providers.md) —
"Customizing authentication with fetch injection".


