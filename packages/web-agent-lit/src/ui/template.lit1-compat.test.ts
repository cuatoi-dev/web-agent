import { describe, it, expect } from "vitest";
import { html, svg, render } from "./template.js";

describe("lit-html seam (template.ts) — lit-html@1 compat", () => {
  it("exports html, svg, and render as functions", () => {
    expect(typeof html).toBe("function");
    expect(typeof svg).toBe("function");
    expect(typeof render).toBe("function");
  });

  it("render(result, container) inserts DOM — Lit-1 arg order (result, container)", () => {
    const div = document.createElement("div");
    render(html`<b>hi</b>`, div);
    expect(div.querySelector("b")?.textContent).toBe("hi");
  });

  it("property binding .prop sets DOM property", () => {
    const div = document.createElement("div");
    render(html`<input .value=${"hello"} />`, div);
    expect((div.querySelector("input") as HTMLInputElement).value).toBe("hello");
  });

  it("@event binding attaches an event listener", () => {
    let fired = false;
    const div = document.createElement("div");
    render(html`<button @click=${() => { fired = true; }}>x</button>`, div);
    div.querySelector("button")!.click();
    expect(fired).toBe(true);
  });

  it("svg template works", () => {
    const div = document.createElement("div");
    render(svg`<circle r="5" />`, div);
    expect(div.querySelector("circle")?.getAttribute("r")).toBe("5");
  });
});