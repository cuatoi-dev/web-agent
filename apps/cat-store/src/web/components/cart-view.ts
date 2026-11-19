import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import "@material/web/button/filled-button.js";
import "@material/web/iconbutton/icon-button.js";
import { store } from "../store";
import { selectCart, setQty, removeFromCart, clearCart, selectCartDiscount } from "../store/cart-slice";
import { placeOrder, setToast } from "../store/ui-slice";
import { createOrder } from "../orders-backend/backend";
import { navigate } from "../router";

@customElement("cart-view")
export class CartView extends LitElement {
  static styles = css`
    :host {
      display: block;
      max-width: 680px;
    }
    input, button, textarea, select, option {
      font-family: inherit;
    }
    md-icon-button span {
      font-family: inherit;
    }
    h2 {
      margin: 0 0 var(--wa-padding-xl, 16px);
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: var(--wa-padding-m, 8px) var(--wa-padding-l, 12px);
      text-align: left;
      border-bottom: 1px solid var(--wa-border-color, #ddd);
    }
    th {
      background: var(--wa-background-color-700, #eee);
      font-weight: 600;
    }
    .qty-stepper {
      display: flex;
      align-items: center;
      gap: var(--wa-padding-s, 4px);
    }
    .qty-stepper button {
      width: 28px;
      height: 28px;
      border: 1px solid var(--wa-button-border-color, #ccc);
      border-radius: var(--wa-border-radius-m, 4px);
      background: var(--wa-button-background-color, #f5f5f5);
      color: var(--wa-button-text-color, #222);
      cursor: pointer;
      font-size: 1.1em;
      line-height: 1;
      padding: 0;
    }
    .qty-stepper button:hover {
      background: var(--wa-button-background-color-hover, #e0e0e0);
      color: var(--wa-button-text-color-hover, #222);
    }
    .qty-val {
      min-width: 28px;
      text-align: center;
    }
    .totals {
      margin-top: var(--wa-padding-xl, 16px);
      text-align: right;
      font-size: 1.1em;
    }
    .totals .line {
      margin: var(--wa-padding-s, 4px) 0;
    }
    .totals .grand {
      font-weight: 700;
      font-size: 1.2em;
    }
    .actions {
      margin-top: var(--wa-padding-xl, 16px);
      display: flex;
      justify-content: flex-end;
      gap: var(--wa-padding-l, 12px);
    }
    .empty {
      text-align: center;
      padding: 48px var(--wa-padding-xl, 16px);${/* eslint-disable-line wa/no-raw-spacing -- 48px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ css``}
      color: var(--wa-text-color-disabled, #888);
    }
    .empty p {
      font-size: 1.1em;
    }
    .promo-badge {
      display: inline-block;
      margin-left: var(--wa-padding-m, 8px);
      padding: var(--wa-padding-xs, 2px) 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ css``}
      border-radius: var(--wa-border-radius-m, 4px);
      background: var(--wa-action-color-success-10opc, #d4edda);
      color: var(--wa-action-color-success, #155724);
      font-size: 0.75em;
      font-weight: 600;
    }
    .totals .discount {
      color: var(--wa-action-color-success, #155724);
      font-weight: 600;
    }
  `;

  @state()
  private _cart = selectCart(store.getState());

  @state()
  private _discount = selectCartDiscount(store.getState());

  private _unsub?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this._unsub = store.subscribe(() => {
      this._cart = selectCart(store.getState());
      this._discount = selectCartDiscount(store.getState());
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
  }

  private _decrement(productId: string, qty: number) {
    if (qty > 1) {
      store.dispatch(setQty({ productId, qty: qty - 1 }));
    } else {
      store.dispatch(removeFromCart({ productId }));
    }
  }

  private _increment(productId: string, qty: number) {
    store.dispatch(setQty({ productId, qty: qty + 1 }));
  }

  private _remove(productId: string) {
    store.dispatch(removeFromCart({ productId }));
  }

  private async _placeOrder() {
    const cart = store.getState().cart;
    let created;
    try {
      created = await createOrder({
        total: cart.total,
        itemCount: cart.items.reduce((n: number, i: { qty: number }) => n + i.qty, 0),
        items: cart.items.map((i: { name: string }) => i.name).join(", "),
      });
    } catch {
      store.dispatch(setToast("Order failed"));
      return;
    }
    store.dispatch(placeOrder({ id: created.id, total: created.total }));
    store.dispatch(clearCart());
    // Async toast — target for wait_for
    setTimeout(() => {
      store.dispatch(setToast("Order confirmed"));
    }, 800);
  }

  private _continueShopping() {
    navigate("/store");
  }

  render() {
    if (this._cart.items.length === 0) {
      return html`
        <div class="empty">
          <p>Your cart is empty 🐱</p>
          <md-filled-button @click=${() => this._continueShopping()}>
            Continue shopping
          </md-filled-button>
        </div>
      `;
    }

    return html`
      <h2>Shopping Cart</h2>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Price</th>
            <th>Qty</th>
            <th>Free</th>
            <th>Subtotal</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this._cart.items.map(
            (item) => html`
              <tr>
                <td>${item.name}${item.freeQty > 0 ? html`<span class="promo-badge">${item.freeQty} free</span>` : ""}</td>
                <td>$${item.price.toFixed(2)}</td>
                <td>
                  <div class="qty-stepper">
                    <button
                      class="qty-dec"
                      aria-label="Decrease quantity of ${item.name}"
                      data-agent-permission-reason="Decrementing to zero removes the item — confirm with the shopper."
                      data-agent-permission=${item.qty === 1 ? "ask" : nothing}
                      @click=${() => this._decrement(item.productId, item.qty)}
                    >−</button>
                    <span class="qty-val">${item.qty}</span>
                    <button
                      class="qty-inc"
                      aria-label="Increase quantity of ${item.name}"
                      @click=${() => this._increment(item.productId, item.qty)}
                    >+</button>
                  </div>
                </td>
                <td>${item.freeQty > 0 ? String(item.freeQty) : ""}</td>
                <td>$${(item.price * item.qty).toFixed(2)}</td>
                <td>
                  <md-icon-button
                    aria-label="Remove ${item.name}"
                    data-agent-permission="ask"
                    data-agent-permission-reason="Removing an item from the cart — ask the shopper to confirm."
                    @click=${() => this._remove(item.productId)}
                  >
                    <span>✕</span>
                  </md-icon-button>
                </td>
              </tr>
            `
          )}
        </tbody>
      </table>
      <div class="totals">
        <div class="line">Subtotal: <strong>$${this._cart.subtotal.toFixed(2)}</strong></div>
        ${this._discount > 0 ? html`
          <div class="line discount">
            Promo discount: <strong>−$${this._discount.toFixed(2)}</strong>
          </div>` : ""}
        <div class="line grand">Total: <strong>$${this._cart.total.toFixed(2)}</strong></div>
      </div>
      <div class="actions">
        <md-filled-button
          data-agent-permission="block"
          data-agent-permission-reason="Placing an order is irreversible — ask the shopper to confirm checkout themselves."
          @click=${() => this._placeOrder()}
        >Place order</md-filled-button>
      </div>
    `;
  }
}
