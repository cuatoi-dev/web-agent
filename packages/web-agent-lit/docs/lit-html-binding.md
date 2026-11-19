---
title: lit-html binding (host peer dependency)
---

# lit-html binding (host peer dependency)

@cuatoi/web-agent-lit uses **lit-html** as its templating engine via a thin
seam (`packages/web-agent-lit/src/ui/template.ts`). The peer dependency accepts
all three majors: `"^1 || ^2 || ^3"`. This page explains how to wire the agent
to the lit-html version your host already has — no runtime bridge code needed.

For registry-level Lit 3 / Material Web component swapping, see
[Lit 3 support & the UI element seam](./lit3-registry.md).

---

## Why any major works

The binding only uses the following lit-html API surface:

| Feature | lit-html 1.x | lit-html 3.x | Used by the binding |
|---------|-------------|-------------|-------------|
| `html` tag function | Yes | Yes | Yes |
| `svg` tag function | Yes | Yes | Yes |
| `render(result, container)` | Yes | Yes | Yes |
| `unsafeHTML` directive | Yes | Yes | Yes |
| `.prop=${val}` property binding | Yes | Yes | Yes |
| `@event=${fn}` event binding | Yes | Yes | Yes |
| `?attr=${bool}` boolean attr | Yes | Yes | Yes |
| Other directives / sentinels | Yes | Yes | not used |
| Cross-boundary `TemplateResult` | varies | varies | not used |

The seam in `packages/web-agent-lit/src/ui/template.ts` (4 lines) re-exports
five symbols — `html`, `svg`, `render`, `nothing` from `lit-html`, and
`unsafeHTML` from `lit-html/directives/unsafe-html.js`:

```ts
// src/ui/template.ts
export { html, svg, render, nothing } from "lit-html";
export { unsafeHTML } from "lit-html/directives/unsafe-html.js";
```

Five exported symbols — `html`, `svg`, `render`, `nothing`, `unsafeHTML` —
and no others. The rest of the binding imports these five from the seam.
**No runtime adapter code is needed** — the binding is a build-time alias
that points every `import … from "lit-html"` in the bundle at the version
your host provides.

The full peer dep range declared in
`packages/web-agent-lit/package.json` is:

```json
"peerDependencies": {
  "lit-html": "^1 || ^2 || ^3"
},
"peerDependenciesMeta": {
  "lit-html": { "optional": false }
}
```

All three majors (1.x, 2.x, 3.x) are supported, and `optional: false` means
the host **must** supply lit-html — the package never vendors it. pnpm does
not warn about peer dep mismatches because the declared range accepts any
major you install.

---

## 1. Declaring the peer dependency

In your host's `package.json`:

```json
{
  "dependencies": {
    "@cuatoi/web-agent-lit": "^0.1.0",
    "@cuatoi/web-agent-core": "^0.1.0"
  },
  "peerDependencies": {
    "lit-html": "^1 || ^2 || ^3"
  }
}
```

Or for a concrete single-major install (lit-html 1 example):

```json
{
  "dependencies": {
    "@cuatoi/web-agent-lit": "^0.1.0",
    "@cuatoi/web-agent-core": "^0.1.0",
    "lit-html": "^1.4.1"
  }
}
```

`"^0.1.0"` is used here because the examples target an external consumer;
inside a pnpm workspace the packages are installed with `"workspace:*"`.

pnpm does not warn about peer dep mismatches because @cuatoi/web-agent-lit's
declared range `"^1 || ^2 || ^3"` accepts whichever major you install.

---

## 2. Binding to lit-html 1.x (esbuild)

Install a scoped alias so lit-html 1.x coexists with any lit-html 3
devDependency:

```json
// package.json
"devDependencies": {
  "lit-html-v1": "npm:lit-html@1.4.1"
}
```

Then add an `alias` entry in your esbuild config. The alias re-routes every
`import … from "lit-html"` in the **entire bundle** — including inside the
binding's `template.ts` — to the 1.x package:

