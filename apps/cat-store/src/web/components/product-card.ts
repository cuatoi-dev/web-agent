import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import "@material/web/button/filled-button.js";
import type { ProductItem } from "../store/seed";
import { store } from "../store";
import { addToCart } from "../store/cart-slice";

@customElement("product-card")
export class ProductCard extends LitElement {
  static styles = css`
    :host {
      display: block;
      border: 1px solid var(--wa-border-color, #ddd);
      border-radius: var(--wa-border-radius-l, 8px);
      padding: var(--wa-padding-l, 12px);
      background: var(--wa-smart-list-background-color, #fff);
      text-align: center;
    }
    input, button, textarea, select, option {
      font-family: inherit;
    }
    .emoji {
      font-size: 2.5em;
    }
    .name {
      font-weight: 600;
      margin: var(--wa-padding-m, 8px) 0 var(--wa-padding-s, 4px);
    }
    .category {
      font-size: 0.85em;
      color: var(--wa-text-color-disabled, #888);
    }
    .price {
      font-size: 1.1em;
      color: var(--wa-text-color, #333);
      margin: var(--wa-padding-m, 8px) 0;
    }
    .out-of-stock {
      color: var(--wa-action-color-error, #c00);
      font-size: 0.85em;
    }
    .qty-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--wa-padding-m, 8px);
      margin: var(--wa-padding-m, 8px) 0;
    }
    .qty-row label {
      font-size: 0.9em;
    }
    /* native <input type="number"> — deliberate for agent tool compatibility */
    .qty-row input {
      width: 60px;
      padding: var(--wa-padding-s, 4px);
      border: 1px solid var(--wa-input-border-color, #ccc);
      background: var(--wa-input-background-color, #fff);
      color: var(--wa-input-text-color, #333);
      border-radius: var(--wa-border-radius-m, 4px);
      text-align: center;
    }
  `;

  @property({ type: Object })
  product!: ProductItem;

  @state()
  private _qty = 1;

  private _onQtyInput(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    if (val > 0) this._qty = val;
  }

  private _onQtyChange() {
    this.requestUpdate();
  }

  private _addToCart() {
    if (!this.product.inStock) return;
    store.dispatch(addToCart({ product: this.product, qty: this._qty }));
    this._qty = 1;
  }

  render() {
    const p = this.product;
    return html`
      <div class="emoji">${p.emoji}</div>
      <div class="name">${p.name}</div>
      <div class="category">${p.category}</div>
      <div class="price">$${p.price.toFixed(2)}</div>
      ${p.inStock
        ? html`
            <div class="qty-row">
              <label for="qty-${p.id}">Qty:</label>
              <input
                id="qty-${p.id}"
                type="number"
                min="1"
                .value=${live(String(this._qty))}
                @input=${(e: Event) => this._onQtyInput(e)}
                @change=${() => this._onQtyChange()}
              />
            </div>
            <md-filled-button
              aria-label="Add ${p.name} to cart"
              @click=${() => this._addToCart()}
            >
              Add to cart
            </md-filled-button>
          `
        : html`<div class="out-of-stock">Out of stock</div>`}
    `;
  }
}
