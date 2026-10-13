// ---------------------------------------------------------------------------
// The local eslint plugin: `wa`.
//
// One rule per file under `rules/`, shared helpers under `lib/`. This barrel is
// the only thing `eslint.config.mjs` imports — adding a rule means adding a
// file and one line here.
//
// Three groups of rules, kept in one plugin because they share the helpers:
//
//   theme      no-raw-colour, no-untokenized-font, no-raw-spacing,
//              token-must-exist — every visual value resolves from a
//              `--wa-*` token that actually exists.
//   structure  types-in-types-file, no-deep-import, no-cycle,
//              no-js-specifier-in-bundler-unit — where a type may be
//              declared, how a package is reached, that the module graph
//              stays acyclic, and that an import specifier is spelled the
//              way the unit's resolver reads it.
//   render     no-widget-factory-in-render, no-innerhtml-write — a widget is
//              built as a tag by the template, and a file that renders with a
//              Lit template does not write HTML by hand.
//
// `dom-test-in-test-dom` belongs to neither; it keeps the DOM test tier from
// eroding one file at a time.
//
// The `interface` over `type` convention is the stock
// `@typescript-eslint/consistent-type-definitions` rule, turned on in
// `eslint.config.mjs`. It needs no code here.
// ---------------------------------------------------------------------------

import noRawColour from "./rules/no-raw-colour.mjs";
import noUntokenizedFont from "./rules/no-untokenized-font.mjs";
import noRawSpacing from "./rules/no-raw-spacing.mjs";
import tokenMustExist from "./rules/token-must-exist.mjs";
import domTestInTestDom from "./rules/dom-test-in-test-dom.mjs";
import typesInTypesFile from "./rules/types-in-types-file.mjs";
import noDeepImport from "./rules/no-deep-import.mjs";
import noCycle from "./rules/no-cycle.mjs";
import noJsSpecifierInBundlerUnit from "./rules/no-js-specifier-in-bundler-unit.mjs";
import noWidgetFactoryInRender from "./rules/no-widget-factory-in-render.mjs";
import noInnerhtmlWrite from "./rules/no-innerhtml-write.mjs";

export default {
  rules: {
    "no-raw-colour": noRawColour,
    "no-untokenized-font": noUntokenizedFont,
    "no-raw-spacing": noRawSpacing,
    "token-must-exist": tokenMustExist,
    "dom-test-in-test-dom": domTestInTestDom,
    "types-in-types-file": typesInTypesFile,
    "no-deep-import": noDeepImport,
    "no-cycle": noCycle,
    "no-js-specifier-in-bundler-unit": noJsSpecifierInBundlerUnit,
    "no-widget-factory-in-render": noWidgetFactoryInRender,
    "no-innerhtml-write": noInnerhtmlWrite,
  },
};
