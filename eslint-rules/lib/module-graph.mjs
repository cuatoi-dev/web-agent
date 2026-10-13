// ---------------------------------------------------------------------------
// Import-graph helpers for the structural rules (`no-cycle`,
// `no-internal-import`).
//
// These resolve imports from disk. They read the raw text of each file and pull
// specifiers out with a regex rather than parsing it. A full parse of every
// transitive import would make lint several times slower for no gain: an
// import specifier is a string literal in a fixed position, and a regex reads
// it exactly as reliably as an AST walk does.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

/** Extensions tried for an extensionless relative import, in order. */
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"];

/**
 * Resolves a relative import specifier to a file on disk.
 *
 * TypeScript source in this workspace imports with a `.js` extension that does
 * not exist until the build runs, so `./foo.js` has to be tried as `./foo.ts`
 * first. Returns null for anything that does not resolve — a bare package
 * specifier, a missing file, or an asset these rules do not follow.
 */
export function resolveRelative(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec);

  const candidates = [];
  // `./foo.js` in TS source usually means `./foo.ts`.
  const rewritten = base.replace(/\.(js|mjs|cjs)$/, "");
  if (rewritten !== base) {
    for (const e of EXTENSIONS) candidates.push(rewritten + e);
  }
  candidates.push(base);
  for (const e of EXTENSIONS) candidates.push(base + e);
  for (const e of EXTENSIONS) candidates.push(path.join(base, "index" + e));

  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      // Not there; try the next shape.
    }
  }
  return null;
}

/** Matches every static and dynamic import specifier in a file's raw text. */
const SPECIFIER_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

/** file path -> resolved relative import targets. Lives for one lint run. */
const depsCache = new Map();

/**
 * Returns the files a module imports, following relative specifiers only.
 *
 * Type-only imports are followed too. A cycle through `import type` is erased
 * at build time and cannot fault at runtime, but it still defeats the
 * refactoring and provenance guarantees the type layout exists to give, and an
 * `isolatedModules` build re-introduces it whenever a specifier loses its
 * `type` marker.
 */
export function depsOf(file) {
  const cached = depsCache.get(file);
  if (cached) return cached;

  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    depsCache.set(file, []);
    return [];
  }

  // Blank comments so a specifier inside one is not followed.
  const cleaned = text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^[^\S\r\n]*\/\/.*$/gm, "");

  const out = [];
  let m;
  const re = new RegExp(SPECIFIER_RE.source, "g");
  while ((m = re.exec(cleaned)) !== null) {
    const target = resolveRelative(file, m[1]);
    if (target) out.push(target);
  }
  depsCache.set(file, out);
  return out;
}

/**
 * Returns the workspace unit (`packages/x` or `apps/y`) that owns a file, as an
 * absolute path, or null when the file sits outside every unit.
 */
export function unitOf(file, root) {
  const rel = path.relative(root, file);
  if (rel.startsWith("..")) return null;
  const parts = rel.split(path.sep);
  if (parts.length < 2) return null;
  if (parts[0] !== "packages" && parts[0] !== "apps") return null;
  return path.join(root, parts[0], parts[1]);
}

/**
 * Finds a path from `start` back to `goal`, following relative imports.
 *
 * Returns the chain of files, or null when `goal` is unreachable. `seen` makes
 * the walk linear in the size of the graph, so a file with a deep import tree
 * costs one traversal rather than one per branch.
 */
export function pathBackTo(start, goal) {
  const seen = new Set();
  const stack = [[start, [start]]];
  while (stack.length > 0) {
    const [node, chain] = stack.pop();
    if (node === goal) return chain;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of depsOf(node)) {
      if (!seen.has(next) || next === goal) stack.push([next, [...chain, next]]);
    }
  }
  return null;
}

/** Visits every import-specifier node of a module, static and dynamic. */
export function importVisitor(check) {
  return {
    ImportDeclaration: (n) => check(n.source, n.source.value),
    ExportNamedDeclaration: (n) => n.source && check(n.source, n.source.value),
    ExportAllDeclaration: (n) => n.source && check(n.source, n.source.value),
    ImportExpression: (n) =>
      n.source?.type === "Literal" && check(n.source, n.source.value),
  };
}