```js
// build.mjs
import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Adjust these paths to your project layout
const litAlias     = path.resolve(__dirname, 'node_modules/@cuatoi/web-agent-lit/src');
const coreAlias    = path.resolve(__dirname, 'node_modules/@cuatoi/web-agent-core/src');
const litModules   = path.resolve(__dirname, 'node_modules/@cuatoi/web-agent-lit/node_modules');
const litV1Alias   = path.resolve(__dirname, 'node_modules/lit-html-v1');
//   ^ or: litModules + '/lit-html-v1' if lit-html-v1 is a web-agent-lit devDep

await esbuild.build({
  entryPoints: ['src/embed.ts'],
  bundle: true,
  outfile: 'public/bundle.js',
  format: 'esm',
  platform: 'browser',
  alias: {
    '@cuatoi/web-agent-lit': litAlias,
    '@cuatoi/web-agent-core': coreAlias,
    'lit-html': litV1Alias,        // ← the only lit-html binding required
  },
  nodePaths: [litModules],
});
```

**That is the entire lit-html 1 integration**: one alias entry and no code
changes.

---

## 3. Binding to lit-html 3.x (esbuild)

If your host already has lit-html 3.x, no alias is needed. Install the peer
dep and bundle normally:

```json
// package.json
"dependencies": {
  "lit-html": "^3.0.0"
}
```

```js
// build.mjs — lit-html 3 host (no alias required for lit-html)
await esbuild.build({
  entryPoints: ['src/embed.ts'],
  bundle: true,
  outfile: 'public/bundle.js',
  alias: {
    '@cuatoi/web-agent-lit': litAlias,
    '@cuatoi/web-agent-core': coreAlias,
    // no 'lit-html' alias — esbuild resolves from your node_modules
  },
  nodePaths: [litModules],
});
```

---

## 4. Binding with Webpack (airgapped host)

The airgapped target uses Webpack. The `resolve.alias` key is the equivalent
of esbuild's `alias:` map — for the **lit-html pin only**. The registry swap
is a separate mechanism and is not a resolve alias:

```js
// webpack.config.js — lit-html 1 host
const path = require('path');
const webpack = require('webpack');

module.exports = {
  resolve: {
    alias: {
      // lit-html version pin (add only if the host is on lit-html 1.x or 2.x)
      'lit-html': path.resolve(__dirname, 'node_modules/lit-html-v1'),
    },
  },
  plugins: [
    // The registry swap is a module replacement, not a resolve alias — the
    // package imports the registry by several relative specifiers
    // ("./registry.js", "../ui/registry.js", "../../ui/registry.js"), so the
    // match has to be a regex on the resolved path.
    new webpack.NormalModuleReplacementPlugin(
      /[\\/]ui[\\/]registry\.js$/,
      path.resolve(__dirname, 'src/acme-registry.ts')
    ),
  ],
};
```

For a lit-html 3 host, omit the `'lit-html'` alias entry — Webpack resolves
from your `node_modules` automatically. (The registry swap stays; see the
[Lit 3 support & the UI element seam](./lit3-registry.md) page.)

---

## 5. A worked lit-html 1.x reference

Two things in this repo exercise lit-html 1.x, and both are checkable:
- **The package's own lit-1 conformance suite.** `pnpm --filter
  @cuatoi/web-agent-lit test:lit1` runs `vitest.config.lit1.ts`, which
  aliases `lit-html` to `lit-html-v1` (`npm:lit-html@1.4.1`) and executes
  `test-dom/**/*.lit1-compat.test.ts`.
- **The docs-site host.** It declares `"lit-html": "^1.4.1"` as a dependency
  and pins the alias in `webpack.config.cjs`:
  `"lit-html": <packages/web-agent-lit/node_modules/lit-html-v1>`. The comment
  there notes the alias is non-exact on purpose, so it also rewrites
  `lit-html/directives/*`.

---

## Summary

| Host lit-html version | What to do |
|----------------------|-----------|
| 1.x | Install `"lit-html-v1": "npm:lit-html@1.4.1"`, add `'lit-html'` alias in esbuild / Webpack pointing at the 1.x package |
| 2.x | Same as 1.x — alias to 2.x package |
| 3.x | Install `"lit-html": "^3.0.0"`, no alias needed |

The registry alias that handles UI component swapping is a separate, parallel
build-time mechanism — see the [Lit 3 support & the UI element seam](./lit3-registry.md)
page.