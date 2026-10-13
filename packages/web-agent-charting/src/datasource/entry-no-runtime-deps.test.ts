import { describe, it, expect, afterAll } from "vitest";
import path from "path";

// esbuild checks `new TextEncoder().encode("") instanceof Uint8Array` at module load time.
// In jsdom environment, globalThis.Uint8Array is replaced with jsdom's window Uint8Array,
// while TextEncoder returns Node's realm Uint8Array. Restore Node's Uint8Array before importing esbuild.
const origUint8Array = globalThis.Uint8Array;
const nodeUint8ArrayProto = Object.getPrototypeOf(new TextEncoder().encode("")) as { constructor: typeof Uint8Array };
globalThis.Uint8Array = nodeUint8ArrayProto.constructor;

interface BareImport {
  specifier: string;
  importer: string;
}

/**
 * Walk the real import graph of `entry` with esbuild, recording EVERY bare
 * specifier (not just framework ones — a widened copy of the walk in
 * entry-framework-agnostic.test.ts:22-52).
 */
async function bareImportsOf(entry: string): Promise<BareImport[]> {
  const esbuild = (await import("esbuild")).default;
  const seen: BareImport[] = [];
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, entry)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    logLevel: "silent",
    plugins: [
      {
        name: "record-bare-imports",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === "entry-point") return null;
            if (args.path.startsWith(".") || path.isAbsolute(args.path)) return null;
            seen.push({ specifier: args.path, importer: path.relative(__dirname, args.importer) });
            return { path: args.path, external: true };
          });
        },
      },
    ],
  });
  return seen;
}

describe("charting datasource entry", () => {
  afterAll(() => {
    globalThis.Uint8Array = origUint8Array;
  });

  it("the ./datasource entry reaches zero bare specifiers", async () => {
    expect(await bareImportsOf("./index.ts")).toEqual([]);
  });

  // Positive control, re-measured 2026-09-03 (task 007 — charting dropped zod
  // for hand-written JSON Schema, so this walk no longer reaches `zod`). The
  // `.` entry now reaches `ajv/dist/2020.js` as a dynamic import, from
  // validate-chart.ts's ajv wrapper (D6) — and it still does NOT reach
  // chart.js. Without this control a green first assertion would prove
  // nothing.
  it("the `.` entry (positive control) reaches ajv", async () => {
    const found = await bareImportsOf("../index.ts");
    expect(found.map((f) => f.specifier)).toContain("ajv/dist/2020.js");
  });
});
