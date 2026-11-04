import { describe, it, expect, beforeEach } from "vitest";
import {
  normalize,
  nameMatches,
  queryAllPierce,
  isHiddenForAria,
  pwElementText,
  matchByText,
  matchByLabel,
  matchByAttribute,
  matchByTestId,
  matchByRole,
  stableName,
} from "./playwright-match";

describe("playwright-match", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("normalize and nameMatches", () => {
    expect(normalize("  Order\n summary ")).toBe("order summary");
    expect(nameMatches("  Order\n summary ", "order SUMMARY")).toBe(true);
    expect(nameMatches("Apply", "Place")).toBe(false);
  });

  it("queryAllPierce lists light DOM then open shadow content", () => {
    document.body.innerHTML = '<div id="h"></div><p id="p"></p>';
    const host = document.getElementById("h");
    const shadow = host?.attachShadow({ mode: "open" });
    if (shadow) {
      shadow.innerHTML = '<span id="s"></span>';
    }
    const elements = queryAllPierce(document);
    const ids = elements.map((e) => e.id).filter((id) => !!id);
    expect(ids).toEqual(["h", "p", "s"]);
  });

  it("queryAllPierce skip prunes a subtree", () => {
    document.body.innerHTML = '<div id="main"><p id="content"></p></div><div id="agent"><span id="agent-child"></span></div>';
    const agent = document.getElementById("agent");
    const elements = queryAllPierce(document, (el) => !!agent && (el === agent || agent.contains(el)));
    const ids = elements.map((e) => e.id);
    expect(ids).toContain("main");
    expect(ids).toContain("content");
    expect(ids).not.toContain("agent");
    expect(ids).not.toContain("agent-child");
  });

  it("isHiddenForAria", () => {
    document.body.innerHTML = `
      <button id="plain">Plain</button>
      <button id="hidden-attr" hidden>Hidden attr</button>
      <div id="parent-hidden" style="display:none">
        <button id="child-display-none">Child</button>
      </div>
      <div id="parent-aria-hidden" aria-hidden="true">
        <button id="child-aria-hidden">Child aria</button>
      </div>
      <button id="vis-hidden" style="visibility:hidden">Vis hidden</button>
      <script id="script-el">console.log(1);</script>
    `;

    expect(isHiddenForAria(document.getElementById("plain")!)).toBe(false);
    expect(isHiddenForAria(document.getElementById("hidden-attr")!)).toBe(true);
    expect(isHiddenForAria(document.getElementById("child-display-none")!)).toBe(true);
    expect(isHiddenForAria(document.getElementById("child-aria-hidden")!)).toBe(true);
    expect(isHiddenForAria(document.getElementById("vis-hidden")!)).toBe(true);
    expect(isHiddenForAria(document.getElementById("script-el")!)).toBe(true);
  });

  it("pwElementText", () => {
    document.body.innerHTML = `
      <input type="submit" id="sub" value="Go">
      <p id="comment-test">a<!--c--><b>b</b></p>
    `;
    expect(pwElementText(document.getElementById("sub")!)).toBe("Go");
    expect(pwElementText(document.getElementById("comment-test")!)).toBe("ab");
  });

  it("matchByText returns only the innermost match", () => {
    document.body.innerHTML = '<div id="outer"><p id="inner">Discount: -$4.20</p></div>';
    const matches = matchByText(document, "Discount: -$4.20");
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("inner");
  });

  it("matchByLabel follows Playwright label precedence", () => {
    document.body.innerHTML = `
      <label for="inp">Beta</label>
      <input id="inp" aria-label="Alpha">
    `;
    expect(matchByLabel(document, "Beta")).toEqual([]);
    const matches = matchByLabel(document, "alpha");
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("inp");
  });

  it("matchByAttribute does not collapse whitespace", () => {
    document.body.innerHTML = '<input id="inp" placeholder="a  b">';
    expect(matchByAttribute(document, "placeholder", "a  b")).toHaveLength(1);
    expect(matchByAttribute(document, "placeholder", "a b")).toHaveLength(0);
  });

  it("matchByTestId is exact", () => {
    document.body.innerHTML = '<button data-testid="icon-action"></button>';
    expect(matchByTestId(document, "icon")).toHaveLength(0);
    expect(matchByTestId(document, "icon-action")).toHaveLength(1);
  });

  it("matchByRole skips hidden elements", () => {
    document.body.innerHTML = `
      <button hidden>Apply</button>
      <button id="visible-btn">Apply</button>
    `;
    const matches = matchByRole(document, "button", "Apply");
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("visible-btn");
  });

  describe("stableName (002)", () => {
    const named = (html: string, selector: string, role: string): string => {
      document.body.innerHTML = html;
      const el = document.querySelector(selector)!;
      return stableName(el, document, role, el.textContent.replace(/\s+/g, " ").trim());
    };

    it("count", () => {
      expect(named('<a href="#c">Cart <span>5</span></a>', "a", "link")).toBe("Cart");
    });

    it("glyph", () => {
      expect(named("<table><tr><th>Date <span>▼</span></th></tr></table>", "th", "columnheader")).toBe("Date");
    });

    it("hash token", () => {
      expect(named('<a href="#c">Order #1234</a>', "a", "link")).toBe("Order");
    });

    it("hash token, ambiguous", () => {
      expect(named('<a href="#c" id="t">Order #1234</a><a href="#d">Order #1235</a>', "#t", "link")).toBe("Order #1234");
    });

    it("stops at the first token with no letter", () => {
      expect(named('<a href="#c">Page 2 of 5</a>', "a", "link")).toBe("Page");
    });

    it("ambiguous, same role", () => {
      expect(named('<button id="t">Item 1</button><button>Item 2</button>', "#t", "button")).toBe("Item 1");
    });

    it("case-insensitive clash", () => {
      expect(named('<a href="#c" id="t">Cart 5</a><a href="#d">cart page</a>', "#t", "link")).toBe("Cart 5");
    });

    it("other role does not clash", () => {
      expect(named('<a href="#c">Cart 5</a><button>Cart</button>', "a", "link")).toBe("Cart");
    });

    it("first token has no letter", () => {
      expect(named("<button>5 items</button>", "button", "button")).toBe("5 items");
    });

    it("no changing token", () => {
      expect(named("<button>Add to cart</button>", "button", "button")).toBe("Add to cart");
    });

    it("non-Latin letters", () => {
      expect(named('<a href="#c">Заказ №5</a>', "a", "link")).toBe("Заказ");
    });

    it("hidden element", () => {
      expect(named('<a href="#c" hidden>Cart 5</a>', "a", "link")).toBe("Cart 5");
    });

    it("empty role and empty name", () => {
      document.body.innerHTML = "<button>Cart 5</button>";
      const btn = document.querySelector("button")!;
      expect(stableName(btn, document, "", "Cart 5")).toBe("Cart 5");
      expect(stableName(btn, document, "button", "")).toBe("");
    });

    it("open shadow root", () => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = host.attachShadow({ mode: "open" });
      const btn = document.createElement("button");
      btn.textContent = "Buy 5";
      root.appendChild(btn);
      expect(stableName(btn, document, "button", "Buy 5")).toBe("Buy");
    });

    it("closed shadow root", () => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = host.attachShadow({ mode: "closed" });
      const btn = document.createElement("button");
      btn.textContent = "Buy 5";
      root.appendChild(btn);
      expect(stableName(btn, document, "button", "Buy 5")).toBe("Buy 5");
    });
  });
});
