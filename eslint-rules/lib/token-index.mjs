// ---------------------------------------------------------------------------
// Reads `wa-tokens.css` once and indexes which theme blocks declare each
// `--wa-*` token. Used by the `token-must-exist` rule.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const TOKENS_CSS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../packages/web-agent-lit/src/themes/wa-tokens.css",
);

/** Cached across the whole lint run; the CSS cannot change mid-run. */
let cached = null;

/**
 * Returns `{ available, inAll, partial, blockCount }`.
 *
 * `inAll` holds the tokens every theme block declares. `partial` maps a token
 * to how many blocks declare it, which is the more interesting failure: a
 * token missing from one theme renders its fallback there and nowhere else.
 */
export function tokenIndex() {
  if (cached) return cached;

  let css;
  try {
    css = readFileSync(TOKENS_CSS, "utf-8");
  } catch {
    // The airgapped repository may not carry web-agent-lit. Without the CSS
    // there is nothing to check against, so the rule stands down rather than
    // reporting every token as unknown.
    cached = { available: false, inAll: new Set(), partial: new Map(), blockCount: 0 };
    return cached;
  }

  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // A theme block opens at a selector and runs to its closing brace. Splitting
  // on top-level `}` is enough here: the file is flat custom-property blocks.
  const blocks = [];
  const re = /(?:^|\})([^{}]*)\{([^{}]*)/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const names = new Set();
    for (const d of m[2].matchAll(/(--wa-[a-z0-9-]+)\s*:/gi)) names.add(d[1]);
    if (names.size) blocks.push(names);
  }

  const counts = new Map();
  for (const b of blocks) for (const n of b) counts.set(n, (counts.get(n) ?? 0) + 1);

  const inAll = new Set();
  const partial = new Map();
  for (const [name, c] of counts) {
    if (c === blocks.length) inAll.add(name);
    else partial.set(name, c);
  }

  cached = { available: blocks.length > 0, inAll, partial, blockCount: blocks.length };
  return cached;
}
