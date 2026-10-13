import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "../../..");

interface WebpackConfigLike {
  entry: Record<string, string>;
  plugins?: Array<{
    userOptions?: { chunks?: string[] };
    options?: { chunks?: string[] };
  }>;
}

describe("webpack entry and page configuration", () => {
  const config = require("../../../webpack.config.js") as WebpackConfigLike;

  it("webpack.config.js declares an HtmlWebpackPlugin page for every entry that needs one", () => {
    const entryKeys = new Set(Object.keys(config.entry));
    const ignoredChunks = new Set(["runtime", "vendors"]);

    const htmlPlugins = (config.plugins || []).filter(
      (p) => Boolean(p && (p.userOptions || p.options)),
    );

    const pageChunks = new Set<string>();
    for (const plugin of htmlPlugins) {
      const opts = plugin.userOptions || plugin.options || {};
      const chunks = Array.isArray(opts.chunks) ? opts.chunks : [];
      for (const chunk of chunks) {
        if (!ignoredChunks.has(chunk)) {
          pageChunks.add(chunk);
        }
      }
    }

    expect(pageChunks.size).toBeGreaterThan(0);
    for (const chunk of pageChunks) {
      expect(entryKeys.has(chunk)).toBe(true);
    }
  });

  it("every entry source file referenced by webpack.config.js exists on disk", () => {
    const entryPaths = Object.values(config.entry);
    expect(entryPaths.length).toBeGreaterThan(0);
    for (const entryPath of entryPaths) {
      const resolvedPath = path.resolve(appRoot, entryPath);
      expect(fs.existsSync(resolvedPath)).toBe(true);
    }
  });
});
