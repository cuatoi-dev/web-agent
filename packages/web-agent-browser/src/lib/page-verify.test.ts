import { describe, it, expect, beforeEach } from "vitest";
import { runVerify } from "./page-verify";
import type { VerifyAdapter } from "./types";

const AGENT_UI_SELECTOR = "web-agent-bubble, [data-agent-ui]";

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

/** 131/002 — the panel now resolves a ref to its element before calling
 *  runVerify, so the test adapter carries the already-resolved element
 *  directly instead of a ref table to look it up from. */
function adapterFor(el: Element): VerifyAdapter {
  return { agentUiSelector: AGENT_UI_SELECTOR, el };
}

describe("page-verify", () => {
  beforeEach(() => {
    document.body.innerHTML = CHECKOUT_BODY;
  });

  it("S1: text_visible PASS after SAVE10", () => {
    document.getElementById("coupon-status")!.textContent = "Discount: -$4.20";
    const res = runVerify({ kind: "text_visible", text: "Discount: -$4.20" }, adapterFor(document.documentElement), document);
    expect(res).toEqual({
      text: 'PASS text "Discount: -$4.20" is visible.',
      isError: false,
    });
  });

  it("S2: text_visible FAIL, text absent", () => {
    const res = runVerify({ kind: "text_visible", text: "Enter a code" }, adapterFor(document.documentElement), document);
    expect(res).toEqual({
      text: 'FAIL expected text "Enter a code" to be visible; found no matching text.',
      isError: false,
    });
  });

  it("S3: text_visible ignores hidden text, agent UI and script source", () => {
    const agentDiv = document.createElement("div");
    agentDiv.setAttribute("data-agent-ui", "true");
    agentDiv.textContent = "Enter a code";
    document.body.appendChild(agentDiv);

    const hiddenP = document.createElement("p");
    hiddenP.style.display = "none";
    hiddenP.textContent = "Enter a code";
    document.body.appendChild(hiddenP);

    const adapter = adapterFor(document.documentElement);
    const res1 = runVerify({ kind: "text_visible", text: "Enter a code" }, adapter, document);
    expect(res1).toEqual({
      text: 'FAIL expected text "Enter a code" to be visible; found no matching text.',
      isError: false,
    });

    const res2 = runVerify({ kind: "text_visible", text: "Coupon not valid" }, adapter, document);
    expect(res2).toEqual({
      text: 'FAIL expected text "Coupon not valid" to be visible; found no matching text.',
      isError: false,
    });
  });

  it("S4: value PASS", () => {
    const coupon = document.getElementById("coupon") as HTMLInputElement;
    coupon.value = "SAVE10";

    const res = runVerify({ kind: "value", ref: "2", value: "SAVE10" }, adapterFor(coupon), document);
    expect(res).toMatchObject({
      text: 'PASS [2] textbox "Coupon" has value "SAVE10".',
      isError: false,
      target: {
        role: "textbox",
        name: "Coupon",
        label: '[2] textbox "Coupon"',
        locator: "getByRole('textbox', { name: 'Coupon' })",
        isPassword: false,
      },
    });
  });

  it("S5: value FAIL", () => {
    const coupon = document.getElementById("coupon") as HTMLInputElement;
    coupon.value = "SAVE10";

    const res = runVerify({ kind: "value", ref: "2", value: "SAVE1" }, adapterFor(coupon), document);
    expect(res).toEqual({
      text: 'FAIL expected [2] textbox "Coupon" to have value "SAVE1"; found "SAVE10".',
      isError: false,
    });
  });

  it("S7: element_visible by role+name PASS", () => {
    const res = runVerify({ kind: "element_visible", role: "button", name: "Apply" }, adapterFor(document.documentElement), document);
    expect(res).toMatchObject({
      text: 'PASS button "Apply" is visible.',
      isError: false,
      target: {
        role: "button",
        name: "Apply",
        label: 'button "Apply"',
        locator: "getByRole('button', { name: 'Apply' })",
      },
    });
  });

  it("S8: element_visible none visible", () => {
    const res = runVerify(
      { kind: "element_visible", role: "button", name: "Clear saved cards" },
      adapterFor(document.documentElement),
      document,
    );
    expect(res).toEqual({
      text: 'FAIL expected button "Clear saved cards" to be visible; found 1 matching, none visible.',
      isError: false,
    });
  });

  it("S9: element_visible no match", () => {
    const res = runVerify({ kind: "element_visible", role: "button", name: "Nope" }, adapterFor(document.documentElement), document);
    expect(res).toEqual({
      text: 'FAIL expected button "Nope" to be visible; found no matching element.',
      isError: false,
    });
  });

  it("S11: list by role+name PASS and FAIL", () => {
    const adapter = adapterFor(document.documentElement);
    const passRes = runVerify(
      { kind: "list", role: "list", name: "Order summary", items: ["Coupon", "Total"] },
      adapter,
      document,
    );
    expect(passRes).toMatchObject({
      text: 'PASS list "Order summary" shows all 2 items.',
      isError: false,
      target: {
        role: "list",
        name: "Order summary",
        label: 'list "Order summary"',
        locator: "getByRole('list', { name: 'Order summary' })",
      },
    });

    const failRes = runVerify(
      { kind: "list", role: "list", name: "Order summary", items: ["Refund"] },
      adapter,
      document,
    );
    expect(failRes).toEqual({
      text: 'FAIL expected list "Order summary" to show "Refund"; not found.',
      isError: false,
    });
  });

  it("S12: list, no list found", () => {
    const res = runVerify({ kind: "list", role: "list", name: "Nope", items: ["Coupon"] }, adapterFor(document.documentElement), document);
    expect(res).toEqual({
      text: 'FAIL expected list "Nope" to be visible; found no matching element.',
      isError: false,
    });
  });
});
