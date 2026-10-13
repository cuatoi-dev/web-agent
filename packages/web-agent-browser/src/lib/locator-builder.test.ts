import { describe, it, expect, beforeEach } from "vitest";
import { buildLocator, escapeLiteral, journalLocator, journalTarget } from "./locator-builder";

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

  it("Apply → getByRole", () => {
    document.body.innerHTML = CHECKOUT_BODY;
    const applyBtn = document.getElementById("apply-btn")!;
    expect(buildLocator(applyBtn, document)).toEqual({
      ok: true,
      line: "page.getByRole('button', { name: 'Apply' }) — matches 1 element",
    });
  });

  it("Coupon → getByRole textbox", () => {
    document.body.innerHTML = CHECKOUT_BODY;
    const couponInput = document.getElementById("coupon")!;
    expect(buildLocator(couponInput, document)).toEqual({
      ok: true,
      line: "page.getByRole('textbox', { name: 'Coupon' }) — matches 1 element",
    });
  });

  it("second icon button → getByTestId nth(1)", () => {
    document.body.innerHTML = CHECKOUT_BODY;
    const btn1 = document.getElementById("icon-action-1")!;
    const btn2 = document.getElementById("icon-action-2")!;
    expect(buildLocator(btn1, document)).toEqual({
      ok: true,
      line: "page.getByTestId('icon-action').nth(0) — matches 1 element (by position)",
    });
    expect(buildLocator(btn2, document)).toEqual({
      ok: true,
      line: "page.getByTestId('icon-action').nth(1) — matches 1 element (by position)",
    });
  });

  it("hidden duplicate does not break role uniqueness", () => {
    document.body.innerHTML = CHECKOUT_BODY;
    const applyBtn = document.getElementById("apply-btn")!;
    const hiddenBtn = document.createElement("button");
    hiddenBtn.textContent = "Apply";
    hiddenBtn.hidden = true;
    applyBtn.parentElement!.insertBefore(hiddenBtn, applyBtn);

    expect(buildLocator(applyBtn, document)).toEqual({
      ok: true,
      line: "page.getByRole('button', { name: 'Apply' }) — matches 1 element",
    });
  });

  it("label candidate when the element has no role", () => {
    document.body.innerHTML = '<label for="m">Size</label><meter id="m"></meter>';
    const meter = document.getElementById("m")!;
    expect(buildLocator(meter, document)).toEqual({
      ok: true,
      line: "page.getByLabel('Size') — matches 1 element",
    });
  });

  it("aria-label gives no label candidate", () => {
    document.body.innerHTML = '<label for="a">Code</label><input id="a" aria-label="Promo"><input aria-label="Promo">';
    const inputA = document.getElementById("a")!;
    expect(buildLocator(inputA, document)).toEqual({
      ok: true,
      line: "page.getByRole('textbox', { name: 'Promo' }).nth(0) — matches 1 element (by position)",
    });
  });

  it("text candidate", () => {
    document.body.innerHTML = '<div id="target">Only here</div><p>Other</p>';
    const target = document.getElementById("target")!;
    expect(buildLocator(target, document)).toEqual({
      ok: true,
      line: "page.getByText('Only here') — matches 1 element",
    });
  });

  it("no candidate", () => {
    document.body.innerHTML = '<div id="target"></div>';
    const target = document.getElementById("target")!;
    expect(buildLocator(target, document)).toEqual({
      ok: false,
    });
  });

  it("escapeLiteral", () => {
    expect(escapeLiteral("it's a \\ path")).toBe("it\\'s a \\\\ path");
    document.body.innerHTML = "<button id=\"b\">O'Brien</button>";
    const btn = document.getElementById("b")!;
    const res = buildLocator(btn, document);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.line).toContain("name: 'O\\'Brien'");
    }
  });

  it("journalLocator: Apply button is the same text buildLocator returns after page. and before  — ", () => {
    document.body.innerHTML = CHECKOUT_BODY;
    const applyBtn = document.getElementById("apply-btn")!;
    expect(journalLocator(applyBtn, document)).toBe("getByRole('button', { name: 'Apply' })");
  });

  it("journalLocator matches buildLocator's line for every element the other tests use", () => {
    document.body.innerHTML = CHECKOUT_BODY;
    const els = [
      document.getElementById("apply-btn")!,
      document.getElementById("coupon")!,
      document.getElementById("icon-action-1")!,
      document.getElementById("icon-action-2")!,
    ];
    for (const el of els) {
      const built = buildLocator(el, document);
      expect(built.ok).toBe(true);
      if (!built.ok) continue;
      const source = journalLocator(el, document);
      const expected = /\.nth\(\d+\)$/.test(source ?? "")
        ? `page.${source} — matches 1 element (by position)`
        : `page.${source} — matches 1 element`;
      expect(built.line).toBe(expected);
    }
  });

  it("no candidate: journalLocator is undefined, journalTarget has no locator", () => {
    document.body.innerHTML = "<div></div>";
    const div = document.querySelector("div")!;
    expect(journalLocator(div, document)).toBeUndefined();
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
});
