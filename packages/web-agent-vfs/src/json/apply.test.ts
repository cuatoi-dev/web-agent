import { describe, expect, it } from "vitest";
import { applyJsonChanges } from "./apply.js";
import type { JsonEditChange } from "./apply.types.js";

/** 20 users: 12 buyers, 8 in MY, so filter counts are exact. */
function users20() {
  const users = Array.from({ length: 20 }, (_, i) => {
    const n = i + 1;
    return {
      id: `u-${String(n).padStart(3, "0")}`,
      email: `user${n}@example.com`,
      role: n <= 12 ? "buyer" : "admin",
      address: { country: n <= 8 ? "MY" : n <= 14 ? "SG" : "US" },
    };
  });
  return { users, settings: { retries: 2, debug: false } };
}

function ok(doc: unknown, changes: JsonEditChange[]) {
  const res = applyJsonChanges(doc, changes);
  if (!res.success) throw new Error(`expected success, got: ${res.error}`);
  return res;
}

describe("applyJsonChanges — set", () => {
  it("changes an existing key and creates missing intermediate objects", () => {
    const doc = users20();
    const res = ok(doc, [
      { op: "set", path: "settings.retries", value: 5 },
      { op: "set", path: "a.b.c", value: "deep" },
    ]);
    expect((res.doc as typeof doc).settings.retries).toBe(5);
    expect((res.doc as Record<string, unknown>).a).toEqual({ b: { c: "deep" } });
    expect(res.report).toEqual(["1. set settings.retries", "2. set a.b.c"]);
  });

  it("leaves the input document untouched", () => {
    const doc = users20();
    ok(doc, [{ op: "set", path: "settings.retries", value: 9 }]);
    expect(doc.settings.retries).toBe(2);
  });
});

describe("applyJsonChanges — delete", () => {
  it("removes an object property", () => {
    const res = ok(users20(), [{ op: "delete", path: "settings.debug" }]);
    expect((res.doc as ReturnType<typeof users20>).settings).toEqual({ retries: 2 });
    expect(res.report).toEqual(["1. delete settings.debug"]);
  });

  it("removes a list item by its index and renumbers nothing", () => {
    const res = ok(users20(), [{ op: "delete", path: "users[3]" }]);
    const users = (res.doc as ReturnType<typeof users20>).users;
    expect(users).toHaveLength(19);
    expect(users.map((u) => u.id)).not.toContain("u-004");
    expect(users[3].id).toBe("u-005");
  });

  it("fails on an index outside the list, naming the length", () => {
    const res = applyJsonChanges(users20(), [{ op: "delete", path: "users[20]" }]);
    expect(res).toEqual({
      success: false,
      error: "Change 1 (delete users[20]) index 20 is outside the list (20 items).",
    });
  });

  it("fails when there is nothing at the path", () => {
    expect(applyJsonChanges(users20(), [{ op: "delete", path: "settings.nope" }])).toEqual({
      success: false,
      error: "Change 1 (delete settings.nope) found nothing at settings.nope.",
    });
    expect(applyJsonChanges(users20(), [{ op: "delete", path: "missing.key" }]).success).toBe(false);
  });
});

describe("applyJsonChanges — append", () => {
  it("appends to an existing list and reports the new index", () => {
    const res = ok(users20(), [{ op: "append", path: "users", value: { id: "u-021" } }]);
    const users = (res.doc as ReturnType<typeof users20>).users;
    expect(users).toHaveLength(21);
    expect(users[20]).toEqual({ id: "u-021" });
    expect(res.report).toEqual(["1. append users: now [20]"]);
  });

  it("creates a missing list", () => {
    const res = ok(users20(), [{ op: "append", path: "tags", value: "vip" }]);
    expect((res.doc as Record<string, unknown>).tags).toEqual(["vip"]);
  });

  it("fails when the target is not a list", () => {
    expect(applyJsonChanges(users20(), [{ op: "append", path: "settings", value: 1 }])).toEqual({
      success: false,
      error: "Change 1 (append settings) settings is not a list.",
    });
  });
});

