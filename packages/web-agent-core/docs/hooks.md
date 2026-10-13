---
title: Lifecycle hooks
---

# Lifecycle hooks

Lifecycle hooks let your host code watch the agent and change what it does at
fixed points: before and after each tool call, when the user sends a prompt,
when a turn ends, around a compaction, and when the session starts.

Core defines seven hooks. There are no others (`src/tool-hooks.types.ts:144-153`).

| Hook | Fires | Return value |
|---|---|---|
| [`onPreTool`](#onpretool) | Before a tool runs | Allow, deny or ask; can replace the input |
| [`onPostTool`](#onposttool) | After a tool returns | Can replace the outcome |
| [`onUserPrompt`](#onuserprompt) | When `send()` is called | Can replace the parts, the display text and the metadata |
| [`onTurnEnd`](#onturnend) | After every turn | Ignored |
| [`onPreCompact`](#onprecompact) | Before a compaction runs | Can veto the compaction |
| [`onPostCompact`](#onpostcompact) | After a compaction succeeds | Ignored |
| [`onSessionStart`](#onsessionstart) | Once, when session start-up finishes | Ignored |

---

## Register hooks

Set `hooks` on the session config. `hooks` is a field of `AgentConfig`
(`src/config.types.ts:159-163`), and `SessionConfig` extends
`Partial<AgentConfig>` (`src/controller.types.ts:93`).

```ts
import { createAgentSession } from "@cuatoi/web-agent-core";

const session = createAgentSession({
  model: "sonnet",
  endpointType: "anthropic",
  hooks: {
    onTurnEnd: ({ stopReason }) => {
      console.log("turn ended:", stopReason);
    },
  },
});
```

With a panel from `@cuatoi/web-agent-lit`, assign the same object to
`panel.hooks`. Both host apps do this: `apps/cat-store/src/web/agent-panel-config.ts:289`
and `apps/docs-site/src/docs-embed.ts:100`.

Core copies `hooks` into the `ToolContext` when it builds the agent
(`src/loop/agent.ts:134`), so tools and hooks read the same object. A later
`updateConfig({ hooks })` rebuilds the agent with the new hooks and keeps the
conversation (`doUpdateConfig` in `src/controller.ts`).

The hook types are exported from the package entry: `AgentHooks`,
`PreToolPayload`, `PreToolResult`, `UserPromptPayload` and the others
(`src/index.ts:29-51`).

---

## Rules that apply to every hook

- **One handler or an array.** Each hook takes a single function or an array of
  functions (`src/hooks/user-prompt.types.ts:7-10`).
- **Registration order.** Handlers run one after another, in array order
  (`src/hooks/run-hooks.ts:19-24`).
- **Awaited, with no timeout.** Core awaits each handler before it continues.
  A handler that never settles stops the turn at that point
  (`src/hooks/run-hooks.ts:12-14`). Keep handlers short.
- **A throw or a rejection is ignored.** Core catches the error, logs
  `[hooks] <event> handler #<i> threw — ignored:` with `console.error`, and
  treats that handler as if it returned nothing. The other handlers still run,
  and the turn continues (`src/hooks/run-hooks.ts:26-33`).
- **Any truthy return is an opinion.** For `onPreTool`, `onPostTool`,
  `onUserPrompt` and `onPreCompact`, core reads the fields of the returned
  object. A logging handler must return nothing. Use a braced function body,
  not an expression body that returns the result of `console.log`.

---

## onPreTool

**When it fires.** Before a tool's own `execute()` runs, on every tool call
(`src/tools/build-tools.ts:80-115`). It fires after core validates the input
against the tool's schema. A call with invalid input returns the validation
error and does not reach the hook (`src/tools/build-tools.ts:44-74`). It fires
only when `hooks` is set.

**Arguments** (`PreToolPayload`, `src/tool-hooks.types.ts:113-120`):

| Field | Type | Meaning |
|---|---|---|
| `name` | `string` | The tool name. |
| `input` | `Record<string, unknown>` | The input as changed by the handlers before this one. |
| `summary` | `string \| undefined` | The text from the tool's own `summarize()`. Undefined when the tool has none, or when `summarize()` throws (`src/tools/build-tools.ts:82-89`). |
| `ctx` | `ToolContext` | The context the tool will run with. |

**Return value** (`PreToolResult`, `src/tool-hooks.types.ts:121-126`):

| Field | Effect |
|---|---|
| `decision: "allow"` | The tool runs. This is also the result when every handler returns nothing. |
| `decision: "deny"` | The tool does not run. Core stops the chain at the first deny, so later handlers are not called (`src/hooks/run-hooks.ts:46-50`). |
| `decision: "ask"` | Marks the call as needing confirmation. A later `"deny"` still wins (`src/hooks/run-hooks.ts:51`). |
| `reason` | Used only with `"deny"`. Core stores `reason` from the denying handler and ignores it on any other decision (`src/hooks/run-hooks.ts:46-49`). |
| `modifiedInput` | Replaces the input. The next handler receives it, and the tool runs with the final value (`src/hooks/run-hooks.ts:42-45`, `src/tools/build-tools.ts:114`). |

What core does with the merged decision (`src/tools/build-tools.ts:96-114`):

- **Deny.** The model receives `reason` as an error result. With no reason,
  the text is `Tool "<name>" was denied.` `onPostTool` does not fire.
- **Ask.** Core has no confirmation dialog of its own at this point. The tool
  does not run, and the model receives an error result that says the
  interaction needed confirmation and was not performed. `onPostTool` does not
  fire. To confirm with the user, show the dialog inside your handler and
  return `"allow"` or `"deny"` yourself.
- **Allow.** The tool runs with the final input.

**If the handler throws or rejects.** Core ignores that handler. With no other
handler, the decision stays `"allow"` and the tool runs.

**Example.** Block one tool, and ask the user before another runs.
`confirmOrder()` stands for your own dialog.

```ts
const session = createAgentSession({
  model: "sonnet",
  endpointType: "anthropic",
  hooks: {
    onPreTool: [
      ({ name }) => {
        if (name === "delete_account") {
          return { decision: "deny", reason: "The agent cannot delete accounts in this app." };
        }
      },
      async ({ name, summary }) => {
        if (name !== "place_order") return;
        const ok = await confirmOrder(summary ?? "Place this order?");
        return ok ? { decision: "allow" } : { decision: "deny", reason: "The user declined." };
      },
    ],
  },
});
```

---

## onPostTool

**When it fires.** After the tool's `execute()` returns or throws
(`src/tools/build-tools.ts:118-164`). It does not fire when `onPreTool` denied
or asked, and it does not fire when input validation failed.

**Arguments** (`PostToolPayload`, `src/tool-hooks.types.ts:143-149`):

| Field | Type | Meaning |
|---|---|---|
| `name` | `string` | The tool name. |
| `toolCallId` | `string \| undefined` | The call identifier supplied by the executor. |
| `input` | `Record<string, unknown>` | The input the tool ran with, after any `modifiedInput`. |
| `outcome` | `ToolOutcome` | The result, as changed by the handlers before this one. |

**Return value** (`PostToolResult`, `src/tool-hooks.types.ts:150`). Return
`{ outcome }` to replace the result. Replacements apply in order, and the next
handler receives the replaced value (`src/hooks/run-hooks.ts:56-64`). Core then
uses the final outcome's `content`, `block` and `images`
(`src/tools/build-tools.ts`, end of `wrapExecutor`).

Loaded tool-provider handlers run before the host's handlers, and later
handlers see earlier replacements (`src/controller-config.ts:33-52`).

Two limits apply:

- **A hook cannot change whether the call failed.** Core reads the tool's own
  `isError` before the hooks run, and that value goes to the model
  (`src/tools/build-tools.ts:142`, `:164`).
- **When the tool throws, you can replace its message.** Core sends the
  hook chain's final content to the model and keeps the error flag true.
  Returned blocks and images are ignored. The original input contains the
  error message, without its stack trace
  (`src/tools/build-tools.ts:121-144`).

**If the handler throws or rejects.** Core ignores that handler, and the
outcome from the handlers before it stays in effect.

**Example.** Remove email addresses from every tool result.

```ts
hooks: {
  onPostTool: ({ outcome }) => ({
    outcome: {
      ...outcome,
      content: outcome.content.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]"),
    },
  }),
}
```

---

## onUserPrompt

**When it fires.** When you call `session.send(parts)`, before the turn starts
or the message is queued (`src/controller-turn.ts:216-252`). It fires only when
an `onUserPrompt` handler is present (`src/controller-turn.ts:228`).

`retryLast()` does not fire it. A queued message runs later without firing it
again (`src/controller-queue.ts:162-166`).

Core runs attachment provider handlers first, then hooks from successfully
loaded tool providers, then your handlers.

**Arguments** (`UserPromptPayload`, `src/hooks/user-prompt.types.ts`):

| Field | Meaning |
|---|---|
| `parts` | The `MessagePart[]` as changed by earlier handlers. |
| `sessionId` | The active chat's ID, or `undefined`. |
| `firstInChat` | True for the first user message in the chat. Saved turns count after a reload. |
| `displayText` | Your `send()` display text, or the text from the original parts. It stays the same across handlers. |

**Return value** (`UserPromptResult`, `src/hooks/user-prompt.types.ts:14-21`):

| Field | Effect |
|---|---|
| `parts` | Replaces the parts sent to the model. Replacements apply in order (`src/hooks/run-hooks.ts:74`). |
| `userDisplayText` | Shown in the transcript in place of the model text. The last handler that sets it wins (`src/hooks/run-hooks.ts:75`). It also replaces the `userDisplayText` you passed to `send()`. If no handler sets it, your value stays (`src/controller-turn.ts:225`, `:236`). |
| `meta` | Core saves this object as `promptMeta`. Later keys win, except attachment chip arrays, which concatenate in handler order. |

If a turn is already running, core queues the final text, images, display text,
and metadata. When queued messages combine, their attachment chips concatenate
in queue order. Restarting a turn preserves its display text and metadata
without running the prompt hooks again.

**If the handler throws or rejects.** Core ignores that handler. The parts from
the handlers before it stay in effect.

**Example.** Add the current page to the prompt, but show only what the user
typed. `apps/docs-site/src/docs-embed.ts:104-120` does the same.

```ts
hooks: {
  onUserPrompt: ({ parts }) => {
    const typed = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    return {
      parts: [{ type: "text", text: `[Page: ${location.pathname}]\n\n` }, ...parts],
      userDisplayText: typed,
    };
  },
}
```

---

## onTurnEnd

**When it fires.** At the end of every turn that `send()`, a queued message or
`retryLast()` starts. Core fires it after it saves the turn and notifies
subscribers, and before it runs a compaction that the model requested
(`src/controller-turn.ts:142-155`). It also fires when the turn fails or is
aborted. A turn that throws produces a result with `stopReason: "error"`
(`src/controller-turn.ts:134-137`).

**Arguments** (`TurnEndPayload`, `src/tool-hooks.types.ts:137`):

| Field | Type | Meaning |
|---|---|---|
| `result` | `TurnResult` | `assistantText`, `blocks`, `stopReason`, and optional `error` and `usage` (`src/loop/types.ts:67-73`). |
| `stopReason` | `"end_turn" \| "max_iterations" \| "aborted" \| "error"` | The same value as `result.stopReason`. |

**Return value.** Ignored (`src/hooks/run-hooks.ts:90-94`).

**If the handler throws or rejects.** Core logs the error. The queue still
drains, and a requested compaction still runs.

**Example.**

```ts
hooks: {
  onTurnEnd: ({ stopReason, result }) => {
    console.log("turn ended:", stopReason, result.assistantText.length);
  },
}
```

---

## onPreCompact

**When it fires.** Before a compaction summarizes the history, and only when
there is something to compact (`src/loop/compaction.ts:151-164`). A compaction
starts in three places, and the hook fires in each:

- automatically, before a turn, when context use is above `autoCompactPercent`
  (`src/controller-turn.ts:88-94`);
- when you call `session.compact()` (`src/controller-turn.ts:36-46`);
- at the end of a turn in which the model called `compact_conversation`
  (`src/controller-turn.ts:164-169`).

**Arguments** (`PreCompactPayload`, `src/tool-hooks.types.ts:138-139`):

| Field | Type | Meaning |
|---|---|---|
| `tokens` | `number` | The estimated context size before compaction. |
| `percent` | `number` | A fraction from 0 to 1, the same value as `SessionState.contextWindow.percent`. |

**Return value** (`PreCompactResult`, `src/tool-hooks.types.ts:140`). Return
`{ veto: true }` to cancel this compaction. Every handler still runs, and one
veto is enough (`src/hooks/run-hooks.ts:81-88`). A vetoed compaction returns
`{ outcome: "skipped" }`, and the compaction observer is not called
(`src/loop/compaction.ts:163`). See [Compaction](./compaction.md).

**If the handler throws or rejects.** Core ignores that handler. With no veto
from another handler, the compaction runs.

**Example.** Do not compact while a checkout form is open.

```ts
hooks: {
  onPreCompact: () => {
    if (document.querySelector("form#checkout")) return { veto: true };
  },
}
```

---

## onPostCompact

**When it fires.** After a compaction writes its summary, and before the
compaction observer reports `"compacted"` (`src/loop/compaction.ts:202-219`).
It does not fire when the compaction was skipped, cancelled or failed.

**Arguments** (`PostCompactPayload`, `src/tool-hooks.types.ts:141`):

| Field | Type | Meaning |
|---|---|---|
| `tokensBefore` | `number` | The estimated context size before compaction. |
| `tokensAfter` | `number` | The estimated context size after compaction. |

**Return value.** Ignored (`src/hooks/run-hooks.ts:90-94`).

**If the handler throws or rejects.** Core logs the error, and the compaction
still counts as successful.

**Example.**

```ts
hooks: {
  onPostCompact: ({ tokensBefore, tokensAfter }) => {
    console.log(`compacted from ${tokensBefore} to ${tokensAfter} tokens`);
  },
}
```

---

## onSessionStart

**When it fires.** Once, at the end of session start-up, after tool providers
and the skill registry have loaded and the active session is open or created
(`src/controller.ts:171-188`). With no session store, the id is
`"default-session"` (`src/controller-sessions.ts:128-136`). With a store, it
fires even when loading the session failed (`src/controller-sessions.ts:169-172`).

It does not fire for `createSession()` or `switchSession()`. The only two
call sites are in `openOrCreateActiveSession()`
(`src/controller-sessions.ts:134`, `:172`). It also does not fire when a
required tool provider fails, because start-up stops before the session opens
(`src/controller.ts:176-185`).

**Arguments** (`SessionStartPayload`, `src/tool-hooks.types.ts:142`):
`sessionId`, the id of the active session.

**Return value.** Ignored (`src/hooks/run-hooks.ts:90-94`).

**If the handler throws or rejects.** Core logs the error, and start-up
finishes.

**Example.**

```ts
hooks: {
  onSessionStart: ({ sessionId }) => {
    console.log("agent session ready:", sessionId);
  },
}
```

---

## Call the dispatcher yourself

Core exports `runHooks(hooks, event, payload)` and `toHookArray(entry)`
(`src/index.ts:29`, `:51`). `runHooks` applies the same merge rules that this
page describes and returns the merged result (`src/hooks/types.ts:53-61`). For
example, `runHooks(hooks, "onPreTool", payload)` returns
`{ decision, reason, input }`.
