# web-agent — agent instructions

web-agent is a browser-native, in-app chat agent. It ships as npm packages
under the `@cuatoi/web-agent-*` scope, with two sample host apps.

If this repository sits inside a larger workspace, that workspace's
`AGENTS.md` also applies and holds the full rules.

## This repository is public and open source

This repository (`github.com/cuatoi-dev/web-agent`) is **public and open
source**. Everything you commit here can be read by anyone, and it stays in
the git history forever.

Before every commit, check the staged diff (`git diff --cached`). Do not commit:

- task files, internal docs or notes from a surrounding workspace;
- internal host names, server paths or absolute paths that contain a home
  folder or a user name;
- credentials, API keys, tokens or environment files.

A surrounding workspace may be private. Its rules apply to your work, but its
content stays out of this repository.

## Layout

| Folder | Contents |
|---|---|
| `packages/web-agent-core` | The agent loop. Every other package depends on it. |
| `packages/web-agent-lit` | The sample framework binding (Lit) and the `--wa-*` theme tokens |
| `packages/web-agent-dom`, `-mcp`, `-openapi`, `-charting`, `-vfs` | Enhancement packages that add tools to core |
| `packages/web-agent-browser` | The browser extension |
| `apps/cat-store`, `apps/docs-site` | Sample host apps |
| `eslint-rules/` | The `wa/*` lint rules |

## Commands

Run every command from this folder. It is the pnpm workspace root.

```bash
pnpm install
pnpm build
pnpm test        # fast unit tests
pnpm test:dom    # unit tests that mount DOM elements
pnpm lint
```

Enable the pre-commit hook once per clone. It runs gitleaks on the staged
changes and blocks a commit that contains a secret:

```bash
git config core.hooksPath .githooks
```

## Rules

- **Dependencies point into core, never out of it.** Core must not import an
  enhancement package. A package's `.` entry must not reach a framework
  package; put a framework binding behind a subpath, such as
  `@cuatoi/web-agent-charting/lit`.
- **Add tool and skill sources through the seams.** Use `ToolProvider` and
  `SkillRegistry` on `SessionConfig`. Core has no built-in tool sources.
- **Put a spec that awaits `updateComplete` in the unit's `test-dom/` folder.**
  The `wa/dom-test-in-test-dom` lint rule enforces this.
- **Never write a unit test that reads a source file to check its text.** Write
  a lint rule under `eslint-rules/rules/` instead.
- **Take every colour, font and spacing value from a `--wa-*` token.** The `wa/*`
  lint rules enforce this.
- **Nothing may fetch at install time or at run time.** The packages run on
  networks with no internet access. A dynamic `import()` must use a literal
  specifier.
- **Run `pnpm` commands only from this folder**, so there is exactly one
  `pnpm-lock.yaml`.
