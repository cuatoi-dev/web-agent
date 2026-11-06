// element-semantics.test.ts — vitest + jsdom
import { afterEach, describe, expect, it } from "vitest";
import { describeElementParts, getRole, getName } from "./element-semantics.js";

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

  it("falls back to the placeholder of a textarea that has no label", () => {
    const root = shadowHost('<textarea placeholder="Ask the assistant..."></textarea>');
    expect(getName(root.querySelector("textarea") as Element)).toBe("Ask the assistant...");
  });

  it("prefers a <label for> over the placeholder", () => {
    const root = shadowHost('<label for="q">Search</label><input id="q" placeholder="Type here">');
    expect(getName(root.querySelector("input") as Element)).toBe("Search");
  });

  it("still finds a <label for> and an aria-labelledby id in the main document", () => {
    document.body.innerHTML =
      '<label for="a">Alpha</label><input id="a"><span id="b">Beta</span><input aria-labelledby="b">';
    const inputs = document.querySelectorAll("input");
    expect(getName(inputs[0])).toBe("Alpha");
    expect(getName(inputs[1])).toBe("Beta");
  });
});

describe("getRole table roles (001)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** A plain table with one header row and one data row. */
  function table(markup: string): HTMLTableElement {
    document.body.innerHTML = `<table>${markup}</table>`;
    return document.querySelector("table") as HTMLTableElement;
  }

  it("a th with no scope is a columnheader", () => {
    const t = table('<thead><tr><th>Date ▼</th></tr></thead>');
    expect(getRole(t.querySelector("th") as Element)).toBe("columnheader");
  });

  it("a th with scope col or colgroup is a columnheader", () => {
    const t = table('<thead><tr><th scope="col">Date</th><th scope="colgroup">All</th></tr></thead>');
    const ths = t.querySelectorAll("th");
    expect(getRole(ths[0])).toBe("columnheader");
    expect(getRole(ths[1])).toBe("columnheader");
  });

  it("a th with scope row or rowgroup is a rowheader, in any letter case", () => {
    const t = table(
      '<tbody><tr><th scope="row">Total</th><th scope="rowgroup">Q1</th><th scope="ROW">Net</th></tr></tbody>',
    );
    const ths = t.querySelectorAll("th");
    expect(getRole(ths[0])).toBe("rowheader");
    expect(getRole(ths[1])).toBe("rowheader");
    expect(getRole(ths[2])).toBe("rowheader");
  });

  it("a td in a plain table is a cell", () => {
    const t = table("<tbody><tr><td>2026-10-01</td></tr></tbody>");
    expect(getRole(t.querySelector("td") as Element)).toBe("cell");
  });

  it("a td in a grid or treegrid table is a gridcell", () => {
    document.body.innerHTML =
      '<table role="grid"><tbody><tr><td>B2</td></tr></tbody></table>' +
      '<table role="treegrid"><tbody><tr><td>C3</td></tr></tbody></table>';
    const tds = document.querySelectorAll("td");
    expect(getRole(tds[0])).toBe("gridcell");
    expect(getRole(tds[1])).toBe("gridcell");
  });

  it("a td with no table ancestor is a cell", () => {
    const td = document.createElement("td");
    expect(getRole(td)).toBe("cell");
  });

  it("tr is a row and thead, tbody and tfoot are rowgroups", () => {
    const t = table("<thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody><tfoot><tr><td>F</td></tr></tfoot>");
    expect(getRole(t.querySelector("thead") as Element)).toBe("rowgroup");
    expect(getRole(t.querySelector("tbody") as Element)).toBe("rowgroup");
    expect(getRole(t.querySelector("tfoot") as Element)).toBe("rowgroup");
    const rows = t.querySelectorAll("tr");
    expect(getRole(rows[0])).toBe("row");
    expect(getRole(rows[1])).toBe("row");
    expect(getRole(rows[2])).toBe("row");
  });

  it("an explicit role attribute still wins on every table element", () => {
    document.body.innerHTML =
      '<table role="grid">' +
      '<thead role="presentation"><tr role="none"><th role="button">Sort</th><td role="link">Go</td></tr></thead>' +
      "</table>";
    expect(getRole(document.querySelector("table") as Element)).toBe("grid");
    expect(getRole(document.querySelector("thead") as Element)).toBe("presentation");
    expect(getRole(document.querySelector("tr") as Element)).toBe("none");
    expect(getRole(document.querySelector("th") as Element)).toBe("button");
    expect(getRole(document.querySelector("td") as Element)).toBe("link");
  });

  it("a table is still a table, and an authored grid role stays grid", () => {
    expect(getRole(table(""))).toBe("table");
    expect(getRole(document.querySelector("table") as Element)).toBe("table");
    document.body.innerHTML = '<table role="grid"></table>';
    expect(getRole(document.querySelector("table") as Element)).toBe("grid");
  });

  it("non-table elements keep the roles they had before", () => {
    document.body.innerHTML =
      '<a href="#x">link</a><a>not a link</a><input type="checkbox">' +
      '<input type="range"><button>Go</button><span>text</span>';
    const els = document.querySelectorAll("a, input, button, span");
    expect(getRole(els[0])).toBe("link");
    expect(getRole(els[1])).toBe("");
    expect(getRole(els[2])).toBe("checkbox");
    expect(getRole(els[3])).toBe("slider");
    expect(getRole(els[4])).toBe("button");
    expect(getRole(els[5])).toBe("");
  });
});

