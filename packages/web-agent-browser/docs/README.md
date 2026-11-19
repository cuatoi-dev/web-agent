---
title: Browser extension package docs
---

# @cuatoi/web-agent-browser — documentation

This package is a Manifest V3 browser extension that puts the web agent on any
website. It has two agents:

- **The side panel agent** lives in the Chrome side panel. It manages tabs,
  drives the in-page agent, and runs JavaScript, HTTP requests, console reads
  and screenshots in any tab you started debugging with `start_debugging`.
- **The in-page agent** is mounted in the visited page itself. It can run
  JavaScript in that page and call the site's own HTTP API.

The package also ships the `web-agent-brand` command, which builds your own
branded copy of the extension. To make one, follow the
[Branding guide](./branding-guide.md). To add skills, see
[Custom skills](./custom-skills.md).

## Guides

| Page | What it covers |
|---|---|
| [Branding guide](./branding-guide.md) | Create a brand package, set the name, models, prompts, options and icon, build it, load it in Chrome, check it, and fix each build error |
| [Custom skills](./custom-skills.md) | Ship a skill in `brand/skills/`, turn off or replace a built-in skill, and create or delete a saved skill at run time |
| [Using the extension](./using-the-extension.md) | The side panel, the per-site switch, the options page, saved skills, and how a model request leaves the browser |
| [Side panel tools](./side-panel-tools.md) | The five tab tools, `page_eval`, `page_fetch`, `page_console`, `page_screenshot`, and the `tab_management` skill |
| [Page agent tools](./page-agent-tools.md) | `toggle_page_agent`, `send_to_page_agent`, `read_page_agent`, the `/compact` and `/new` commands, and the `page_agent` wait loop |
| [In-page tools](./in-page-tools.md) | The in-page `page_fetch` and `page_eval`, and what they can reach on the visited page |
| [Website edit skill](./website-edit.md) | The `website_edit` skill: the four-step loop, the three shadow-DOM routes, and the defect table |
| [Third-party notices](./third-party-notices.md) | The licence of the provider logos in `src/lib/provider-logos.ts` |

## Related packages

- `@cuatoi/web-agent-core` — the agent loop, tool schemas, skills and session storage
- `@cuatoi/web-agent-lit` — the chat UI and the `<web-agent-bubble>` element this extension mounts
- `@cuatoi/web-agent-dom` — the DOM and state tools the in-page agent also carries
