import { describe, it, expect } from "vitest";
import { validateDataQuery, FieldSchemaSchema, DataQuerySchema, QUERY_DEFS } from "./types.js";
import Ajv2020 from "ajv/dist/2020.js";

const ajv = new (Ajv2020 as unknown as typeof import("ajv/dist/2020.js").default)({ strict: false });
const okAgainst = (schema: object, value: unknown) => ajv.validate(schema, value);

describe("FieldSchemaSchema", () => {
  it("accepts a field carrying a label", () => {
    expect(okAgainst(FieldSchemaSchema, { name: "price", label: "Shelf price", type: "number" })).toBe(true);
  });

  it("accepts limitation", () => {
    expect(
      okAgainst(FieldSchemaSchema, {
        name: "notes",
        type: "string",
        limitation: "Free-text search only",
      })
    ).toBe(true);
  });

  it("still rejects an unknown key — the schema stays strict", () => {
    expect(okAgainst(FieldSchemaSchema, { name: "price", type: "number", nope: 1 })).toBe(false);
  });
});

describe("validateDataQuery", () => {
  it("accepts a valid query with basic filter, select, sort, and page options", async () => {
    const query = {
      source: "orders",
      select: ["id", "price"],
      filter: {
        price: { $gt: 10 },
      },
      sort: [{ field: "price", dir: "desc" }],
      page: {
        limit: 10,
        offset: 0,
      },
    };
    const res = await validateDataQuery(query);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.source).toBe("orders");
      expect(res.value.select).toEqual(["id", "price"]);
    }
  });

  it("rejects unknown top-level keys because schema is strict", async () => {
    const query = {
      source: "orders",
      unknownKey: "value",
    };
    const res = await validateDataQuery(query);
    if (!res.ok) {
      expect(res.message).toContain("additional");
    } else {
      expect.fail("should have been rejected");
    }
  });

  it("validates recursive FilterExpr nested $and/$or structure", async () => {
    const query = {
      source: "orders",
      filter: {
        $and: [
          {
            $or: [{ price: { $lt: 5 } }, { price: { $gt: 100 } }],
          },
          { category: "Pet" },
        ],
      },
    };
    const res = await validateDataQuery(query);
    expect(res.ok).toBe(true);
  });

  it("rejects invalid values for operators", async () => {
    const query = {
      source: "orders",
      filter: {
        price: { $gt: {} }, // Invalid scalar
      },
    };
    const res = await validateDataQuery(query);
    if (!res.ok) {
      expect(res.message).toContain("Invalid input");
    } else {
      expect.fail("should have been rejected");
    }
  });

  it("accepts a valid aggregate with dimensions + measures", async () => {
    const query = {
      source: "orders",
      aggregate: {
        groupBy: [{ field: "category" }, { field: "createdAt", granularity: "month" }],
        measures: [
          { op: "count" as const },
          { op: "sum" as const, field: "total" },
        ],
      },
    };
    const res = await validateDataQuery(query);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.aggregate).toBeDefined();
      expect(res.value.aggregate!.groupBy).toHaveLength(2);
      expect(res.value.aggregate!.measures).toHaveLength(2);
    }
  });

  it("accepts aggregate with having, sort, and limit", async () => {
    const query = {
      source: "orders",
      aggregate: {
        groupBy: [{ field: "category" }],
        measures: [{ op: "sum" as const, field: "total", as: "revenue" }],
        having: { revenue: { $gt: 100 } },
        sort: [{ field: "revenue", dir: "desc" }],
        limit: 10,
      },
    };
    const res = await validateDataQuery(query);
    expect(res.ok).toBe(true);
  });

  it("rejects aggregate with unknown keys (strict)", async () => {
    const query = {
      source: "orders",
      aggregate: {
        groupBy: [{ field: "category" }],
        measures: [{ op: "count" as const }],
        unknownKey: "bad",
      },
    };
    const res = await validateDataQuery(query);
    if (!res.ok) {
      expect(res.message).toContain("additional");
    } else {
      expect.fail("should have been rejected");
    }
  });

  it("rejects aggregate with bad measure op", async () => {
    const query = {
      source: "orders",
      aggregate: {
        groupBy: [{ field: "category" }],
        measures: [{ op: "unknownOp" }],
      },
    };
    const res = await validateDataQuery(query);
    if (!res.ok) {
      expect(res.message.toLowerCase()).toContain("must be equal to one of the allowed values");
    } else {
      expect.fail("should have been rejected");
    }
  });

  it("rejects aggregate with bad granularity", async () => {
    const query = {
      source: "orders",
      aggregate: {
        groupBy: [{ field: "createdAt", granularity: "decade" }],
        measures: [{ op: "count" as const }],
      },
    };
    const res = await validateDataQuery(query);
    if (!res.ok) {
      expect(res.message.toLowerCase()).toContain("must be equal to one of the allowed values");
    } else {
      expect.fail("should have been rejected");
    }
  });

  it("accepts measure op first/last", async () => {
    const query = {
      source: "orders",
      aggregate: {
        groupBy: [{ field: "category" }],
        measures: [
          { op: "first" as const, field: "total" },
          { op: "last" as const, field: "total" },
        ],
      },
    };
    const res = await validateDataQuery(query);
    expect(res.ok).toBe(true);
  });

  it("accepts granularity hour/minute", async () => {
    const hourQuery = {
      source: "orders",
      aggregate: {
        groupBy: [{ field: "createdAt", granularity: "hour" }],
        measures: [{ op: "count" as const }],
      },
    };
    expect((await validateDataQuery(hourQuery)).ok).toBe(true);

    const minuteQuery = {
      source: "orders",
      aggregate: {
        groupBy: [{ field: "createdAt", granularity: "minute" }],
        measures: [{ op: "count" as const }],
      },
    };
    expect((await validateDataQuery(minuteQuery)).ok).toBe(true);
  });

  it("rejects aggregate dimension with unknown keys", async () => {
    const query = {
      source: "orders",
      aggregate: {
        groupBy: [{ field: "category", bad: true }],
        measures: [{ op: "count" as const }],
      },
    };
    const res = await validateDataQuery(query);
    if (!res.ok) {
      expect(res.message).toContain("additional");
    } else {
      expect.fail("should have been rejected");
    }
  });

  it("accepts a string search", async () => {
    const res = await validateDataQuery({ source: "orders", search: "salmon" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.search).toBe("salmon");
    }
  });

  it("rejects a non-string search", async () => {
    const res = await validateDataQuery({ source: "orders", search: 42 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain("search");
    }
  });

  it("accepts search alongside filter and aggregate", async () => {
    const res = await validateDataQuery({
      source: "orders",
      search: "x",
      filter: { status: "placed" },
      aggregate: {
        groupBy: [{ field: "category" }],
        measures: [{ op: "count" as const }],
      },
    });
    expect(res.ok).toBe(true);
  });
});

