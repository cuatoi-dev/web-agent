import { describe, it, expect } from "vitest";
import { FieldSchema } from "./types.js";
import { matchesFilter, matchesSearch } from "./filter.js";

const schema: FieldSchema[] = [
  { name: "id", type: "string" },
  { name: "name", type: "string" },
  { name: "category", type: "enum", enumValues: ["Food", "Pet", "Accessory"] },
  { name: "price", type: "number" },
  { name: "inStock", type: "boolean" },
  { name: "createdAt", type: "date" }
];

describe("matchesFilter", () => {
  const row = {
    id: "1",
    name: "Catnip",
    category: "Food",
    price: 5.99,
    inStock: true,
    createdAt: "2026-01-15T08:00:00Z"
  };

  it("handles scalar shorthand ($eq equivalence)", () => {
    expect(matchesFilter(row, { category: "Food" }, schema)).toBe(true);
    expect(matchesFilter(row, { category: "Pet" }, schema)).toBe(false);
  });

  it("handles explicit $eq and $ne operators", () => {
    expect(matchesFilter(row, { price: { $eq: 5.99 } }, schema)).toBe(true);
    expect(matchesFilter(row, { price: { $ne: 10.00 } }, schema)).toBe(true);
    expect(matchesFilter(row, { price: { $eq: 10.00 } }, schema)).toBe(false);
    expect(matchesFilter(row, { price: { $ne: 5.99 } }, schema)).toBe(false);
  });

  it("handles numeric comparisons ($gt, $gte, $lt, $lte)", () => {
    expect(matchesFilter(row, { price: { $gt: 5 } }, schema)).toBe(true);
    expect(matchesFilter(row, { price: { $gte: 5.99 } }, schema)).toBe(true);
    expect(matchesFilter(row, { price: { $lt: 6 } }, schema)).toBe(true);
    expect(matchesFilter(row, { price: { $lte: 5.99 } }, schema)).toBe(true);
    expect(matchesFilter(row, { price: { $gt: 6 } }, schema)).toBe(false);
  });

  it("handles date comparisons ($gt, $gte, $lt, $lte)", () => {
    expect(matchesFilter(row, { createdAt: { $gt: "2026-01-01" } }, schema)).toBe(true);
    expect(matchesFilter(row, { createdAt: { $gte: "2026-01-15T08:00:00Z" } }, schema)).toBe(true);
    expect(matchesFilter(row, { createdAt: { $lt: "2026-02-01" } }, schema)).toBe(true);
    expect(matchesFilter(row, { createdAt: { $lte: "2026-01-15T08:00:00Z" } }, schema)).toBe(true);
    expect(matchesFilter(row, { createdAt: { $lt: "2026-01-01" } }, schema)).toBe(false);
  });

  it("handles $in and $nin operators", () => {
    expect(matchesFilter(row, { category: { $in: ["Food", "Pet"] } }, schema)).toBe(true);
    expect(matchesFilter(row, { category: { $nin: ["Pet", "Accessory"] } }, schema)).toBe(true);
    expect(matchesFilter(row, { category: { $in: ["Pet"] } }, schema)).toBe(false);
    expect(matchesFilter(row, { category: { $nin: ["Food"] } }, schema)).toBe(false);
  });

  it("handles string operators ($contains, $startsWith, $endsWith, $regex)", () => {
    expect(matchesFilter(row, { name: { $contains: "nip" } }, schema)).toBe(true);
    expect(matchesFilter(row, { name: { $startsWith: "Cat" } }, schema)).toBe(true);
    expect(matchesFilter(row, { name: { $endsWith: "ip" } }, schema)).toBe(true);
    expect(matchesFilter(row, { name: { $regex: "^Cat.*$" } }, schema)).toBe(true);
    expect(matchesFilter(row, { name: { $regex: "/NIP/i" } }, schema)).toBe(true);

    expect(matchesFilter(row, { name: { $contains: "dog" } }, schema)).toBe(false);
    expect(matchesFilter(row, { name: { $startsWith: "dog" } }, schema)).toBe(false);
  });

  it("handles $between operator (number and date)", () => {
    expect(matchesFilter(row, { price: { $between: [5.00, 6.00] } }, schema)).toBe(true);
    expect(matchesFilter(row, { createdAt: { $between: ["2026-01-01", "2026-01-31"] } }, schema)).toBe(true);
    expect(matchesFilter(row, { price: { $between: [1.00, 4.00] } }, schema)).toBe(false);
  });

  it("handles $exists and $isNull operators", () => {
    expect(matchesFilter(row, { name: { $exists: true } }, schema)).toBe(true);
    expect(matchesFilter(row, { nonExistent: { $exists: false } }, [...schema, { name: "nonExistent", type: "string" }])).toBe(true);
    expect(matchesFilter(row, { name: { $isNull: false } }, schema)).toBe(true);
    expect(matchesFilter({ ...row, id: null }, { id: { $isNull: true } }, schema)).toBe(true);
  });

  it("handles combinators ($and, $or, $not)", () => {
    expect(matchesFilter(row, {
      $and: [
        { category: "Food" },
        { price: { $lt: 10 } }
      ]
    }, schema)).toBe(true);

    expect(matchesFilter(row, {
      $or: [
        { category: "Pet" },
        { price: { $lt: 10 } }
      ]
    }, schema)).toBe(true);

    expect(matchesFilter(row, {
      $not: { category: "Pet" }
    }, schema)).toBe(true);
  });

  it("throws error for unknown field", () => {
    expect(() => {
      matchesFilter(row, { totl: { $eq: 5 } }, schema);
    }).toThrow('Unknown field "totl". Fields: id, name, category, price, inStock, createdAt');
  });

  it("throws error for operator and type mismatch", () => {
    expect(() => {
      matchesFilter(row, { price: { $contains: "5" } }, schema);
    }).toThrow('Operator $contains is not valid for number field "price".');

    expect(() => {
      matchesFilter(row, { inStock: { $startsWith: "true" } }, schema);
    }).toThrow('Operator $startsWith is not valid for boolean field "inStock".');
  });

  it("throws error for bad pattern or oversized regex", () => {
    expect(() => {
      matchesFilter(row, { name: { $regex: "a".repeat(201) } }, schema);
    }).toThrow("Regex pattern length exceeds limit of 200 characters.");

    expect(() => {
      matchesFilter(row, { name: { $regex: "[" } }, schema);
    }).toThrow("Invalid regex pattern: [");
  });
});

describe("matchesSearch", () => {
  const row = {
    id: "1",
    name: "Catnip",
    category: "Food",
    price: 5.99,
    inStock: true,
    createdAt: "2026-01-15T08:00:00Z"
  };

  it("matches a lower-cased needle against any text field", () => {
    expect(matchesSearch(row, "catnip", schema)).toBe(true);
    expect(matchesSearch(row, "foo", schema)).toBe(true); // matches enum field "Food"
  });

  it("ignores non-text fields", () => {
    expect(matchesSearch(row, "5.99", schema)).toBe(false);
    expect(matchesSearch(row, "true", schema)).toBe(false);
    expect(matchesSearch(row, "2026-01", schema)).toBe(false);
  });

  it("ignores a declared string field whose value is not a string", () => {
    const badRow: Record<string, unknown> = { id: 7, name: null, category: "Food" };
    expect(matchesSearch(badRow, "7", schema)).toBe(false);
    expect(matchesSearch(badRow, "food", schema)).toBe(true);
  });
});
