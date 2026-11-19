---
title: Using the extension
---

# Using the extension

This page covers what you see and set after you load the extension: the side
panel, the per-site switch, the options page, and saved skills. It also
explains how a model request leaves the browser.

## Open the side panel

Select the extension button in the Chrome toolbar. The button opens the side
panel for the tab you are on (`src/background.ts:12-22`).

The same click grants the extension the `activeTab` permission for that tab.
`page_screenshot` needs that permission. If it loses access to a tab, click the
toolbar button on that tab again.

The side panel runs one of the brand's agents, defined in
`brand/agents/<id>.yml`. The first time you open it, it runs the brand's
default agent (`brand/plugin.yml`'s `defaultAgent`). The header shows the
agent's `displayName` before the first message.

To change the agent, use the combo box at the top of the side panel. It shows
the current agent's name and description. Open it with a click, or with Enter,
Space or the Down arrow key. The list shows the default agent first, then the
other agents by display name. Select an agent with a click, or move with the
arrow keys and press Enter. Press Escape, or click outside the list, to close it
without a change (`src/lib/agent-combo.ts`).

Each agent has its own panel and its own session list, saved under
`web-agent-extension-panel-<id>`. An agent's conversations do not appear in
another agent's history, in the in-page agent, or in any host app
(`src/sidepanel.ts:buildAgentPanel`, `src/lib/agent-switcher.ts`).

If the current agent is still working when you select another one, the side
panel asks first. Select **Stop and switch** to stop the turn and switch, or
**Cancel** to keep the current agent and let its turn continue.

The side panel opens on the agent you used last. If that agent is no longer in
the brand, it opens on the default agent (`sidePanelAgent` in
`chrome.storage.local`, `src/lib/settings.ts:getLastAgentId`).

If the brand fails to load, or defines no agent, the panel shows an error
instead of a chat, and no combo box.

The side panel reads the model table and the theme once, when it opens
(`src/sidepanel.ts:main`). It opens on the agent's own model when that model
is on, and on the default model otherwise. Each provider's key and headers go
with its own models. After you change the Models tab, close the side panel
and open it again.

## Turn the in-page agent on for a site

On the right of the agent combo box is an icon button. It turns the in-page
agent on or off in the tab you are looking at
(`src/lib/page-agent-icon.ts`). Select it, or move to it with the Tab key and
press Space.

The icon updates when you switch tabs, when the active tab finishes loading
or changes URL, and when the browser window gains focus. It follows the
active tab in the window that contains the side panel. When you select the
icon, it checks the active tab again before it changes the in-page agent.

- **Off:** the icon has a slash through it.
- **On:** the button has an accent fill and a dot in its top-right corner.
- **Unavailable:** the icon is faded and has a slash through it.

The slash and the dot show the state without relying on colour.

Point to the button to see its tooltip. A screen reader reads the same text.
It names the action, then the state of the tab
(`src/lib/panel-toggle.ts:39-70`):

| Tooltip | What it means |
|---|---|
| `Turn off the agent in this tab. The in-page agent is on for <origin>.` | The bubble is in the page. |
| `Turn on the agent in this tab. The in-page agent is off for <origin>.` | The bubble is not in the page. Select the button to add it. |
| `Turn on the agent in this tab. This page already has its own agent, so nothing was added.` | The page has its own agent. The button is unavailable. |
| `Turn on the agent in this tab. Open a website in a tab to use this control.` | The tab is not a website, for example a `chrome://` page or an extension page. The button is unavailable. |

`<origin>` includes the scheme, for example `http://localhost:10040`.

The extension saves your choice per origin in extension storage
(`src/lib/settings.ts:74-87`). On a later visit to that origin, the bubble
comes back without another click (`src/bridge.ts:61-65`).

The side panel agent can make the same change with `toggle_page_agent`. See
[Page agent tools](./page-agent-tools.md).

### Sites that already have an agent

The extension never adds a second agent to a page. Before it mounts the bubble,
it looks for a `web-agent-bubble` or `agent-chat-panel` element in the document
and in every open shadow root (`src/lib/agent-detect.ts:11-32`,
`src/content.ts:58`). If the page mounts its own agent later, within 10 seconds
of the bubble appearing, the extension removes its bubble
(`src/content.ts:206-220`, `src/lib/constants.ts:6`).

The extension registers its custom elements only when the bubble mounts. On a
page where the bubble is off, the extension defines nothing, so the page keeps
its own `<wa-*>` classes.

## What both agents carry

Beyond the tools on the other pages, both agents have these capabilities:

- **A todo list.** `todo_write` and `todo_read` are on for both agents
  (`src/lib/panel-setup.ts`, `src/content.ts`). A brand can turn them
  off with `tools: { todo: { enabled: false } }` in `brand/plugin.yml`.
- **A scheduler.** `set_schedule`, `list_schedules` and `cancel_schedule` are
  on for side panel agents. The in-page agent gets these tools when the brand
  enables the scheduler, as the sample brand does. A brand can turn it off with
  `tools: { scheduler: { enabled: false } }` in `brand/plugin.yml`.
- **Up to 1000 tool steps in one turn.** Both agents set `maxIterations` to
  1000. The core default is 200.
- **Saved skills.** Both agents can save a skill with `create_skill` and remove
  one with `delete_skill`. Both tools ask you to confirm first. Both agents use
  one store, so a shared skill saved on one site is available on every site and
  in the side panel. A side panel agent can also save a skill for itself only:
  ask it to keep the skill private, and it saves with `shared: false`. Other
  agents and the in-page agent do not see that skill. A skill name is unique
  across all agents (`src/lib/skill-registry.ts`, `SKILLS_KEY`,
  `src/sidepanel.ts:buildAgentPanel`, `src/content.ts:102`).
- **Brand prompts and skills.** The in-page agent reads its prompt from
  `brand/plugin.yml`'s `prompts.inPage`; each side panel agent reads its own
  from `instructions` in its `brand/agents/<id>.yml` file. Both get the skills
  in `brand/skills/` (`src/lib/brand.ts`, `src/lib/brand-capabilities.ts`), and
  a side panel agent's own `skills` / `excludeSkills` narrows that further.

A saved skill with the same name as a brand skill or a built-in skill replaces
it (`src/lib/brand-capabilities.ts:19-22`). To add a skill, see
[Custom skills](./custom-skills.md).

## Choose the models and the theme

The options page opens on **General**. Choose **Theme** there and select
**Save**. The other tabs are **Models**, **Skills**, and **Agents**.

1. The **Models** tab shows one row per provider and its models under it.
   Models that share an endpoint and a wire format in `brand/model.yml` form
   one provider row with the **Provided** tag. The count line reads
   "Enabled N/M".
2. The **Enabled** switch turns a model on or off. Only enabled models
   appear in the side panel and bubble kebab menus and in the agent editor.
   The last enabled model cannot be turned off; the page shows
   `At least one model must stay on.`
3. The **Default** radio picks the model the bubble uses and that an agent
   set to **Use the options page model** uses. A model that is off cannot be
   the default. Turning off the default moves it to the first other enabled
   model.
4. The key button (a key icon, tooltip `Key for <provider>`) on a brand
   provider row opens a dialog with one field,
   **API key (optional)**. Empty: the provider sends the key the brand
   provides in `brand/model.yml`, or no key when the brand gives none.
   Filled: your key is sent in place of the provided key, to that endpoint
   only. The key is stored encrypted (AES-GCM) in extension storage, and the
   encryption key is kept in the extension's IndexedDB.
5. Switches, radios and keys save at once.
   **Theme** is on the **General** tab and keeps its own **Save** button, which
   shows `Saved. Reload a page to use the new settings.`

The provider row shows `key ••••xxxx` for your own key, `provided key`
for the brand's key, and `no key` when there is neither.

### When the brand locks the model

If the build sets `options: { lockModel: true }` in `brand/plugin.yml`, the
table shows only brand models and no row checkboxes. **Enabled**, **Default**,
**Key** and the chat switchers still work. The theme stays editable.

### What the theme changes

The theme changes the agent bubble and the side panel only. The extension never
writes a `data-theme` attribute on the website itself. If the website already
supplies the `--wa-*` design tokens, the extension applies no theme to the
bubble, and the bubble follows the website's theme
(`src/lib/theme.ts:94-119`). With **Auto**, an operating system change
updates the bubble without a reload.

## Switch the model while chatting

The side panel and the bubble list the enabled models in the kebab menu
(shown with two or more enabled models). Picking one sends the next message to
that model, on its own endpoint and wire format, and keeps the conversation.
The default on the Models tab does not change.

## See and remove saved skills

The options page lists every skill your agents have saved on the **Skills**
tab (`src/lib/saved-skills.ts`).

- Each row shows the skill name, an owner label (`Shared` or the owning agent's name), and its description.
- Select **Delete** on a row to remove that skill. The page removes it from
  storage at once and does not ask you to confirm. Other skills are not
  affected.
- When nothing is saved, the section shows
  `No skills saved yet. Ask the agent to create one and it appears here.`

The page reads the list when it opens and after each delete
(`src/options.ts:243`, `src/lib/saved-skills.ts:100-112`). If an agent saves a skill while the options page is
open, reopen the page to see it.

## See your agents

The options page lists your agents on the **Agents** tab (`src/lib/agent-store.ts`,
`src/lib/agent-cards.ts`).

The list shows the default agent first, then the other agents by display name.

- Each card shows the agent's display name, description, and status tags: `Default`
  for the brand's default agent, `Provided` or `Added by you`, and `Edited`
  when a brand agent has stored changes.
- The summary line lists the assigned model (or `Options page model`, or `Options page model (its model is off or deleted)` when the agent's model is off or gone), tools,
  and skills.
- When a brand agent sets `memory: true` in its
  `brand/agents/<id>.yml`, its card shows a **Memory** switch, off by default.
  The help text reads "Remember things about you and this agent between chats.
  Saved in this browser." Turning the switch on or off applies at once when the
  current chat has no messages. Otherwise it applies from the next chat, and
  the current chat keeps the files and skills it started with. With the
  switch on, each chat starts with `/home/shared/USER.md`, which every side
  panel agent shares, and `/home/agent/MEMORY.md`, which belongs to that agent
  alone. The agent also gets the `remember` and `onboarding` skills. The agent
  inside a visited website never loads memory.
- The toolbar indicates the agents appear in the side panel's agent list in
  this order.

## Edit an agent

On the **Agents** tab, select **Edit** on a card. The card opens in place, and
the other cards are dimmed until you close it. You can edit one card at a time
(`src/lib/agent-editor.ts`).

You can change these fields:

- **Description** and **System instructions**. Both are required.
- **Model**. **Use the options page model** follows the Default on the
  **Models** tab. The other options are the enabled models, shown as
  `label — provider`. If the brand locks the model settings, this field is
  read-only.
- **Skills** and **Tools**. Select **All skills (*)** or **All tools (*)**, or
  select single names. **All** also includes names that are added later. The
  **Tools** list has a filter box.
- **Excluded skills** and **Excluded tools**. These fields work only when the
  field above them is set to **All**. When you select single names instead,
  the excluded field is cleared and turned off.

A provided agent's display name and id cannot be changed.

Select **Save agent** to store the change, or **Cancel** to close the card
without saving. If a required field is empty, a message shows under the field
and nothing is saved. The side panel uses the change the next time it opens.

If your saved values are the same as the brand's values, no change is stored,
and the card does not show `Edited`.

## Reset a brand agent

Open a brand agent with **Edit**, then select **Reset to brand default**. The
stored change is removed at once, with no confirmation. The card shows the
brand's values again, without `Edited`.

## Add an agent

On the **Agents** tab, select **Add agent**. A card titled **New agent** opens
at the top of the list, and the other cards are dimmed
(`src/lib/agent-editor.ts`).

Fill in **Display name**, **Description** and **System instructions**. All
three are required. The other fields start as **Use the options page model**,
**All skills (*)** and **All tools (*)**, and work as they do when you edit an
agent.

Under **Display name**, the hint shows the agent's id, for example
`Id: checkout-tester`. The id uses lowercase ASCII letters, digits and hyphens.
If the id is already taken, a number is added: `checkout-tester-2`. If the name
has no ASCII letter or digit, the id is `agent`. The id is fixed when you save
and does not change if you rename the agent later
(`src/lib/agent-edit-rules.ts:makeId`).

Select **Save agent** to store the agent, or **Cancel** to remove the new card
without saving. The saved agent shows `Added by you`, and the side panel lists
it the next time the panel opens.

## Delete an agent

You can delete only agents that you added. Open the agent with **Edit**, then
select **Delete agent**. A dialog asks you to confirm, for example:
`Delete Checkout tester? Its chat history and its 1 private skill are deleted too.`
Select **Cancel** or press Escape to keep the agent.

When you select **Delete agent** in the dialog, the page removes:

- the agent,
- every skill saved for that agent only,
- the side panel's last-used agent setting, when it names that agent, so the
  side panel opens on the default agent,
- the agent's chat history (`src/lib/agent-delete.ts`).

If the side panel is open, the chat history is removed when the side panel
closes.

## How a model request leaves the browser

The in-page bubble runs inside the visited page, so the page's cross-origin
rules apply to it. Its requests therefore go through the service worker
(`src/lib/relay-fetch.ts`, `src/bridge.ts:208-254`, `src/background.ts:24-50`):

1. The bubble posts the request to the extension's isolated content script.
2. The content script opens a port to the service worker.
3. The service worker looks up the request's model, checks that the request URL is
   that model's provider endpoint or a path under it, and adds that provider's
   headers. A request for another URL gets
   `The request URL does not match the model's provider.` and is not
   sent.
4. The service worker sends the request to the endpoint and streams each chunk
   back over the port.
5. The content script passes the chunks to the bubble.

The authentication header depends on the provider key
(`src/lib/auth-headers.ts`, `src/lib/relay-handler.ts`):

| Provider key | Header sent |
|---|---|
| None (no Key-button key, no brand key) | No auth header |
| Wire format `openai` | `Authorization: Bearer <key>` |
| Wire format `anthropic` | `x-api-key: <key>` |
| Wire format `gemini` | `x-goog-api-key: <key>` |

For a brand provider the key is your Key-button key, else the brand's
`apiKey` from `brand/model.yml`. Every anthropic-format request also sends
`anthropic-version: 2023-06-01` and
`anthropic-dangerous-direct-browser-access: true`. The web page and its
scripts never receive a key: the brand object posted to the page has no
`apiKey`.

The side panel does not use the relay. It is an extension page, so it calls the
endpoint directly and adds the same header itself
(`src/lib/panel-setup.ts:9-46`).

## Build and test from this repository

Build the extension before you run the end-to-end tests. The Playwright fixture
loads the unpacked extension from `dist/` (`e2e/extension.fixture.ts:6`), and
`dist/` is not committed.

```bash
pnpm --filter @cuatoi/web-agent-browser build
pnpm --filter @cuatoi/web-agent-browser test
pnpm --filter @cuatoi/web-agent-browser test:e2e:mock
```

The build runs the type check, bundles the extension into `dist-template/`, then
builds the repository's own `brand/` into `dist/`
(`package.json` `build` script). Load `dist/` unpacked to try it.

The default brand lists `http://localhost:10040/*` under `hosts`
(`brand/plugin.yml`). That origin is the end-to-end fixtures server.
Playwright cannot select the Chrome permission prompt, so the tests need that
origin granted at install.
