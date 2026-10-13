---
title: Built-in chat panel features
---

# Built-in chat panel features

This page describes what `<agent-chat-panel>` shows and does on its own, with
no extra host code. Use it to learn which config keys turn a feature on, and
what your users see. For the public methods and properties, see
[Custom header & panel API](./custom-header-and-public-api.md).

Source paths on this page are relative to `packages/web-agent-lit/`.

## Header

The built-in header shows the session title and a row of controls
(`src/chat-ui/chat-panel.ts:146-211`). Set `hideHeader` to remove it.

- **Title.** The panel shows the session title. With no title, it shows
  `agentName`. With no `agentName`, it shows `🤖 <appName> Assistant`, and with
  no `appName`, `🤖 Assistant` (`src/chat-ui/chat-panel.ts:133-139`).
- **Rename.** A pencil button next to the title opens an inline editor. You can
  also double-click the title (`src/chat-ui/chat-panel-screens.ts:279-288`).
  Press Enter to save or Escape to cancel
  (`src/chat-ui/chat-panel-elements.ts:180-191`). A renamed title is marked as
  manual, so automatic titling does not overwrite it.
- **New session and history.** Two buttons create a session and open the
  session history list. The history list switches, deletes, and clears
  sessions, and asks for confirmation first
  (`src/chat-ui/chat-panel-history.ts:214-239`).
- **Persistence off.** When `config.persist` is `false`, the panel hides the
  pencil, the new-session button, and the history button, and double-click
  does nothing (`src/chat-ui/chat-panel.ts:159-164`).
- **Busy state.** While a turn runs, the header buttons are disabled
  (`src/chat-ui/chat-panel.ts:110-118`).

The kebab menu holds these entries (`src/chat-ui/chat-panel.ts:166-199`):

| Entry | When it shows | What it does |
|---|---|---|
| Choose model | `models` has two or more entries | Lists each model. Picking one calls the session's `setModel()`, so the conversation stays. The active model has a check mark. |
| Configuration | Always | Opens the Settings screen. |
| Debug | `debug` is `true` | Opens the Debug screen. |

### Settings screen

The Settings screen has one section, **Visual cue**: a checkbox that shows the
agent cursor while the agent works, and a Slow or Fast speed choice
(`src/chat-ui/chat-panel-screens.ts:52-97`). A change updates `cues` on the
live session and calls your `onCuesChange` callback
(`src/chat-ui/chat-panel-screens.ts:34-42`).

### Debug screen

The Debug screen has two read-only text areas, each with a **Copy** button
(`src/chat-ui/chat-panel-screens.ts:205-256`):

- **Raw conversation & tool calls** — the same text `getDebugLog()` returns.
  It has three sections: the host and agent config as JSON, one line for each
  provider fallback in this page load, and the conversation with every tool
  call's input and outcome (`src/chat-ui/chat-panel-screens.ts:142-171`).
- **Available tools** — the tools the session gave the model on its most
  recent turn, read from the session's `availableTools()`
  (`src/chat-ui/chat-panel-screens.ts:117-119`). The list is empty before the
  first turn.

## Message window

The panel does not keep the whole conversation in the DOM. It renders only the
newest part of it, called the message window
(`src/chat-ui/chat-panel-window.ts:265-332`).

- **Size.** Set `config.messageWindow` to the number of rows to keep. The
  default is 200 (`src/chat-ui/chat-panel-window.ts:7`, `:242-244`). A message
  bubble is one row, and each tool step inside it is one more row
  (`src/chat-ui/chat-panel-window.ts:233-239`).
- **Turn boundaries.** A window always starts at a user message, so a turn is
  never cut in half. A window can hold more rows than the size when the cut
  falls inside a turn (`src/chat-ui/chat-panel-window.ts:251-262`).
- **Scroll up to load more.** When you scroll to within 80 px of the top and
  older messages exist, the panel shows a three-dot loader at the top and adds
  the previous window above. Your reading position stays in place
  (`src/chat-ui/chat-panel-window.ts:11`, `:314-320`, `:411-448`).
- **Scroll back down to trim.** When you reach the bottom again, the panel
  trims back to the newest window. While you are away from the bottom, new
  messages never remove rows (`src/chat-ui/chat-panel-window.ts:277-285`,
  `:323-331`).

### Scroll-to-bottom button

When the message list is more than 30 px away from the bottom, a round arrow
button appears above the composer
(`src/chat-ui/chat-panel-window.ts:306`, `src/chat-ui/chat-panel.ts:281-283`).
Its accessible name is "Scroll to newest messages". Select it to jump to the
newest message (`src/chat-ui/chat-panel-elements.ts:96-105`). The button carries
the class `wa-jump-btn`, which you can use as a selector with any UI registry.

## Status notices

The panel shows turn status as one notice line below the messages, with the
class `wa-notice` (`src/chat-ui/chat-panel-window.ts:69-134`). At most one of
the first four kinds shows at a time, in this order of precedence
(`src/chat-ui/chat-panel-window.ts:147-217`):

