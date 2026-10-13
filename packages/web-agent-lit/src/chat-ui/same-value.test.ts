import { describe, it, expect } from "vitest";
import { sameValue } from "./same-value.js";

describe("sameValue", () => {
  it("returns true for identical primitive values and undefined", () => {
    expect(sameValue(1, 1)).toBe(true);
    expect(sameValue("a", "a")).toBe(true);
    expect(sameValue(undefined, undefined)).toBe(true);
  });

  it("returns false for different primitives or null/undefined vs object", () => {
    expect(sameValue(1, 2)).toBe(false);
    expect(sameValue(undefined, {})).toBe(false);
    expect(sameValue(null, {})).toBe(false);
  });

  it("returns true for shallow-equal plain objects with identical values", () => {
    const f = () => 0;
    expect(sameValue({ a: 1, f }, { a: 1, f })).toBe(true);
  });

  it("returns false for plain objects with different values or keys", () => {
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameValue({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
  });

  it("returns false for nested objects because comparison is one level only", () => {
    expect(sameValue({ n: { x: 1 } }, { n: { x: 1 } })).toBe(false);
  });

  it("compares arrays by identity only", () => {
    const arr = [1];
    expect(sameValue(arr, arr)).toBe(true);
    expect(sameValue([1], [1])).toBe(false);
  });

  it("compares functions by identity only", () => {
    expect(sameValue(() => 0, () => 0)).toBe(false);
  });

  it("compares class instances by identity only", () => {
    class C {
      a = 1;
    }
    expect(sameValue(new C(), new C())).toBe(false);
  });

  it("handles null-prototype objects", () => {
    const o = Object.assign(Object.create(null), { a: 1 });
    expect(sameValue(o, { a: 1 })).toBe(true);
  });
});
