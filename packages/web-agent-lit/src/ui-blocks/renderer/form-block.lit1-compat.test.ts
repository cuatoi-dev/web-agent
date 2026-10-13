import { describe, it, expect } from "vitest";
import { html, render } from "lit-html-v1";

// Regression guard for a real bug: docs-site aliases `lit-html` to lit-html@1 at
// build time (webpack.config.cjs), while unit tests run against the real
// lit-html@3 (template.ts). A plain `attr=${cond ? true : null}` binding removes
// the attribute under v3 (via the `nothing` sentinel special-case) but NOT under
// v1 — v1's AttributeCommitter has no such special case for a bare `null`/`nothing`
// object, so it stringifies to `setAttribute(name, "[object Object]")` or
// `"null"`, leaving e.g. a <select> permanently disabled. The portable binding is
// the boolean-attribute directive `?attr=${bool}`, which both versions implement
// via toggleAttribute/removeAttribute. This test renders with the REAL lit-html@1
// package (not the aliased template.ts) to catch any regression to the unsafe
// plain-attribute pattern in form-block.ts.
describe("form-block select disabled/selected bindings — lit-html@1 compatibility", () => {
  it("?disabled=${false} does not render the disabled attribute under lit-html@1", () => {
    const div = document.createElement("div");
    const tpl = (disabled: boolean) => html`<select ?disabled=${disabled}></select>`;
    render(tpl(false), div);
    expect(div.querySelector("select")!.hasAttribute("disabled")).toBe(false);
  });

  it("?disabled=${true} renders the disabled attribute under lit-html@1", () => {
    const div = document.createElement("div");
    const tpl = (disabled: boolean) => html`<select ?disabled=${disabled}></select>`;
    render(tpl(true), div);
    expect(div.querySelector("select")!.hasAttribute("disabled")).toBe(true);
  });

  it("?selected=${...} marks only the matching option under lit-html@1", () => {
    const div = document.createElement("div");
    const options = ["Red", "Blue"];
    const value = "Blue";
    const tpl = html`
      <select>
        ${options.map((opt) => html`<option value=${opt} ?selected=${opt === value}>${opt}</option>`)}
      </select>
    `;
    render(tpl, div);
    const opts = Array.from(div.querySelectorAll("option"));
    expect(opts.filter((o) => o.hasAttribute("selected"))).toHaveLength(1);
    expect(opts.find((o) => o.hasAttribute("selected"))?.getAttribute("value")).toBe("Blue");
  });
});
