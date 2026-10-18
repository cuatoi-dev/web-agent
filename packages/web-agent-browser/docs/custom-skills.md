---
title: Custom skills
---

# Add a custom skill

A skill is a named set of instructions for the agent. The agent sees each
skill's name and description in the `# Skills` section of its system prompt.
When a task matches, the agent calls `load_skill` to read the full instructions
(`packages/web-agent-core/src/prompt/system-prompt.ts:116-119`,
`packages/web-agent-core/src/tools/skill-tools.ts:92-117`).

You can add a skill in two ways:

| Way | Who adds it | Where it is stored | Can be a `/` command |
|---|---|---|---|
| [Ship the skill in a brand](#ship-a-skill-in-a-brand) | You, before the build | `brand/skills/<file>.md`, compiled into `dist/brand.json` | Yes |
| [Create the skill at run time](#create-a-skill-at-run-time) | The agent, when you ask it | Browser extension storage, key `savedSkills` | No |

## Ship a skill in a brand

Use this way when every user of your extension must have the skill. Before you
start, create a brand package. See the [Branding guide](./branding-guide.md).

### Step 1: Create the skill file

1. Open the `brand/skills/` folder of your brand package.
2. Create one markdown file for the skill, for example
   `brand/skills/release_notes.md`. The file name must end in `.md`.
3. Paste this example into the file:

   ```markdown
   ---
   name: release_notes
   description: Summarise the release notes on the current page as a short changelog.
   command: true
   argumentHint: "[version]"
   ---

   # release_notes

   Summarise the release notes on the page the user is looking at.

   1. Read the page. Find the section for the version the user named. If the
      user named no version, use the newest one on the page.
   2. Group the changes under three headings: **Added**, **Changed** and
      **Fixed**. Leave out a heading that has no changes.
   3. Write each change as one short line.
   4. End with the version number and the release date, if the page shows them.

   If the page has no release notes, say so and stop.
   ```

4. Change the frontmatter and the body for your own skill.

### Step 2: Fill in the frontmatter

The frontmatter is the block between the two `---` lines at the top of the file.
The build reads these keys (`tool/compile-brand.cjs:138-182`):

| Key | Required | Accepted values | What it does |
|---|---|---|---|
| `name` | Yes | Lowercase letters, digits and underscores. Starts with a letter. | The name the agent uses with `load_skill`, and the name the user types after `/`. Each name must be unique in the folder. |
| `description` | Yes | A non-empty string. | One line. The agent reads it to decide when to load the skill. |
| `command` | No | `true` or `false`. The default is `false`. | With `true`, the user can run the skill as `/name` from the message box. |
| `argumentHint` | No | A string. | Text shown after the name in the command menu, for example `[version]`. It is only a label. |

The build ignores any other frontmatter key (`tool/compile-brand.cjs:175-181`).

The body is everything below the closing `---`. It is the skill's instructions,
in markdown, and it must not be empty. The build removes blank lines at the
start and the end of the body (`tool/compile-brand.cjs:155`).

### Step 3: Build and check

1. Run the build in the brand package folder:

   ```bash
   npm run build
   ```

   The summary line counts your skill, for example
   `Built Acme Assistant 1.4.0 — 1 model(s), 1 skill(s), 2 host permission(s).`

2. Check that the skill is in the compiled brand:

   ```bash
   node -p "require('./dist/brand.json').skillDefs.map(s => s.name)"
   ```

   The output lists `release_notes`.

3. Reload the extension in `chrome://extensions`.
4. Open the side panel and type `/`. The command menu shows `release_notes`
   with the hint `[version]`.

If the build fails, the message names the skill file. See
[When the build fails](./branding-guide.md#brandskillsmd) for each message and
its fix.

### How the build compiles skills

- The build reads every `.md` file in `brand/skills/`, in sorted file-name
  order. It skips `README.md` (`tool/compile-brand.cjs:200-223`).
- If `brand/skills/` does not exist, the brand has no skills
  (`tool/compile-brand.cjs:202`).
- Each file becomes one entry in the `skillDefs` list of `dist/brand.json`, with
  the keys `name`, `description`, `definition` (the body), `command` and
  `argumentHint` (`tool/compile-brand.cjs:175-181`).

### How the agents use a brand skill

- **Both agents get every brand skill**: the side panel agent and the in-page
  agent (`src/sidepanel.ts`, `buildAgentPanel`; `src/content.ts`, `mount`).
- **The agent can load it.** The skill's name and description are in the
  `# Skills` section of the system prompt, and `load_skill` returns the body.
- **The user can run it.** If `command` is `true`, the skill is in the `/`
  command menu (`packages/web-agent-core/src/commands/slash-commands.ts:47-56`).
  When the user sends `/release_notes 2.1`, the agent receives the skill body,
  a blank line, and then `2.1` as one message. The chat shows
  `/release_notes 2.1` (`packages/web-agent-core/src/controller-queue.ts:52-63`).

### Replace or turn off a built-in skill

The extension has built-in skills in six groups
(`tool/compile-brand.cjs`, `SKILL_GROUPS`):

| Group | Agent | Skills in the group | Source |
|---|---|---|---|
| `core` | In-page | `query_data_advanced`, `present_to_user` | `packages/web-agent-core/src/skills/default-skills.ts:5,97` |
| `dom` | In-page | `multi_step_ui` | `packages/web-agent-dom/src/skills/multi-step-ui-skill.ts:4` |
| `pageFetch` | In-page | `page_fetch` | `src/lib/page-fetch-skill.ts:4` |
| `tab` | Side panel | `tab_management`, `page_agent` | `src/lib/tab-skill.ts:55-57` |
| `websiteEdit` | Side panel | `website_edit` | `src/lib/website-edit-skill.ts:4` |
| `testing` | Side panel | `test_plan`, `test_report`, `explore_app` | `src/lib/test-plan-skill.ts`, `src/lib/test-report-skill.ts`, `src/lib/explore-app-skill.ts` |

**To turn off a group**, set its `enabled` flag to `false` in
`brand/plugin.yml`. For example, this removes the `website_edit` skill from the
side panel:

```yaml
skills:
  websiteEdit: { enabled: false }
```

A group that you do not list stays on. Only `{ enabled: false }` removes a
group (`src/lib/brand-capabilities.ts:24-37`). The group names are fixed. An
unknown group name fails the build (`tool/compile-brand.cjs`, `compileFlags`).

**To replace one built-in skill**, give your brand skill the same `name`. For
example, a file with `name: website_edit` replaces the built-in `website_edit`
skill in the side panel. The replacement stays in the same position in the
list (`src/lib/brand-capabilities.ts:34-36`).

The `skills` flag and a brand skill work together. If you turn off
`websiteEdit` and also ship a skill named `website_edit`, the side panel has
your skill, because brand skills are added after the groups are removed.

The default brand gives `test_plan`, `test_report` and `explore_app` to both Chromagent and tesagent. To give
it to one agent only, add `excludeSkills: [test_plan]` to the other agent's
file in `brand/agents/`.

## Create a skill at run time

Use this way when you want to save a skill for yourself, in your own browser,
without a new build.

### Ask the agent to save the skill

1. Open the side panel, or the in-page agent on a site where you turned it on.
2. Describe the skill and ask the agent to save it. For example:

   ```
   Create a skill named table_to_csv. Description: "Turn the largest table on
   the current page into CSV." Instructions: find the table with the most
   rows, use its header cells as the first CSV line, write one CSV line per
   row, put quotes around any value that has a comma, and return the CSV in
   one code block. Save it with create_skill.
   ```

3. The agent calls `create_skill`. A **Confirm action** dialog shows
   `Agent wants to: Create skill "table_to_csv".` in the in-page agent. In
   the side panel it shows `Create skill "table_to_csv" for all agents`, or
   `Create skill "table_to_csv" for <agent name> only` when you asked the
   agent to keep the skill for itself. Select **Allow**
   (`packages/web-agent-lit/src/chat-ui/confirm-scrim.ts:82-113`).
4. The tool returns `Skill "table_to_csv" saved successfully.`, and the agent
   tells you that the skill is saved.

To use the skill later, ask for the task, for example
`Turn the table on this page into CSV.` You can also name the skill:
`Use the table_to_csv skill.`

### What `create_skill` does

`create_skill` takes three required arguments and, in the side panel, one
optional argument
(`packages/web-agent-core/src/tools/skill-tools.ts:34-52`):

| Argument | What it is |
|---|---|
| `name` | The skill name. If a skill with this name already exists, the new skill overwrites it. |
| `description` | A short summary of what the skill does and when to use it. |
| `definition` | The full instructions, in markdown. |
| `shared` | Side panel agents only, optional. `true` or missing: every agent can use the skill. `false`: only the agent that saved it can use it. |

In order, the tool (`packages/web-agent-core/src/tools/skill-tools.ts:128-178`):

1. Checks that each argument is a non-empty string, and removes spaces at the
   start and the end.
2. Asks you to confirm. The dialog text is `Create skill "<name>"` in the
   in-page agent, `Create skill "<name>" for all agents` or
   `Create skill "<name>" for <agent name> only` in the side panel, and
   `Overwrite existing skill "<name>"` when the name already exists. If you
   select **Reject**, nothing is saved.
3. Saves the skill.
4. Makes the skill available in the same conversation at once.

The two agents offer `create_skill` and `delete_skill` because the extension
gives each agent a writable skill store
(`packages/web-agent-core/src/tools/skill-tools.ts:120`, `:183`;
`src/sidepanel.ts:buildAgentPanel`, `src/content.ts:106`).

### Where the saved skills are stored

- Both agents use one store: the `savedSkills` key in `chrome.storage.local`
  (`src/lib/skill-registry.ts`, `SKILLS_KEY`).
- A skill with no `owner` is shared. Every side panel agent and the in-page
  agent on every site can use it. Every skill saved before owners existed is
  shared.
- A skill saved by a side panel agent with `shared: false` has
  `owner: "<agent id>"`. Only that agent can list, load, overwrite or delete
  it.
- The in-page agent always saves shared skills and sees shared skills only.
- A skill name is unique across all agents. If another agent owns a private
  skill with the same name, `create_skill` fails with
  `A skill named "<name>" belongs to another agent. Choose another name.`
- The value is a list of `{ name, description, definition, owner? }`
  entries, with one entry per name.
- The in-page agent cannot use `chrome.*` APIs, so it sends each read and write
  through the extension's content script, `bridge.js`
  (`forwardedSkillRegistry`, `src/lib/skill-registry.ts`).
- A new conversation reads the saved skills once, when it starts
  (`packages/web-agent-core/src/controller.ts:171-187`). A skill that you save in
  one tab reaches an agent that is already open in another tab when that agent
  starts a new session.

### Differences from a brand skill

- **No `/` command.** `create_skill` saves only `name`, `description` and
  `definition` (`packages/web-agent-core/src/tools/skill-tools.ts:161`). A saved
  skill has no `command` or `argumentHint`, so it is not in the `/` command
  menu.
- **No name format check.** Any non-empty name is accepted. A brand skill name
  must be lower_snake_case.
- **A saved skill wins a name clash.** A saved skill replaces a brand skill or a
  built-in skill with the same name
  (`packages/web-agent-core/src/controller-config.ts:197-205`,
  `packages/web-agent-core/src/skills/skill-registry.ts:67-75`). If the brand
  skill had `command: true`, its `/` command is gone while the saved skill
  exists, because the saved skill has no `command`.
- **Per browser.** Saved skills stay in the browser where they were saved. They
  are not part of `dist/`.

### See and delete saved skills

**On the options page:**

1. Open the extension options page.
2. Select the **Skills** tab. Each row shows the skill name, owner label
   (`Shared` or the owning agent's name), and description
   (`src/lib/saved-skills.ts:19-45`).
3. Select **Delete** on a row. The page removes the skill at once and does not
   ask you to confirm (`src/lib/saved-skills.ts:75-86`).

If no skill is saved, the section shows
`No skills saved yet. Ask the agent to create one and it appears here.`
The page reads the list when it opens and after each delete. If an agent saves a
skill while the page is open, open the page again to see it.

When you delete an agent on the **Agents** tab, the skills saved for that agent
only are deleted too. See "Delete an agent" in
[Using the extension](./using-the-extension.md).

**From the chat:**

1. Ask the agent, for example `Delete the table_to_csv skill.`
2. The agent calls `delete_skill`. A **Confirm action** dialog shows
   `Agent wants to: Delete skill "table_to_csv".` Select **Allow**.
3. The tool returns `Skill "table_to_csv" deleted.`, and the agent tells you
   that the skill is deleted.

`delete_skill` works only for a name in the agent's current skill list. For
another name, it returns `Skill "<name>" not found.`
(`packages/web-agent-core/src/tools/skill-tools.ts:190-236`). It removes the
entry from the saved store only. A brand skill or a built-in skill with the
same name comes back when a new session starts.

## Which skill wins

When two skills have the same name, the agent keeps one of them, in this order:

1. The saved skill (created at run time).
2. The brand skill (`brand/skills/`).
3. The built-in skill.
