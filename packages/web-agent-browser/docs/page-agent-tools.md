---
title: Page agent tools
---

# Page agent tools

## Talk to the in-page agent from the side panel

The agent in the side panel can also drive the in-page agent in a tab using three page-agent tools:

- `toggle_page_agent`: Turns the in-page agent on or off in a tab. Pass `state: "on"` or `state: "off"` to set that state; if the tab is already in it, the tool reports that and changes nothing. Leave `state` out to flip the current state. It reports the state that actually resulted, and it saves your per-site choice the same way the button at the top of the side panel does (see [Using the extension](./using-the-extension.md)). A page that already has its own agent gets nothing.
- `send_to_page_agent`: Sends a message to the in-page agent in a tab. The message appears in that agent's conversation as if you had typed it, and the bubble opens if it was closed. The tool does not wait for the answer.
- `read_page_agent`: Reads the in-page agent's conversation and running state from a tab after a mandatory fixed wait of 30 s (for the first check after sending) or 120 s (for subsequent checks while the agent is running). The tool sleeps for the specified duration before reading once and returning, so a call pauses execution rather than returning immediately.

All three tools take an optional tab ID and act on the active tab of the current window when you leave it out (`src/lib/page-agent-tools.ts:28-36`). If the in-page agent is not on for the tab, `send_to_page_agent` and `read_page_agent` report that and name `toggle_page_agent` as the fix; neither turns the agent on for you. `send_to_page_agent` first re-checks the tab for up to 3 seconds and sends again if the agent appears, because a mount `toggle_page_agent` has just reported can still be settling. The re-check only reads the tab's state; it never turns the agent on.

## What each tool reports

From `src/lib/page-agent-tools.ts`:

| Tool | Situation | Result |
|---|---|---|
| All three | The tab has no content script, such as a `chrome://` page | `Cannot reach tab #<id>. The extension has no content script there …` (`:38-39`) |
| All three | The page has its own agent | `… that page already has its own agent, so nothing was added.` (`:99-104`, `:244-249`, `:318-323`) |
| `toggle_page_agent` | The bubble is now in the page | `The web agent is now ON in tab #<id> (<origin>).` (`:238-242`) |
| `toggle_page_agent` | The bubble was removed | `The web agent is now OFF in tab #<id> (<origin>).` (`:261-263`) |
| `toggle_page_agent` | You passed `state` and the tab is already in that state | `The web agent is already <ON\|OFF> in tab #<id> (<origin>). Nothing changed.` (`:200-204`) |
| `toggle_page_agent` | You asked for on and no bubble was added | `Could not turn the web agent on in tab #<id> (<origin>). Nothing was added to that page.` (`:254-259`) |
| `toggle_page_agent` | You asked for on, the page reported the bubble, and the re-check could not confirm it | `The web agent did not come up in tab #<id> (<origin>).` (`:231-236`) |
| `send_to_page_agent` | The message reached the agent's session | `Sent to the web agent in tab #<id> (<origin>): "<text>". It is answering now; this tool does not wait for the answer.` (`:153-155`) |
| `send_to_page_agent` | The session did not accept the message | `The web agent in tab #<id> (<origin>) did not accept the message.` (`:133-137`) |
| `read_page_agent` | The bubble is in the page | A header with `Status: RUNNING (still working)` or `Status: IDLE (finished)`, then one `[role] text` line per message (`:332-341`) |

The `read_page_agent` output is capped at 6000 characters and ends with
`…(output truncated)` when it is longer (`:339-341`,
`src/lib/constants.ts:47`).

A toggle outcome is reported from the page, not from the request. On a page
that already has its own agent, a request to turn the bubble on is reported as
a refusal, never as "now OFF" (`src/content.ts:248-261`).

## Send a command to the in-page agent

`send_to_page_agent` also carries two commands. Send the command on its own, as
the whole message text (`src/lib/page-agent-tools.ts:72`,
`src/lib/tab-skill.ts:46-51`):

- `/compact` makes the in-page agent summarise its older turns to free up its
  context.
- `/new` starts the in-page agent on a fresh session. `/clear` does the same
  thing.

The tool reports what the in-page agent actually did
(`src/lib/page-agent-tools.ts:140-151`):

- When the agent ran the command, the result is `Ran /<command> in the page agent.`
- When the text starts with a slash but is not a command that agent knows, it
  is delivered as an ordinary message, and the result is
  `Sent as ordinary text — '<name>' is not a command in that page agent.`

Any other text is an ordinary user message.

## The send → 30 s read → 120 s read loop

The `page_agent` reference skill teaches the side panel agent this loop for
delegating a task to a tab, from `src/lib/tab-skill.ts:28-53` (the skill) and
`:34-41` (the loop itself):

1. `toggle_page_agent` with `state: "on"` for that tab. If the bubble is already
   on, nothing changes.
2. `send_to_page_agent` with the task text — it returns at once and does not wait
   for the answer (`src/lib/page-agent-tools.ts:153-155`).
3. `read_page_agent` with `wait: 30` for the first look after sending.
4. While the answer says the agent is still running, `read_page_agent` again with
   `wait: 120`, reporting progress after each look.
5. Stop when the agent reports it is no longer running.

The delays are fixed and are the only accepted values, so a reader does not read
a slow call as a hang:

- The input schema accepts exactly `30` or `120` and nothing else —
  `z.union([z.literal(30), z.literal(120)])` at `src/lib/page-agent-tools.ts:272-274`.
- Any other value comes back as the error "Invalid wait: … The wait argument must
  be exactly 30 (for the first look after a send) or 120 (for every look after
  that)." — `src/lib/page-agent-tools.ts:290-294`.
- The tool sleeps first and reads once; it does not poll
  (`src/lib/page-agent-tools.ts:297`). A `wait: 120` call therefore takes at
  least two minutes to answer. That is the tool working, not a hang.
