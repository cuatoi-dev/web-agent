---
title: Todo tracking (todo_write & todo_read)
---

# Todo tracking (todo_write & todo_read)

Todo tracking gives the agent a short, numbered plan for multi-step work. The
model writes the plan with `todo_write`, marks steps as it works, and reads the
plan back with `todo_read`. Each session owns its own list. When a session
store is configured, the list is saved with the session.

---

## Turn on todo tracking

Todo tracking is off by default. Set `todo` on the `SessionConfig`
(`src/controller.types.ts:121`):

```ts
import { createAgentSession } from "@cuatoi/web-agent-core";

const session = createAgentSession({
  model: "sonnet",
  endpointType: "anthropic",
  todo: { enabled: true },
});
```

When `todo.enabled` is `true`, core puts the session's todo store on
`ToolContext._todos` (`src/controller-config.ts:188`), and `todoTools(ctx)` — and
so `defaultTools(ctx)` — returns `todo_write` and `todo_read`
(`src/tools/todo-tools.ts:14-15`).

When `todo` is absent or `enabled` is `false`, neither tool is offered to the
model. If a tool still runs against a context with no seam, it returns
`Todo tracking is turned off in this app.` as an error.

---

## TodoItem shape

From `src/todo.types.ts:2-8`:

```ts
type TodoStatus = "pending" | "in_progress" | "done";

interface TodoItem {
  id: string;        // "t1", "t2", …, assigned by core
  text: string;
  status: TodoStatus;
}
```

---

## todo_write tool

`todo_write` takes **either** `items` **or** `updates`, never both.

### Replace the plan with `items`

```ts
todo_write({
  items: [
    { text: "Find the low-stock products" },
    { text: "Draft the reorder list", status: "pending" },
  ],
})
```

`items` replaces the whole list. Each entry needs `text`. `status` defaults to
`pending`. Core gives every new item a new id. Ids count up for the life of the
store and are not reused when you replace the plan (`src/todo.ts:66-69`).

### Change items with `updates`

```ts
todo_write({
  updates: [
    { id: "t1", status: "done" },
    { id: "t2", status: "in_progress", text: "Draft the reorder list for Food" },
  ],
})
```

Each update needs an `id`. `text` and `status` are optional; a field you leave
out keeps its value. Core checks every id first. If any id is unknown, the call
changes nothing and returns
`No todo with id <ids>. Call todo_read for the current ids.` as an error
(`src/todo.ts:120-142`).

### Result and errors

On success, `todo_write` returns the full list, one numbered line per item
(`src/todo.ts:50-57`):

```
1. [x] Find the low-stock products  (id: t1)
2. [~] Draft the reorder list for Food  (id: t2)
```

The mark is `[ ]` for `pending`, `[~]` for `in_progress` and `[x]` for `done`.

| Input | Error text |
|---|---|
| Both `items` and `updates` | `Send either items or updates, not both.` |
| Neither, or a value that is not an array | `Send items to set the plan, or updates to change it.` |
| An unknown `id` in `updates` | `No todo with id <ids>. Call todo_read for the current ids.` |

Core validates arguments against the tool's JSON Schema before the tool runs,
so a `status` outside the three values is rejected with an `Invalid input`
error first. See [Validation](./tools.md#validation).

---

## todo_read tool

```ts
todo_read({})
```

Returns `No todos.` for an empty list, or the same numbered list that
`todo_write` returns (`src/todo.ts:167-172`).

---

## Persistence

Every change to the list calls `SessionStore.saveMeta(activeSessionId, { todos })`
when a session store is configured (`src/controller-sessions.ts:17-25`). The
list is stored on `SessionMeta.todos`. A failed save is logged to the console
and does not fail the tool call.

Core restores the list from `SessionMeta.todos`:

- at startup, for the most recent session (`src/controller-sessions.ts:157`)
- when the session switches (`src/controller-sessions.ts:265-266`)

A new session starts with an empty list (`src/controller-sessions.ts:227`).
Without a session store, the list lives in memory for the page load only.

See [Session backend](./session-backend.md) for the `SessionMeta` shape.

---

## Read the list from the host

`session.todos()` returns a copy of the active session's list
(`src/controller.ts:267`). Core notifies `subscribe()` listeners after every
change, so a UI can render the plan next to the chat:

```ts
session.subscribe(() => {
  renderPlan(session.todos());
});
```

---

## Exports

The package entry point exports `todoTools`, `createTodoStore`, and the types
`TodoItem`, `TodoStatus`, `TodoControllerSeam` and `TodoStore`
(`src/index.ts:56-83`). Core creates one store for each session. You need
`createTodoStore` only to build your own controller.

---

## Cross-links

- [Tools & data sources](./tools.md) — the full core tool list
- [Scheduler](./scheduler.md) — the other session-owned seam
- [Session handling](./session-handling.md) — `AgentSession` methods
- [Session backend](./session-backend.md) — `SessionMeta.todos`
