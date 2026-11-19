// Pure page-collection/link-rewriting logic for build-static.mjs, split out
// so it can be unit tested without triggering build-static.mjs's dist/ wipe
// (which runs at import time).
import fs from 'fs';
import path from 'path';

// Cross-cutting guides that stay in apps/docs-site/src/content (slug → order).
export const GUIDE_ORDER = {
  index: 1,
  architecture: 2,
  theming: 6,
  usage: 10,
  troubleshooting: 11,
  showcase: 12,
};

// Nav order is the array order: Core, Lit, MCP, OpenAPI, Charting, DOM.
export const PACKAGE_SECTIONS = [
  { dir: 'web-agent-core',     category: 'Core',     folder: 'core' },
  { dir: 'web-agent-lit',      category: 'Lit',      folder: 'lit' },
  { dir: 'web-agent-mcp',      category: 'MCP',      folder: 'mcp' },
  { dir: 'web-agent-openapi',  category: 'OpenAPI',  folder: 'openapi' },
  { dir: 'web-agent-charting', category: 'Charting', folder: 'charting' },
  { dir: 'web-agent-dom',      category: 'DOM',      folder: 'dom' },
];

export function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { title: '', body: content };
  const fm = match[1];
  const body = match[2];
  const titleMatch = fm.match(/^title:\s*(.+)$/m);
  return { title: titleMatch ? titleMatch[1].trim() : '', body };
}

export function stripMarkdown(text) {
  return text
    .replace(/^```[\s\S]*?^```/gm, '')       // fenced code blocks
    .replace(/`[^`]+`/g, '')                   // inline code
    .replace(/^#{1,6}\s+/gm, '')               // headings
    .replace(/\*\*([^*]+)\*\*/g, '$1')         // bold
    .replace(/\*([^*]+)\*/g, '$1')             // italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // links
    .replace(/^\|.+\|$/gm, '')                 // table rows
    .replace(/^[-*]\s+/gm, '')                 // list bullets
    .replace(/^---+$/gm, '')                   // hr
    .replace(/\n{3,}/g, '\n\n')               // collapse blank lines
    .trim();
}

export function extractHeadings(body) {
  const headings = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^(#{2,3})\s+(.+)/);
    if (m) {
      headings.push({ level: m[1].length, text: m[2].trim() });
    }
  }
  return headings;
}

export function extractFirstH1(body) {
  const m = body.match(/^#\s+(.+)/m);
  return m ? m[1].trim() : '';
}

export function prettifySlug(slug) {
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// Cross-cutting guides in apps/docs-site/src/content/*.md.
export function collectGuidePages(pagesDir) {
  return fs.readdirSync(pagesDir).filter(f => f.endsWith('.md')).sort().map(f => {
    const file = path.join(pagesDir, f);
    const slug = f.replace(/\.md$/, '');
    const raw = fs.readFileSync(file, 'utf-8');
    const { title, body } = parseFrontmatter(raw);
    if (!title.trim()) {
      throw new Error(`Missing "title:" frontmatter: ${file}`);
    }
    return { file, slug, title, body, category: 'Guides', folder: 'guides',
             order: GUIDE_ORDER[slug] ?? 99 };
  });
}

// Package pages in packages/<pkg>/docs/*.md, one category/folder per package.
export function collectPackagePages(packagesRoot, sections = PACKAGE_SECTIONS) {
  const pages = [];
  for (const sec of sections) {
    const dir = path.join(packagesRoot, sec.dir, 'docs');
    if (!fs.existsSync(dir)) {
      throw new Error(`Package docs folder not found: ${dir}`);
    }
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
    // README is the section landing page; everything else follows alphabetically.
    const ordered = [
      ...files.filter(f => f.toLowerCase() === 'readme.md'),
      ...files.filter(f => f.toLowerCase() !== 'readme.md'),
    ];
    ordered.forEach((f, i) => {
      const file = path.join(dir, f);
      const slug = f.replace(/\.md$/, '').toLowerCase();   // README.md → "readme"
      const raw = fs.readFileSync(file, 'utf-8');
      const { title, body } = parseFrontmatter(raw);
      if (!title.trim()) {
        throw new Error(`Missing "title:" frontmatter: ${file}`);
      }
      pages.push({ file, slug, title, body, category: sec.category,
                   folder: sec.folder, order: i + 1 });
    });
  }
  return pages;
}

export function assertNoDuplicateSlugs(guidePages, packagePages) {
  // (a) same emitted key: two files would overwrite each other in dist/
  const byKey = new Map();
  for (const p of [...guidePages, ...packagePages]) {
    const key = `${p.folder}/${p.slug}`;
    const prev = byKey.get(key);
    if (prev) {
      throw new Error(`Duplicate page route "#/${key}":\n  ${prev.file}\n  ${p.file}`);
    }
    byKey.set(key, p);
  }
  // (b) a site page and a package page owning the same slug — prevents leftover
  //     duplicate copies (e.g. src/content/tools.md left behind
  //     next to packages/web-agent-core/docs/tools.md).
  const bySlug = new Map(guidePages.map(p => [p.slug, p]));
  for (const p of packagePages) {
    const site = bySlug.get(p.slug);
    if (site) {
      throw new Error(`Slug "${p.slug}" is owned by two sources:\n  ${site.file}\n  ${p.file}`);
    }
  }
}

// pageIndex: Map<absolute source path, {folder, slug}>, built from ALL
// collected pages (site + package) so cross-package links resolve.
export function rewriteLinks(body, page, pageIndex) {
  const warnings = [];
  const out = body.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text, target) => {
    if (/^(https?:|mailto:|#)/.test(target)) return whole;      // external / in-page anchor
    // A section fragment belongs to the route, not to the source file path:
    // `guide.md#section` must resolve the FILE and carry the fragment over,
    // or the link is left as a relative path the browser cannot serve.
    const hashAt = target.indexOf('#');
    const file = hashAt === -1 ? target : target.slice(0, hashAt);
    const fragment = hashAt === -1 ? '' : target.slice(hashAt);
    if (!file.endsWith('.md')) return whole;
    const abs = path.resolve(path.dirname(page.file), file);
    const hit = pageIndex.get(abs);
    if (hit) return `[${text}](#/${hit.folder}/${hit.slug}${fragment})`;
    warnings.push(`${page.file} → ${target}`);
    return text;                                                 // drop the dead link, keep the words
  });
  return { body: out, warnings };
}
