// RuleTester cases for `wa/no-widget-factory-in-render`.
//
// Run with `node --test` (see `packages/web-agent-lit/package.json`). Each
// invalid case asserts the `factory` message and its line, so a report that
// slips out of the render scope, or one that fails to fire, is caught.
import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import rule from "./no-widget-factory-in-render.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

const messageId = "factory";

ruleTester.run("no-widget-factory-in-render", rule, {
  valid: [
    // A registry role call outside any render scope.
    'const b = uiRegistry.button({});',
    // The named registry identifier outside a render scope.
    'function build() { return registry.iconButton({}); }',
    // An identifier imported from a ui/registry module, used outside a render
    // scope.
    [
      'import { uiRegistry as reg } from "../ui/registry.js";',
      "const b = reg.button({});",
    ].join("\n"),
    // An unrelated identifier with a role name inside a render scope.
    "class C { render() { return foo.button({}); } }",
    // A render method that builds only tags, so it creates no widget.
    "class C { render() { return html`<wa-button>Go</wa-button>`; } }",
    // element creation outside a render scope.
    'const el = document.createElement("div");',
    // element creation inside a callback that is not a render scope.
    'function f() { [1].forEach(() => { document.createElement("div"); }); }',
    // A method named like a render scope but reached through a member call is
    // not a render scope declaration.
    "class C { other() { return document.createElement(\"div\"); } }",
  ],
  invalid: [
    {
      // A registry factory in a `template()` method.
      code: "class C { template() { return uiRegistry.button({}); } }",
      errors: [{ messageId, line: 1 }],
    },
    {
      // An imported registry alias in a `render()` method.
      code: [
        'import { uiRegistry as reg } from "../ui/registry.js";',
        "class C { render() { return reg.iconButton({}); } }",
      ].join("\n"),
      errors: [{ messageId, line: 2 }],
    },
    {
      // element creation in a `_renderX()` method.
      code: 'class C { _renderX() { return document.createElement("div"); } }',
      errors: [{ messageId, line: 1 }],
    },
    {
      // A named registry role in an object-literal `render()` method.
      code: "const o = { render() { return uiRegistry.checkbox({}); } };",
      errors: [{ messageId, line: 1 }],
    },
    {
      // A function that directly returns an html template is a render scope.
      code: "const view = () => html`<div>${uiRegistry.menu({})}</div>`;",
      errors: [{ messageId, line: 1 }],
    },
    {
      // A nested callback keeps the enclosing render scope.
      code: "class C { render() { return html`<div>${items.map(() => uiRegistry.button({}))}</div>`; } }",
      errors: [{ messageId, line: 1 }],
    },
    {
      // element creation inside a `render()` that returns a template.
      code: [
        "class C {",
        "  render() {",
        '    const el = document.createElement("div");',
        "    return html`${el}`;",
        "  }",
        "}",
      ].join("\n"),
      errors: [{ messageId, line: 3 }],
    },
  ],
});
