// RuleTester cases for `wa/no-innerhtml-write`.
//
// Run with `node --test` (see `packages/web-agent-lit/package.json`). Each
// invalid case asserts the `write` message and its line. The control cases
// prove the rule stays scoped to files that import `html`, and that a read is
// not a write.
import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import rule from "./no-innerhtml-write.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

const messageId = "write";

ruleTester.run("no-innerhtml-write", rule, {
  valid: [
    // The same write in a file that does not import `html`.
    'const el = document.createElement("div"); el.innerHTML = "<b>x</b>";',
    // A css-only import from lit does not make this a template file.
    'import { css } from "lit"; el.innerHTML = "<b>x</b>";',
    // A read of innerHTML is not a write.
    'import { html } from "lit"; const text = el.innerHTML;',
    // A computed member is not the plain property this rule targets.
    'import { html } from "lit"; el["innerHTML"] = "<b>x</b>";',
    // insertAdjacentHTML in a file with no html import.
    'el.insertAdjacentHTML("beforeend", "<b>x</b>");',
    // outerHTML write with no html import.
    'el.outerHTML = "<b>x</b>";',
  ],
  invalid: [
    {
      // innerHTML write with `html` imported from lit.
      code: [
        'import { html } from "lit";',
        'const el = document.createElement("div");',
        'el.innerHTML = "<b>x</b>";',
      ].join("\n"),
      errors: [{ messageId, line: 3 }],
    },
    {
      // outerHTML write with `html` imported from lit-html.
      code: [
        'import { html } from "lit-html";',
        'const el = document.createElement("div");',
        'el.outerHTML = "<b>x</b>";',
      ].join("\n"),
      errors: [{ messageId, line: 3 }],
    },
    {
      // insertAdjacentHTML with `html` imported from a ui/template module.
      code: [
        'import { html } from "../ui/template.js";',
        'const el = document.createElement("div");',
        'el.insertAdjacentHTML("beforeend", "<b>x</b>");',
      ].join("\n"),
      errors: [{ messageId, line: 3 }],
    },
    {
      // An aliased `html` import still counts.
      code: [
        'import { html as h } from "lit";',
        "const el = document.createElement(\"div\");",
        'el.innerHTML = "<b>x</b>";',
      ].join("\n"),
      errors: [{ messageId, line: 3 }],
    },
    {
      // Import order does not change enforcement: the import sits after the
      // write.
      code: [
        'const el = document.createElement("div");',
        'el.innerHTML = "<b>x</b>";',
        'import { html } from "lit";',
      ].join("\n"),
      errors: [{ messageId, line: 2 }],
    },
    {
      // A deep member target still reports.
      code: [
        'import { html } from "lit";',
        'this.root.innerHTML = "<b>x</b>";',
      ].join("\n"),
      errors: [{ messageId, line: 2 }],
    },
  ],
});
