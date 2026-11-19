---
title: Scheduler (set_schedule, list_schedules & cancel_schedule)
---

# Scheduler (set_schedule, list_schedules & cancel_schedule)

The scheduler lets the agent send a prompt or run a slash command again and
again on a timer, or send it once as a reminder. Each session owns its own
scheduler. Schedules live in memory only, so they end when the session ends.

---

## Turn on scheduling

Scheduling is off by default. Set `scheduler` on the `SessionConfig`
(`src/controller.types.ts:125`):

```ts
import { createAgentSession } from "@cuatoi/web-agent-core";

const session = createAgentSession({
  model: "sonnet",
  endpointType: "anthropic",
  scheduler: { enabled: true },
});
```

With a panel from `@cuatoi/web-agent-lit`, pass the same field through
`panel.config`.

When `scheduler.enabled` is `true`, core does three things:

- It puts the session's scheduler on `ToolContext._scheduler`
  (`src/controller-config.ts:202`).
- `schedulerTools(ctx)`, and so `defaultTools(ctx)`, returns `set_schedule`,
  `list_schedules` and `cancel_schedule` (`src/tools/scheduler-tools.ts:13-14`).
- It adds three slash commands to the command list: `/schedule`,
  `/schedule-list` and `/schedule-cancel` (`src/controller-config.ts:226`).
  See [Scheduler commands](#scheduler-commands).

When `scheduler` is absent or `enabled` is `false`, the seam is absent, the
three tools are not offered to the model, and the three commands do not exist.
If a tool still runs against a context with no seam, it returns
`Scheduling is turned off in this app.` as an error.

---

## set_schedule tool

```ts
set_schedule({
  name: string,      // required
  every: string,     // required, for example "30s", "10m" or "2h"
  repeat: number,    // required, 1 to 36000
  command?: string,  // a command name, without the leading slash
  prompt?: string,   // literal prompt text
})
```

The tool checks its input in this order (`src/scheduler.ts:127-153`). The first
failure returns an error result and creates nothing:

| Check | Error text |
|---|---|
| Scheduling is on | `Scheduling is turned off in this app.` |
| Not both `command` and `prompt` | `Give either a command or a prompt, not both.` |
| One of `command` or `prompt` | `Give a command or a prompt to send when it fires.` |
| `repeat` is a whole number from 1 to 36000 | `repeat must be a whole number from 1 to 36000.` |
| `every` is a number followed by `s`, `m` or `h` | `every must look like 30s, 10m or 2h` |
| `every` is at least 1 second | `the shortest interval is 1s` |
| `name` is not empty | `Give the schedule a name.` |

`every` is a relative interval only. A clock time such as `9:00` is rejected.

`repeat: 1` makes a one-off reminder. `repeat` of 2 or more makes a repeating
schedule.

A schedule with the same `name` as an existing one replaces it. Its timer stops
and the result ends with `Replaced the previous one.`

On success the tool returns, for example, `Scheduled stock-check, every 10m, 6 run(s).`

---

## What happens when a schedule fires

Each schedule uses a `setTimeout` of `every`. When the timer fires
(`src/scheduler.ts:91-124`):

1. The run count goes up by one.
2. If this schedule's previous message is still waiting in the queue, core
   removes it. One schedule never holds more than one waiting message. Messages
   from other schedules, and every message the user typed, stay in the queue.
3. Core adds the schedule's work to the session queue. A `command` is queued as
   a command and shows as `/<command>`. A `prompt` is queued as ordinary text.
4. If no turn is running, core starts to drain the queue. A turn that is
   already running drains the queue when it ends, and so does a manual
   compaction (`/compact` or the context gauge).
5. If the run count is lower than `repeat`, core starts the timer again.
   Otherwise the schedule is spent and its timer stops.

A queued command runs as a command, never as prompt text. If the command no
longer exists when its turn comes, core drops it
(`src/controller-queue.ts:155-167`).

### Recovery after an error

A turn that ends with an error does not drain the queue by itself. This stops a
failed turn from starting the next failed turn with no delay. A compaction that
ends with an error does not drain either, for the same reason.

A schedule tick is different, because it arrives one interval later. When a tick
finds a stale error, it clears `state.error` and drains the queue again
(`src/controller-queue.ts:132-151`). So a schedule continues on its own after an
API outage ends, and you do not need to press Retry. During the outage, step 2
above keeps the queue at one waiting message for each schedule.

A tick that replaces its own waiting message still counts as a run, so
`repeat` always ends the schedule, even during an outage.

---

## list_schedules tool

```ts
list_schedules({})
```

Returns `Nothing is scheduled.`, or a table with one row for each schedule
(`src/scheduler.ts:196-209`):

```
Name | Kind | Fires | Sends | Runs | State
stock-check | schedule | every 10m | prompt "Check stock levels" | 2 of 6 | active
standup | reminder | every 1h | command /summary | 1 of 1 | spent
```

`Kind` is `reminder` when `repeat` is 1, and `schedule` otherwise. A spent
schedule stays in the list until it is cancelled or the session ends.

---

## cancel_schedule tool

```ts
cancel_schedule({ name: string })
```

Stops the timer and removes the schedule, whether it is active or spent. A name
that matches no schedule returns `No schedule called <name>.` as an error
(`src/scheduler.ts:184-194`).

---

## How long a schedule lives

Schedules are never written to the session store. Core removes every schedule
and stops every timer when:

- a new session starts — `createSession()`, `reset()`, `/new`, deleting the
  active session, or `clearAllSessions()` (`src/controller-sessions.ts:235`)
- the session switches to another one (`src/controller-sessions.ts:278`)
- the session is disposed (`src/controller.ts:338`)

A page reload also ends every schedule, because the timers live in the page.

---

## Scheduler commands

When scheduling is on, core adds the skills from `schedulerSkills()`
(`src/skills/scheduler-skills.ts`) to the command list:

| Command | What it asks the model to do |
|---|---|
| `/schedule` | Collect what to run, how often and how many times, then call `set_schedule`. Tell the user the schedule lasts only for this chat session. |
| `/schedule-list` | Call `list_schedules` and show the result as a table. |
| `/schedule-cancel` | Call `list_schedules` first if the user named no schedule, then call `cancel_schedule`. |

All three set `disableModelInvocation: true`. The user can run them, but they
do not appear in `search_skills`, `load_skill` or the `# Skills` prompt section.
You do not need to add them to `config.skills`. See
[Slash commands](./skill.md#slash-commands).

---

## Read the schedule count

`session.pendingCounts()` returns the number of schedules that are not spent
(`src/scheduler.ts:219-229`):

```ts
const { schedules, reminders, total } = session.pendingCounts();
```

`reminders` counts entries with `repeat: 1`. `schedules` counts the rest. Core
notifies `subscribe()` listeners whenever a schedule is set, fires or is
cancelled, so a UI can show a badge from this value.

---

## Exports

The package entry point exports these scheduler items (`src/index.ts:73`,
`src/index.ts:76-85`, `src/index.ts:152`):

| Export | What it is |
|---|---|
| `schedulerTools(ctx?)` | The three tools. Returns `[]` when `ctx?._scheduler` is absent. |
| `schedulerSkills()` | The three command skills. |
| `createScheduler(deps)` | The scheduler behind the seam. Core creates one for each session; you need it only to build your own controller. |
| `parseEvery(spec)` | Parses `"30s"`, `"10m"` or `"2h"` into `{ ms }`, or returns `{ error }`. |
| `formatMs(ms)` | Formats milliseconds as `30s`, `10m` or `2h`. |
| `formatHumanDuration(ms)` | Formats milliseconds as words, for example `10 minutes`. |
| `formatHumanEvery(spec)` | Formats a raw `every` value as words. It also accepts loose forms such as `"10 seconds"`, and returns `undefined` when it cannot read the value. A framework binding uses it for friendly tool phrases. |
| `ScheduleEntry`, `SchedulerRegistry`, `PendingCounts`, `SetScheduleInput`, `SchedulerDependencies` | Types. |

---

## Cross-links

- [Tools & data sources](./tools.md) — the full core tool list
- [Skills](./skill.md) — slash commands and `disableModelInvocation`
- [Session handling](./session-handling.md) — the session queue and `AgentSession`
- [Todo tracking](./todo.md) — the other session-owned seam
