// ---------------------------------------------------------------------------
// no-js-specifier-in-bundler-unit
//
// A relative import specifier must not carry a `.js` extension in a unit that
// resolves with `moduleResolution: "Bundler"`.
//
// The two halves of this workspace disagree on purpose. `web-agent-core`,
// `-lit`, `-charting`, `-dom`, `-mcp` and `-openapi` compile under NodeNext,
// where `./foo.js` is the *required* spelling. `apps/cat-store` (outside
// `src/server` and `src/shared`), `apps/docs-site` and `web-agent-browser`
// compile under Bundler, where the same spelling names a file that does not
// exist — only the `.ts` source does.
//
// TypeScript hides this: `tsc` substitutes `.js` -> `.ts` in every resolution
// mode, so the typecheck passes. Webpack does not, unless the config sets
// `resolve.extensionAlias`. `apps/cat-store/webpack.config.js` does not, so a
// `.js` specifier there silently resolves to nothing and the importing module
// ends up with no exports at all:
//
//     WARNING in ./src/web/agent-panel-config.ts 146:18-23
//     export 'store' (imported as 'store') was not found in './store'
//     (module has no exports)
//
// The warning names the file that *imports* the barrel, not the barrel that
// carries the bad specifier, so it is hard to trace and easy to write off.
//
// Which units this runs in is decided by `eslint.config.mjs`. This rule does
// not read any tsconfig.
//
// Two guards on the fixer, both load-bearing:
//
//   relative only   `ajv/dist/2020.js`, `lit/decorators.js`, `chart.js` and
//                   `@modelcontextprotocol/sdk/server/mcp.js` are real paths
//                   inside dependencies. Stripping those breaks the build.
//   `.js` only      not `.mjs`, `.cjs`, `.json`, and not a name that merely
//                   ends in `.js` such as `./vendor/three.js.min`.
// ---------------------------------------------------------------------------

import { importVisitor } from "../lib/module-graph.mjs";

export default {
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description:
        "Drop the `.js` extension from a relative import specifier in a Bundler-resolution unit.",
    },
    schema: [],
    messages: {
      jsSpecifier:
        "`{{spec}}` keeps a `.js` extension, but this unit resolves with `moduleResolution: \"Bundler\"`. That file does not exist — only the `.ts` source does — so the import silently resolves to nothing. Write `{{fixed}}`.",
    },
  },
  create(context) {
    return importVisitor((node, spec) => {
      if (typeof spec !== "string") return;
      // A bare specifier is a path inside a dependency. It is not ours to edit.
      if (!spec.startsWith(".")) return;
      // `.mjs`, `.cjs`, `.json` and `./vendor/three.js.min` all fail this.
      if (!spec.endsWith(".js")) return;

      const fixed = spec.slice(0, -3);
      const raw = node.raw ?? "";
      const quote = raw.slice(-1);
      // Only offer a fix when the raw literal ends in `.js` + its own quote.
      // An escaped or otherwise unusual literal is reported without one.
      const fixable = raw.endsWith(`.js${quote}`) && raw.length >= 6;

      context.report({
        node,
        messageId: "jsSpecifier",
        data: { spec, fixed },
        // Remove exactly the three characters before the closing quote, so the
        // original quote style survives the fix.
        fix: fixable
          ? (fixer) => fixer.removeRange([node.range[1] - 4, node.range[1] - 1])
          : undefined,
      });
    });
  },
};
