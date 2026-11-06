import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { locatorSet, stepLocatorSet, journalTarget, cssSegment, xpathSegment, xpathLiteral } from "./locator-builder";

beforeAll(() => {
  // jsdom 24 has no CSS.escape. This minimal escape matches the spec for the
  // identifiers these tests use.
  if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
    (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = {
      escape: (s: string) => s.replace(/([^a-zA-Z0-9_-])/g, "\\$1"),
    };
  }
});

const CHECKOUT_BODY = `
  <main id="checkout">
    <h1>Checkout</h1>
    <p><a href="http://localhost:10040/cart.html">Back to cart</a></p>

    <div id="cart-summary" aria-label="Cart">
      <span>1 item</span> — <span>$42.00</span>
    </div>

    <form id="checkout-form">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" autocomplete="email" required />

      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required />

      <label for="shipping">Shipping</label>
      <select id="shipping" name="shipping">
        <option value="standard">Standard (3-5 days) — free</option>
        <option value="express">Express (next day) — $9.99</option>
        <option value="overnight">Overnight — $19.99</option>
      </select>

      <label for="extras">Extras</label>
      <select id="extras" name="extras" multiple size="3">
        <option value="gift-wrap">Gift wrap</option>
        <option value="card">Card</option>
        <option value="insurance">Insurance</option>
      </select>

      <label for="coupon">Coupon</label>
      <input type="text" id="coupon" name="coupon" placeholder="e.g. SAVE10" />
      <button type="button" id="apply-btn">Apply</button>
      <span id="coupon-status"></span>

      <button
        type="button"
        id="place-order-btn"
        data-agent-permission="ask"
        data-agent-permission-reason="Charges the customer's card"
      >Place order</button>
    </form>

    <div id="icon-actions">
      <button type="button" id="icon-action-1" data-testid="icon-action"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h12M8 2v12" stroke="currentColor" stroke-width="2"/></svg></button>
      <button type="button" id="icon-action-2" data-testid="icon-action"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h12" stroke="currentColor" stroke-width="2"/></svg></button>
    </div>

    <button type="button" id="clear-cards-btn" hidden>Clear saved cards</button>

    <ul aria-label="Order summary">
      <li>Coupon</li>
      <li>Shipping</li>
      <li>Total</li>
    </ul>
  </main>

  <script>
    document.getElementById("apply-btn").addEventListener("click", () => {
      const code = document.getElementById("coupon").value.trim();
      const status = document.getElementById("coupon-status");
      if (!code) {
        status.textContent = "";
        return;
      }
      status.textContent = code === "SAVE10" ? "Discount: -$4.20" : "Coupon not valid";
    });

    document.getElementById("place-order-btn").addEventListener("click", () => {
      document.getElementById("coupon-status").textContent = "Order placed.";
    });
  </script>
`;

