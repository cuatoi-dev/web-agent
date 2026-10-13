import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import "@material/web/button/filled-button.js";
import { queryOrders } from "../orders-backend/backend";
import type { DataQuery, Condition } from "@cuatoi/web-agent-lit";
import { Order } from "../../shared/orders";
import { ordersPageStyles } from "./orders-page.styles";

@customElement("orders-page")
export class OrdersPage extends LitElement {
  static styles = ordersPageStyles;

  @state()
  private search = "";

  @state()
  private filters = {
    status: "all",
    category: "all",
    dateFrom: "",
    dateTo: "",
  };

  @state()
  private sort = {
    field: "createdAt",
    dir: "desc" as "asc" | "desc",
  };

  @state()
  private page = {
    limit: 20,
    offset: 0,
  };

  @state()
  private rows: Order[] = [];

  @state()
  private total = 0;

  @state()
  private loading = false;

  @state()
  private error: string | null = null;

  @state()
  private hasMore = false;

  private _debounceTimer?: ReturnType<typeof setTimeout>;

  connectedCallback() {
    super.connectedCallback();
    void this._load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
  }

  async _load() {
    this.loading = true;
    this.error = null;

    const filterObj: Record<string, Condition> = {};
    if (this.filters.status && this.filters.status !== "all") {
      filterObj.status = this.filters.status;
    }
    if (this.filters.category && this.filters.category !== "all") {
      filterObj.category = this.filters.category;
    }
    if (this.filters.dateFrom || this.filters.dateTo) {
      const low = this.filters.dateFrom ? this.filters.dateFrom + "T00:00:00.000Z" : "1970-01-01T00:00:00.000Z";
      const high = this.filters.dateTo ? this.filters.dateTo + "T23:59:59.999Z" : "2100-01-01T00:00:00.000Z";
      filterObj.createdAt = { $between: [low, high] };
    }

    const query: DataQuery = {
      source: "orders",
      page: {
        limit: this.page.limit,
        offset: this.page.offset,
      },
    };

    if (Object.keys(filterObj).length > 0) {
      query.filter = filterObj;
    }
    if (this.search) {
      query.search = this.search;
    }
    if (this.sort.field) {
      query.sort = [{ field: this.sort.field, dir: this.sort.dir }];
    }

    try {
      const res = await queryOrders(query);
      this.rows = res.rows as Order[];
      this.total = res.page.total;
      this.hasMore = res.page.hasMore;
    } catch (err) {
      // Duck-typed .message read, not `instanceof Error` — `queryOrders`/`fetch`
      // can throw an Error, a DOMException or a plain object, and the original
      // code read `.message` off any of them.
      const message = (err as { message?: unknown } | null)?.message;
      this.error = (typeof message === "string" && message) || "Failed to load orders";
      this.rows = [];
      this.total = 0;
      this.hasMore = false;
    } finally {
      this.loading = false;
    }
  }

