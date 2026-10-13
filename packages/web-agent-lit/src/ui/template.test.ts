import { describe, it, expect } from "vitest";
import { html, svg, render, live, repeat } from "./template.js";

describe("lit-html seam (template.ts)", () => {
  it("exports html, svg, and render as functions", () => {
    expect(typeof html).toBe("function");
    expect(typeof svg).toBe("function");
    expect(typeof render).toBe("function");
  });

  it("render(result, container) inserts DOM — Lit-3 arg order", () => {
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

  it("live re-syncs a property to the given value even when the DOM value has diverged since the last render", () => {
    const div = document.createElement("div");
    const template = (v: string) => html`<input .value=${live(v)} />`;
    render(template("hello"), div);
    const input = div.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("hello");

    // A user edit (or other out-of-band write) changes the live DOM value
    // without lit-html's cache knowing. Re-rendering the SAME value would be
    // a no-op under a plain .prop binding, since lit-html's cache still
    // holds "hello" — the point of live() is to check the real DOM instead.
    input.value = "typed by user";
    render(template("hello"), div);
    expect(input.value).toBe("hello");
  });

  it("repeat keeps each keyed DOM node's identity across a reorder", () => {
    const div = document.createElement("div");
    const list = (items: string[]) =>
      html`<ul>${repeat(items, (item) => item, (item) => html`<li>${item}</li>`)}</ul>`;

    render(list(["a", "b", "c"]), div);
    const [liA, liB] = Array.from(div.querySelectorAll("li"));

    render(list(["c", "a", "b"]), div);
    const reordered = Array.from(div.querySelectorAll("li"));
    expect(reordered.map((li) => li.textContent)).toEqual(["c", "a", "b"]);
    expect(reordered[1]).toBe(liA);
    expect(reordered[2]).toBe(liB);
  });
});
