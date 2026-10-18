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

## Apps

One line per app: `name · hosts · apps/<name>/`

- (none yet)
