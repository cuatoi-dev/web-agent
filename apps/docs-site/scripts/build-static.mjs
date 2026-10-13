#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  PACKAGE_SECTIONS,
  extractHeadings, extractFirstH1, prettifySlug, stripMarkdown,
  collectGuidePages, collectPackagePages, assertNoDuplicateSlugs, rewriteLinks,
} from './build-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Directories
const PAGES_DIR = path.resolve(ROOT, 'src/content');
const PACKAGES_ROOT = path.resolve(ROOT, '../../packages');
const BEERCSS_DIR = path.resolve(ROOT, 'vendor/beercss-docs');
const DIST_DIR = path.resolve(ROOT, 'dist');
const STYLES_SRC   = path.resolve(ROOT, 'src/engine/styles.css');
const DIST_STYLES  = path.join(DIST_DIR, 'styles.css');
const VENDOR_SRC   = path.resolve(ROOT, 'vendor/beercss');
const DIST_VENDOR  = path.join(DIST_DIR, 'vendor/beercss');
const FONT_SRC     = path.resolve(ROOT, 'vendor/public-sans');
const DIST_FONT    = path.join(DIST_DIR, 'vendor/public-sans');
const DIST_CONTENT_DIR = path.join(DIST_DIR, 'content');
const DIST_CONTENT_BEERCSS = path.join(DIST_CONTENT_DIR, 'beercss');
const OUT_DIR = path.resolve(ROOT, 'src/generated');
const MD_INDEX_FILE = path.join(DIST_DIR, 'md-index.json');
const SEARCH_FILE = path.join(OUT_DIR, 'docs-index.json');

// Beer CSS meta files to skip as nav entries
const BEERCSS_SKIP = new Set(['INDEX.md', 'SUMMARY.md', 'ELEMENTS.md']);

// ---- build index ----

const allEntries = [];
const searchEntries = []; // {slug, title, category, folder, text} subset for search tool

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Fresh dist each build; webpack (clean:false) then adds bundles + HTML.
fs.rmSync(DIST_DIR, { recursive: true, force: true });
ensureDir(DIST_DIR);

// --- Guides (src/content) + package docs (packages/<pkg>/docs) ---
const guidePages = collectGuidePages(PAGES_DIR);
const packagePages = collectPackagePages(PACKAGES_ROOT, PACKAGE_SECTIONS);

// Fail before anything is written to dist/: missing titles already threw
// inside the collectors above; duplicate slugs are checked here.
assertNoDuplicateSlugs(guidePages, packagePages);

// pageIndex resolves relative .md links across both sources, keyed on the
// absolute source path, so a cross-package link resolves too.
const pageIndex = new Map();
for (const p of [...guidePages, ...packagePages]) {
  pageIndex.set(p.file, { folder: p.folder, slug: p.slug });
}

const linkWarnings = [];
for (const p of [...guidePages, ...packagePages]) {
  const destDir = path.join(DIST_CONTENT_DIR, p.folder);
  ensureDir(destDir);
  const { body: rewrittenBody, warnings } = rewriteLinks(p.body, p, pageIndex);
  linkWarnings.push(...warnings);

  const headings = extractHeadings(rewrittenBody);
  const text = stripMarkdown(rewrittenBody);

  allEntries.push({
    slug: p.slug,
    title: p.title,
    category: p.category,
    folder: p.folder,
    order: p.order,
    headings,
    text,
  });
  searchEntries.push({ slug: p.slug, title: p.title, category: p.category, folder: p.folder, text });

  // Write the emitted (rewritten) markdown — this is what the SPA fetches.
  fs.writeFileSync(path.join(destDir, `${p.slug}.md`), rewrittenBody);
}

if (linkWarnings.length > 0) {
  console.warn(`${linkWarnings.length} unresolved link(s) — rendered as plain text:`);
  for (const w of linkWarnings) console.warn(`  ${w}`);
}

// --- Beer CSS Reference ---
if (fs.existsSync(BEERCSS_DIR)) {
  ensureDir(DIST_CONTENT_BEERCSS);

  const beercssFiles = fs
    .readdirSync(BEERCSS_DIR)
    .filter(f => f.endsWith('.md') && !BEERCSS_SKIP.has(f))
    .sort();

  for (const f of beercssFiles) {
    const raw = fs.readFileSync(path.join(BEERCSS_DIR, f), 'utf-8');
    const slug = f.replace(/\.md$/, '').toLowerCase();
    const title = extractFirstH1(raw) || prettifySlug(slug);
    const headings = extractHeadings(raw);
    const text = stripMarkdown(raw);

    const entry = {
      slug,
      title,
      category: 'Beer CSS Reference',
      folder: 'beercss',
      order: 0, // alphabetical; no explicit ordering needed
      headings,
      text,
    };

    allEntries.push(entry);
    searchEntries.push({ slug, title, category: 'Beer CSS Reference', folder: 'beercss', text });

    // Copy md — filename matches slug (lowercased)
    const destName = slug + '.md';
    fs.copyFileSync(path.join(BEERCSS_DIR, f), path.join(DIST_CONTENT_BEERCSS, destName));
  }
} else {
  console.error('WARNING: Beer CSS docs directory not found:', BEERCSS_DIR);
}

// Sort each section by order (then slug), and emit sections in nav order so
// md-index.json is already in nav order (app.ts renders sections in order of
// first appearance).
const SECTION_ORDER = ['Guides', ...PACKAGE_SECTIONS.map(s => s.category), 'Beer CSS Reference'];
const sorted = SECTION_ORDER.flatMap(cat =>
  allEntries.filter(e => e.category === cat).sort((a, b) =>
    a.order !== b.order ? a.order - b.order : a.slug.localeCompare(b.slug)));

// Write dist/md-index.json
ensureDir(DIST_DIR);
fs.writeFileSync(MD_INDEX_FILE, JSON.stringify(sorted, null, 2));
const sectionCounts = SECTION_ORDER
  .map(cat => `${cat} ${allEntries.filter(e => e.category === cat).length}`)
  .join(', ');
console.log(`md-index.json: ${sorted.length} entries (${sectionCounts}) → ${MD_INDEX_FILE}`);

// Write src/generated/docs-index.json (search dataset, {slug,title,category,folder,text})
ensureDir(OUT_DIR);
fs.writeFileSync(SEARCH_FILE, JSON.stringify(searchEntries, null, 2));
console.log(`docs-index.json: ${searchEntries.length} search entries → ${SEARCH_FILE}`);

// Report content copy
const contentFolders = fs.readdirSync(DIST_CONTENT_DIR);
const folderCounts = contentFolders
  .map(f => `${f} ${fs.readdirSync(path.join(DIST_CONTENT_DIR, f)).filter(x => x.endsWith('.md')).length}`)
  .join(', ');
console.log(`dist/content/: ${folderCounts}`);

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}
fs.copyFileSync(STYLES_SRC, DIST_STYLES);
console.log('styles.css →', DIST_STYLES);
copyDir(VENDOR_SRC, DIST_VENDOR);
console.log(`vendor/beercss → ${DIST_VENDOR} (${fs.readdirSync(DIST_VENDOR).length} files)`);
copyDir(FONT_SRC, DIST_FONT);
console.log(`vendor/public-sans → ${DIST_FONT} (${fs.readdirSync(DIST_FONT).length} files)`);
