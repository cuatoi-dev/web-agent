// state-adapter.test.ts — vitest
import { describe, it, expect, beforeEach } from "vitest";
import { StateAdapter, evaluateJsonPath } from "./state-adapter.js";

/** The JSON shape `StateAdapter.query()` serialises. Typed here so the
 *  assertions below read the real fields instead of `any`. */
interface QueryResultJson {
  total_matches: number;
  returned: number;
  results: unknown[];
}

function parseQueryResult(out: string): QueryResultJson {
  return JSON.parse(out) as QueryResultJson;
}

/** Fixture: cat-store-shaped state with 25 products */
function makeFixture() {
  const products = Array.from({ length: 25 }, (_, i) => ({
    id: i + 1,
    name: `Cat Product ${i + 1}`,
    category: ["Food", "Toys", "Beds", "Grooming"][i % 4],
    price: 9.99 + i,
    inStock: i % 3 !== 0,
  }));

  const cart = {
    items: [
      { productId: 1, qty: 2, lineTotal: 19.98 },
      { productId: 3, qty: 1, lineTotal: 11.99 },
    ],
    subtotal: 31.97,
    total: 35.17,
  };

  const ui = {
    route: "/store",
    lastOrder: null,
    toast: null,
  };

  return { products: { items: products, filterCategory: "All" }, cart, ui };
}