  private _onSearchInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    this.search = val;
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this.page = { ...this.page, offset: 0 };
      void this._load();
    }, 300);
  }

  private _onStatusChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    this.filters = { ...this.filters, status: val };
    this.page = { ...this.page, offset: 0 };
    void this._load();
  }

  private _onCategoryChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    this.filters = { ...this.filters, category: val };
    this.page = { ...this.page, offset: 0 };
    void this._load();
  }

  private _onDateFromChange(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    this.filters = { ...this.filters, dateFrom: val };
    this.page = { ...this.page, offset: 0 };
    void this._load();
  }

  private _onDateToChange(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    this.filters = { ...this.filters, dateTo: val };
    this.page = { ...this.page, offset: 0 };
    void this._load();
  }

  private _toggleSort(field: string) {
    if (this.sort.field === field) {
      this.sort = { field, dir: this.sort.dir === "asc" ? "desc" : "asc" };
    } else {
      this.sort = { field, dir: "desc" };
    }
    this.page = { ...this.page, offset: 0 };
    void this._load();
  }

  private _onPrevPage() {
    if (this.page.offset > 0) {
      const newOffset = Math.max(0, this.page.offset - this.page.limit);
      this.page = { ...this.page, offset: newOffset };
      void this._load();
    }
  }

  private _onNextPage() {
    if (this.hasMore) {
      const newOffset = this.page.offset + this.page.limit;
      this.page = { ...this.page, offset: newOffset };
      void this._load();
    }
  }

  private _formatDate(isoStr: string): string {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  }

  render() {
    const showingStart = this.total === 0 ? 0 : this.page.offset + 1;
    const showingEnd = Math.min(this.page.offset + this.page.limit, this.total);

    return html`
      <h2>Order History</h2>

      ${this.error ? html`<div class="error-container">${this.error}</div>` : ""}

      <div class="controls-card">
        <div class="filter-bar">
          <div class="filter-group">
            <label for="search-input">Search</label>
            <input
              type="text"
              id="search-input"
              .value=${this.search}
              @input=${(e: Event) => this._onSearchInput(e)}
              placeholder="Search ID, customer..."
            />
          </div>

          <div class="filter-group">
            <label for="status-select">Status</label>
            <select id="status-select" .value=${this.filters.status} @change=${(e: Event) => this._onStatusChange(e)}>
              <option value="all">All Statuses</option>
              <option value="placed">Placed</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div class="filter-group">
            <label for="category-select">Category</label>
            <select id="category-select" .value=${this.filters.category} @change=${(e: Event) => this._onCategoryChange(e)}>
              <option value="all">All Categories</option>
              <option value="Food">Food</option>
              <option value="Toys">Toys</option>
              <option value="Beds">Beds</option>
              <option value="Grooming">Grooming</option>
              <option value="Health">Health</option>
            </select>
          </div>

          <div class="filter-group">
            <label for="date-from-input">From Date</label>
            <input
              type="date"
              id="date-from-input"
              .value=${this.filters.dateFrom}
              @change=${(e: Event) => this._onDateFromChange(e)}
            />
          </div>

          <div class="filter-group">
            <label for="date-to-input">To Date</label>
            <input
              type="date"
              id="date-to-input"
              .value=${this.filters.dateTo}
              @change=${(e: Event) => this._onDateToChange(e)}
            />
          </div>
        </div>
      </div>

      <div class="table-card">
        <table>
          <thead>
            <tr>
              <th>Order ID</th>
              <th class="sortable" @click=${() => this._toggleSort("createdAt")}>
                Date
                <span class="sort-indicator">
                  ${this.sort.field === "createdAt" ? (this.sort.dir === "asc" ? "▲" : "▼") : ""}
                </span>
              </th>
              <th>Customer</th>
              <th>Category</th>
              <th class="sortable" @click=${() => this._toggleSort("total")}>
                Total
                <span class="sort-indicator">
                  ${this.sort.field === "total" ? (this.sort.dir === "asc" ? "▲" : "▼") : ""}
                </span>
              </th>
              <th class="sortable" @click=${() => this._toggleSort("status")}>
                Status
                <span class="sort-indicator">
                  ${this.sort.field === "status" ? (this.sort.dir === "asc" ? "▲" : "▼") : ""}
                </span>
              </th>
              <th>Items</th>
            </tr>
          </thead>
          <tbody>
            ${this.loading
              ? html`
                  <tr>
                    <td colspan="7">
                      <div class="loading-container">Loading orders...</div>
                    </td>
                  </tr>
                `
              : this.rows.length === 0
                ? html`
                    <tr>
                      <td colspan="7">
                        <div class="empty-container">No orders match</div>
                      </td>
                    </tr>
                  `
                : this.rows.map(
                    (row) => html`
                      <tr>
                        <td><strong>${row.id}</strong></td>
                        <td>${this._formatDate(row.createdAt)}</td>
                        <td>${row.customer}</td>
                        <td>${row.category}</td>
                        <td>$${Number(row.total).toFixed(2)}</td>
                        <td>
                          <span class="status-badge status-${row.status}">
                            ${row.status}
                          </span>
                        </td>
                        <td>${row.items}</td>
                      </tr>
                    `
                  )}
          </tbody>
        </table>
      </div>

      <div class="pagination">
        <div class="pagination-info">
          Showing ${showingStart}–${showingEnd} of ${this.total}
        </div>
        <div class="pagination-buttons">
          <md-filled-button
            id="prev-btn"
            ?disabled=${this.page.offset === 0 || this.loading}
            @click=${() => this._onPrevPage()}
          >
            Prev
          </md-filled-button>
          <md-filled-button
            id="next-btn"
            ?disabled=${!this.hasMore || this.loading}
            @click=${() => this._onNextPage()}
          >
            Next
          </md-filled-button>
        </div>
      </div>
    `;
  }
}
