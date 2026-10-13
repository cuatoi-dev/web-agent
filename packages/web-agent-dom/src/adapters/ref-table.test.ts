// ref-table.test.ts — vitest + jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { RefTable } from "./ref-table.js";

/**
 * Helper: create a connected element via jsdom.
 * The element is appended to `document.body`, so `isConnected` is true. The
 * basic "ok" case relies on that; the detached test calls `el.remove()`.
 */
function makeEl(): Element {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("RefTable", () => {
  let table: RefTable;

  beforeEach(() => {
    table = new RefTable();
    document.body.innerHTML = "";
  });

  describe("initial state", () => {
    it("generation starts at 0", () => {
      expect(table.generation).toBe(0);
    });

    it("resolve on empty table returns unknown", () => {
      expect(table.resolve(1)).toEqual({ status: "unknown" });
      expect(table.resolve("99")).toEqual({ status: "unknown" });
    });
  });

  describe("assign", () => {
    it("returns increasing refs starting at 1", () => {
      const a = makeEl();
      const b = makeEl();
      const c = makeEl();
      expect(table.assign(a)).toBe(1);
      expect(table.assign(b)).toBe(2);
      expect(table.assign(c)).toBe(3);
    });

    it("resolve returns ok for assigned refs", () => {
      const el = makeEl();
      const ref = table.assign(el);
      const result = table.resolve(ref);
      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.el).toBe(el);
        expect(result.generation).toBe(0);
      }
    });
  });

  describe("refFor (124/005)", () => {
    it("returns undefined for an element that was never assigned", () => {
      expect(table.refFor(makeEl())).toBeUndefined();
    });

    it("returns the ref assign() handed out", () => {
      const el = makeEl();
      const ref = table.assign(el);
      expect(table.refFor(el)).toBe(ref);
    });

    it("returns the FIRST ref when the same element is assigned twice", () => {
      const el = makeEl();
      const first = table.assign(el);
      const second = table.assign(el);
      expect(second).not.toBe(first);
      expect(table.refFor(el)).toBe(second);
    });

    it("forgets every element after invalidateAll", () => {
      const el = makeEl();
      table.assign(el);
      table.invalidateAll();
      expect(table.refFor(el)).toBeUndefined();
    });

    it("assign does not bump the generation, so refFor never crosses one", () => {
      const before = table.generation;
      const el = makeEl();
      table.assign(el);
      expect(table.generation).toBe(before);
      expect(table.refFor(el)).toBe(1);
    });
  });

  describe("resolve — acceptance criteria", () => {
    it("accepts string refs ('7')", () => {
      const els = [makeEl(), makeEl(), makeEl(), makeEl(), makeEl(), makeEl(), makeEl()];
      els.forEach((el) => table.assign(el));
      const result = table.resolve("7");
      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.el).toBe(els[6]);
      }
    });

    it("returns unknown for non-numeric strings", () => {
      expect(table.resolve("abc")).toEqual({ status: "unknown" });
      expect(table.resolve("")).toEqual({ status: "unknown" });
    });

    it("returns unknown for zero / negative", () => {
      expect(table.resolve(0)).toEqual({ status: "unknown" });
      expect(table.resolve(-1)).toEqual({ status: "unknown" });
    });

    it("returns unknown for never-assigned ref in same generation", () => {
      table.assign(makeEl());
      expect(table.resolve(999)).toEqual({ status: "unknown" });
    });
  });

  describe("invalidateAll", () => {
    it("increments generation", () => {
      table.invalidateAll();
      expect(table.generation).toBe(1);
      table.invalidateAll();
      expect(table.generation).toBe(2);
    });

    it("resets ref numbering to 1", () => {
      table.assign(makeEl()); // ref 1
      table.assign(makeEl()); // ref 2
      table.invalidateAll();
      expect(table.assign(makeEl())).toBe(1);
    });

    it("makes previously assigned refs stale (not unknown)", () => {
      const el = makeEl();
      table.assign(el); // ref 1, gen 0
      table.invalidateAll(); // gen 1
      const result = table.resolve(1);
      expect(result.status).toBe("stale");
      if (result.status === "stale") {
        expect(result.fromGeneration).toBe(0);
        expect(result.generation).toBe(1);
      }
    });

    it("refs assigned after invalidate are valid only in new generation", () => {
      table.invalidateAll(); // gen 1
      const el = makeEl();
      table.assign(el);
      expect(table.resolve(1).status).toBe("ok");
    });
  });

  describe("detached detection", () => {
    it("returns detached for removed element", () => {
      const el = makeEl();
      const ref = table.assign(el);
      el.remove(); // isConnected → false
      const result = table.resolve(ref);
      expect(result.status).toBe("detached");
      // No clean-up needed: `beforeEach` clears `document.body`.
    });
  });

  describe("edge cases", () => {
    it("multiple invalidates keep generation tracking correct", () => {
      const el = makeEl();
      table.assign(el); // gen 0
      table.invalidateAll(); // gen 1
      table.invalidateAll(); // gen 2
      // ref 1 from gen 0 should be stale with fromGeneration=0
      const result = table.resolve(1);
      expect(result.status).toBe("stale");
      if (result.status === "stale") {
        expect(result.fromGeneration).toBe(0);
        expect(result.generation).toBe(2);
      }
    });

    it("assign + invalidate + assign same ref number is ok in new gen", () => {
      const el1 = makeEl();
      table.assign(el1); // ref 1
      table.invalidateAll();
      const el2 = makeEl();
      const ref2 = table.assign(el2); // ref 1 again
      expect(ref2).toBe(1);
      const result = table.resolve(1);
      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.el).toBe(el2);
      }
    });
  });
});