describe("StateAdapter", () => {
  let adapter: StateAdapter;
  let getState: () => ReturnType<typeof makeFixture>;

  beforeEach(() => {
    const fixture = makeFixture();
    getState = () => fixture;
    adapter = new StateAdapter(getState);
  });

  // -----------------------------------------------------------------------
  // evaluateJsonPath
  // -----------------------------------------------------------------------
  describe("evaluateJsonPath", () => {
    it("returns matches for $..price", () => {
      const state = makeFixture();
      const result = evaluateJsonPath(state, "$..price");
      expect("matches" in result).toBe(true);
      expect((result as { matches: number[] }).matches.length).toBe(25);
    });

    it("returns error for path not starting with $", () => {
      const state = makeFixture();
      const result = evaluateJsonPath(state, "products.items");
      expect("error" in result).toBe(true);
    });

    it("handles filter expressions", () => {
      const state = makeFixture();
      const result = evaluateJsonPath(state, '$.products.items[?(@.category=="Food")]');
      expect("matches" in result).toBe(true);
      const matches = (result as { matches: unknown[] }).matches;
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // query — basic queries
  // -----------------------------------------------------------------------
  describe("query", () => {
    it('$.products.items[*].category returns total_matches:25, returned:20', async () => {
      const out = await adapter.query({ path: "$.products.items[*].category" });
      const parsed = parseQueryResult(out);
      expect(parsed.total_matches).toBe(25);
      expect(parsed.returned).toBe(20); // default limit
    });

    it('limit:100 returns all 25', async () => {
      const out = await adapter.query({ path: "$.products.items[*].category", limit: 100 });
      const parsed = parseQueryResult(out);
      expect(parsed.total_matches).toBe(25);
      expect(parsed.returned).toBe(25);
    });

    it('$.cart.items[*] returns cart line objects', async () => {
      const out = await adapter.query({ path: "$.cart.items[*]" });
      const parsed = parseQueryResult(out);
      expect(parsed.total_matches).toBe(2);
      expect(parsed.returned).toBe(2);
      expect(JSON.stringify(parsed.results[0])).toContain("productId");
    });

    it('$.cart.total returns the number', async () => {
      const out = await adapter.query({ path: "$.cart.total" });
      const parsed = parseQueryResult(out);
      expect(parsed.total_matches).toBe(1);
      expect(parsed.results[0]).toBe(35.17);
    });
  });

  // -----------------------------------------------------------------------
  // query — keys_only
  // -----------------------------------------------------------------------
  describe("query keys_only", () => {
    it('returns keys of matched objects', async () => {
      const out = await adapter.query({ path: "$.cart.items[0]", keys_only: true });
      const parsed = parseQueryResult(out);
      expect(parsed.results[0]).toEqual(expect.arrayContaining(["productId", "qty", "lineTotal"]));
    });
  });

  // -----------------------------------------------------------------------
  // query — depth/leaf truncation + non-serializable
  // -----------------------------------------------------------------------
  describe("query truncation + non-serializable", () => {
    // Test depth limit: depth > DEPTH_LIMIT (6) should show …
    it("depth limit adds truncated marker", async () => {
      // Create 8-level deep object to exceed DEPTH_LIMIT=6
      const deepState = {
        a: { b: { c: { d: { e: { f: { g: { h: "deep" } } } } } } },
      };
      const deepAdapter = new StateAdapter(() => deepState, { queryResultMaxChars: 10000 });
      const out = await deepAdapter.query({ path: "$.a" });
      // The serializeValue function adds "…" when depth > DEPTH_LIMIT
      expect(out.includes("…") || out.includes('"…"')).toBe(true);
    });

    // Test leaf char limit: string > 300 chars should be truncated
    it("long string truncated with ellipsis", async () => {
      const longState = {
        long: "x".repeat(500),
      };
      const longAdapter = new StateAdapter(() => longState);
      const out = await longAdapter.query({ path: "$.long" });
      // serializeValue truncates strings > 300 chars with …
      expect(out.includes("…")).toBe(true);
    });

    it("non-serializable function becomes [Function]", async () => {
      const fnState = {
        cb: function example() {},
      };
      const fnAdapter = new StateAdapter(() => fnState);
      const out = await fnAdapter.query({ path: "$.cb" });
      expect(out).toContain("[Function]");
    });

    // Not covered: an Element value becoming [Element].
    // it("non-serializable Element becomes [Element]")
  });

  // -----------------------------------------------------------------------
  // query — queryResultMaxChars
  // -----------------------------------------------------------------------
  describe("query queryResultMaxChars", () => {
    it("caps output and reflects in returned", async () => {
      const tinyAdapter = new StateAdapter(getState, { queryResultMaxChars: 200 });
      const out = await tinyAdapter.query({ path: "$.products.items[*].name" });
      expect(out.length).toBeLessThanOrEqual(230); // with the truncation marker
      const parsed = parseQueryResult(out);
      // returned should be less than default 20
      expect(parsed.returned).toBeLessThan(20);
    });
  });

  // -----------------------------------------------------------------------
  // query — invalid path
  // -----------------------------------------------------------------------
  describe("query invalid path", () => {
    it("path not starting with $ returns Invalid JSONPath:", async () => {
      const out = await adapter.query({ path: "products.items" });
      expect(out).toContain("Invalid JSONPath");
      expect(out).toContain("Path must start with $");
    });

    it("malformed path returns error", async () => {
      const out = await adapter.query({ path: "$.products.items[?(" });
      expect(out).toContain("Invalid JSONPath");
    });
  });

  // -----------------------------------------------------------------------
  // describeShape
  // -----------------------------------------------------------------------
  describe("describeShape", () => {
    it("lists products/cart/ui with nested keys, types only, <=1000 chars", () => {
      const shape = adapter.describeShape();
      expect(shape).toContain("products:");
      expect(shape).toContain("cart:");
      expect(shape).toContain("ui:");
      expect(shape.length).toBeLessThanOrEqual(1000);
    });

    it("includes array type info", () => {
      const shape = adapter.describeShape();
      expect(shape).toMatch(/array/);
    });
  });

  // -----------------------------------------------------------------------
  // waitForPathTruthy
  // -----------------------------------------------------------------------
  describe("waitForPathTruthy", () => {
    it("resolves true when path is truthy initially", async () => {
      const state = { value: "hello" };
      const a = new StateAdapter(() => state);
      const res = await a.waitForPathTruthy("$.value", 100);
      expect(res).toBe(true);
    });

    it("resolves true when path flips to truthy via polling", async () => {
      let state = { value: "" };
      const a = new StateAdapter(() => state);

      const promise = a.waitForPathTruthy("$.value", 2000);

      setTimeout(() => {
        state = { value: "now-truthy" };
      }, 100);

      const res = await promise;
      expect(res).toBe(true);
    });

    it("resolves false on timeout if never truthy", async () => {
      const state = { value: "" };
      const a = new StateAdapter(() => state);
      const res = await a.waitForPathTruthy("$.value", 50);
      expect(res).toBe(false);
    });

    it("resolves false promptly if aborted", async () => {
      const state = { value: "" };
      const a = new StateAdapter(() => state);
      const controller = new AbortController();
      const promise = a.waitForPathTruthy("$.value", 500, controller.signal);
      
      setTimeout(() => {
        controller.abort();
      }, 50);

      const res = await promise;
      expect(res).toBe(false);
    });
  });
});