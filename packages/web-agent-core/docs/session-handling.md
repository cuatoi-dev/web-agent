---
title: Session handling (multi-session UI)
---

# Session handling (multi-session UI)

The agent supports multiple named sessions. Each session persists its message
history and metadata to IndexedDB when persistence is on (see
[Enabling sessions](#enabling-sessions)). Without it, the conversation lives
only in memory for the current page load.

---

## Enabling sessions

Set `AgentConfig.persist` to `true`. Core then uses `sessionStore` when you set
one, and otherwise creates an `IdbSessionStore` with `sessionNamespace`
(`src/controller-config.ts:98-102`). `persist` defaults to `false`
(`src/config.ts:58`). With `persist` off, core ignores `sessionStore` and
`sessionNamespace`.

```ts
import { IdbSessionStore } from "@cuatoi/web-agent-core";

panel.config = {
  // ...
  persist: true,
  sessionNamespace: "my-app",   // easiest — isolated per-host IndexedDB DB
  // — OR —
  sessionStore: new IdbSessionStore("my-app"),  // explicit
};
```

The Lit panel hides the "New session" button, the "Session history" button and
the rename controls only when `panel.config.persist` is exactly `false`
(`packages/web-agent-lit/src/chat-ui/chat-panel.ts:159`, `:163-164`). When you
leave `persist` unset, the panel shows them, but core stores nothing. See
[Session backend interface](./session-backend.md).

---

## Session metadata

Each session has a `SessionMeta` object:

```ts
interface SessionMeta {
  id: string;
  title: string;
  titleManual: boolean;   // true when user has explicitly renamed it
  createdAt: number;      // Unix ms
  updatedAt: number;      // Unix ms
  messageCount: number;
  todos?: TodoItem[];     // the session's todo list, when todo tracking is on
  lastSeq?: number;       // highest record sequence written
}
```

From `src/loop/types.ts:7-18`. See [Todo tracking](./todo.md#persistence) for
`todos`.

---

## Session lifecycle in the UI

The session UI is in `packages/web-agent-lit/src/chat-ui/`. The header
template is in `chat-panel.ts`, the buttons are created in
`chat-panel-elements.ts`, the history panel is in `chat-panel-history.ts`, the
title editor is in `chat-panel-screens.ts`, and auto-title is in
`chat-panel-session.ts`. The header buttons are disabled while a turn runs
(`chat-panel.ts:111-118`).

### New session

The "New session" icon button (`_newSessionBtnEl`) in the panel header calls
`createSession()` (`chat-panel-elements.ts:136-141`). The "+ New Session"
button at the bottom of the history panel does the same
(`chat-panel-history.ts:163-167`, `:230-233`). Core gives the new session a
generated UUID and an empty title (`src/controller-sessions.ts:200-210`). Until
the session has a title, the header shows the agent name or the app name
(`chat-panel.ts:133-139`), and the history row shows the creation date
(`session-label.ts:15-26`).

### Session history

The "Session history" icon button (`_historyBtnEl`) opens a history panel
(`chat-panel-elements.ts:116-122`). Each row shows the session title and its
`updatedAt` time (`chat-panel-history.ts:130-143`). The panel lists
`SessionState.sessions` in the order core gives it. `IdbSessionStore` sorts
that list by `updatedAt`, newest first (`src/loop/session-store.ts:147-150`).

Clicking another session asks "Switch to this session?" first. Clicking the
active session closes the panel (`chat-panel-history.ts:113-127`, `:220-228`).
To load a session, core calls `readRange()` on the store, 200 records at a
time, until it reaches the start of the session, and rebuilds the message list
(`src/controller-sessions.ts:99-118`, `:233-255`).

### Auto-title

The panel asks core for a title after the first assistant reply, and again
after the third (`chat-panel-session.ts:120-129`). Core sends the conversation
to the model and asks for a 3 to 6 word title. It removes surrounding quotes,
cuts the title to 80 characters, and saves it with `titleManual: false`
(`src/controller-sessions.ts:299-317`). Auto-title does nothing without a
session store. Once the user renames the session, `titleManual` is `true` and
the panel stops auto-titling that session.

### Rename

There are two ways to start a rename. Both open the same inline text input in
the panel header:

- The "Edit session title" button (`_titleEditBtnEl`). It appears when you
  move the pointer over the header, or when keyboard focus moves into the
  header. On a touch device it is always shown
  (`chat-panel-shell-css.ts:88-103`).
- A double-click on the session title text.

Both are hidden only when `panel.config.persist` is `false`
(`chat-panel.ts:159`, `chat-panel-screens.ts:279-280`). While the input is
open, **Enter** or the "Save title" button saves, and **Escape** or the
"Cancel title edit" button cancels (`chat-panel-elements.ts:173-211`). Saving
an empty title closes the editor without a change
(`chat-panel-screens.ts:290-296`). Saving calls `setTitle()`, which stores the
title with `titleManual: true` (`src/controller-sessions.ts:291-297`).

### Delete

Each row in the history panel has a delete icon button. It asks "Delete this
session?" and then calls `deleteSession(id)` for that one session
(`chat-panel-history.ts:145-153`, `:214-218`). Core calls
`SessionStore.deleteByIds([id])`. If you delete the active session, core
creates a new one (`src/controller-sessions.ts:270-280`).

The "Clear all history" button at the bottom of the history panel asks for
confirmation, deletes every stored session, and starts a new session
(`chat-panel-history.ts:176-181`, `:235-239`,
`src/controller-sessions.ts:282-289`).

---

## Session state flow

`createAgentSession()` creates an `AgentSession` that wires the UI state
(`SessionState`) to the panel. The `SessionConfig` holds the current
`AgentConfig` and is updated via `updateConfig()` whenever panel properties
change.

Each message in `SessionState.messages` exposes an array of `parts` (`SessionMessagePart`
at `src/controller.types.ts:24-32`). Parts include `text`, `block`, `tool`, and `compaction`.
Compaction parts record history compression runs. On live runs, compaction parts
carry `stats?: CompactionStats`, whereas reloaded sessions reconstruct compaction parts
with `status: "done"` and no `stats`. See [Compaction](./compaction.md) for full
details and presence guards.

---

## Session-only config fields

`SessionConfig` extends `Partial<AgentConfig>` and adds these fields
(`src/controller.types.ts:93-126`):

| Field | What it does |
|---|---|
| `appContext.appName`, `appContext.appDescription` | Name and describe the host app in the system prompt. Defaults: `"Web Application"` and `"An interactive web application."` |
| `appContext.appInstructions` | Your own instructions for this agent. Core copies them to `ToolContext.app` (`src/controller-config.ts:147`) and adds them to the system prompt as an `# App instructions` section (`src/prompt/system-prompt.ts:121-123`). |
| `appContext.userName`, `appContext.userInfo` | Details about the current user, added to the system prompt as data, not instructions. |
| `store` | An object with `getState()`. Core reads `getState().ui.route` for the current route before each turn. |
| `sources` | The `SourceEntry[]` behind the data tools. See [Tools & data sources](./tools.md#wiring-data-sources). |
| `scheduler` | `{ enabled: true }` turns on the scheduler. See [Scheduler](./scheduler.md). |
| `todo` | `{ enabled: true }` turns on todo tracking. See [Todo tracking](./todo.md). |
| `messageWindow` | How many rendered rows the chat panel keeps in the page. Core never reads it; the framework binding does. |

---

## AgentSession methods

From `src/controller.types.ts:140-215`:

| Method | What it does |
|---|---|
| `getState()` | Returns the current `SessionState`. |
| `subscribe(listener)` | Calls `listener` now and after every state change. Returns an unsubscribe function. |
| `subscribeEvents(listener)` | Receives `SessionEvent` values: `retry:start`, `retry:success`, `retry:failure`, `auto-retry:attempt` and `provider:fallback`. |
| `send(parts, opts?)` | Starts a turn. If a turn is already running, core adds the message to `queuedMessages` instead. `opts.userDisplayText` sets the text shown for the user message. |
| `retryLast()` | Retries the last turn. See [Retry the last turn](#retry-the-last-turn). |
| `abort()` | Stops the running turn and any running compaction. |
| `compact()` | Compacts the history now. Does nothing while a turn or compaction runs, or when there is nothing to compact. |
| `reset()`, `createSession()` | Start a fresh session. |
| `switchSession(id)`, `deleteSession(id)`, `clearAllSessions()` | Change sessions. Deleting the active session starts a fresh one. |
| `setTitle(id, title)`, `autoTitle()`, `refreshSessions()` | Manage session titles and the session list. |
| `updateConfig(patch)` | Merges `patch` into the config and rebuilds the agent. The conversation is kept. A different `toolProviders` array or `skillRegistry` object is loaded again. |
| `setModel(id)` | Changes the model for the next turn and keeps the conversation. |
| `dispose()` | Stops the turn, clears every schedule, removes listeners and disposes tool and attachment providers. |
| `initPromise` | Resolves when tool providers, the skill registry and the first session are loaded. Rejects when a `required` tool provider fails. |
| `cancelQueued(id)`, `popLastQueued()`, `clearQueue()` | Manage `queuedMessages`. |
| `commands()`, `resolveCommand(name)`, `enqueueCommand(...)`, `runCommand(entry, argument)` | Read and run slash commands. See [Slash commands](./skill.md#slash-commands). |
| `pendingCounts()` | Counts active schedules and reminders. See [Scheduler](./scheduler.md#read-the-schedule-count). |
| `todos()` | Returns a copy of the active session's todo list. See [Todo tracking](./todo.md). |
| `getAttachmentProviders()` | Returns the attachment providers from the config and from loaded tool providers. |
| `availableTools()` | Returns the tools the agent was given for the most recent turn. See [List the tools the agent has](#list-the-tools-the-agent-has). |

---

## SessionState fields

From `src/controller.types.ts:70-91`:

| Field | What it holds |
|---|---|
| `messages` | The transcript as `SessionMessage[]`. |
| `sessions`, `activeSessionId` | The session list and the open session. |
| `running` | `true` while a turn runs. |
| `compacting` | `true` while a compaction runs. An automatic compaction can run after `running` is already `false`. |
| `canCompact` | `true` when at least one turn can be compacted. Use it to enable a compaction button. |
| `error` | The last turn error, or `undefined`. |
| `usage`, `contextWindow` | Token counts and context window use. `contextWindow.percent` is a fraction from 0 to 1. |
| `queuedMessages` | Messages waiting for the running turn to end. An item from a schedule carries `source: { kind: "schedule", name }`. |
| `model` | The active model id. |
| `inProgressTurnId` | The id of the running turn, or `undefined`. |

A `SessionMessage` can carry `failed: { message, retryable }` for a turn that
failed, or `notice: { message, retryable }` for a turn that completed with no
content. The two never appear together. See the next section.

---

## Retry the last turn

`retryLast()` acts only on the last turn, and only in two cases
(`src/controller-turn.ts:381-399`). In every other case it does nothing.

**A failed turn resumes from its last completed step.** A turn fails when the
model call errors or when you abort it; core marks it `failed`. `retryLast()`
removes the `failed` marker and continues the same turn. The steps that
completed stay in the conversation, so a tool that already ran is **not** run
again. For example, a `place_order` tool that ran before the failure does not
place a second order. With a session store, core drops only the turn's last
stored record, and the resumed turn writes it again with the new steps
(`src/controller-turn.ts:297-341`).

**An empty completed turn is sent again.** When the model ends its turn
normally but with no content, core does not treat it as a failure. It sets
`notice` on the user message with the text
`The model ended its turn without a reply.` and `retryable: true`
(`src/controller-messages.ts:264-272`). `retryLast()` then removes that turn and
sends the user message again (`src/controller-turn.ts:349-379`).

Both paths emit `retry:start`, then `retry:success` or `retry:failure` through
`subscribeEvents()`.

---

## List the tools the agent has

`availableTools()` returns the name and description of every tool the agent was
given for the most recent turn, in the order the model sees them
(`src/controller.types.ts:198-214`). The list includes tool-provider tools,
the scheduler and todo tools, and `create_skill` or `delete_skill` when the
session offers them. Use it for a debug view. It returns `[]` before the first
turn. Each call returns a fresh copy.

```ts
for (const tool of session.availableTools()) {
  console.log(tool.name, "—", tool.description);
}
```

---

## Cross-links

- [Session backend interface](./session-backend.md) — `SessionStore` interface
  and `IdbSessionStore` details
- [Compaction](./compaction.md) — conversation history compaction, `CompactionStats`, and reload behavior
- [Scheduler](./scheduler.md) — `scheduler` config, schedule tools and `pendingCounts()`
- [Todo tracking](./todo.md) — `todo` config, todo tools and `todos()`
