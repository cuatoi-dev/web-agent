# Web agent brand toolkit

This package turns a `package.json` and a `brand/` folder into a loadable Chrome
extension. You do not write source, a manifest, or webpack configuration. The
toolkit ships the prebuilt extension, the compiler, and the `web-agent-brand`
command that builds your brand into `dist/`.

## Quick start

Run these commands outside a copy of the web-agent repository:

```bash
npx -p @cuatoi/web-agent-browser web-agent-brand init acme-agent
cd acme-agent
npm install
npm run build
```

Then load the `dist` folder at `chrome://extensions` with **Developer mode** on
and **Load unpacked**.

`init` creates a package with a working default brand. Edit `package.json` and
the files in `brand/`, then build again. The
[Branding guide](./docs/branding-guide.md) explains each step, each key, and
each build error.

## Documentation

The extension's own behavior is described in [`docs/`](./docs/README.md):

- [Branding guide](./docs/branding-guide.md) — create, build, load and check a
  branded extension, step by step, with every build error and its fix.
- [Custom skills](./docs/custom-skills.md) — ship a skill in a brand, or have
  the agent save one at run time.
- [Using the extension](./docs/using-the-extension.md) — the side panel, the
  per-site switch, the options page, saved skills, and how a model request
  leaves the browser.
- [Side panel tools](./docs/side-panel-tools.md) — tab tools, `page_eval`,
  `page_fetch`, `page_console` and `page_screenshot`.
- [Page agent tools](./docs/page-agent-tools.md) — how the side panel drives the
  in-page agent.
- [In-page tools](./docs/in-page-tools.md) — `page_fetch` and `page_eval` in the
  in-page agent.
- [Website edit skill](./docs/website-edit.md) — how the side panel agent
  restyles a page.

## Commands

| Command | What it does |
|---|---|
| `web-agent-brand init <directory>` | Creates a new brand package in `<directory>`. Refuses a directory that exists and is not empty. |
| `web-agent-brand build` | Builds `./brand` into `./dist` in the current directory. |
| `web-agent-brand --version` | Prints the toolkit version. |

Any failure prints the error and exits 1. A wrong or missing command prints the
usage text and exits 2.
