import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  collectGuidePages,
  collectPackagePages,
  assertNoDuplicateSlugs,
  rewriteLinks,
  PACKAGE_SECTIONS,
} from "../scripts/build-lib.mjs";

// Do NOT import build-static.mjs — it wipes dist/ at import time.

const ROOT = path.resolve(__dirname, "..");
const REPO_PACKAGES_ROOT = path.resolve(ROOT, "../../packages");
const REPO_SITE_CONTENT = path.resolve(ROOT, "src/content");

const tmpDirs: string[] = [];
function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writePage(dir: string, name: string, content: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content, "utf-8");
}

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("build-lib fixtures", () => {
  it("collectGuidePages reads title, slug and order", () => {
    const dir = mkTmp("build-lib-guides-");
    writePage(dir, "alpha.md", "---\ntitle: Alpha\n---\n\n# Alpha\n");
    writePage(dir, "mystery.md", "---\ntitle: Mystery\n---\n\n# Mystery\n");
    const pages = collectGuidePages(dir);
    const alpha = pages.find((p) => p.slug === "alpha");
    expect(alpha).toMatchObject({ slug: "alpha", title: "Alpha" });
    const mystery = pages.find((p) => p.slug === "mystery");
    expect(mystery!.order).toBe(99); // absent from GUIDE_ORDER
  });

  it("missing title throws, naming the file (collectGuidePages)", () => {
    const dir = mkTmp("build-lib-notitle-guide-");
    writePage(dir, "no-title.md", "# No Title\n\nJust a body, no frontmatter.\n");
    expect(() => collectGuidePages(dir)).toThrow(/no-title\.md/);
  });

  it("missing title throws, naming the file (collectPackagePages)", () => {
    const root = mkTmp("build-lib-notitle-pkg-");
    writePage(path.join(root, "pkg-a", "docs"), "no-title.md", "# No Title\n\nJust a body.\n");
    expect(() =>
      collectPackagePages(root, [{ dir: "pkg-a", category: "PkgA", folder: "pkg-a" }])
    ).toThrow(/no-title\.md/);
  });

  it("empty title is treated as missing", () => {
    const dir = mkTmp("build-lib-emptytitle-");
    writePage(dir, "blank-title.md", "---\ntitle:    \n---\n\n# Blank\n");
    expect(() => collectGuidePages(dir)).toThrow(/blank-title\.md/);
  });

  it("collectPackagePages puts README first, alphabetical after, no order 99", () => {
    const root = mkTmp("build-lib-readme-order-");
    const docsDir = path.join(root, "pkg-b", "docs");
    writePage(docsDir, "b.md", "---\ntitle: B\n---\n\n# B\n");
    writePage(docsDir, "a.md", "---\ntitle: A\n---\n\n# A\n");
    writePage(docsDir, "README.md", "---\ntitle: Pkg B\n---\n\n# Pkg B\n");
    const pages = collectPackagePages(root, [{ dir: "pkg-b", category: "PkgB", folder: "pkg-b" }]);
    expect(pages.map((p) => p.slug)).toEqual(["readme", "a", "b"]);
    expect(pages.every((p) => p.order !== 99)).toBe(true);
  });

  it("README lowercases to readme", () => {
    const root = mkTmp("build-lib-readme-slug-");
    writePage(path.join(root, "pkg-c", "docs"), "README.md", "---\ntitle: Pkg C\n---\n\n# Pkg C\n");
    const pages = collectPackagePages(root, [{ dir: "pkg-c", category: "PkgC", folder: "pkg-c" }]);
    expect(pages[0].slug).toBe("readme");
  });

  it("assertNoDuplicateSlugs catches a site/package overlap", () => {
    const siteDir = mkTmp("build-lib-dup-site-");
    const pkgRoot = mkTmp("build-lib-dup-pkg-");
    writePage(siteDir, "tools.md", "---\ntitle: Tools\n---\n\n# Tools\n");
    writePage(path.join(pkgRoot, "pkg-d", "docs"), "tools.md", "---\ntitle: Tools\n---\n\n# Tools\n");
    const guidePages = collectGuidePages(siteDir);
    const packagePages = collectPackagePages(pkgRoot, [{ dir: "pkg-d", category: "PkgD", folder: "pkg-d" }]);
    let message = "";
    try {
      assertNoDuplicateSlugs(guidePages, packagePages);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain(path.join(siteDir, "tools.md"));
    expect(message).toContain(path.join(pkgRoot, "pkg-d", "docs", "tools.md"));
  });

  it("assertNoDuplicateSlugs allows the same slug in two packages, distinct routes", () => {
    const pkgRoot = mkTmp("build-lib-samesame-");
    writePage(path.join(pkgRoot, "pkg-e", "docs"), "tools.md", "---\ntitle: E Tools\n---\n\n# E Tools\n");
    writePage(path.join(pkgRoot, "pkg-f", "docs"), "tools.md", "---\ntitle: F Tools\n---\n\n# F Tools\n");
    const packagePages = collectPackagePages(pkgRoot, [
      { dir: "pkg-e", category: "PkgE", folder: "pkg-e" },
      { dir: "pkg-f", category: "PkgF", folder: "pkg-f" },
    ]);
    expect(() => assertNoDuplicateSlugs([], packagePages)).not.toThrow();
    const routes = packagePages.map((p) => `#/${p.folder}/${p.slug}`);
    expect(routes).toEqual(["#/pkg-e/tools", "#/pkg-f/tools"]);
  });

  it("rewriteLinks rewrites a same-folder link", () => {
    const pkgRoot = mkTmp("build-lib-rewrite-same-");
    const docsDir = path.join(pkgRoot, "pkg-g", "docs");
    writePage(docsDir, "tools.md", "---\ntitle: T\n---\n\n# T\n");
    writePage(docsDir, "readme.md", "---\ntitle: R\n---\n\n[T](./tools.md)\n");
    const packagePages = collectPackagePages(pkgRoot, [{ dir: "pkg-g", category: "PkgG", folder: "pkg-g" }]);
    const readme = packagePages.find((p) => p.slug === "readme")!;
    const pageIndex = new Map(packagePages.map((p) => [p.file, { folder: p.folder, slug: p.slug }]));
    const { body, warnings } = rewriteLinks(readme.body, readme, pageIndex);
    expect(body).toContain("[T](#/pkg-g/tools)");
    expect(warnings).toEqual([]);
  });

  it("rewriteLinks routes a link between two renamed guides", () => {
    const pkgRoot = mkTmp("build-lib-rewrite-acme-");
    const docsDir = path.join(pkgRoot, "pkg-lit", "docs");
    writePage(
      docsDir,
      "porting-to-acme-components.md",
      "---\ntitle: Porting\n---\n\n[E](./extending-with-acme-components.md)\n",
    );
    writePage(docsDir, "extending-with-acme-components.md", "---\ntitle: Extending\n---\n\n# Extending\n");
    const packagePages = collectPackagePages(pkgRoot, [
      { dir: "pkg-lit", category: "PkgLit", folder: "lit" },
    ]);
    const porting = packagePages.find((p) => p.slug === "porting-to-acme-components")!;
    const pageIndex = new Map(packagePages.map((p) => [p.file, { folder: p.folder, slug: p.slug }]));
    const { body, warnings } = rewriteLinks(porting.body, porting, pageIndex);
    expect(body).toContain("](#/lit/extending-with-acme-components)");
    expect(warnings).toEqual([]);
  });

  it("rewriteLinks carries a section fragment onto the rewritten route", () => {
    const pkgRoot = mkTmp("build-lib-rewrite-frag-");
    const docsDir = path.join(pkgRoot, "pkg-frag", "docs");
    writePage(
      docsDir,
      "porting-to-acme-components.md",
      "---\ntitle: Porting\n---\n\n# Porting\n",
    );
    writePage(
      docsDir,
      "extending-with-acme-components.md",
      "---\ntitle: Extending\n---\n\n[guide](./porting-to-acme-components.md#2-the-wa--tag-contract-in-full)\n",
    );
    const packagePages = collectPackagePages(pkgRoot, [
      { dir: "pkg-frag", category: "PkgFrag", folder: "lit" },
    ]);
    const extending = packagePages.find((p) => p.slug === "extending-with-acme-components")!;
    const pageIndex = new Map(packagePages.map((p) => [p.file, { folder: p.folder, slug: p.slug }]));
    const { body, warnings } = rewriteLinks(extending.body, extending, pageIndex);
    // The file resolves to its route and the fragment rides along, so the
    // rendered link is a route the router can serve instead of a raw .md path.
    expect(body).toContain("](#/lit/porting-to-acme-components#2-the-wa--tag-contract-in-full)");
    expect(body).not.toContain(".md)");
    expect(warnings).toEqual([]);
  });

  it("rewriteLinks rewrites a cross-package link", () => {
    const pkgRoot = mkTmp("build-lib-rewrite-cross-");
    writePage(path.join(pkgRoot, "pkg-h", "docs"), "target.md", "---\ntitle: Target\n---\n\n# Target\n");
    writePage(path.join(pkgRoot, "pkg-i", "docs"), "source.md", "---\ntitle: Source\n---\n\n[R](../../pkg-h/docs/target.md)\n");
    const packagePages = collectPackagePages(pkgRoot, [
      { dir: "pkg-h", category: "PkgH", folder: "pkg-h" },
      { dir: "pkg-i", category: "PkgI", folder: "pkg-i" },
    ]);
    const source = packagePages.find((p) => p.slug === "source")!;
    const pageIndex = new Map(packagePages.map((p) => [p.file, { folder: p.folder, slug: p.slug }]));
    const { body, warnings } = rewriteLinks(source.body, source, pageIndex);
    expect(body).toContain("[R](#/pkg-h/target)");
    expect(warnings).toEqual([]);
  });

  it("rewriteLinks drops an unresolvable link but keeps the text", () => {
    const pkgRoot = mkTmp("build-lib-rewrite-dead-");
    const docsDir = path.join(pkgRoot, "pkg-j", "docs");
    writePage(docsDir, "readme.md", "---\ntitle: R\n---\n\n[package README](../README.md)\n");
    const packagePages = collectPackagePages(pkgRoot, [{ dir: "pkg-j", category: "PkgJ", folder: "pkg-j" }]);
    const readme = packagePages[0];
    const pageIndex = new Map(packagePages.map((p) => [p.file, { folder: p.folder, slug: p.slug }]));
    const { body, warnings } = rewriteLinks(readme.body, readme, pageIndex);
    expect(body).toContain("package README");
    expect(body).not.toContain("](");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(readme.file);
    expect(warnings[0]).toContain("../README.md");
  });

  it("rewriteLinks leaves external and in-page links alone", () => {
    const pkgRoot = mkTmp("build-lib-rewrite-external-");
    const docsDir = path.join(pkgRoot, "pkg-k", "docs");
    const body = "[site](https://example.com) [mail](mailto:a@b.com) [anchor](#section)";
    writePage(docsDir, "readme.md", `---\ntitle: R\n---\n\n${body}\n`);
    const packagePages = collectPackagePages(pkgRoot, [{ dir: "pkg-k", category: "PkgK", folder: "pkg-k" }]);
    const readme = packagePages[0];
    const pageIndex = new Map(packagePages.map((p) => [p.file, { folder: p.folder, slug: p.slug }]));
    const { body: out, warnings } = rewriteLinks(readme.body, readme, pageIndex);
    expect(out).toContain(body);
    expect(warnings).toEqual([]);
  });
});

describe("build-lib real-tree invariants", () => {
  it("every real page has a title (does not throw)", () => {
    expect(() => collectGuidePages(REPO_SITE_CONTENT)).not.toThrow();
    expect(() => collectPackagePages(REPO_PACKAGES_ROOT)).not.toThrow();
  });

  it("no real duplicate slug", () => {
    const guidePages = collectGuidePages(REPO_SITE_CONTENT);
    const packagePages = collectPackagePages(REPO_PACKAGES_ROOT);
    expect(() => assertNoDuplicateSlugs(guidePages, packagePages)).not.toThrow();
  });

  it("no real page lands in the unordered tail", () => {
    const guidePages = collectGuidePages(REPO_SITE_CONTENT);
    const packagePages = collectPackagePages(REPO_PACKAGES_ROOT);
    expect([...guidePages, ...packagePages].every((p) => p.order !== 99)).toBe(true);
  });

  it("every configured package section is non-empty", () => {
    const packagePages = collectPackagePages(REPO_PACKAGES_ROOT);
    for (const section of PACKAGE_SECTIONS) {
      expect(packagePages.some((p) => p.folder === section.folder)).toBe(true);
    }
  });
});
