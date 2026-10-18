import { beforeEach, describe, expect, it } from "vitest";
import { screenshotHighlight, screenshotRestore, screenshotSelect } from "./helper-screenshot";

beforeEach(() => {
  document.body.replaceChildren();
});

function add(tag: string, attrs: Record<string, string> = {}, parent: Element | ShadowRoot = document.body): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.append(el);
  return el;
}

function shadowHost(parent: Element | ShadowRoot = document.body): { host: HTMLElement; root: ShadowRoot } {
  const host = add("div", {}, parent);
  return { host, root: host.attachShadow({ mode: "open" }) };
}

const css = (selector: string) => screenshotSelect(document.documentElement, "css", selector);
const xpath = (selector: string) => screenshotSelect(document.documentElement, "xpath", selector);

describe("screenshotSelect — css", () => {
  it("selects the first match and counts all matches", () => {
    const first = add("button");
    add("button");
    const selected = css("button");
    expect(selected).toEqual({ ok: true, element: first, count: 2 });
  });

  it("prefers light-DOM matches over shadow matches and counts only the light ones", () => {
    const { root } = shadowHost();
    add("p", { class: "x" }, root);
    const light = add("p", { class: "x" });
    expect(css(".x")).toEqual({ ok: true, element: light, count: 1 });
  });

  it("falls back to open shadow roots: a nested root comes before a later sibling host", () => {
    const outer = shadowHost();
    const nested = shadowHost(outer.root);
    const deep = add("span", { class: "hit" }, nested.root);
    const second = shadowHost();
    add("span", { class: "hit" }, second.root);
    expect(css(".hit")).toEqual({ ok: true, element: deep, count: 2 });
  });

  it("queries each root separately, so a child combinator works inside a shadow root", () => {
    const { root } = shadowHost();
    const box = add("section", { class: "box" }, root);
    const child = add("button", {}, box);
    expect(css(".box > button")).toEqual({ ok: true, element: child, count: 1 });
  });

  it("does not enter a closed shadow root", () => {
    const host = add("div");
    const closed = host.attachShadow({ mode: "closed" });
    add("b", { class: "secret" }, closed);
    expect(css(".secret")).toEqual({ ok: false, error: "No element matches .secret." });
  });

  it("reports an invalid selector and no match", () => {
    expect(css("[")).toEqual({ ok: false, error: "Invalid CSS selector: [" });
    expect(css("#nope")).toEqual({ ok: false, error: "No element matches #nope." });
  });

  it("reports an empty selector as invalid", () => {
    expect(css("")).toEqual({ ok: false, error: "Invalid CSS selector: " });
  });
});

describe("screenshotSelect — xpath", () => {
  it("selects the first match and counts all matches", () => {
    const first = add("button", { class: "b" });
    add("button", { class: "b" });
    expect(xpath("//*[@class='b']")).toEqual({ ok: true, element: first, count: 2 });
  });

  it("does not enter shadow roots", () => {
    const { root } = shadowHost();
    add("button", { id: "inside" }, root);
    expect(xpath("//*[@id='inside']")).toEqual({ ok: false, error: "No element matches //*[@id='inside']." });
  });

  it("reports a syntax error", () => {
    expect(xpath("//*[")).toEqual({ ok: false, error: "Invalid XPath: //*[" });
  });

  it.each(["count(//button)", "string(//h1)", "boolean(//button)"])("rejects the scalar expression %s", (expr) => {
    add("button");
    add("h1");
    expect(xpath(expr)).toEqual({ ok: false, error: `XPath did not select an element: ${expr}` });
  });

  it("rejects a text node and an attribute node", () => {
    add("h1").textContent = "Title";
    expect(xpath("//h1/text()")).toEqual({ ok: false, error: "XPath did not select an element: //h1/text()" });
    add("a", { href: "/x" });
    expect(xpath("//a/@href")).toEqual({ ok: false, error: "XPath did not select an element: //a/@href" });
  });
});

describe("screenshotHighlight / screenshotRestore", () => {
  it("sets the red outline", () => {
    const el = add("button");
    screenshotHighlight(el);
    expect(el.style.outline).toContain("3px solid red");
    expect(el.style.outlineOffset).toBe("2px");
  });

  it("restores an element that had no inline outline", () => {
    const el = add("button", { style: "color: blue" });
    const saved = screenshotHighlight(el);
    screenshotRestore(el, saved);
    expect(el.style.outline).toBe("");
    expect(el.style.outlineOffset).toBe("");
    expect(el.getAttribute("style")).toBe("color: blue;");
  });

  it("restores existing values with their priority, longhands included", () => {
    const el = add("button");
    el.style.setProperty("outline-style", "dashed");
    el.style.setProperty("outline-width", "1px", "important");
    el.style.setProperty("outline-offset", "7px", "important");
    const saved = screenshotHighlight(el);
    screenshotRestore(el, saved);
    expect(el.style.getPropertyValue("outline-style")).toBe("dashed");
    expect(el.style.getPropertyValue("outline-width")).toBe("1px");
    expect(el.style.getPropertyPriority("outline-width")).toBe("important");
    expect(el.style.getPropertyValue("outline-offset")).toBe("7px");
    expect(el.style.getPropertyPriority("outline-offset")).toBe("important");
  });

  it("keeps unrelated inline styles changed while the highlight was on", () => {
    const el = add("button");
    const saved = screenshotHighlight(el);
    el.style.color = "green";
    screenshotRestore(el, saved);
    expect(el.style.color).toBe("green");
    expect(el.style.outline).toBe("");
  });

  it("outlines an SVG element", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    document.body.append(svg);
    const saved = screenshotHighlight(svg);
    expect(svg.style.outline).toContain("red");
    screenshotRestore(svg, saved);
    expect(svg.style.outline).toBe("");
  });
});
