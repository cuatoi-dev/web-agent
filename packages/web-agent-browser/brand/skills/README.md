# The skills folder

Put one markdown file here per skill. The build compiles every `.md` file in
this folder into `dist/brand.json`, and both agents get them.

This folder is empty in the default brand, so the default build ships exactly
the skills the extension defines in code.

`README.md` is the one file the build skips. Every other `.md` file must be a
skill file.

## A skill file

```
---
name: claims_lookup
description: Find a claim by number and explain its status.
command: true
argumentHint: "[claim number]"
---

# claims_lookup

Explain what the agent should do, in plain markdown. This body becomes the
skill's definition.
```

| Key | Required | What it does |
|---|---|---|
| `name` | yes | What the model calls, and what the user types after a slash. Lower case, digits and underscores only, starting with a letter. |
| `description` | yes | One line. The model reads it to decide whether to load the skill. |
| `command` | no | `true` makes the skill invocable as `/name`. Defaults to `false`. |
| `argumentHint` | no | Shown after the name in the command menu, for example `[claim number]`. |

The body below the frontmatter is the skill's definition. It must not be empty.

## What fails the build

The build fails, and writes no `dist/`, when a skill file:

- has no `---` frontmatter block at the top
- has a frontmatter block that is never closed with `---`
- is missing `name` or `description`
- has a `name` that is not lower_snake_case
- has frontmatter but no body
- has a `command` value that is not `true` or `false`

Two skill files that declare the same `name` also fail the build, and the
message names both files.
