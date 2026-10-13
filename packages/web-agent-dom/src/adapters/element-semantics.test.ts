// element-semantics.test.ts — vitest + jsdom
import { afterEach, describe, expect, it } from "vitest";
import { getName } from "./element-semantics.js";

function shadowHost(html: string): ShadowRoot {
  const host = document.createElement("custom-field");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = html;
  document.body.appendChild(host);
  return root;
}

describe("getName inside an open shadow root", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("finds a <label for> in the element's own shadow root", () => {
    const root = shadowHost('<label for="qty">Qty:</label><input id="qty">');
    expect(getName(root.querySelector("input") as Element)).toBe("Qty:");
  });

  it("resolves aria-labelledby ids in the element's own shadow root", () => {
    const root = shadowHost('<span id="lbl">Delivery date</span><input aria-labelledby="lbl">');
    expect(getName(root.querySelector("input") as Element)).toBe("Delivery date");
  });

  it("prefers the label in its own root over a same-id label in the document", () => {
    const outer = document.createElement("label");
    outer.setAttribute("for", "qty");
    outer.textContent = "Outer";
    document.body.appendChild(outer);
    const root = shadowHost('<label for="qty">Inner</label><input id="qty">');
    expect(getName(root.querySelector("input") as Element)).toBe("Inner");
  });

  it("still finds a <label for> and an aria-labelledby id in the main document", () => {
    document.body.innerHTML =
      '<label for="a">Alpha</label><input id="a"><span id="b">Beta</span><input aria-labelledby="b">';
    const inputs = document.querySelectorAll("input");
    expect(getName(inputs[0])).toBe("Alpha");
    expect(getName(inputs[1])).toBe("Beta");
  });
});