// ── Helper: wrap a leaf filter to depth n with $and ──────────────────────────
function wrap(n: number): unknown {
  let expr: unknown = { total: { $gt: 1 } };
  for (let i = 0; i < n; i++) {
    expr = { $and: [expr] };
  }
  return expr;
}

describe("filter depth bound", () => {
  for (const depth of [1, 2, 3]) {
    it(`accepts filter at depth ${depth}`, async () => {
      const res = await validateDataQuery({ source: "t", filter: wrap(depth) });
      expect(res.ok, `depth ${depth} should be ok: ${res.ok ? "" : (res as { message: string }).message}`).toBe(true);
    });
  }

  for (const depth of [4, 5]) {
    it(`rejects filter at depth ${depth}`, async () => {
      const res = await validateDataQuery({ source: "t", filter: wrap(depth) });
      expect(res.ok, `depth ${depth} should be rejected`).toBe(false);
    });
  }

  for (const depth of [1, 2, 3]) {
    it(`accepts aggregate.having at depth ${depth}`, async () => {
      const res = await validateDataQuery({
        source: "t",
        aggregate: {
          groupBy: [{ field: "x" }],
          measures: [{ op: "count" }],
          having: wrap(depth),
        },
      });
      expect(res.ok, `having depth ${depth} should be ok`).toBe(true);
    });
  }

  for (const depth of [4, 5]) {
    it(`rejects aggregate.having at depth ${depth}`, async () => {
      const res = await validateDataQuery({
        source: "t",
        aggregate: {
          groupBy: [{ field: "x" }],
          measures: [{ op: "count" }],
          having: wrap(depth),
        },
      });
      expect(res.ok, `having depth ${depth} should be rejected`).toBe(false);
    });
  }
});

