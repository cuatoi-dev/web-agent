import { describe, it, expect } from "vitest";
import esbuild from "esbuild";
import path from "path";

// These tests measure the *JS* bundle (chart.js absence). The
// real webpack build injects CSS via style-loader; here CSS imports (e.g. the
// wa-tokens stylesheet) are stubbed to empty modules so they don't break
// the esbuild pass or skew the JS-only measurement.
const cssStubPlugin: esbuild.Plugin = {
  name: "css-stub",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
  },
};

// 005: pin `lit-html` to v1 ONLY for imports issued from web-agent-lit's own
// source (it was written against the v1 API). Scoped by importer rather than
// a blanket `alias` entry, because docs-embed.ts now also pulls in the real
// `lit` package (v3, via docs-agent-widget.ts) — `lit`'s own internal
// `lit-html/is-server.js` import needs the real v3 lit-html, and a global
// alias to v1 (which lacks is-server.js) broke that resolve. Mirrors the
// same issuer-scoped fix in webpack.config.cjs.
function scopedLitHtmlV1Plugin(scopeDir: string, targetDir: string): esbuild.Plugin {
  return {
    name: "scoped-lit-html-v1",
    setup(build) {
      build.onResolve({ filter: /^lit-html(\/.*)?$/ }, async (args) => {
        if (!args.importer.startsWith(scopeDir)) return undefined; // let default resolution proceed
        const rest = args.path.slice("lit-html".length); // "" or "/directives/unsafe-html.js"
        const result = await build.resolve(`.${rest}`, {
          kind: args.kind,
          resolveDir: targetDir,
        });
        if (result.errors.length > 0) return { errors: result.errors };
        return { path: result.path, namespace: result.namespace };
      });
    },
  };
}

// `@cuatoi/web-agent-lit/themes` names the registry module, not the
// `src/themes` directory the broad package alias points at. The alias option
// matches on prefix, so it would also capture `/themes/wa-tokens.css`; this
// plugin matches the bare subpath only and leaves CSS to the broad alias.
// Mirrors the same split in webpack.config.cjs and vitest.config.ts.
function themesRegistryPlugin(litAliasDir: string): esbuild.Plugin {
  return {
    name: "themes-registry",
    setup(build) {
      build.onResolve({ filter: /^@cuatoi\/web-agent-lit\/themes$/ }, () => ({
        path: path.resolve(litAliasDir, "themes/registry.ts"),
      }));
    },
  };
}

describe("docs-site bundle absence", () => {
  it("web-agent-embed bundle has no chart.js code", async () => {
    const entryPoint = path.resolve(__dirname, "./docs-embed.ts");
    const litAlias   = path.resolve(__dirname, "../../../packages/web-agent-lit/src");
    const coreAlias  = path.resolve(__dirname, "../../../packages/web-agent-core/src");
    const domAlias   = path.resolve(__dirname, "../../../packages/web-agent-dom/src");
    const litNodeModules  = path.resolve(__dirname, "../../../packages/web-agent-lit/node_modules");
    const coreNodeModules = path.resolve(__dirname, "../../../packages/web-agent-core/node_modules");
    const domNodeModules  = path.resolve(__dirname, "../../../packages/web-agent-dom/node_modules");
    const litHtmlV1Alias  = path.resolve(__dirname, "../../../packages/web-agent-lit/node_modules/lit-html-v1");

    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      minify: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: ["es2022"],
      alias: {
        "@cuatoi/web-agent-lit": litAlias,
        "@cuatoi/web-agent-core": coreAlias,
        "@cuatoi/web-agent-dom": domAlias,
        "node:fs": path.resolve(__dirname, "../scripts/empty.js"),
        "node:path": path.resolve(__dirname, "../scripts/empty.js"),
      },
      nodePaths: [litNodeModules, coreNodeModules, domNodeModules],
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [
        cssStubPlugin,
        themesRegistryPlugin(litAlias),
        scopedLitHtmlV1Plugin(litAlias, litHtmlV1Alias),
      ],
    });

    const outputText = result.outputFiles[0].text;
    expect(outputText).not.toContain("chartjs-");
    expect(outputText).not.toContain("chartjs.org");
  });

  it("gallery bundle has no chart.js code", async () => {
    const entryPoint = path.resolve(__dirname, "./gallery.ts");
    const litAlias   = path.resolve(__dirname, "../../../packages/web-agent-lit/src");
    const coreAlias  = path.resolve(__dirname, "../../../packages/web-agent-core/src");
    const domAlias   = path.resolve(__dirname, "../../../packages/web-agent-dom/src");
    const litNodeModules  = path.resolve(__dirname, "../../../packages/web-agent-lit/node_modules");
    const coreNodeModules = path.resolve(__dirname, "../../../packages/web-agent-core/node_modules");
    const domNodeModules  = path.resolve(__dirname, "../../../packages/web-agent-dom/node_modules");
    const litHtmlV1Alias  = path.resolve(__dirname, "../../../packages/web-agent-lit/node_modules/lit-html-v1");

    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      minify: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: ["es2022"],
      alias: {
        "@cuatoi/web-agent-lit": litAlias,
        "@cuatoi/web-agent-core": coreAlias,
        "@cuatoi/web-agent-dom": domAlias,
        "node:fs": path.resolve(__dirname, "../scripts/empty.js"),
        "node:path": path.resolve(__dirname, "../scripts/empty.js"),
      },
      nodePaths: [litNodeModules, coreNodeModules, domNodeModules],
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [
        cssStubPlugin,
        themesRegistryPlugin(litAlias),
        scopedLitHtmlV1Plugin(litAlias, litHtmlV1Alias),
      ],
    });

    const outputText = result.outputFiles[0].text;
    expect(outputText).not.toContain("chartjs-");
    expect(outputText).not.toContain("chartjs.org");
  });
});
