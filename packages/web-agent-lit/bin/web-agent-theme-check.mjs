#!/usr/bin/env node
// web-agent-theme-check <theme.css> [--base <built-in id>]
//
// Checks a custom theme file against the --wa-* tokens this package ships in
// src/themes/wa-tokens.css. Node standard library only: the target is
// airgapped. Own small parser, because eslint-rules/lib/token-index.mjs is
// not part of this package.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BUILT_IN = ["wa1-dark", "wa2-dark", "wa2-light"];
const USAGE = "usage: web-agent-theme-check <theme.css> [--base <built-in id>]";
// Resolved from this script, so it works from node_modules with no arguments.
const TOKENS_CSS = fileURLToPath(new URL("../src/themes/wa-tokens.css", import.meta.url));
const THEME_SELECTOR = /\[data-theme="([^"]+)"\]/;

/** Every `selector { body }` block, with the --wa-* names its body declares. */
function parse(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    names: new Set([...m[2].matchAll(/(--wa-[a-z0-9-]+)\s*:/gi)].map((d) => d[1])),
  }));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const baseAt = args.indexOf("--base");
const base = baseAt === -1 ? undefined : args[baseAt + 1];
const positional = args.filter((_, i) => baseAt === -1 || (i !== baseAt && i !== baseAt + 1));
if (positional.length !== 1) fail(USAGE);
if (baseAt !== -1 && !BUILT_IN.includes(base)) fail(USAGE);
const file = positional[0];

let text;
try {
  text = readFileSync(file, "utf-8");
} catch {
  fail(`error: cannot read ${file}`);
}

const known = new Set();
for (const b of parse(readFileSync(TOKENS_CSS, "utf-8"))) {
  if (THEME_SELECTOR.test(b.selector)) for (const n of b.names) known.add(n);
}

const themeBlocks = parse(text).filter((b) => THEME_SELECTOR.test(b.selector));
if (themeBlocks.length === 0) {
  console.log("error: no [data-theme=...] block");
  process.exit(1);
}

let errors = 0;
for (const b of themeBlocks) {
  const id = THEME_SELECTOR.exec(b.selector)[1];
  for (const n of b.names) {
    if (!known.has(n)) {
      console.log(`error: ${n} is not a web-agent token`);
      errors++;
    }
  }
  const missing = [...known].filter((n) => !b.names.has(n)).length;
  if (missing > 0) console.log(`warn: ${missing} tokens inherit from ${base ?? "the base theme"}`);
  const declared = [...b.names].filter((n) => known.has(n)).length;
  console.log(`${id}: ${declared} of ${known.size} tokens declared`);
}
process.exit(errors > 0 ? 1 : 0);
