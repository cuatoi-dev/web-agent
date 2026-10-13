import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

interface WebpackConfigLike {
  entry: Record<string, string | string[]>;
  plugins?: Array<{
    userOptions?: { chunks?: string[] };
    options?: { chunks?: string[] };
  }>;
}

describe("docs-site webpack entry and page configuration", () => {
  const config = require("../webpack.config.cjs") as WebpackConfigLike;

  it("every entry source file referenced by webpack.config.cjs exists on disk", () => {
    const entryEntries = Object.values(config.entry);
    expect(entryEntries.length).toBeGreaterThan(0);
    for (const entryItem of entryEntries) {
      const paths = Array.isArray(entryItem) ? entryItem : [entryItem];
      for (const p of paths) {
        const resolved = path.resolve(appRoot, p);
        expect(fs.existsSync(resolved), `Entry source file exists: ${p}`).toBe(true);
      }
    }
  });

  it("HtmlWebpackPlugin pages only reference existing declared entries", () => {
    const entryKeys = new Set(Object.keys(config.entry));
    const htmlPlugins = (config.plugins || []).filter(
      (p) => Boolean(p && (p.userOptions || p.options))
    );
    expect(htmlPlugins.length).toBeGreaterThan(0);

    const pageChunks = new Set<string>();
    for (const plugin of htmlPlugins) {
      const opts = plugin.userOptions || plugin.options || {};
      const chunks = Array.isArray(opts.chunks) ? opts.chunks : [];
      for (const chunk of chunks) {
        pageChunks.add(chunk);
      }
    }
    for (const chunk of pageChunks) {
      expect(entryKeys.has(chunk), `Chunk '${chunk}' must be a declared entry`).toBe(true);
    }
    expect(pageChunks.has("web-agent-embed")).toBe(false);
    expect(pageChunks.has("cues-demo")).toBe(false);
  });
});
