---
title: Branding guide
---

# Brand the extension

This guide takes you from nothing to a branded Chrome extension that you can
load. You create a brand package, set its name, models, prompts and icon, build
it, and load it in Chrome.

A brand package is a folder with two things in it: a `package.json` and a
`brand/` folder. The `web-agent-brand build` command reads both and writes a
loadable extension to `dist/` (`tool/build.cjs:30-52`). You do not write source
code, a manifest, or a webpack configuration.

To add your own skills, see [Custom skills](./custom-skills.md).

## Before you start

You need:

- Node.js and npm.
- Access to the npm registry that hosts `@cuatoi/web-agent-browser`.
- Google Chrome, or another browser that loads unpacked Manifest V3 extensions.

## Step 1: Create the brand package

1. Open a terminal in the folder where you want the package.
2. Run this command. Replace `acme-agent` with your package name:

   ```bash
   npx -p @cuatoi/web-agent-browser web-agent-brand init acme-agent
   ```

   Use the `-p` form. `npx web-agent-brand` without `-p` looks for an npm
   package named `web-agent-brand`, which does not exist, and fails with a
   `404` error.

   Run this command outside a copy of the web-agent repository. Inside the
   repository, it fails with `web-agent-brand: not found`. To work inside the
   repository, see [Build from a copy of this repository](#build-from-a-copy-of-this-repository).

3. Install the toolkit:

   ```bash
   cd acme-agent
   npm install
   ```

`init` creates the folder and copies the default brand into it
(`tool/init.cjs:39-79`). The result is:

```
acme-agent/
├── package.json        the extension name, version and description
├── .gitignore          ignores node_modules only; dist/ is published
└── brand/
    ├── plugin.yml      prompts, options, extra hosts, tool and skill switches
    ├── model.yml       the models the options page offers
    ├── icon.png        the extension icon
    ├── README.md       the key reference for plugin.yml and model.yml
    └── skills/
        └── README.md   the skill file reference
```

The default brand builds as it is. You can run Step 8 now to check your setup,
then come back and change the brand.

`init` refuses a folder that already exists and is not empty, so it never
overwrites a brand (`tool/init.cjs:40-48`).

## Step 2: Set the name, version and description

Open `package.json`. The build reads three fields from it
(`tool/manifest.cjs:79-92`):

| Field | Required | What it becomes |
|---|---|---|
| `displayName` | No | The extension name in Chrome and the toolbar button title. If you leave it out, the build uses `name`. |
| `version` | Yes | The extension version. |
| `description` | Yes | The extension description. |

`init` fills in a starting value for each field: `displayName` is the folder
name in title case (`acme-agent` becomes `Acme Agent`), `version` is `0.1.0`, and
`description` is `A web agent for <name>.` (`tool/init.cjs:53-57`).

Chrome accepts a version of one to four numbers separated by dots, each from 0
to 65535. If your version has a prerelease or build suffix, such as
`1.4.0-beta.2`, the build removes the suffix and prints one line to say so
(`tool/manifest.cjs:55-66`, `tool/build.cjs:45-47`).

Example:

```json
{
  "name": "acme-agent",
  "displayName": "Acme Assistant",
  "version": "1.4.0",
  "description": "Acme's helper on any page."
}
```

Keep the other fields that `init` wrote (`scripts`, `dependencies`, `files`,
`private`).

## Step 3: Choose the models

Open `brand/model.yml`. It holds a `models` list. The options page offers these
entries, in this order, and a new install uses the first entry
(`src/lib/brand-models.ts:11-23`).

Each entry has these keys (`tool/compile-brand.cjs:236-288`):

| Key | Required | Accepted values |
|---|---|---|
| `id` | Yes | A non-empty string. Each `id` must be unique. |
| `label` | Yes | A non-empty string. The name shown in the options page. |
| `endpoint` | Yes | An absolute `http://` or `https://` URL. |
| `wireFormat` | Yes | `anthropic`, `openai` or `gemini`. |
| `model` | Yes | The model name sent to the endpoint. |
| `provider` | No | Row name in the options table. Defaults to the endpoint's host and path. Entries with the same endpoint and wire format form one provider row. |
| `vision` | No | `true` when the model accepts images. Defaults to `false` (text only). |

Each wire format adds its own path to the endpoint, so do not put that path in
`endpoint`:

| `wireFormat` | Path the extension adds | Source |
|---|---|---|
| `openai` | `/chat/completions` | `packages/web-agent-core/src/transport/openai-provider.ts:163` |
| `anthropic` | `/v1/messages` | `packages/web-agent-core/src/transport/anthropic-provider.ts:133` |
| `gemini` | `/v1beta/models/<model>:generateContent` | `packages/web-agent-core/src/transport/gemini-provider.ts:97` |

Example:

```yaml
models:
  - id: acme-claude
    label: "Acme Claude"
    endpoint: "https://llm.acme.com/api/anthropic"
    wireFormat: anthropic
    model: claude-sonnet
    provider: Acme
    vision: true
```

The default brand points to a development gateway. Replace those entries with
your own endpoints.

The default entries are:

| ID | Label |
|---|---|
| `anthropic-sonnet` | Sonnet |
| `openai-sonnet` | Sonnet OpenAI |
| `gemini-flash` | Gemini Flash |

The build gives the extension permission to reach the origin of every
`endpoint`, on every port. For example, `https://llm.acme.com:8443/v1` becomes
`https://llm.acme.com/*` (`tool/manifest.cjs:24-31`). Chrome grants these
permissions at install time.

If you delete `model.yml`, the options page offers the extension's built-in
model list instead (`src/lib/brand-models.ts:11-15`).

## Step 4: Write the agent prompts

The extension has two surfaces: the side panel, and the in-page bubble. Each
one can have its own prompt.

### The side panel's agents

The side panel runs one or more agents, defined as files in `brand/agents/`.
Every brand needs at least one. Create `brand/agents/acme.yml`:

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
| `<id>` (the file name without `.yml`) | Yes | Lowercase letters, digits, `-` and `_`, starting with a letter. |
| `displayName` | Yes | A non-empty string. Shown in the panel header before the first message. |
| `description` | Yes | A non-empty string. |
| `instructions` | Yes | A non-empty string. Becomes the agent's `# App instructions` section. |
| `model` | No | An `id` from `model.yml`. The agent opens on that model while it is enabled on the options page, and on the default model otherwise. The key is the one set for that model's provider. |
| `tools` | Yes | `"*"` for every side panel tool, or a list of tool names. |
| `excludeTools` | No | A list of tool names to remove from an otherwise-allowed set. |
| `skills` | Yes | `"*"` for every side panel skill, or a list of skill names. |
| `excludeSkills` | No | A list of skill names to remove from an otherwise-allowed set. |

If an agent leaves out or excludes `start_debugging` while retaining tools that require an active debugger session (such as `page_snapshot` or `page_click`), the build prints a warning.

Then point `plugin.yml`'s `defaultAgent` at it:

```yaml
defaultAgent: acme
```

`defaultAgent` is required, and must name a file in `brand/agents/`. The side
panel runs that agent (`src/lib/brand-capabilities.ts:resolveAgent`).

An agent can also ship a starter `/home/agent/AGENTS.md`. Create
`brand/agents/<id>.home/AGENTS.md`; the side panel writes it into the agent's
file system once, when the file does not exist. It never overwrites a file the
user or the agent has changed. The folder may hold only `AGENTS.md`.

### The in-page bubble's prompt

Open `brand/plugin.yml` and edit the `prompts` block:

```yaml
prompts:
  inPage: |
    You are the Acme Assistant on this page. You can operate this page only.
```

The value must be a non-empty string (`tool/compile-brand.cjs`). The text
becomes the `# App instructions` section of the bubble's system prompt
(`src/lib/brand.ts`). If you leave out `inPage`, the bubble has no
`# App instructions` section.

## Step 5: Set the options, hosts and switches

The other `plugin.yml` blocks are all optional. If you leave a block out, the
extension keeps its default behavior.

### Lock the model settings

```yaml
options:
  lockModel: true
```

With `lockModel: true`, the options page table shows only brand models and no row
checkboxes. **Enabled**, **Default**, **Key** and the chat switchers still work.
The theme and the token stay editable. Only the value `true` locks the table.
Any other value, or no value, leaves row checkboxes present
(`tool/compile-brand.cjs:635-639`).

### Offer the built-in providers

```yaml
options:
  builtInProviders: true
```

With `builtInProviders: true`, **Add model** first shows a grid of eight tiles:
OpenRouter, Anthropic, OpenAI, xAI, Google AI, DeepSeek, Moonshot (Kimi) and
Custom. When you select a provider, the form fills in its endpoint and format.
Anthropic, OpenAI, DeepSeek and Google AI also fill in their current model list
and each model's Vision value. You can edit the endpoint and model rows, and
choose among the provider's formats. Only the value `true` shows the grid. Any
other value, or no value, opens the custom form directly.

### Add hosts

`hosts` lists extra origins the extension can call, as Chrome match patterns.
You do not need to list your model endpoints. The build adds them
(`tool/manifest.cjs:24-40`).

```yaml
hosts:
  - "https://api.acme.com/*"
```

A pattern is `<all_urls>`, or `scheme://host/path`. The scheme is `http`,
`https`, `file`, `ftp` or `*`. The host can have a port, for example
`http://localhost:8080/*` (`tool/manifest.cjs:10-13`).

The default brand lists `http://localhost:10040/*`. That origin is the test
server of this repository. Remove it from your brand.

### Turn tool groups on or off

```yaml
tools:
  data:  { enabled: false }
```

| Group | Tools |
|---|---|
| `scheduler` | `set_schedule`, `list_schedules` and `cancel_schedule` |
| `todo` | `todo_write` and `todo_read` |
| `data` | `list_data_sources`, `get_field_details`, `sample_field_values`, `query_data` |

`show_generative_ui` is not available in the side panel, so there is no group
for it. It builds a `form` or `buttons` block, and it checks that block with
`ajv` first. `ajv` compiles a validator with `new Function`, which the
extension's Content Security Policy refuses, so the check fails and the tool
returns an error instead of a block. Every side panel agent runs without it,
whatever its `tools` list says.

Each group takes a mapping with a boolean `enabled`
(`tool/compile-brand.cjs`, `compileFlags`; `src/lib/brand-capabilities.ts`,
`brandToolConfig`). For a
side panel agent, a group switched off here is removed on top of that agent's
own `tools` list — an agent set to `tools: "*"` still loses the group.

### Turn built-in skill groups on or off

```yaml
skills:
  websiteEdit: { enabled: false }
  testing:     { enabled: false }
```

The `skills` block turns off built-in skills. It does not add skills. To add
skills, see [Custom skills](./custom-skills.md), which also lists the skills in
each group. As with tool groups, a side panel agent's own `skills` list still
loses a group switched off here. For example, `testing: { enabled: false }`
removes the `test_plan` skill from every side panel agent, even from an
agent whose `skills` list names `test_plan`.

## Step 6: Replace the icon

Replace `brand/icon.png` with your own icon. The file must be
(`tool/png-icons.cjs:41-74`):

- a PNG file
- 8-bit RGBA (colour type 6)
- not interlaced
- square
- at least 128 x 128 pixels

The build writes `dist/icons/16.png`, `32.png`, `48.png` and `128.png` from it
(`tool/png-icons.cjs:161-166`). If your image editor saves a palette PNG or a
PNG without an alpha channel, export it again as RGBA.

## Step 7: Add skills

This step is optional. Put one markdown file per skill in `brand/skills/`. See
[Custom skills](./custom-skills.md) for the file format and a full example.

## Step 8: Build the extension

Run this command in the package folder:

```bash
npm run build
```

`npm run build` runs `web-agent-brand build` (`tool/init.cjs:61`). The build
does these things (`tool/build.cjs:30-52`):

1. It checks `plugin.yml`, `model.yml`, every skill file, `icon.png` and
   `package.json`.
2. If a check fails, it prints the error, exits with code 1, and does not
   change `dist/`. See [When the build fails](#when-the-build-fails).
3. If every check passes, it deletes `dist/` and writes a new one.
4. It prints one summary line.

A successful build prints a line like this:

```
Built Acme Assistant 1.4.0 — 1 model(s), 1 skill(s), 2 host permission(s).
```

The output folder is always `dist/` in the package folder. It contains:

```
dist/
├── manifest.json     generated from package.json and the brand
├── brand.json        the compiled brand: agents, defaultAgent, prompts, options, models, skills, hosts, themes
├── brand-themes/     one CSS file per custom theme; present only when the brand declares themes
├── icons/            16.png, 32.png, 48.png, 128.png
└── background.js, content.js, bridge.js, sidepanel.js, options.js, and the
    HTML and CSS files they use
```

## Step 9: Load the extension in Chrome

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** in the top-right corner.
3. Select **Load unpacked**.
4. Select the `dist` folder of your package.

When you change the brand later, run `npm run build` again. Then select the
**Reload** button on the extension card in `chrome://extensions`.

## Step 10: Check that it worked

Check the build output first:

1. Print the extension name and version:

   ```bash
   node -p "const m = require('./dist/manifest.json'); m.name + ' ' + m.version"
   ```

2. Print the skill names that the build compiled:

   ```bash
   node -p "require('./dist/brand.json').skillDefs.map(s => s.name)"
   ```

Then check the extension in Chrome:

1. On `chrome://extensions`, the extension card shows your `displayName`,
   `version`, `description` and icon.
2. Open the options page of the extension. The **Models** tab lists the
   `label` of each entry in your `model.yml`, grouped by provider.
3. On the options page, select the **Agents** tab. It shows one card for each
   file in your `agents/` folder, with its `displayName` and `description`.
   The card for your `defaultAgent` is first and shows `Default`.
4. Select the extension button in the toolbar. The side panel opens.
5. Ask the agent which skills it has. Your brand skills are listed in the
   `# Skills` section of its system prompt, so the agent can name them.
6. If a skill has `command: true`, type `/` in the message box. The skill shows
   in the command menu.

## Publish the brand package

When the extension works, remove `"private": true` from `package.json`, then
run:

```bash
npm publish
```

`init` sets `private: true` so that you do not publish under a name you did not
choose (`tool/init.cjs:58-60`). `files: ["dist"]` publishes the built extension
and not the brand sources (`tool/init.cjs:62-65`). A person who installs your
package loads its `dist/` folder unpacked, as in Step 9.

## Add custom themes

This step is optional. A brand can ship its own themes. Each theme is one entry
in the `themes` list in `plugin.yml`:

```yaml
themes:
  - id: acme-dense
    label: Acme Dense
    scheme: dark
    base: wa2-dark
    css: themes/acme-dense.css
```

| Key | Required | Accepted values |
|---|---|---|
| `id` | Yes | Lowercase letters, digits and `-`, starting with a letter. It must not be `wa1-dark`, `wa2-dark` or `wa2-light`, and no two themes may share an `id`. |
| `label` | Yes | A non-empty string. The name shown in the options page theme list. |
| `scheme` | Yes | `dark` or `light`. |
| `base` | Yes | A built-in theme the custom theme extends: `wa1-dark`, `wa2-dark` or `wa2-light`. |
| `css` | Yes | The path to the theme's CSS file, relative to the `brand/` folder. |

`css` points to a file that declares exactly one `[data-theme="<id>"]` block.
The block sets only the `--wa-*` tokens the theme changes; every other token is
inherited from `base`:

```css
[data-theme="acme-dense"] {
  --wa-action-color-info: hsl(150deg 80% 40%);
  --wa-action-color-info-10opc: hsl(150deg 80% 40% / 10%);
  --wa-action-color-info-20opc: hsl(150deg 80% 40% / 20%);
}
```

The build checks every theme file with `web-agent-theme-check`. A token that is
not a web-agent token fails the build with a message naming the entry and the
token. A missing file, an invalid `id`, a duplicate `id`, a built-in `id`, an
unknown `base` and a bad `scheme` fail the build too.

When the build succeeds it does three things:

1. It copies each theme to `dist/brand-themes/<id>.css`.
2. It adds each file to the manifest's content-script CSS, and adds
   `brand-themes/*.css` to the manifest's web-accessible resources. The in-page
   bubble therefore gets the theme with no extra request.
3. It lists the theme in `dist/brand.json`, so the side panel, the in-page
   bubble and the options page register it at run time.

The options page shows every theme by its `label`, after the built-in themes.
The user picks one theme for the whole extension. A page that ships its own
`--wa-*` tokens keeps them, and the bubble follows that page.

## Build from a copy of this repository

If you work in this repository, you can build a brand package with the local
toolkit instead of the published one. Run the commands in steps 1 and 2 from the
`projects/web-agent` folder.

1. Build the extension once. This writes the bundles to `dist-template/`:

   ```bash
   pnpm --filter @cuatoi/web-agent-browser build
   ```

2. Create the brand package:

   ```bash
   node packages/web-agent-browser/bin/web-agent-brand.mjs init <folder>
   ```

3. Edit the brand as in steps 2 to 7.
4. Build it. Run this in the brand package folder:

   ```bash
   node <path-to>/packages/web-agent-browser/bin/web-agent-brand.mjs build
   ```

The build copies `dist-template/` from the toolkit into your package's `dist/`
(`tool/build.cjs:38-40`). Step 1 also builds the repository's own `brand/`
into `packages/web-agent-browser/dist/`.

## What a brand cannot change

- **The built-in themes.** A brand adds themes with `plugin.yml`'s `themes` key
  (see [Add custom themes](#add-custom-themes)). The three built-in themes
  (`wa1-dark`, `wa2-dark`, `wa2-light`) stay, and the user always decides which
  theme to use. The extension reads the `--wa-*` tokens from `wa-tokens.css`
  (`webpack.config.cjs:54-59`).
- **Page titles.** The side panel page title is `Web Agent`
  (`src/sidepanel.html:3`). The options page title and heading are
  `Web Agent options` (`src/options.html:3`, `src/options.html:87`).
- **The bubble launcher icon.** It is a fixed SVG (`src/lib/constants.ts:117`).

## When the build fails

Each check prints one line that names the file and the problem. A YAML syntax
error in `plugin.yml`, `model.yml` or skill frontmatter prints the YAML parser's
own message instead. That message names the file, the line and the column, and
shows the lines around the error. For example:

```
missed comma between flow collection entries in "brand/plugin.yml" (19:18)

 17 | skills:
 18 |   websiteEdit: { enabled: false }
 19 | tools: { data: [ }
-----------------------^
```

If you run the build in a folder with no `package.json`, Node.js prints an
`ENOENT: no such file or directory` error that names `package.json`
(`tool/build.cjs:31`). Run the build in the brand package folder.

### `package.json`

Source: `tool/manifest.cjs:60-65`, `tool/manifest.cjs:80-83`.

| Message | How to fix it |
|---|---|
| `package.json needs a version` | Add a `version`. |
| `package.json needs a description; it is the extension's store description` | Add a `description`. |
| `package.json version '<v>' cannot be a Chrome version; use 1-4 dot-separated integers, each 0-65535` | Use one to four numbers separated by dots, each from 0 to 65535. |

### `brand/plugin.yml`

Source: `tool/compile-brand.cjs:78-125`, `tool/compile-brand.cjs:316-336`,
`tool/manifest.cjs:33-38`.

| Message | How to fix it |
|---|---|
| `plugin.yml must contain a YAML mapping, got <what>` | Put `key: value` pairs at the top level of the file. |
| `plugin.yml prompts must be a YAML mapping, got <what>` | Make `prompts` a mapping with an `inPage` key. |
| `plugin.yml prompts.sidePanel is no longer read; move the text to instructions in brand/agents/<id>.yml` | The side panel's agents get their prompt from `instructions` in their own `brand/agents/<id>.yml` file now. Move the text there and remove `prompts.sidePanel`. |
| `plugin.yml prompts.<key> is not a known agent; expected inPage` | Rename the key to `inPage`. |
| `plugin.yml prompts.<key> must be a string` | Make the prompt a string. |
| `plugin.yml prompts.<key> is empty; remove the key instead` | Write the prompt, or remove the key. |
| `plugin.yml defaultAgent is missing; expected <ids>` | Add `defaultAgent: <id>`, naming one of the files in `brand/agents/`. |
| `plugin.yml defaultAgent "<x>" has no file brand/agents/<x>.yml; expected <ids>` | Fix the id, or add that agent file. |
| `plugin.yml <block> must be a YAML mapping, got <what>` | Make the `tools` or `skills` block a mapping. |
| `plugin.yml <block>.<key> is not a known <tool\|skill> group; expected <list>` | Use a group name from the list in the message. |
| `plugin.yml <block>.<key> must be a mapping with a boolean 'enabled', for example { enabled: false }` | Write the group as `{ enabled: true }` or `{ enabled: false }`. |
| `plugin.yml hosts must be a YAML list of match patterns, got <what>` | Make `hosts` a list. |
| `plugin.yml hosts[<i>] must be a non-empty string` | Make each entry a non-empty string. |
| `plugin.yml hosts '<p>' is not a Chrome match pattern; expected <all_urls> or scheme://host/path, e.g. https://acme.com/*` | Use `<all_urls>` or `scheme://host/path`. |

### `brand/agents/<id>.yml`

Source: `tool/compile-brand.cjs:compileAgents`.

| Message | How to fix it |
|---|---|
| `brand/agents/ has no agent files; add at least one <id>.yml, for example chromagent.yml` | Add at least one agent file. |
| `brand/agents/<file> file name must use lowercase letters, digits, - and _, starting with a letter` | Rename the file. The name without `.yml` becomes the agent's id. |
| `brand/agents/<file> <key> must be a non-empty string` | Write a non-empty `displayName`, `description` or `instructions`. |
| `brand/agents/<file> model "<x>" is not an id in model.yml; expected <ids>` | Fix the id, or add that entry to `model.yml`. |
| `brand/agents/<file> <key> must be "*" or a list of names` | Write `tools` and `skills` as `"*"` or a YAML list. |
| `brand/agents/<file> <key> must be a list of names` | Write `excludeTools` and `excludeSkills` as a YAML list. |
| `brand/agents/<file> <key> lists "<name>", which is not a side panel tool; expected "*" or names such as read_tabs, page_eval, page_screenshot` | Use a real side panel tool name. |
| `brand/agents/<file> <key> lists "<name>", which is not a side panel skill; expected "*" or names such as <names>` | Use a real side panel skill name. |
| `brand/agents/<id>.home must be a folder` | Replace the file named `<id>.home` with a folder, or delete it. |
| `brand/agents/<id>.home may only contain AGENTS.md (found: <names>)` | Delete every other entry. A starter folder holds one file, `AGENTS.md`. |
| `brand/agents/<id>.home/AGENTS.md must be a file` | Replace the folder named `AGENTS.md` with a text file. |

### `brand/model.yml`

Source: `tool/compile-brand.cjs:243-283`.

| Message | How to fix it |
|---|---|
| `model.yml must have a models: list` | Put the entries under a top-level `models:` list. |
| `model.yml lists no models; an extension with no model cannot answer` | Add at least one entry, or delete `model.yml`. |
| `model.yml models[<i>] must be a YAML mapping, got <what>` | Make each entry a mapping of keys. |
| `model.yml models[<i>].<field> is required` | Add the named field as a non-empty string. |
| `model.yml has two models with id '<id>'` | Give each entry a unique `id`. |
| `model.yml models[<i>].wireFormat '<w>' is unknown; expected anthropic, openai or gemini` | Use `anthropic`, `openai` or `gemini`. |
| `model.yml models[<i>].endpoint must be an absolute http(s) URL` | Use a full URL that starts with `http://` or `https://`. |

### `brand/skills/*.md`

Source: `tool/compile-brand.cjs:142-173`, `tool/compile-brand.cjs:213-218`.

| Message | How to fix it |
|---|---|
| `brand/skills/<file> has no YAML frontmatter; expected a --- block at the top` | Start the file with a line that holds only `---`. |
| `brand/skills/<file> frontmatter is not closed with ---` | End the frontmatter with a line that holds only `---`. |
| `brand/skills/<file> frontmatter is missing 'name'` | Add `name`. |
| `brand/skills/<file> name '<n>' must be lower_snake_case; it is what the model calls` | Use lowercase letters, digits and underscores, and start with a letter. |
| `brand/skills/<file> frontmatter is missing 'description'` | Add `description`. |
| `brand/skills/<file> has frontmatter but no body; the body is the skill's definition` | Write the skill instructions below the frontmatter. |
| `brand/skills/<file> frontmatter 'command' must be true or false` | Use `true` or `false`, without quotes. |
| `two skills are both named '<n>': brand/skills/<a> and brand/skills/<b>` | Give each skill a unique `name`. |

### `brand/icon.png`

Source: `tool/png-icons.cjs:41-74`.

| Message | How to fix it |
|---|---|
| `brand/icon.png is missing; the build needs one square PNG of at least 128x128` | Add `brand/icon.png`. |
| `brand/icon.png is not a PNG` | Save the icon as a real PNG file. |
| `brand/icon.png must be an 8-bit RGBA PNG, found bit depth <d> and colour type <c>; re-export it as 8-bit RGBA (colour type 6)` | Export the icon again as 8-bit RGBA. |
| `brand/icon.png is interlaced; re-export it non-interlaced` | Export the icon again without interlacing. |
| `brand/icon.png must be square, got <w>x<h>` | Make the width and height the same. |
| `brand/icon.png is <w>x<h>; Chrome requires a 128px icon and upscaling pixel art looks broken` | Use an icon of at least 128 x 128 pixels. |

### `init`

Source: `bin/web-agent-brand.mjs:29`, `tool/init.cjs:40-48`.

| Message | How to fix it |
|---|---|
| `init needs a target directory` | Add the folder name: `web-agent-brand init <folder>`. |
| `<folder> already exists and is not empty` | Choose a new folder name, or empty the folder. |

A missing or unknown command prints the usage text and exits with code 2
(`bin/web-agent-brand.mjs:46-48`).
