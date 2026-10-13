import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Polyfill ElementInternals for jsdom before importing material components
if (typeof window !== "undefined") {
  if (!window.ElementInternals) {
    window.ElementInternals = class {} as unknown as typeof ElementInternals;
  }
  const internalsProto = window.ElementInternals.prototype;
  if (!internalsProto.setFormValue) internalsProto.setFormValue = () => {};
  if (!internalsProto.setValidity) internalsProto.setValidity = () => {};
  if (!internalsProto.checkValidity) internalsProto.checkValidity = () => true;
  if (!internalsProto.reportValidity) internalsProto.reportValidity = () => true;
}

import { OrdersPage } from "../../../src/web/components/orders-page";
import { OrdersStore } from "../../../src/server/orders-store";
import type { DataQuery } from "@cuatoi/web-agent-core";

if (!customElements.get("orders-page")) {
  customElements.define("orders-page", OrdersPage);
}

describe("OrdersPage component", () => {
  let ordersStore: OrdersStore;

  beforeEach(() => {
    ordersStore = new OrdersStore(200);
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.startsWith("/api/orders?q=")) {
        const q = JSON.parse(decodeURIComponent(url.slice("/api/orders?q=".length))) as DataQuery;
        return Promise.resolve(
          new Response(JSON.stringify(ordersStore.query({ ...q, source: "orders" })), { status: 200 })
        );
      }
      return Promise.resolve(new Response("not found", { status: 404, statusText: "Not Found" }));
    }));
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders rows and pagination footer on mount", async () => {
    const page = document.createElement("orders-page") as OrdersPage;
    document.body.appendChild(page);
    await page.updateComplete;

    // wait for async queryOrders
    await new Promise((resolve) => setTimeout(resolve, 10));
    await page.updateComplete;

    const shadow = page.shadowRoot!;
    
    // Check loading container is gone
    const loading = shadow.querySelector(".loading-container");
    expect(loading).toBeNull();

    // Check table has rows
    const rows = shadow.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThan(0);

    // Check footer has total
    const footerText = shadow.querySelector(".pagination-info")?.textContent;
    expect(footerText).toContain("Showing 1–20 of");
  });

  it("applies status filter and reloads", async () => {
    const page = document.createElement("orders-page") as OrdersPage;
    document.body.appendChild(page);
    await page.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await page.updateComplete;

    const shadow = page.shadowRoot!;
    const statusSelect = shadow.querySelector("#status-select") as HTMLSelectElement;
    expect(statusSelect).not.toBeNull();

    statusSelect.value = "delivered";
    statusSelect.dispatchEvent(new Event("change"));

    await page.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await page.updateComplete;

    // Verify all displayed rows are 'delivered'
    const statusBadges = shadow.querySelectorAll(".status-badge");
    expect(statusBadges.length).toBeGreaterThan(0);
    statusBadges.forEach((badge) => {
      expect(badge.textContent?.trim()).toBe("delivered");
    });
  });

  it("applies search and resets offset", async () => {
    const page = document.createElement("orders-page") as OrdersPage;
    document.body.appendChild(page);
    await page.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await page.updateComplete;

    const shadow = page.shadowRoot!;
    const searchInput = shadow.querySelector("#search-input") as HTMLInputElement;
    expect(searchInput).not.toBeNull();
    
    searchInput.value = "ORD-1005";
    searchInput.dispatchEvent(new Event("input"));

    // Search has 300ms debounce
    await new Promise((resolve) => setTimeout(resolve, 350));
    await page.updateComplete;

    const rows = shadow.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThan(0);
    const orderIdCell = rows[0].querySelector("strong");
    expect(orderIdCell?.textContent).toContain("ORD-1005");
  });

  it("toggles sorting when clicking headers", async () => {
    const page = document.createElement("orders-page") as OrdersPage;
    document.body.appendChild(page);
    await page.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await page.updateComplete;

    const shadow = page.shadowRoot!;
    const headers = shadow.querySelectorAll("th.sortable");
    let totalHeader: HTMLTableCellElement | null = null;
    headers.forEach((h) => {
      if (h.textContent?.includes("Total")) {
        totalHeader = h as HTMLTableCellElement;
      }
    });
    expect(totalHeader).not.toBeNull();

    // Click to sort desc
    totalHeader!.click();
    await page.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await page.updateComplete;

    // Check indicator
    expect(totalHeader!.textContent).toContain("▼");

    // Click again to toggle asc
    totalHeader!.click();
    await page.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await page.updateComplete;

    expect(totalHeader!.textContent).toContain("▲");
  });

  it("paginates next and prev", async () => {
    const page = document.createElement("orders-page") as OrdersPage;
    document.body.appendChild(page);
    await page.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await page.updateComplete;

    const shadow = page.shadowRoot!;
    const nextBtn = shadow.querySelector("#next-btn") as HTMLElement;
    const prevBtn = shadow.querySelector("#prev-btn") as HTMLElement;

    expect(prevBtn.hasAttribute("disabled")).toBe(true);
    expect(nextBtn.hasAttribute("disabled")).toBe(false);

    nextBtn.click();
    await page.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await page.updateComplete;

    const footerText = shadow.querySelector(".pagination-info")?.textContent;
    expect(footerText).toContain("Showing 21–40 of");
    expect(prevBtn.hasAttribute("disabled")).toBe(false);
  });
});

describe("OrdersPage styles", () => {
  it("lets native form controls inherit the Public Sans base font", () => {
    const css = (OrdersPage.styles as { cssText: string }).cssText;
    expect(css).toContain("font-family: inherit");
  });
});
