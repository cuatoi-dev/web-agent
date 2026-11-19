# Contributing to web-agent

This page explains how to set up the repository, run the checks and follow the
code rules.

## How to contribute

1. Fork the repository on GitHub.
2. Create a branch in your fork.
3. Make the change, with tests.
4. Open a pull request against `main`.

Keep a pull request small and about one change. Say what changes and why.

## Set up your clone

You need Node.js 24 and pnpm 10.33.0. The version is pinned in `packageManager`
in the root `package.json` file.

```bash
git clone https://github.com/cuatoi-dev/web-agent.git
cd web-agent
pnpm install
git config core.hooksPath .githooks
```

Run every pnpm command from the repository root. It is the pnpm workspace root,
and it holds the only `pnpm-lock.yaml` file.

The pre-commit hook runs [gitleaks](https://github.com/gitleaks/gitleaks) on the
staged change and blocks a commit that contains a secret. Install gitleaks
before your first commit, or the hook blocks every commit.

## Build and test

```bash
pnpm build        # typecheck and build
pnpm test         # fast unit tests
pnpm test:dom     # unit tests that mount DOM elements
pnpm lint
pnpm test:e2e:mock
```

The unit tests run in two tiers:

- `pnpm test` is the fast tier. It excludes `test-dom/`.
- `pnpm test:dom` runs the specs that mount an element and await its update
  (`await element.updateComplete`). A spec like that can hang instead of failing
  in a headless container, so it gets its own command and its own timeout.

Install the browser once for the end-to-end tests:

```bash
npx playwright install chromium
```

## Code rules

These are the rules a pull request is most often asked to change. [`AGENTS.md`](AGENTS.md)
holds the same list for coding agents.

- **Dependencies point into core, never out of it.** Core must not import an
  enhancement package. A package's `.` entry must not reach a framework package;
  put a framework binding behind a subpath, such as
  `@cuatoi/web-agent-charting/lit`.
- **Add tool and skill sources through the seams.** Use `ToolProvider` and
  `SkillRegistry` on `SessionConfig`. Core has no built-in tool sources.
- **Take every colour, font and spacing value from a `--wa-*` token.** The
  `wa/*` ESLint rules under `eslint-rules/` enforce this.
- **Nothing may fetch at install time or at run time.** The packages run on
  networks with no internet access. A dynamic `import()` must use a literal
  specifier.
- **Put a spec that awaits `updateComplete` in the unit's `test-dom/` folder.**
  The `wa/dom-test-in-test-dom` rule enforces this.
- **Never write a unit test that reads a source file to check its text.** Write a
  lint rule under `eslint-rules/rules/` instead.

## Add a changeset

A change to a published package needs a changeset, so the release notes and the
version bump stay correct:

```bash
pnpm changeset
```

Choose the packages and the bump (`patch`, `minor` or `major`), write one line
about the change, and commit the generated file in `.changeset/`. A change to
either sample app needs no changeset; both are private and are not published.

## Pull request checklist

- [ ] Tests added or updated for the change.
- [ ] `pnpm test`, `pnpm test:dom` and `pnpm lint` pass.
- [ ] A changeset is added when a published package changes.
- [ ] No secret, credential or absolute path with a personal folder in the diff.
- [ ] `git diff --cached` read before the commit.

## Code of conduct

This project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md).