describe("applyJsonChanges — insert", () => {
  it("puts the item first at index 0 and shifts the rest", () => {
    const res = ok(users20(), [{ op: "insert", path: "users", index: 0, value: { id: "u-000" } }]);
    const users = (res.doc as ReturnType<typeof users20>).users;
    expect(users[0]).toEqual({ id: "u-000" });
    expect(users[1].id).toBe("u-001");
    expect(users).toHaveLength(21);
    expect(res.report).toEqual(["1. insert users at [0]"]);
  });

  it("inserts at the end when the index equals the length", () => {
    const res = ok(users20(), [{ op: "insert", path: "users", index: 20, value: { id: "u-021" } }]);
    const users = (res.doc as ReturnType<typeof users20>).users;
    expect(users[20]).toEqual({ id: "u-021" });
  });

  it("fails on an index past the end and on a missing list", () => {
    expect(applyJsonChanges(users20(), [{ op: "insert", path: "users", index: 21, value: 1 }])).toEqual({
      success: false,
      error: "Change 1 (insert users) index 21 is outside the list (20 items).",
    });
    expect(applyJsonChanges(users20(), [{ op: "insert", path: "tags", index: 0, value: 1 }])).toEqual({
      success: false,
      error: "Change 1 (insert tags) tags is not a list.",
    });
  });
});

describe("applyJsonChanges — update", () => {
  it("merges top-level fields into the 12 buyers and changes nothing else", () => {
    const doc = users20();
    const res = ok(doc, [{ op: "update", path: "users", where: { role: "buyer" }, merge: { password: "x" } }]);
    const users = (res.doc as ReturnType<typeof users20>).users;
    expect(users.filter((u) => "password" in u)).toHaveLength(12);
    expect(users.slice(0, 12).every((u) => u.password === "x")).toBe(true);
    expect(users.slice(12).some((u) => "password" in u)).toBe(false);
    const before = doc.users;
    users.forEach((u, i) => {
      expect(u).toEqual(i < 12 ? { ...before[i], password: "x" } : before[i]);
    });
  });

  it("reports the matched indexes and honours expect", () => {
    const res = ok(users20(), [
      { op: "update", path: "users", where: { "address.country": "MY" }, merge: { seen: true }, expect: 8 },
    ]);
    expect(res.report).toEqual(["1. update users: 8 items [0], [1], [2], [3], [4], [5], [6], [7]"]);
  });

  it("fails when the expect count does not match, naming both counts", () => {
    expect(
      applyJsonChanges(users20(), [
        { op: "update", path: "users", where: { "address.country": "MY" }, merge: {}, expect: 1 },
      ]),
    ).toEqual({
      success: false,
      error: "Change 1 (update users) matched 8 items; expect is 1.",
    });
  });

  it("fails when the target is not a list", () => {
    expect(applyJsonChanges(users20(), [{ op: "update", path: "settings", where: {}, merge: {} }])).toEqual({
      success: false,
      error: "Change 1 (update settings) settings is not a list.",
    });
  });
});

