import { describe, expect, it, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

// The scaffolder is a CommonJS build script, not part of the src/ TypeScript
// graph — it runs from bin/web-agent-brand.mjs, never inside a bundled entry.
const require = createRequire(import.meta.url);
const { init, titleCase, toolkitVersion } = require("../../tool/init.cjs") as {
  init: (dir: string) => { name: string; version: string; dir: string };
  titleCase: (name: string) => string;
  toolkitVersion: () => string;
};
const compileBrand = require("../../tool/compile-brand.cjs").compileBrand as (
  brandDir: string,
) => { models: unknown[] };

const TOOLKIT_BRAND_DIR = path.resolve(__dirname, "../../brand");

describe("init", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTarget(name = "acme-agent"): string {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "init-test-")), name);
    tempDirs.push(path.dirname(dir));
    return dir;
  }

  function readPkg(dir: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as Record<string, unknown>;
  }

  it("writes exactly package.json, brand/ and .gitignore", () => {
    const target = makeTarget();
    init(target);
    expect(fs.readdirSync(target).sort()).toEqual([".gitignore", "brand", "package.json"]);
  });

  it("names the package after the directory", () => {
    const target = makeTarget();
    init(target);
    const pkg = readPkg(target);
    expect(pkg.name).toBe("acme-agent");
    expect(pkg.description).toBe("A web agent for acme-agent.");
  });

  it("derives displayName from the directory name", () => {
    const target = makeTarget();
    init(target);
    expect(readPkg(target).displayName).toBe("Acme Agent");
  });

  it("scaffolds private, so nothing is published by accident", () => {
    const target = makeTarget();
    init(target);
    expect(readPkg(target).private).toBe(true);
  });

  it("publishes dist and not the brand sources", () => {
    const target = makeTarget();
    init(target);
    expect(readPkg(target).files).toEqual(["dist"]);
  });

  it("wires the build script to the bin", () => {
    const target = makeTarget();
    init(target);
    const pkg = readPkg(target);
    expect(pkg.scripts).toEqual({ build: "web-agent-brand build" });
  });

  it("depends on the toolkit at its real version", () => {
    const target = makeTarget();
    init(target);
    const pkg = readPkg(target);
    const deps = pkg.dependencies as Record<string, string>;
    expect(deps["@cuatoi/web-agent-browser"]).toBe(`^${toolkitVersion()}`);
  });

  it("does not ignore dist", () => {
    const target = makeTarget();
    init(target);
    const gitignore = fs.readFileSync(path.join(target, ".gitignore"), "utf8");
    expect(gitignore).toBe("node_modules\n");
    expect(gitignore).not.toMatch(/dist/);
  });

  it("copies the working default brand", () => {
    const target = makeTarget();
    init(target);
    for (const file of ["plugin.yml", "model.yml", "icon.png"]) {
      expect(fs.existsSync(path.join(target, "brand", file))).toBe(true);
    }
    expect(fs.statSync(path.join(target, "brand")).isDirectory()).toBe(true);
    const copied = fs.readFileSync(path.join(target, "brand", "icon.png"));
    const original = fs.readFileSync(path.join(TOOLKIT_BRAND_DIR, "icon.png"));
    expect(copied.equals(original)).toBe(true);
  });

  it("copies brand/agents/chromagent.yml and tesagent.yml", () => {
    const target = makeTarget();
    init(target);
    for (const file of ["chromagent.yml", "tesagent.yml"]) {
      const copied = fs.readFileSync(path.join(target, "brand", "agents", file));
      const original = fs.readFileSync(path.join(TOOLKIT_BRAND_DIR, "agents", file));
      expect(copied.equals(original)).toBe(true);
    }
  });

  it("the scaffolded brand compiles", () => {
    const target = makeTarget();
    init(target);
    compileBrand(path.join(target, "brand"));
  });

  it("refuses a directory that already exists and is not empty", () => {
    const target = makeTarget();
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "existing.txt"), "keep me");
    expect(() => init(target)).toThrow("already exists and is not empty");
  });

  it("writes nothing when it refuses", () => {
    const target = makeTarget();
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "existing.txt"), "keep me");
    try {
      init(target);
    } catch {
      // expected
    }
    expect(fs.readdirSync(target).sort()).toEqual(["existing.txt"]);
  });

  it("refuses a path that is a file", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "init-test-"));
    tempDirs.push(parent);
    const fileOnDisk = path.join(parent, "occupied-file");
    fs.writeFileSync(fileOnDisk, "not a directory");
    expect(() => init(fileOnDisk)).toThrow("already exists and is not empty");
  });

  it("accepts an existing empty directory", () => {
    const target = makeTarget();
    fs.mkdirSync(target, { recursive: true });
    init(target);
    expect(fs.readdirSync(target).sort()).toEqual([".gitignore", "brand", "package.json"]);
  });

  it("titleCase splits on hyphen and underscore", () => {
    expect(titleCase("acme-agent")).toBe("Acme Agent");
    expect(titleCase("acme_claims_bot")).toBe("Acme Claims Bot");
    expect(titleCase("acme")).toBe("Acme");
  });

  it("titleCase tolerates repeated and trailing separators", () => {
    expect(titleCase("acme--agent-")).toBe("Acme Agent");
  });
});