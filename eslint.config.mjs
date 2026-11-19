import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import wa from "./eslint-rules/index.mjs";

// One eslint config for the whole workspace.
//
// `ignores` and `files` patterns below resolve against THIS file's directory
// (the workspace root), NOT the directory eslint runs in, so every pattern
// carries its unit prefix. eslint finds this file by walking up from the unit
// it is run in, which is why each unit keeps a plain `eslint .` lint script.
//
// Each unit needs its own `parserOptions.project`, so each gets one
// `files`-scoped block. Nine units lint against their `tsconfig.lint.json`;
// `apps/docs-site` has none and lints against its own `tsconfig.json`.
const UNITS = [
  ["packages/web-agent-browser", "tsconfig.lint.json"],
  ["packages/web-agent-charting", "tsconfig.lint.json"],
  ["packages/web-agent-core", "tsconfig.lint.json"],
  ["packages/web-agent-dom", "tsconfig.lint.json"],
  ["packages/web-agent-lit", "tsconfig.lint.json"],
  ["packages/web-agent-mcp", "tsconfig.lint.json"],
  ["packages/web-agent-openapi", "tsconfig.lint.json"],
  ["packages/web-agent-vfs", "tsconfig.lint.json"],
  ["apps/cat-store", "tsconfig.lint.json"],
  ["apps/docs-site", "tsconfig.json"],
];