describe("getName whitespace collapse", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("a th whose text and sort span sit on separate lines is named `Date ▼`", () => {
    document.body.innerHTML =
      '<table><thead><tr><th class="sortable">\n        Date\n        <span class="sort-indicator">▼</span>\n      </th></tr></thead></table>';
    expect(getName(document.querySelector("th") as Element)).toBe("Date ▼");
  });

  it("collapses a whitespace run in aria-label, aria-labelledby, label, alt, title and placeholder", () => {
    document.body.innerHTML =
      '<button aria-label="  Save \n  draft ">x</button>' +
      '<span id="l">Full \n   name</span><input aria-labelledby="l">' +
      '<label for="e">Work \n  email</label><input id="e">' +
      '<img alt="A  \n cat">' +
      '<a href="#" title="Go\t\n home">x</a>' +
      '<input placeholder="Search \n   orders">';
    const q = (sel: string): Element => document.querySelector(sel) as Element;
    expect(getName(q("button"))).toBe("Save draft");
    expect(getName(q("input[aria-labelledby]"))).toBe("Full name");
    expect(getName(q("#e"))).toBe("Work email");
    expect(getName(q("img"))).toBe("A cat");
    expect(getName(q("a"))).toBe("Go home");
    expect(getName(q("input[placeholder]"))).toBe("Search orders");
  });

  it("applies the 120-character cut after the collapse", () => {
    const words = Array.from({ length: 60 }, () => "ab").join("   \n   ");
    document.body.innerHTML = `<div>${words}</div>`;
    const name = getName(document.querySelector("div") as Element);
    expect(name).toBe(Array.from({ length: 60 }, () => "ab").join(" ").slice(0, 120) + "…");
  });
});

describe("getName skips style, script and hidden text (rec 001)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const OPTION_SHADOW =
    "<style>:host { display: block; } :host([hidden]) { display: none; }</style>" +
    '<input type="checkbox"><span part="label"><slot></slot></span>';

  function optionList(): Element[] {
    document.body.innerHTML =
      '<div role="listbox" aria-label="Country">' +
      '<x-option role="option">US</x-option>' +
      '<x-option role="option">HK</x-option>' +
      '<x-option role="option">EU</x-option>' +
      "</div>";
    const opts = Array.from(document.querySelectorAll("x-option"));
    for (const o of opts) o.attachShadow({ mode: "open" }).innerHTML = OPTION_SHADOW;
    return opts;
  }

  it("names a shadow-root option by its slotted text, without the CSS", () => {
    const opts = optionList();
    expect(describeElementParts(opts[1])).toEqual({ role: "option", name: "HK" });
    expect(getName(opts[0])).toBe("US");
    expect(getName(opts[2])).toBe("EU");
  });

  it("adds no text from script, template or noscript children of a button or a div", () => {
    for (const tag of ["button", "div"]) {
      const el = document.createElement(tag);
      el.innerHTML = "<script>var a = 1;</script><noscript>Enable JavaScript</noscript>";
      // innerHTML puts template children into .content; append directly so the
      // <template> element has a real child text node, as a live page can.
      const tpl = document.createElement("template");
      tpl.appendChild(document.createTextNode("Template text"));
      el.appendChild(tpl);
      el.appendChild(document.createTextNode("Save"));
      document.body.appendChild(el);
      expect(getName(el)).toBe("Save");
    }
  });

  it("adds no text from hidden or aria-hidden=true descendants, but keeps aria-hidden=false", () => {
    document.body.innerHTML =
      '<button id="b1"><span hidden>Secret</span><span aria-hidden="true">★</span>Apply</button>' +
      '<button id="b2"><span aria-hidden="false">Go</span></button>';
    expect(getName(document.getElementById("b1") as Element)).toBe("Apply");
    expect(getName(document.getElementById("b2") as Element)).toBe("Go");
  });

  it("skips an aria-hidden=true element slotted into a shadow root", () => {
    document.body.innerHTML = '<x-option role="option"><span aria-hidden="true">✓</span>HK</x-option>';
    const host = document.querySelector("x-option") as Element;
    host.attachShadow({ mode: "open" }).innerHTML = OPTION_SHADOW;
    expect(getName(host)).toBe("HK");
  });

  it("still names an element that is itself aria-hidden=true or hidden", () => {
    document.body.innerHTML = '<button aria-hidden="true">Close</button><div hidden>Panel</div>';
    expect(getName(document.querySelector("button") as Element)).toBe("Close");
    expect(getName(document.querySelector("div") as Element)).toBe("Panel");
  });

  it("uses a slot's fallback content when nothing is assigned, and the assigned text otherwise", () => {
    const empty = document.createElement("x-label");
    empty.attachShadow({ mode: "open" }).innerHTML = "<span><slot>Default label</slot></span>";
    const filled = document.createElement("x-label");
    filled.textContent = "Custom";
    filled.attachShadow({ mode: "open" }).innerHTML = "<span><slot>Default label</slot></span>";
    document.body.append(empty, filled);
    expect(getName(empty)).toBe("Default label");
    expect(getName(filled)).toBe("Custom");
  });

  it("skips a style element inside a role=button custom element's shadow root", () => {
    // A native <button> cannot have a shadow root (jsdom throws NotSupportedError),
    // so this uses a custom element with role="button".
    const host = document.createElement("x-button");
    host.setAttribute("role", "button");
    host.attachShadow({ mode: "open" }).innerHTML = "<style>:host { color: red; }</style><slot></slot>";
    host.textContent = "Buy";
    document.body.appendChild(host);
    expect(getName(host)).toBe("Buy");
  });
});