describe("applyJsonChanges — remove", () => {
  it("removes the 8 MY users and names each by its old index and id", () => {
    const res = ok(users20(), [{ op: "remove", path: "users", where: { "address.country": "MY" } }]);
    const users = (res.doc as ReturnType<typeof users20>).users;
    expect(users).toHaveLength(12);
    expect(users.every((u) => u.address.country !== "MY")).toBe(true);
    expect(users[0].id).toBe("u-009");
    expect(res.report[0]).toBe(
      "1. remove users: 8 item(s), was [0] (id u-001), was [1] (id u-002), was [2] (id u-003), was [3] (id u-004), was [4] (id u-005), was [5] (id u-006), was [6] (id u-007), was [7] (id u-008)",
    );
  });

  it("omits the id when the removed item has none", () => {
    const res = ok({ rows: [{ v: 1 }, { v: 2 }] }, [{ op: "remove", path: "rows", where: { v: 2 } }]);
    expect((res.doc as { rows: unknown[] }).rows).toEqual([{ v: 1 }]);
    expect(res.report).toEqual(["1. remove rows: 1 item(s), was [1]"]);
  });

  it("fails on an expect mismatch, naming both counts", () => {
    expect(
      applyJsonChanges(users20(), [
        { op: "remove", path: "users", where: { role: "nobody" }, expect: 1 },
      ]),
    ).toEqual({
      success: false,
      error: "Change 1 (remove users) matched 0 items; expect is 1.",
    });
  });

  it("fails when the target is not a list", () => {
    expect(applyJsonChanges(users20(), [{ op: "remove", path: "settings", where: {} }])).toEqual({
      success: false,
      error: "Change 1 (remove settings) settings is not a list.",
    });
  });
});

describe("applyJsonChanges — upsert", () => {
  it("replaces the item whose key matches and reports its index", () => {
    const res = ok(users20(), [
      { op: "upsert", path: "users", key: "id", value: { id: "u-003", email: "new@example.com" } },
    ]);
    const users = (res.doc as ReturnType<typeof users20>).users;
    expect(users).toHaveLength(20);
    expect(users[2]).toEqual({ id: "u-003", email: "new@example.com" });
    expect(res.report).toEqual(["1. upsert users: replaced [2]"]);
  });

  it("appends when no item matches and reports the new index", () => {
    const res = ok(users20(), [
      { op: "upsert", path: "users", key: "id", value: { id: "u-030", email: "u30@example.com" } },
    ]);
    const users = (res.doc as ReturnType<typeof users20>).users;
    expect(users).toHaveLength(21);
    expect(users[20]).toEqual({ id: "u-030", email: "u30@example.com" });
    expect(res.report).toEqual(["1. upsert users: appended [20]"]);
  });

  it("fails when the target is not a list", () => {
    expect(
      applyJsonChanges(users20(), [{ op: "upsert", path: "settings", key: "id", value: { id: "x" } }]),
    ).toEqual({
      success: false,
      error: "Change 1 (upsert settings) settings is not a list.",
    });
  });
});

describe("applyJsonChanges — all or nothing", () => {
  it("discards an earlier successful change when a later one fails", () => {
    const doc = users20();
    const before = JSON.stringify(doc, null, 2);
    const res = applyJsonChanges(doc, [
      { op: "set", path: "settings.retries", value: 9 },
      { op: "append", path: "users", value: { id: "u-021" } },
      { op: "delete", path: "users[99]" },
    ]);
    expect(res.success).toBe(false);
    expect(JSON.stringify(doc, null, 2)).toBe(before);
  });

  it("reports the change number that failed, counting from 1", () => {
    const res = applyJsonChanges(users20(), [
      { op: "set", path: "settings.retries", value: 9 },
      { op: "remove", path: "users", where: { role: "nobody" }, expect: 2 },
    ]);
    expect(res.success).toBe(false);
    expect((res as { error: string }).error).toBe(
      "Change 2 (remove users) matched 0 items; expect is 2.",
    );
  });

  it("accepts an empty change list and returns a clone", () => {
    const doc = users20();
    const res = ok(doc, []);
    expect(res.report).toEqual([]);
    expect(res.doc).toEqual(doc);
    expect(res.doc).not.toBe(doc);
  });

  it("keeps key order for a document saved from the clone", () => {
    const doc = { z: 1, a: 2, m: { y: 1, b: 2 } };
    const res = ok(doc, [{ op: "set", path: "a", value: 3 }]);
    expect(Object.keys(res.doc as object)).toEqual(["z", "a", "m"]);
    expect(JSON.stringify(res.doc, null, 2)).toBe(
      `{\n  "z": 1,\n  "a": 3,\n  "m": {\n    "y": 1,\n    "b": 2\n  }\n}`,
    );
  });
});
