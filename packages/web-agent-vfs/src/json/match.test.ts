import { describe, expect, it } from "vitest";
import { matches, pick } from "./match.js";

const item = {
  id: "u-001",
  role: "buyer",
  address: { country: "MY", city: "Kuala Lumpur" },
  tags: ["a", "b"],
};

describe("matches", () => {
  it("is true when every where pair equals the item's field", () => {
    expect(matches(item, { role: "buyer" })).toBe(true);
    expect(matches(item, { role: "buyer", id: "u-001" })).toBe(true);
  });

  it("is false when one pair differs", () => {
    expect(matches(item, { role: "buyer", id: "u-002" })).toBe(false);
  });

  it("resolves a dotted key through nested objects", () => {
    expect(matches(item, { "address.country": "MY" })).toBe(true);
    expect(matches(item, { "address.country": "SG" })).toBe(false);
  });

  it("compares a nested field deeply", () => {
    expect(matches(item, { address: { country: "MY", city: "Kuala Lumpur" } })).toBe(true);
    expect(matches(item, { address: { country: "MY" } })).toBe(false);
    expect(matches(item, { tags: ["a", "b"] })).toBe(true);
    expect(matches(item, { tags: ["b", "a"] })).toBe(false);
  });

  it("is false on a missing key, a type mismatch, or a non-object item", () => {
    expect(matches(item, { missing: "x" })).toBe(false);
    expect(matches(item, { role: 1 })).toBe(false);
    expect(matches("not an object", { role: "buyer" })).toBe(false);
    expect(matches(null, { role: "buyer" })).toBe(false);
  });

  it("is true for an empty where", () => {
    expect(matches(item, {})).toBe(true);
  });
});

describe("pick", () => {
  it("keeps the requested keys in the order given, not the item's own order", () => {
    expect(Object.keys(pick({ id: "u-001", email: "a@b.c", role: "buyer" }, ["email", "id"]))).toEqual(["email", "id"]);
    expect(pick({ id: "u-001", email: "a@b.c", role: "buyer" }, ["email", "id"])).toEqual({
      email: "a@b.c",
      id: "u-001",
    });
  });

  it("ignores keys the item does not have, and reads an own falsy value", () => {
    expect(pick(item, ["id", "nope"])).toEqual({ id: "u-001" });
    expect(pick({ id: "", active: false }, ["id", "active"])).toEqual({ id: "", active: false });
  });

  it("does not walk into nested keys — only top-level ones", () => {
    expect(pick(item, ["address"])).toEqual({ address: { country: "MY", city: "Kuala Lumpur" } });
  });

  it("returns an empty object for a non-object item", () => {
    expect(pick("text", ["id"])).toEqual({});
    expect(pick(null, ["id"])).toEqual({});
  });
});
