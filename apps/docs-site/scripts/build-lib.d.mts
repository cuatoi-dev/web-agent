// Ambient declarations for build-lib.mjs, so TS consumers (build-lib.test.ts)
// don't hit TS7016. Kept alongside build-lib.mjs — TS resolves a colocated
// <name>.d.mts as the companion declaration file for <name>.mjs.

export interface PackageSection {
  dir: string;
  category: string;
  folder: string;
}

export interface Page {
  file: string;
  slug: string;
  title: string;
  body: string;
  category: string;
  folder: string;
  order: number;
}

export interface Heading {
  level: number;
  text: string;
}

export interface RewriteResult {
  body: string;
  warnings: string[];
}

export const GUIDE_ORDER: Record<string, number>;
export const PACKAGE_SECTIONS: PackageSection[];

export function parseFrontmatter(content: string): { title: string; body: string };
export function stripMarkdown(text: string): string;
export function extractHeadings(body: string): Heading[];
export function extractFirstH1(body: string): string;
export function prettifySlug(slug: string): string;

export function collectGuidePages(pagesDir: string): Page[];
export function collectPackagePages(packagesRoot: string, sections?: PackageSection[]): Page[];
export function assertNoDuplicateSlugs(guidePages: Page[], packagePages: Page[]): void;
export function rewriteLinks(
  body: string,
  page: Page,
  pageIndex: Map<string, { folder: string; slug: string }>
): RewriteResult;
