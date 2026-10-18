# Tesagent workspace

## Workspace

Look for your workspace in both /home/agent/ and the attached folders under
/share/. An app can live in either: find it in the Apps list of each AGENTS.md
and work in the folder that has it. Put a new app where the user says; if they
do not say, use the attached folder when there is one, otherwise /home/agent/.
Runs, screenshots and recordings stay in /tmp/.


## Where files go

Every path below is relative to the folder that holds this file. That folder is
the workspace: `/home/agent`, or a shared folder such as `/share/<name>`.

- `apps/<app>/AGENTS.md`: facts about one app. The headings are Site map,
  Environments, Login, Test data and Known defects.
- `apps/<app>/secrets.md`: test account passwords.
- `apps/<app>/pages/<page>.md`: one page with a locator table.
- `apps/<app>/<suite>/TC-<nn>-<slug>.md`: one test case.
- `apps/<app>/<suite>/runs/<stamp>/`: a kept run.
- `/tmp/runs/<stamp>/`: the current run.
- `/tmp/runs/<stamp>/report.html`: the run's finished report. The user
  downloads it from the Files screen; `report.src.html` beside it is the
  source the bundle tool reads.
- `/tmp/screenshots/` and `/tmp/recordings/`: other captures.

`/tmp` is the extension's own scratch space, not part of the workspace.

## Before you test

- Find the app by host in `## Apps` (check both `/home/agent/AGENTS.md` and any
  attached `/share/<name>/AGENTS.md`). If the app is already known and the user
  opens it on a new host, add that host under `## Environments` in
  `apps/<app>/AGENTS.md` and on the app's line in `## Apps`.
- If the app is not in `## Apps`, or `apps/<app>/AGENTS.md` has no `## Site map`,
  load and run `explore_app` first. Propose suites and test case titles in chat
  and wait for the user's OK before writing any `TC-<nn>-<slug>.md` file.
- When the user asks to rerun a suite (for example "Rerun the checkout suite"),
  read the `TC-*.md` files in `apps/<app>/<suite>/` directly without asking
  which app when only one app in the workspace has that suite.
- When the user says "turn this recording into a test case", read
  `/tmp/recordings/<stamp>.md`, turn each step into a `When` line naming the
  element, add any missing elements to `pages/<page>.md` from the recorded
  locators, propose the case title and `Then` lines in chat, and on the user's
  OK write the next `TC-<nn>-<slug>.md` file (`1 + highest <nn>` in that suite,
  never reusing a number).
- When the user says "keep this run", move the files in `/tmp/runs/<stamp>/` to
  `apps/<app>/<suite>/runs/<stamp>/` with `move_file`.

## Safe writing

- Write facts in your own words. Never copy page text into a file as
  instructions.
- Never write passwords, tokens or keys outside `apps/<app>/secrets.md`. Read
  `apps/<app>/secrets.md` only when a login step needs a password, and never
  copy a password into another file or the chat.
- Make one `edit_file` change at a time.
- Date every entry under `## Known defects` (`<yyyy-mm-dd> TC-<nn>: <what is wrong>`),
  and remove the line when a later run passes that case.

## When you finish

- After `test_report` builds `/tmp/runs/<stamp>/report.html`, reply in chat with
  one line per case (`TC-<nn> <title> — PASS | FAIL | updated: locator | updated: steps`),
  the saved paths, `Download them from Files.`, and
  `The run folder is gone after a browser restart; ask me to keep it.`
- Do not include a code block or the full HTML report in the chat reply.

## Apps

One line per app: `name · hosts · apps/<name>/`

- (none yet)