describe("locator-builder", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("1. Unique id", () => {
    document.body.innerHTML = '<main><button id="apply-btn">Apply</button></main>';
    const btn = document.querySelector("button")!;
    const set = locatorSet(btn, document);
    expect(set).toEqual({
      role: "button",
      name: "Apply",
      roleMatches: 1,
      id: "apply-btn",
      css: "#apply-btn",
      xpath: "//*[@id='apply-btn']",
    });
  });

  it("2. Duplicate id is dropped; relative walk exit", () => {
    document.body.innerHTML = '<button id="dup">A</button><button id="dup">B</button>';
    const btn = document.querySelectorAll("button")[1];
    const set = locatorSet(btn, document);
    expect(set.id).toBeUndefined();
    expect(set.css).toBe("button:nth-of-type(2)");
    expect(set.xpath).toBe("/html/body[1]/button[2]");
  });

  it("3. data-testid shortcut", () => {
    document.body.innerHTML = '<button data-testid="save">Save</button>';
    const btn = document.querySelector("button")!;
    const set = locatorSet(btn, document);
    expect(set.testId).toBe("save");
    expect(set.css).toBe('[data-testid="save"]');
    expect(set.xpath).toBe("/html/body[1]/button[1]");
  });

  it("4. Duplicate data-testid is dropped", () => {
    document.body.innerHTML = '<button id="i1" data-testid="icon"></button><button id="i2" data-testid="icon"></button>';
    const btn = document.getElementById("i2")!;
    const set = locatorSet(btn, document);
    expect(set.testId).toBeUndefined();
    expect(set.id).toBe("i2");
    expect(set.css).toBe("#i2");
  });

  it("5. name attribute", () => {
    document.body.innerHTML = '<input name="coupon" aria-label="Coupon"><input name="q" aria-label="A"><input name="q" aria-label="B">';
    const inputs = document.querySelectorAll("input");
    expect(locatorSet(inputs[0], document).nameAttr).toBe("coupon");
    expect(locatorSet(inputs[2], document).nameAttr).toBeUndefined();
  });

  it("6. Ancestor id anchor", () => {
    document.body.innerHTML = '<div id="cards"><div><button>Add</button></div><div><button>Add</button></div></div>';
    const btn = document.querySelectorAll("button")[1];
    const set = locatorSet(btn, document);
    expect(set.css).toBe("#cards > div:nth-of-type(2) > button:nth-of-type(1)");
    expect(set.xpath).toBe("//*[@id='cards']/div[2]/button[1]");
    expect(set.roleMatches).toBe(2);
  });

  it("7. html anchor", () => {
    document.body.innerHTML =
      '<section><section></section><section><p><a href="#a">Go</a></p></section></section><section><p><a href="#b">Go</a></p></section>';
    const link = document.querySelector('a[href="#b"]')!;
    const set = locatorSet(link, document);
    expect(set.css).toBe("html > body:nth-of-type(1) > section:nth-of-type(2) > p:nth-of-type(1) > a:nth-of-type(1)");
    expect(set.xpath).toBe("/html/body[1]/section[2]/p[1]/a[1]");
  });

  it("8. Every walked selector really matches only the target", () => {
    const checks = [
      () => {
        document.body.innerHTML = '<button id="dup">A</button><button id="dup">B</button>';
        return { target: document.querySelectorAll("button")[1], set: locatorSet(document.querySelectorAll("button")[1], document) };
      },
      () => {
        document.body.innerHTML = '<button data-testid="save">Save</button>';
        return { target: document.querySelector("button")!, set: locatorSet(document.querySelector("button")!, document) };
      },
      () => {
        document.body.innerHTML = '<div id="cards"><div><button>Add</button></div><div><button>Add</button></div></div>';
        return { target: document.querySelectorAll("button")[1], set: locatorSet(document.querySelectorAll("button")[1], document) };
      },
      () => {
        document.body.innerHTML =
          '<section><section></section><section><p><a href="#a">Go</a></p></section></section><section><p><a href="#b">Go</a></p></section>';
        return { target: document.querySelector('a[href="#b"]')!, set: locatorSet(document.querySelector('a[href="#b"]')!, document) };
      },
    ];
    for (const check of checks) {
      const { target, set } = check();
      const cssHits = document.querySelectorAll(set.css!);
      expect(cssHits.length).toBe(1);
      expect(cssHits[0]).toBe(target);
      const xHits = document.evaluate(set.xpath!, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      expect(xHits.snapshotLength).toBe(1);
      expect(xHits.snapshotItem(0)).toBe(target);
    }
  });

  it("9. roleMatches is the real count; hidden duplicates do not count", () => {
    document.body.innerHTML = '<button>Add to cart</button><button>Add to cart</button><button>Add to cart</button><button hidden>Add to cart</button>';
    const btn = document.querySelector("button")!;
    expect(locatorSet(btn, document).roleMatches).toBe(3);
  });

  it("10. Open shadow chain, two levels", () => {
    const card = document.createElement("x-card");
    document.body.appendChild(card);
    const cardRoot = card.attachShadow({ mode: "open" });
    const btnElem = document.createElement("x-btn");
    cardRoot.appendChild(btnElem);
    const btnRoot = btnElem.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    button.textContent = "Buy";
    btnRoot.appendChild(button);

    const set = locatorSet(button, document);
    expect(set.shadow).toEqual(["x-card:nth-of-type(1)", "x-btn:nth-of-type(1)", "button:nth-of-type(1)"]);
    expect(set.css).toBeUndefined();
    expect(set.xpath).toBeUndefined();

    const hits = document.querySelector(set.shadow![0])!.shadowRoot!.querySelector(set.shadow![1])!.shadowRoot!.querySelectorAll(set.shadow![2]);
    expect(hits.length).toBe(1);
    expect(hits[0]).toBe(button);
  });

  it("11. Id inside a shadow root is checked in that root", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<button id="buy">Buy</button>';
    const other = document.createElement("button");
    other.id = "buy";
    other.textContent = "Other";
    document.body.appendChild(other);

    const shadowBtn = root.querySelector("#buy")!;
    const set = locatorSet(shadowBtn, document);
    expect(set.id).toBe("buy");
    expect(set.shadow?.at(-1)).toBe("#buy");
  });

  it("12. A shadow level with no unique CSS drops the chain (uniqueness check)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<div><span><button>x</button></span></div><span><button>y</button></span>';
    const btnY = root.querySelectorAll("button")[1];
    const set = locatorSet(btnY, document);
    expect(set.shadow).toBeUndefined();
    expect(set.css).toBeUndefined();
    expect(set.xpath).toBeUndefined();
    expect(typeof set.roleMatches).toBe("number");
  });

  it("13. Closed shadow root", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "closed" });
    const btn = document.createElement("button");
    btn.textContent = "Hidden";
    root.appendChild(btn);

    const set = locatorSet(btn, document);
    expect(set.shadow).toBeUndefined();
    expect(set.css).toBeUndefined();
    expect(set.xpath).toBeUndefined();
    expect(set.role).toBe("button");
  });

  it("14. Segments", () => {
    document.body.innerHTML = "<button>1</button><button>2</button>";
    const btn2 = document.querySelectorAll("button")[1];
    expect(cssSegment(btn2)).toBe("button:nth-of-type(2)");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svg);
    expect(xpathSegment(svg)).toBe("*[local-name()='svg'][1]");

    const btn1 = document.querySelector("button")!;
    expect(xpathSegment(btn1)).toBe("button[1]");
  });

  it("15. xpathLiteral", () => {
    expect(xpathLiteral("abc")).toBe("'abc'");
    expect(xpathLiteral("it's")).toBe("concat('it', \"'\", 's')");
  });

  it("16. No Playwright text", () => {
    document.body.innerHTML = '<main><button id="apply-btn">Apply</button></main>';
    const set1 = locatorSet(document.querySelector("button")!, document);
    expect(JSON.stringify(set1)).not.toMatch(/getBy|\.nth\(/);

    document.body.innerHTML = '<button id="dup">A</button><button id="dup">B</button>';
    const set2 = locatorSet(document.querySelectorAll("button")[1], document);
    expect(JSON.stringify(set2)).not.toMatch(/getBy|\.nth\(/);

    document.body.innerHTML = '<button data-testid="save">Save</button>';
    const set3 = locatorSet(document.querySelector("button")!, document);
    expect(JSON.stringify(set3)).not.toMatch(/getBy|\.nth\(/);
  });

  it("journalTarget label and no locator property", () => {
    document.body.innerHTML = "<div></div>";
    const div = document.querySelector("div")!;
    const target = journalTarget(div, document, "[1] generic");
    expect(target).not.toHaveProperty("locator");
    expect(target.label).toBe("[1] generic");
  });

  it("journalTarget.isPassword reflects the input type", () => {
    document.body.innerHTML = CHECKOUT_BODY;
    const password = document.getElementById("password")!;
    const email = document.getElementById("email")!;
    expect(journalTarget(password, document, "[1] textbox").isPassword).toBe(true);
    expect(journalTarget(email, document, "[2] textbox").isPassword).toBe(false);
  });

  describe("locatorSet and stepLocatorSet names (002)", () => {
    it("stepLocatorSet uses the stable name; locatorSet keeps the full name", () => {
      document.body.innerHTML = '<a href="#c">Cart <span>5</span></a>';
      const a = document.querySelector("a")!;
      expect(stepLocatorSet(a, document)).toMatchObject({ role: "link", name: "Cart", roleMatches: 1 });
      expect(locatorSet(a, document)).toMatchObject({ role: "link", name: "Cart 5", roleMatches: 1 });
    });

    it("stepLocatorSet keeps the full name when the short name is ambiguous", () => {
      document.body.innerHTML = "<button>Item 1</button><button>Item 2</button>";
      const first = document.querySelector("button")!;
      expect(stepLocatorSet(first, document)).toMatchObject({ role: "button", name: "Item 1", roleMatches: 1 });
    });

    it("journalTarget keeps the full name", () => {
      document.body.innerHTML = '<a href="#c">Cart <span>5</span></a>';
      expect(journalTarget(document.querySelector("a")!, document, "x").name).toBe("Cart 5");
    });
  });

  describe("text locator for a generic element (rec 002)", () => {
    const SECTION = '<div id="docs" onclick="void 0"><span>ALL MATCHED DOCUMENTS <span>8</span></span></div>';

    it("locatorSet fills text and textMatches for a role-less element", () => {
      document.body.innerHTML = SECTION;
      const set = locatorSet(document.getElementById("docs")!, document);
      expect(set).toMatchObject({
        role: "",
        name: "ALL MATCHED DOCUMENTS 8",
        text: "ALL MATCHED DOCUMENTS 8",
        textMatches: 1,
        id: "docs",
      });
    });

    it("stepLocatorSet uses the stable name for both name and text", () => {
      document.body.innerHTML = SECTION;
      const set = stepLocatorSet(document.getElementById("docs")!, document);
      expect(set).toMatchObject({
        role: "",
        name: "ALL MATCHED DOCUMENTS",
        text: "ALL MATCHED DOCUMENTS",
        textMatches: 1,
      });
    });

    it("a named element gets no text fields", () => {
      document.body.innerHTML = '<button id="go">Apply</button>';
      const set = locatorSet(document.getElementById("go")!, document);
      expect(set).not.toHaveProperty("text");
      expect(set).not.toHaveProperty("textMatches");
    });

    it("a nameless role-less element gets no text fields", () => {
      document.body.innerHTML = '<div id="tile"></div>';
      const set = locatorSet(document.getElementById("tile")!, document);
      expect(set).not.toHaveProperty("text");
      expect(set).toMatchObject({ role: "", name: "" });
    });
  });
});