describe("DataQuerySchema $ref structure", () => {
  it("accepts aggregate objects and rejects aggregate JSON strings", async () => {
    const aggregate = { groupBy: [{ field: "category" }], measures: [{ op: "count" }] };
    expect((await validateDataQuery({ source: "orders", aggregate })).ok).toBe(true);
    const invalid = await validateDataQuery({ source: "orders", aggregate: JSON.stringify(aggregate) });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.message).toContain("data/aggregate must be object");
  });

  it("exposes inline types for aggregate, filter, and sort", () => {
    const props = DataQuerySchema.properties as Record<string, Record<string, unknown>>;
    for (const [name, type] of [["aggregate", "object"], ["filter", "object"], ["sort", "array"]]) {
      expect(props[name].$ref).toBeUndefined();
      expect(props[name].type).toBe(type);
    }
    expect(DataQuerySchema.$defs).toBe(QUERY_DEFS);
  });

  function collectRefs(obj: unknown, refs: string[] = []): string[] {
    if (typeof obj !== "object" || obj === null) return refs;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === "$ref" && typeof v === "string") refs.push(v);
      else collectRefs(v, refs);
    }
    return refs;
  }

  it("every $ref targets #/$defs/", () => {
    const refs = collectRefs(DataQuerySchema);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref, `ref ${ref} must target #/$defs/`).toMatch(/^#\/\$defs\//);
    }
  });

  it("every $defs entry is reachable and no dangling $ref", () => {
    const refs = new Set(collectRefs(DataQuerySchema).map((r) => r.replace("#/$defs/", "")));
    const defs = new Set(Object.keys(DataQuerySchema.$defs as object));
    for (const ref of refs) {
      expect(defs.has(ref), `$ref "#/$defs/${ref}" has no matching $defs entry`).toBe(true);
    }
  });

  it("the three filter levels are structurally identical except for their inner $ref targets", () => {
    const { filterL1, filterL2, filterExpr } = QUERY_DEFS;

    // Each level is an anyOf with 4 branches; the first 3 carry a single items/$ref or $not/$ref.
    // The 4th is always { $ref: "#/$defs/filterLeaf" }.
    function innerRefs(level: { anyOf: unknown[] }): string[] {
      return level.anyOf.slice(0, 3).map((branch) => {
        const b = branch as Record<string, unknown>;
        const propKey = "$and" in (b.properties as object)
          ? "$and"
          : "$or" in (b.properties as object)
            ? "$or"
            : "$not";
        const prop = (b.properties as Record<string, unknown>)[propKey] as Record<string, unknown>;
        return propKey === "$not"
          ? (prop["$ref"] as string)
          : ((prop["items"] as Record<string, string>)["$ref"]);
      });
    }

    const l1Refs = innerRefs(filterL1 as { anyOf: unknown[] });
    const l2Refs = innerRefs(filterL2 as { anyOf: unknown[] });
    const topRefs = innerRefs(filterExpr as { anyOf: unknown[] });

    // Each level's three branches all point to the same inner schema
    expect(new Set(l1Refs).size).toBe(1);
    expect(new Set(l2Refs).size).toBe(1);
    expect(new Set(topRefs).size).toBe(1);

    // And those inner schemas form the chain: filterLeaf -> filterL1 -> filterL2
    expect(l1Refs[0]).toBe("#/$defs/filterLeaf");
    expect(l2Refs[0]).toBe("#/$defs/filterL1");
    expect(topRefs[0]).toBe("#/$defs/filterL2");
  });
});
