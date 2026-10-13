import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const BIN = path.resolve(__dirname, "../../bin/web-agent-theme-check.mjs");
const FIXTURES = path.resolve(__dirname, "../../test-fixtures/themes");
/** Distinct --wa-* names in the stylesheet the checker reads. Input to the
 *  expected count, not an assertion about the file's text. */
const KNOWN = new Set(
  [...readFileSync(path.resolve(__dirname, "wa-tokens.css"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/(--wa-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
).size;

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf-8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe("theme checker", () => {
  it("checks three-token with --base wa2-dark", () => {
    const res = run(path.join(FIXTURES, "three-token.css"), "--base", "wa2-dark");
    expect(res.code).toBe(0);
    expect(res.out).toContain(`warn: ${KNOWN - 3} tokens inherit from wa2-dark`);
    expect(res.out).toContain(`fixture-three: 3 of ${KNOWN} tokens declared`);
    expect(res.out).not.toContain("error:");
  });

  it("checks three-token without --base", () => {
    const res = run(path.join(FIXTURES, "three-token.css"));
    expect(res.code).toBe(0);
    expect(res.out).toContain(`warn: ${KNOWN - 3} tokens inherit from the base theme`);
    expect(res.out).toContain(`fixture-three: 3 of ${KNOWN} tokens declared`);
  });

  it("fails on misspelled token", () => {
    const res = run(path.join(FIXTURES, "misspelled-token.css"));
    expect(res.code).toBe(1);
    expect(res.out).toContain("error: --wa-font-size-mm is not a web-agent token");
    expect(res.out).toContain(`fixture-misspelled: 1 of ${KNOWN} tokens declared`);
  });

  it("fails on no-theme-block file", () => {
    const res = run(path.join(FIXTURES, "no-theme-block.css"));
    expect(res.code).toBe(1);
    expect(res.out).toContain("error: no [data-theme=...] block");
  });

  it("fails with usage on no arguments", () => {
    const res = run();
    expect(res.code).toBe(1);
    expect(res.err).toContain("usage: web-agent-theme-check");
  });

  it("fails with usage on invalid base", () => {
    const res = run(path.join(FIXTURES, "three-token.css"), "--base", "acme");
    expect(res.code).toBe(1);
    expect(res.err).toContain("usage:");
  });

  it("fails on missing file", () => {
    const res = run(path.join(FIXTURES, "missing.css"));
    expect(res.code).toBe(1);
    expect(res.err).toContain("error: cannot read");
  });
});
