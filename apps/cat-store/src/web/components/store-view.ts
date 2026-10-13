import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { store } from "../store";
import { selectVisibleProducts, selectCategories, setFilterCategory } from "../store/products-slice";
import "./product-card";

@customElement("store-view")
export class StoreView extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    input, button, textarea, select, option {
      font-family: inherit;
    }
    .filter-bar {
      margin-bottom: var(--wa-padding-xl, 16px);
    }
    .filter-bar label {
      margin-right: var(--wa-padding-m, 8px);
      font-weight: 600;
    }
    /* native <select> — deliberate for agent tool compatibility */
    .filter-bar select {
      padding: 6px var(--wa-padding-l, 12px);${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ css``}
      border: 1px solid var(--wa-input-border-color, #ccc);
      background: var(--wa-input-background-color, #fff);
      color: var(--wa-input-text-color, #333);
      border-radius: var(--wa-border-radius-m, 4px);
      font-size: 1em;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: var(--wa-padding-xl, 16px);
    }
  `;

  @state()
  private _products = selectVisibleProducts(store.getState());

  @state()
  private _categories = selectCategories(store.getState());

  @state()
  private _filter = store.getState().products.filterCategory;

  private _unsub?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this._unsub = store.subscribe(() => {
      const s = store.getState();
      this._products = selectVisibleProducts(s);
      this._categories = selectCategories(s);
      this._filter = s.products.filterCategory;
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
  }

  private _onFilterChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    store.dispatch(setFilterCategory(val));
  }

  render() {
    return html`
      <div class="filter-bar">
        <label for="cat-filter">Category:</label>
        <select id="cat-filter" @change=${(e: Event) => this._onFilterChange(e)}>
          <option value="">All</option>
          ${this._categories.map(
            (c) => html`<option value=${c} ?selected=${this._filter === c}>${c}</option>`
          )}
        </select>
      </div>
      <div class="grid">
        ${this._products.map(
          (p) => html`<product-card .product=${p}></product-card>`
        )}
      </div>
    `;
  }
}
