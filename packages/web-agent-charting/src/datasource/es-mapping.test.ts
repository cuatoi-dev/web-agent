import { describe, it, expect } from "vitest";
import { esSchemaFromMapping, esEnumProbeBody, applyEsEnumProbe, ES_ENUM_MAX_VALUES } from "./es-mapping.js";

// Measured live, 2026-08-18, against a scratch index refine003-probe-v1.
const MAPPING_BODY = {
  "refine003-probe-v1": {
    mappings: {
      properties: {
        active: { type: "boolean" },
        category: { type: "keyword" },
        createdAt: { type: "date" },
        customer: { type: "text", fields: { keyword: { type: "keyword", ignore_above: 256 } } },
        itemCount: { type: "integer" },
        total: { type: "double" },
      },
    },
  },
};

const MULTI_KEY_BODY = {
  ".ds-x-000001": {
    mappings: {
      properties: {
        active: { type: "boolean" },
        category: { type: "keyword" },
        createdAt: { type: "date" },
      },
    },
  },
  ".ds-x-000002": {
    mappings: {
      properties: {
        active: { type: "boolean" },
        category: { type: "keyword" },
        createdAt: { type: "date" },
      },
    },
  },
};

describe("esSchemaFromMapping", () => {
  it("parses the measured mapping body", () => {
    const schema = esSchemaFromMapping(MAPPING_BODY, "refine003-probe-v1");
    expect(schema.byName.customer).toEqual({
      name: "customer",
      type: "string",
      esType: "text",
      termPath: "customer.keyword",
    });
    expect(schema.byName.category.termPath).toBe("category");
    expect(schema.byName.active.type).toBe("boolean");
    expect(schema.byName.createdAt.type).toBe("date");
    expect(schema.byName.itemCount.type).toBe("number");
    expect(schema.byName.total.type).toBe("number");
    expect(schema.unsupported).toEqual([]);
  });

  it("a text field with no fields.keyword gets termPath: undefined and limitation", () => {
    const body = { idx: { mappings: { properties: { notes: { type: "text" } } } } };
    const schema = esSchemaFromMapping(body, "idx");
    expect(schema.byName.notes.termPath).toBeUndefined();
    expect(schema.byName.notes.limitation).toBeDefined();
    expect(schema.fields[0].limitation).toBeDefined();
  });

  it("flattens a nested properties object to dotted names", () => {
    const body = {
      idx: {
        mappings: {
          properties: {
            address: { properties: { city: { type: "keyword" }, zip: { type: "keyword" } } },
          },
        },
      },
    };
    const schema = esSchemaFromMapping(body, "idx");
    expect(schema.byName["address.city"]).toBeDefined();
    expect(schema.byName["address.zip"]).toBeDefined();
    expect(schema.fields.map((f) => f.name)).toEqual(["address.city", "address.zip"]);
  });

  it("a name absent from the body resolves through the body's own keys (alias)", () => {
    const fromAlias = esSchemaFromMapping(MAPPING_BODY, "not-the-index");
    const fromConcrete = esSchemaFromMapping(MAPPING_BODY, "refine003-probe-v1");
    expect(fromAlias.fields.map((f) => f.name)).toEqual(fromConcrete.fields.map((f) => f.name));
    expect(fromAlias.fields).toHaveLength(6);
  });

  it("a data stream body merges every backing index, each field once", () => {
    const schema = esSchemaFromMapping(MULTI_KEY_BODY, "x");
    expect(schema.fields.map((f) => f.name)).toEqual(["active", "category", "createdAt"]);
  });

  it("the first key wins when two backing indices disagree on a type", () => {
    const disagreeBody = {
      ".ds-x-000001": { mappings: { properties: { x: { type: "keyword" } } } },
      ".ds-x-000002": { mappings: { properties: { x: { type: "long" } } } },
    };
    const schema = esSchemaFromMapping(disagreeBody, "x");
    expect(schema.byName.x.type).toBe("string");
  });

  it("reports an unmapped type instead of dropping it", () => {
    const body = {
      idx: {
        mappings: {
          properties: {
            geo: { type: "geo_point" },
            name: { type: "keyword" },
          },
        },
      },
    };
    const schema = esSchemaFromMapping(body, "idx");
    expect(schema.byName.geo).toBeUndefined();
    expect(schema.byName.name).toBeDefined();
    expect(schema.unsupported).toHaveLength(1);
    const expectedUnsupported: { name: string; esType: string; reason: unknown } = {
      name: "geo",
      esType: "geo_point",
      reason: expect.stringContaining("geo_point"),
    };
    expect(schema.unsupported[0]).toEqual(expectedUnsupported);
  });

  it("maps flattened, ip and version to string with their own termPath", () => {
    const body = {
      idx: {
        mappings: {
          properties: {
            meta: { type: "flattened" },
            ip: { type: "ip" },
            ver: { type: "version" },
          },
        },
      },
    };
    const schema = esSchemaFromMapping(body, "idx");
    expect(schema.byName.meta).toEqual({ name: "meta", type: "string", esType: "flattened", termPath: "meta" });
    expect(schema.byName.ip).toEqual({ name: "ip", type: "string", esType: "ip", termPath: "ip" });
    expect(schema.byName.ver).toEqual({ name: "ver", type: "string", esType: "version", termPath: "ver" });
  });

  it("match_only_text has no termPath and carries a limitation", () => {
    const body = { idx: { mappings: { properties: { log: { type: "match_only_text" } } } } };
    const schema = esSchemaFromMapping(body, "idx");
    expect(schema.byName.log.termPath).toBeUndefined();
    expect(schema.byName.log.limitation).toContain("match_only_text");
    expect(schema.fields[0].limitation).toContain("match_only_text");
  });

  it("an alias inherits its target's type, termPath and sourcePath", () => {
    const body = {
      idx: {
        mappings: {
          properties: {
            aliasCat: { type: "alias", path: "category" },
            aliasCust: { type: "alias", path: "customer" },
            category: { type: "keyword" },
            customer: { type: "text", fields: { keyword: { type: "keyword" } } },
          },
        },
      },
    };
    const schema = esSchemaFromMapping(body, "idx");
    expect(schema.byName.aliasCat).toEqual({
      name: "aliasCat",
      type: "string",
      esType: "alias",
      termPath: "category",
      sourcePath: "category",
    });
    expect(schema.byName.aliasCust).toEqual({
      name: "aliasCust",
      type: "string",
      esType: "alias",
      termPath: "customer.keyword",
      sourcePath: "customer",
    });
  });

  it("an alias to a keyword-less text target inherits the limitation", () => {
    const body = {
      idx: {
        mappings: {
          properties: {
            aliasNotes: { type: "alias", path: "notes" },
            notes: { type: "text" },
          },
        },
      },
    };
    const schema = esSchemaFromMapping(body, "idx");
    expect(schema.byName.aliasNotes.termPath).toBeUndefined();
    expect(schema.byName.aliasNotes.limitation).toBeDefined();
    expect(schema.fields.find((f) => f.name === "aliasNotes")?.limitation).toBeDefined();
  });

  it("a dangling alias is reported, not dropped", () => {
    const body = {
      idx: {
        mappings: {
          properties: {
            dangling: { type: "alias", path: "missing_field" },
          },
        },
      },
    };
    const schema = esSchemaFromMapping(body, "idx");
    expect(schema.byName.dangling).toBeUndefined();
    expect(schema.unsupported).toHaveLength(1);
    expect(schema.unsupported[0].name).toBe("dangling");
    expect(schema.unsupported[0].esType).toBe("alias");
    expect(schema.unsupported[0].reason).toContain("missing_field");
  });

  it("empty properties yields an empty schema", () => {
    const body = { idx: { mappings: { properties: {} } } };
    expect(esSchemaFromMapping(body, "idx")).toEqual({ fields: [], byName: {}, unsupported: [] });
  });

  it("an empty body yields an empty schema", () => {
    expect(esSchemaFromMapping({}, "idx")).toEqual({ fields: [], byName: {}, unsupported: [] });
  });
});

