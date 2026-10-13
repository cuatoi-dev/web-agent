import { describe, it, expect, afterAll } from "vitest";
import path from "path";

// esbuild checks `new TextEncoder().encode("") instanceof Uint8Array` at module load time.
// In jsdom environment, globalThis.Uint8Array is replaced with jsdom's window Uint8Array,
// while TextEncoder returns Node's realm Uint8Array. Restore Node's Uint8Array before importing esbuild.
const origUint8Array = globalThis.Uint8Array;
const nodeUint8ArrayProto = Object.getPrototypeOf(new TextEncoder().encode("")) as { constructor: typeof Uint8Array };
globalThis.Uint8Array = nodeUint8ArrayProto.constructor;

/** Framework packages the vanilla `.` entry must never reach. */
const FRAMEWORK = /^(@cuatoi\/web-agent-lit|lit-html|lit|@lit\/)/;

interface FrameworkImport { specifier: string; importer: string }

/**
 * Walk the real import graph of `entry` with esbuild. Relative imports are
 * bundled (so the walk is transitive); every bare specifier is externalized and,
 * if it names a framework package, recorded. Type-only imports are erased by
 * esbuild and correctly do not count — they create no runtime dependency.
 */
async function frameworkImportsOf(entry: string): Promise<FrameworkImport[]> {
  const esbuild = (await import("esbuild")).default;
  const seen: FrameworkImport[] = [];
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, entry)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    logLevel: "silent",
    plugins: [
      {
        name: "record-framework-imports",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === "entry-point") return null;
            if (args.path.startsWith(".") || path.isAbsolute(args.path)) return null;
            if (FRAMEWORK.test(args.path)) {
              seen.push({
                specifier: args.path,
                importer: path.relative(__dirname, args.importer),
              });
            }
            return { path: args.path, external: true };
          });
        },
      },
    ],
  });
  return seen;
}

describe("charting entry points", () => {
  afterAll(() => {
    globalThis.Uint8Array = origUint8Array;
  });

  it("the `.` entry reaches no framework package", async () => {
    expect(await frameworkImportsOf("./index.ts")).toEqual([]);
  });

  // Positive control: the same detector must fire on a graph that DOES use Lit,
  // otherwise a green test above would prove nothing.
  it("the `./lit` entry does reach the Lit binding", async () => {
    const found = await frameworkImportsOf("./lit/index.ts");
    expect(found.map((f) => f.specifier)).toContain("@cuatoi/web-agent-lit");
  });
});
