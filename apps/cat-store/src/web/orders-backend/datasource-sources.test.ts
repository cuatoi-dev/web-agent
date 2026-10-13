import { describe, it, expect, afterEach, vi } from "vitest";
import {
  WIDE_ORDERS_FIELDS,
  createSampleWideOrders,
  createWideOrdersSource,
  getCatSources,
} from "./datasource-sources";
import { runQueryData, createDataSourceProvider } from "@cuatoi/web-agent-core";
import type { RootState } from "../store";

describe("Wide orders test source", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("WIDE_ORDERS_FIELDS has 50 fields, exceeding the default threshold of 40", () => {
    expect(WIDE_ORDERS_FIELDS.length).toBeGreaterThan(40);
  });

  it("createSampleWideOrders generates rows with all 50 fields", () => {
    const rows = createSampleWideOrders(5);
    expect(rows).toHaveLength(5);
    for (const field of WIDE_ORDERS_FIELDS) {
      expect(rows[0]).toHaveProperty(field.name);
    }
  });

  it("createWideOrdersSource describes orders with 50 fields", async () => {
    const source = createWideOrdersSource(10);
    const info = await source.describe();
    expect(info.name).toBe("orders");
    expect(info.fields).toHaveLength(50);
    expect(info.rowCount).toBe(10);
  });

  it("querying without select triggers the wide-source guardrail error", async () => {
    const provider = createDataSourceProvider({
      sources: [createWideOrdersSource(20)],
    });
    const outcome = await runQueryData(
      { source: "orders", page: { limit: 5 } },
      { signal: new AbortController().signal, dataSource: provider, app: {}, imageInput: false },
    );
    expect(outcome.isError).toBe(true);
    // The real message names the column count, the 40-column limit, and the way out.
    expect(outcome.content).toMatch(/"orders" has 50 columns/);
    expect(outcome.content).toMatch(/40-column limit/);
    expect(outcome.content).toMatch(/pass them in "select"/);
    expect(outcome.content).toMatch(/get_field_details/);
  });

  it("querying with select succeeds and returns only selected columns", async () => {
    const provider = createDataSourceProvider({
      sources: [createWideOrdersSource(20)],
    });
    const outcome = await runQueryData(
      { source: "orders", select: ["orderId", "customerName", "total"], page: { limit: 3 } },
      { signal: new AbortController().signal, dataSource: provider, app: {}, imageInput: false },
    );
    expect(outcome.isError).toBeUndefined();
    expect(outcome.content).toMatch(/ord-1000/);
    expect(outcome.content).toMatch(/Alice Smith/);
  });

  it("getCatSources activates wide orders when wideOrders=1 in search query", async () => {
    vi.stubGlobal("window", {
      location: { search: "?wideOrders=1" },
    });
    const [orders] = getCatSources(() => ({} as RootState));
    const info = await orders.describe();
    expect(info.fields).toHaveLength(50);
  });

  it("getCatSources defaults to standard orders when wideOrders is absent", () => {
    vi.stubGlobal("window", {
      location: { search: "" },
    });
    const [orders] = getCatSources(() => ({} as RootState));
    expect(typeof orders.describe).toBe("function");
  });
});
