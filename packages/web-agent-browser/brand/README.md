# The brand folder

This folder holds the default brand for the extension. The build reads it and
writes `dist/brand.json`, which both agents read at runtime.

This page is the key reference. For step-by-step instructions, see:

- [Branding guide](../docs/branding-guide.md) — create, build, load and check a
  branded extension, and fix each build error.
- [Custom skills](../docs/custom-skills.md) — add a skill in `skills/`, or have
  the agent save one at run time.

`web-agent-brand init` copies this file into each new brand package, and the
published npm package does not include `docs/`. In a brand package, the two
links above do not work. Read the pages in the web-agent repository at
`projects/web-agent/packages/web-agent-browser/docs/`.

## Files

| File | What it does |
|---|---|
| `plugin.yml` | The in-page bubble's prompt under `prompts`, the side panel's default agent under `defaultAgent`, installation options under `options`, extra hosts under `hosts`, and tool and skill group switches under `tools` and `skills`. The file is optional, but `defaultAgent` is required whenever it is loaded. |
| `agents/` | One YAML file per side panel agent. At least one is required. See [agents/](#agents). |
| `model.yml` | The list of models the options page offers. |
| `skills/` | One markdown file per skill the brand ships. See `skills/README.md`. |
| `icon.png` | One square PNG, at least 128x128. The build downscales it to 16, 32, 48 and 128. |

## plugin.yml

`prompts` accepts exactly one key:

- `inPage` — the agent in the bubble on a web page.

The value is a string. The text becomes the in-page agent's `# App
instructions` section in its system prompt. You can leave out `prompts`, or
leave out `inPage`. The bubble then behaves as it does with no brand at all.

The side panel's agents get their prompt from `instructions` in their own
`brand/agents/<id>.yml` file instead — see [agents/](#agents). A `prompts`
block that still carries `sidePanel` fails the build with a message telling
you to move the text there.

`defaultAgent` names the agent, from `brand/agents/`, the side panel runs. It
is required.

The build fails, and writes no `dist/`, when:

- `plugin.yml` or `prompts` is not a YAML mapping
- `prompts` carries `sidePanel`
- a key under `prompts` is not `inPage`
- a value is not a string
- a value is empty or only whitespace
- `defaultAgent` is missing, or names no file in `brand/agents/`

The failure message names `plugin.yml`, the key, and the accepted values.

## agents/

`brand/agents/<id>.yml` defines one side panel agent. The file name without
`.yml` is the agent's id — lowercase letters, digits, `-` and `_`, starting
with a letter.

```yaml
displayName: Acme Assistant
description: Your Personal Assistant
instructions: |
  You are the Acme Assistant in the browser side panel. Keep replies short.
tools: "*"
skills: "*"
```

| Key | Required | Accepted values |
|---|---|---|
| `displayName` | Yes | A non-empty string. Shown in the panel header before the first message. |
| `description` | Yes | A non-empty string. |
| `instructions` | Yes | A non-empty string. Becomes the agent's `# App instructions` section. |
| `model` | No | An `id` from `model.yml`. Overrides the endpoint, wire format, model and streaming for this agent; the options page's API key still applies. |
| `tools` | Yes | `"*"`, or a list of side panel tool names (`read_tabs`, `page_eval`, and so on). |
| `excludeTools` | No | A list of tool names removed from an otherwise-allowed set. |
| `skills` | Yes | `"*"`, or a list of side panel skill names. |
| `excludeSkills` | No | A list of skill names removed from an otherwise-allowed set. |

At least one file is required. The default brand ships `chromagent.yml`, the
default agent, and `tesagent.yml`. Chromagent has every tool and skill.
`tesagent.yml` excludes `toggle_page_agent`, `send_to_page_agent` and
`read_page_agent`, so only Chromagent can drive the in-page agent.

The build fails, and writes no `dist/`, when:

- `brand/agents/` is missing or has no `.yml` files
- a file name does not match the lowercase / digits / `-` / `_` rule
- `displayName`, `description` or `instructions` is missing, not a string, or
  empty
- `model` names an id not in `model.yml`
- `tools` or `skills` is not `"*"` or a list of strings
- `excludeTools` or `excludeSkills` is set but is not a list of strings
- `tools` or `excludeTools` names a tool that is not a real side panel tool
- `skills` or `excludeSkills` names a skill that is not a real side panel skill

The failure message names the file, the key, and — for an unknown name — the
name and a sample of the accepted ones.

### Options

`options` configures installation behavior:

- `lockModel` (boolean, default `false`) — when set to `true`, the options page
  makes the endpoint URL, wire format, model, and streaming checkbox read-only.
  The preset picker, theme, API key, and shared token remain editable.

### Extra hosts

`hosts` lists origins the extension may call, as Chrome match patterns. Every
endpoint in `model.yml` is granted automatically, so list here only what the
agent must reach on top of that.

```yaml
hosts:
  - "https://api.acme.com/*"
  - "<all_urls>"            # a brand that must reach any site
```

A pattern is `<all_urls>`, or `scheme://host/path` — for example
`https://acme.com/*`. A port is allowed: `http://localhost:10040/*`.

These are granted when the extension is installed. Chrome shows the origins in
the install warning, and the user is never prompted again while they work.

The build fails, and writes no `dist/`, when:

- `hosts` is not a list
- an entry is empty or is not a string
- an entry is not a Chrome match pattern

### Tool groups

`tools` switches built-in tool groups on or off. Leave a group out and it keeps
its current behaviour.

```yaml
tools:
  data:      { enabled: false }
  genui:     { enabled: false }
  todo:      { enabled: true }
  scheduler: { enabled: true }
```

| Group | What it covers |
|---|---|
| `scheduler` | `set_schedule`, `list_schedules` and `cancel_schedule`. |
| `todo` | `todo_write` and `todo_read`, and the composer's todo indicator. |
| `data` | `list_data_sources`, `get_field_details`, `sample_field_values`, `query_data`. |
| `genui` | `show_generative_ui`. |

### Skill groups

`skills` switches the built-in skill sets on or off, the same way.

```yaml
skills:
  core:      { enabled: false }
  dom:       { enabled: true }
  pageFetch: { enabled: true }
  tab:       { enabled: true }
  websiteEdit: { enabled: true }
  testing: { enabled: true }
```

| Group | Which agent has it | Skills in the group |
|---|---|---|
| `core` | the in-page agent | `query_data_advanced`, `present_to_user` |
| `dom` | the in-page agent | `multi_step_ui` |
| `pageFetch` | the in-page agent | `page_fetch` |
| `tab` | the side panel's agents | `tab_management`, `page_agent` |
| `websiteEdit` | the side panel's agents | `website_edit` |
| `testing` | the side panel's agents | `test_plan` |

The skills in `brand/skills/` go to **every** agent — the in-page bubble and
every side panel agent — and are added on top of whichever groups are still
on. A side panel agent's own `skills` / `excludeSkills` still applies after
that. A brand skill with the same name as a built-in replaces it.

The build fails, and writes no `dist/`, when:

- a key under `tools` is not `scheduler`, `todo`, `data` or `genui`
- a key under `skills` is not `core`, `dom`, `pageFetch`, `tab`, `websiteEdit` or `testing`
- a group's value is not a mapping carrying a boolean `enabled`

## skills

`brand/skills/` holds one markdown file per skill. See
[`skills/README.md`](skills/README.md) for the file format and the build
failures it can cause.

## model.yml

`model.yml` defines the models available in the options-page picker.

The file contains a `models` list. Each entry requires:

- `id` — unique identifier for the entry
- `label` — display name shown in the picker
- `endpoint` — absolute http or https URL
- `wireFormat` — `anthropic`, `openai`, or `gemini`
- `model` — model identifier sent to the endpoint

`streaming` is optional and defaults to `false`.

The first entry in `models` is the default for a fresh profile with no saved settings.
If `model.yml` is absent, the extension falls back to its built-in model list.

The build fails, and writes no `dist/`, when:

- `model.yml` lacks a `models:` list
- `models` is empty
- an entry is not a YAML mapping
- an entry is missing `id`, `label`, `endpoint`, `wireFormat` or `model`, or
  one of them is empty
- an entry has an unknown `wireFormat`
- two entries share an `id`
- an endpoint has no scheme or is not http(s)
- `streaming` is not `true` or `false`

## icon.png

`icon.png` is the extension's icon. Supply one file; the build writes
`dist/icons/16.png`, `32.png`, `48.png` and `128.png` from it.

The file must be:

- a PNG, 8-bit RGBA (colour type 6), not interlaced
- square
- at least 128x128

The build fails, and writes no `dist/`, when any of those is not true. The
message names what it found.

## How the brand reaches each agent


1. The build compiles this folder into `dist/brand.json`.
2. The service worker reads that file once and serves it on the `brand:get`
   message.
3. The side panel asks the worker directly.
4. The in-page agent cannot reach `chrome.*`, so `bridge.js` asks the worker and
   forwards the brand on the same message that already carries the settings.
