---
title: Website edit skill
---

# Website edit skill

## What the skill is for

The side panel agent can restyle and restructure the page in any activated tab
with `page_eval`. This skill carries the rules that make an edit visible on
screen and durable across the page's own re-renders, instead of a change the
tool reports as done but the user cannot see. It lives in
`src/lib/website-edit-skill.ts`.

## The four-step loop

The skill teaches a survey, edit, look, fix loop. Step 3, look, is required:
`page_eval` returning `{ok:true}` says the code ran, not that the user can see
the result. The agent must call `page_screenshot`, then `page_console` at
error level, before it reports success.

## What the agent does when it cannot see

`page_screenshot` is offered only when the model accepts images
(`src/lib/page-screenshot-tool.ts:49-54`). When the tool is not in its list,
the skill tells the agent to fall back to `page_console` at error level, then
tell the user it cannot confirm the visual result and ask what they see.

## The three shadow-DOM routes

Page CSS does not cross a shadow boundary. The skill names three routes
through it: a custom property set on the host or `:root`, which is inherited
and does cross the boundary; `::part()` for an element the component marks
with a `part` attribute; and an adopted stylesheet for anything else inside
the component, appended to `adoptedStyleSheets` rather than replacing it.

## Other rules in the skill

- **Survey first.** `document.querySelector` does not look inside shadow roots,
  so the skill gives a helper that collects every open shadow root before the
  agent queries. A closed shadow root cannot be reached, and the agent says so
  instead of retrying (`src/lib/website-edit-skill.ts:32-51`).
- **One idempotent script.** Every edit script first removes what its previous
  run added. Everything the agent adds is tagged with the `nx-` prefix, which is
  also the list to remove when you ask it to undo the change (`:87-97`).
- **Survive a re-render.** A framework re-render builds new shadow roots without
  the added stylesheets. The skill has the agent re-apply them from a
  `MutationObserver` (`:99-113`).
- **Move nodes, do not rewrite them.** The agent moves existing elements, so
  links and text survive. It writes new text only for parts you asked it to add
  (`:115-124`).
- **Defect table.** The skill lists nine common visual defects, their causes and
  their fixes, for example content cut off by `overflow:hidden`, or a dark
  restyle that changes nothing because the page paints over `document.body`
  (`:126-138`).

## When a tool refuses

The skill tells the agent what to do for each refusal (`:140-152`):

| Tool result starts with | What the agent does |
|---|---|
| `Debugging is not started on tab #<id>` | Calls `start_debugging` on that tab, then tries again. |
| `Debugging stopped on tab #<id>` | The user pressed Cancel on Chrome's debugging bar. Calls `start_debugging` again. |
| `page_eval stopped the script after <n> ms` | The tab is usable again. Sends a smaller script. |
| `Tab #<id> is not the active tab in its window` | Asks you to switch to that tab. |
| `Screenshots are limited to 2 per second.` | Waits, then calls again. |

## Turning the skill off for a brand

A brand sets `skills: { websiteEdit: { enabled: false } }` in
`brand/plugin.yml` to drop the skill from the side panel
(`src/lib/brand-capabilities.ts:24-37`, `src/sidepanel.ts:89-92`). The panel
then ships no `website_edit` entry, and the extension still builds. The
`skills` block is described in `brand/README.md` and in
[Custom skills](./custom-skills.md#replace-or-turn-off-a-built-in-skill).