| Notice | When it shows | Actions | Screen reader role |
|---|---|---|---|
| Retrying | A turn is running and core is retrying the model call. One dot fills for each attempt. | None | `status` |
| Failed turn | The newest turn failed. | **Retry** if the failure is retryable, and **Dismiss** | `alert` |
| Empty reply | The newest turn finished, but the model sent no content. This is not a failure. | **Retry** if retryable. No Dismiss. | `status` |
| Error | The session has an error, for example a provider that is not available, or a slash command that cannot run. | **Dismiss** | `alert` |
| Warning | The panel has a message for you and the host set no `notify` callback. It can show next to any notice above. | **Dismiss** | `status` |

The retrying notice becomes the failed-turn notice in the same element, so the
transcript does not move when the retries run out.

The panel reads the failed and empty-reply markers from the newest message only
(`src/chat-ui/chat-panel-window.ts:42-55`). So the notice clears on its own when
the next turn starts. Dismiss hides a failed turn until the page reloads
(`src/chat-ui/chat-panel-fields.ts:155-161`).

## Events and notifications

The panel dispatches two events. Both bubble and cross shadow boundaries
(`composed: true`).

| Event | `detail` | When |
|---|---|---|
| `agent-running-change` | `{ running: boolean }` | The panel becomes busy or idle. Busy means a turn is running or a compaction is in progress (`src/chat-ui/chat-panel-session.ts:99-109`). `<web-agent-bubble>` uses it to show its Stop button. |
| `agent-toast` | `{ message: string; type: "error" \| "info" }` | The panel has a message for you, such as an attachment hint, and you did not set `notify` (`src/chat-ui/chat-panel-session.ts:201-219`). |

If you set `notify`, the panel calls it instead. It then dispatches no
`agent-toast` event and shows no warning notice.

## Composer indicators

The composer row can show up to three small indicators, left of the Send
button (`src/chat-ui/chat-panel.ts:288-318`). Each is a separate element that
the package exports.

### Todo indicator — `<agent-todo-indicator>`

Shows when `config.todo.enabled` is `true` and the session has at least one
todo item (`src/chat-ui/chat-panel-session.ts:39-42`,
`src/chat-ui/chat-panel.ts:293-296`). With no items, the indicator is absent.

- The badge shows how many items are not done. When all items are done, it
  shows a check mark (`src/chat-ui/todo-indicator.ts:40-44`, `:229-233`).
- Hover over it or focus it with the keyboard to open a list of every item.
  Escape closes the list. Each item's status reads by shape: an empty ring for
  pending, a half-filled ring for in progress, and a filled circle with a tick
  for done (`src/chat-ui/todo-indicator.ts:181-209`, `:217-221`, `:238-252`).
- The list is never taller than half the panel
  (`src/chat-ui/todo-indicator.ts:27-33`).

### Schedule clock — `<agent-schedule-clock>`

Shows when `config.scheduler.enabled` is `true` and at least one schedule or
reminder is pending (`src/chat-ui/chat-panel-session.ts:28-32`,
`src/chat-ui/chat-panel.ts:301-307`). The badge shows the total. The tooltip
and accessible name read, for example, "2 schedules, 1 reminder. Use
/schedule-list to see or cancel them." The package exports that text builder
as `scheduleSummary()` (`src/chat-ui/schedule-clock.ts:9-14`).

### Context gauge — `<agent-context-gauge>`

Always shows. It is a ring that fills as the conversation uses the model's
context window (`src/chat-ui/chat-panel.ts:310-318`).

- The ring turns red at `config.context.autoCompactPercent` (default `0.75`),
  and amber from 15 points below that
  (`src/chat-ui/context-gauge.ts:96-103`).
- Select it, or press Enter or Space on it, to compact the conversation. It is
  disabled while a turn runs, while a compaction runs, and when the session
  reports it cannot compact. A disabled gauge has a dashed track, not a dimmed
  one (`src/chat-ui/chat-panel.ts:316`, `src/chat-ui/context-gauge.ts:112-115`,
  `:139-148`, `:194-196`).
- The ring spins while a compaction runs.

## Tool steps in the transcript

Each tool call shows as a one-line step inside the assistant message
(`src/chat-ui/message-view.ts:312-339`). The line text comes from three
sources, in this order:

1. The tool's own `renderer`, when you set one on a `tools` entry and the call
   has finished.
2. A built-in phrase for known tools, such as "Agent set a 3-step plan" for
   `todo_write` or "Agent checked the time" for `get_time`
   (`src/chat-ui/tool-phrases.ts:34-175`). A running call shows a present-tense
   phrase, such as "Agent is updating its plan…"
   (`src/chat-ui/tool-phrases.ts:177-199`).
3. For any other tool, "Agent used the tool `<name>`"
   (`src/chat-ui/tool-phrases.ts:206-214`).

The phrases use `agentShortName` in place of "Agent" when you set it.

Built-in phrases exist for the DOM tools, the data tools, the skill tools
(`search_skills`, `load_skill`, `create_skill`), `show_generative_ui`,
`show_chart`, the scheduler tools (`set_schedule`, `list_schedules`,
`cancel_schedule`), `get_time`, and the todo tools (`todo_write`, `todo_read`).

A context compaction shows as its own step. While it runs, or when it was
cancelled or failed, the line reads "Agent compacts its context" with a
` · running`, ` · cancelled` or ` · failed` suffix. When it finishes, a card
shows the duration and the message, token and tool-call counts before and
after (`src/chat-ui/message-view.ts:272-310`,
`src/chat-ui/tool-phrases.ts:219-227`).