export default tseslint.config(
  {
    ignores: [
      // eslint does not lint its own config.
      "eslint.config.mjs",
      // Build output, one entry per unit.
      "packages/web-agent-browser/dist/**",
      "packages/web-agent-browser/dist-template/**",
      // e2e specs copy dist/ into patched test extensions under temp/,
      // generated at test time and gitignored.
      "**/temp/**",
      "packages/web-agent-charting/dist/**",
      "packages/web-agent-core/dist/**",
      "packages/web-agent-dom/dist/**",
      "packages/web-agent-lit/dist/**",
      "packages/web-agent-mcp/dist/**",
      "packages/web-agent-openapi/dist/**",
      "packages/web-agent-vfs/dist/**",
      "apps/cat-store/dist/**",
      "apps/docs-site/dist/**",
      // Files each unit excluded when eslint was installed, tasks 001-017.
      "packages/web-agent-browser/webpack.config.cjs",
      "packages/web-agent-browser/tool/generate-public-sans-css.cjs",
      "packages/web-agent-browser/tool/compile-brand.cjs",
      "packages/web-agent-browser/tool/sidepanel-tools.cjs",
      "packages/web-agent-browser/tool/png-icons.cjs",
      "packages/web-agent-browser/tool/manifest.cjs",
      "packages/web-agent-browser/tool/build.cjs",
      "packages/web-agent-browser/tool/init.cjs",
      "packages/web-agent-browser/bin/web-agent-brand.mjs",
      "packages/web-agent-lit/bin/web-agent-theme-check.mjs",
      "packages/web-agent-browser/e2e/fixtures-server.mjs",
      // A plain fixture script served to the page, not part of the build.
      "packages/web-agent-browser/e2e/fixtures/dialog-csp.js",
      "packages/web-agent-browser/e2e/fixtures/checkout-extra.js",
      "packages/web-agent-browser/e2e/fixtures/sw-worker.js",
      "apps/cat-store/temp/**",
      "apps/cat-store/webpack.config.js",
      "apps/cat-store/webpack.genui.config.js",
      "apps/cat-store/scripts/*.mjs",
      "apps/docs-site/vendor/**",
      "apps/docs-site/webpack.config.cjs",
      "apps/docs-site/scripts/*.mjs",
      "apps/docs-site/scripts/*.js",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    // The theme-token rules. These replace the two vitest guards that
    // used to live in `packages/web-agent-lit/src/themes/`; a violation now
    // reports at its own file and line instead of failing one test in another
    // package. Production source only — test files build known-bad input on
    // purpose, and `dist/` is generated.
    files: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.spec.ts", "**/*.d.ts"],
    plugins: { wa },
    rules: {
      "wa/no-raw-colour": "error",
      "wa/no-untokenized-font": "error",
      "wa/no-raw-spacing": "error",
      "wa/token-must-exist": "error",
    },
  },
  {
    // The structural rules. These protect the shape of the workspace: where a
    // type may be declared, how a package's API is reached, and that the
    // module graph stays acyclic.
    //
    // Production source only, matching the token rules above. Test files
    // declare throwaway fixture shapes inline and reach into the internals of
    // the unit they test on purpose — both are what a test is for.
    files: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.spec.ts", "**/*.d.ts"],
    plugins: { wa },
    rules: {
      "wa/types-in-types-file": "error",
      "wa/no-deep-import": [
        "error",
        { scope: "@cuatoi/", root: import.meta.dirname, maxDepth: 2 },
      ],
      "wa/no-cycle": ["error", { root: import.meta.dirname }],
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
    },
  },
  {
    // The render rules. A widget is built as a `<wa-*>` tag by the template,
    // and a file that renders with a Lit template does not write HTML by hand.
    // Scoped to the three production trees that render; test files build
    // known-bad input on purpose, and `.d.ts` files are generated.
    files: [
      "packages/web-agent-lit/src/**/*.ts",
      "packages/web-agent-vfs/src/**/*.ts",
      "apps/cat-store/src/**/*.ts",
    ],
    ignores: ["**/*.test.ts", "**/*.spec.ts", "**/*.d.ts"],
    plugins: { wa },
    rules: {
      "wa/no-widget-factory-in-render": "error",
      "wa/no-innerhtml-write": "error",
    },
  },
  {
    // web-agent-core is the agent loop and must stay free of UI and rendering
    // libraries — that is the whole point of the one-core-plus-enhancements
    // layout in AGENTS.md. This replaces bundle-guard.test.ts, which walked
    // core's own src/ with readdirSync and regexed each file for these
    // imports. eslint already resolves imports; it does not need a test to
    // grep for them.
    files: ["packages/web-agent-core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          { name: "lit-html", message: "web-agent-core must not depend on a rendering library. Framework bindings live in web-agent-lit." },
          { name: "marked", message: "web-agent-core must not depend on a markdown renderer. That belongs in web-agent-lit." },
          { name: "dompurify", message: "web-agent-core must not depend on a sanitiser. That belongs in web-agent-lit." },
          { name: "vega", message: "web-agent-core must not depend on a charting library. That belongs in web-agent-charting." },
          { name: "vega-embed", message: "web-agent-core must not depend on a charting library. That belongs in web-agent-charting." },
          { name: "vega-lite", message: "web-agent-core must not depend on a charting library. That belongs in web-agent-charting." },
        ],
      }],
    },
  },
  {
    // The DOM-tier reminder. Scoped to specs under a unit's `src/`, which is
    // exactly where a DOM spec should NOT be: the block above deliberately
    // ignores test files, so this rule needs its own block to see them.
    // `test-dom/` is not matched here, so a correctly placed spec is silent.
    files: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    plugins: { wa },
    rules: {
      "wa/dom-test-in-test-dom": "error",
    },
  },
  {
    // `.js` import specifiers in the units that resolve
    // with `moduleResolution: "Bundler"`. Webpack resolves a relative
    // specifier literally, so `./store.js` names a file that does not exist
    // and the importing module silently ends up with no exports.
    //
    // Scoped by resolution mode, not by unit name. `apps/cat-store/src/server`
    // and `apps/cat-store/src/shared` are compiled by
    // `apps/cat-store/tsconfig.server.json` under NodeNext and emit real
    // JavaScript to `dist/node`, so there the `.js` extension is the correct
    // spelling and the rule must not see them.
    //
    // Test files are included on purpose, unlike the blocks above. A test
    // resolves through the same unit config as the source next to it, so a
    // `.js` specifier is just as wrong there — and a spelling that survives in
    // a test is the one that gets copied back into `src/`.
    files: [
      "apps/cat-store/**/*.ts",
      "apps/docs-site/**/*.ts",
      "packages/web-agent-browser/**/*.ts",
    ],
    ignores: [
      "apps/cat-store/src/server/**",
      "apps/cat-store/src/shared/**",
      "**/*.d.ts",
    ],
    plugins: { wa },
    rules: {
      "wa/no-js-specifier-in-bundler-unit": "error",
    },
  },
  {
    // 2026-09-09. A hard cap on the size of one production source file.
    // `max-lines` is a stock eslint rule, so this block configures it and
    // adds no code, the same way
    // `@typescript-eslint/consistent-type-definitions` is handled above.
    //
    // Every line counts — blank lines and comments included — so the number
    // the rule reports is the number `wc -l` reports for the same file.
    //
    // Production source only, matching the token and structural blocks above.
    // A test file grows with the cases it covers, and `.d.ts` files are
    // generated.
    files: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.spec.ts", "**/*.d.ts"],
    rules: {
      "max-lines": ["error", { max: 500, skipBlankLines: false, skipComments: false }],
    },
  },
  ...UNITS.map(([dir, tsconfig]) => ({
    files: [`${dir}/**`],
    languageOptions: {
      parserOptions: {
        project: [`./${dir}/${tsconfig}`],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  })),
  {
    // Test code types its mocks, stubs and fixtures loosely on purpose, so
    // the six "unsafe/any" rules fight it for no benefit. They stay ON for
    // production code. `**/e2e/**/*.ts` is included deliberately: the e2e
    // helpers are test infrastructure and relax with the tests. Every other
    // rule — require-await, unbound-method, no-floating-promises,
    // no-misused-promises and all core rules — stays ON here.
    files: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/e2e/**/*.ts",
      "packages/web-agent-lit/test-support/**",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // genui-bootstrap.test.ts compiles the browser bootstrap source this
    // module generates and runs it against a fake `window`/`console`.
    // `new Function` IS the thing under test, so the rule cannot be
    // satisfied without changing what the test proves. Scoped to this one
    // file; 3 findings suppressed.
    files: ["apps/cat-store/src/server/genui-bootstrap.test.ts"],
    rules: { "@typescript-eslint/no-implied-eval": "off" },
  },
  {
    // demo-skill.test.ts parses the show_generative_ui object literals out of
    // the shipped skill text and runs them through the real block validator,
    // so it reads the shipped string rather than a pasted copy of it.
    // `new Function` IS how it turns that source text into an object; the
    // rule cannot be satisfied without changing what the test proves. Scoped
    // to this one file.
    files: ["apps/docs-site/src/demo-skill.test.ts"],
    rules: { "@typescript-eslint/no-implied-eval": "off" },
  },
  {
    // cdp-page-source.test.ts reconstructs PAGE_DESCRIBE_SOURCE/PAGE_FETCH_SOURCE
    // with `new Function` to prove the exact string CDP receives is valid,
    // runnable JavaScript with no free module-level names. `new Function` IS
    // the thing under test; the rule cannot be satisfied without changing
    // what the test proves. Scoped to this one file.
    files: ["packages/web-agent-browser/src/lib/cdp-page-source.test.ts"],
    rules: { "@typescript-eslint/no-implied-eval": "off" },
  },
);