describe("esEnumProbeBody", () => {
  it("returns null when no field qualifies", () => {
    const body = { idx: { mappings: { properties: { total: { type: "double" } } } } };
    const schema = esSchemaFromMapping(body, "idx");
    expect(esEnumProbeBody(schema)).toBeNull();
  });

  it("emits size: 0 and one terms agg per candidate", () => {
    const schema = esSchemaFromMapping(MAPPING_BODY, "refine003-probe-v1");
    const probe = esEnumProbeBody(schema) as { size: number; aggs: Record<string, unknown> };
    expect(probe.size).toBe(0);
    expect(probe.aggs).toEqual({
      category: { terms: { field: "category", size: ES_ENUM_MAX_VALUES + 1 } },
      customer: { terms: { field: "customer.keyword", size: ES_ENUM_MAX_VALUES + 1 } },
    });
  });
});

describe("applyEsEnumProbe", () => {
  it("promotes a field to enum when at/under the threshold and sum_other_doc_count is 0", () => {
    const schema = esSchemaFromMapping(MAPPING_BODY, "refine003-probe-v1");
    const probeResponse = {
      aggregations: {
        category: { sum_other_doc_count: 0, buckets: [{ key: "Food" }, { key: "Toys" }] },
        customer: { sum_other_doc_count: 5, buckets: [{ key: "Alice" }] },
      },
    };
    const applied = applyEsEnumProbe(schema, probeResponse);
    expect(applied.byName.category.type).toBe("enum");
    expect(applied.fields.find((f) => f.name === "category")?.enumValues).toEqual(["Food", "Toys"]);
    // sum_other_doc_count > 0 leaves it "string"
    expect(applied.byName.customer.type).toBe("string");
  });

  it("leaves a field string when the bucket count exceeds the threshold", () => {
    const body = { idx: { mappings: { properties: { region: { type: "keyword" } } } } };
    const schema = esSchemaFromMapping(body, "idx");
    const buckets = Array.from({ length: ES_ENUM_MAX_VALUES + 1 }, (_, i) => ({ key: `r${i}` }));
    const applied = applyEsEnumProbe(schema, {
      aggregations: { region: { sum_other_doc_count: 0, buckets } },
    });
    expect(applied.byName.region.type).toBe("string");
  });

  it("applyEsEnumProbe carries unsupported through", () => {
    const unsupportedItem = { name: "geo", esType: "geo_point", reason: "unsupported" };
    const schema = {
      fields: [{ name: "category", type: "string" as const }],
      byName: { category: { name: "category", type: "string" as const, esType: "keyword", termPath: "category" } },
      unsupported: [unsupportedItem],
    };

    const withoutAggs = applyEsEnumProbe(schema, {});
    expect(withoutAggs.unsupported).toEqual([unsupportedItem]);

    const withAggs = applyEsEnumProbe(schema, {
      aggregations: { category: { sum_other_doc_count: 0, buckets: [{ key: "A" }] } },
    });
    expect(withAggs.unsupported).toEqual([unsupportedItem]);
  });
});
