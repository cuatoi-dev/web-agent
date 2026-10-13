import { describe, expect, it, vi } from "vitest";
import { resolveLocalRefs } from "./resolve-local-refs.js";

interface SchemaNode {
  type?: string;
  description?: string;
  $ref?: string | number;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  content?: Record<string, { schema?: SchemaNode }>;
  requestBody?: { content: Record<string, { schema?: SchemaNode }> };
  get?: { requestBody: { content: Record<string, { schema?: SchemaNode }> } };
  schemas?: Record<string, SchemaNode>;
  Node?: SchemaNode;
  A?: SchemaNode;
  X?: SchemaNode;
  [key: string]: unknown;
}

describe("resolveLocalRefs", () => {
  it("resolves a nested local ref", () => {
    const doc = {
      components: { schemas: { Cat: { type: "object" } } },
      paths: {
        "/cats": {
          get: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Cat" },
                },
              },
            },
          },
        },
      },
    };
    const resolved = resolveLocalRefs(doc);
    const paths = resolved["paths"] as Record<string, SchemaNode>;
    const schema = paths["/cats"]?.get?.requestBody.content["application/json"]?.schema;
    expect(schema).toEqual({ type: "object" });
    expect(schema?.$ref).toBeUndefined();
  });

  it("resolves a ref to a ref", () => {
    const doc = {
      components: {
        schemas: {
          A: { $ref: "#/components/schemas/B" },
          B: { type: "string" },
        },
      },
      node: { $ref: "#/components/schemas/A" },
    };
    const resolved = resolveLocalRefs(doc);
    expect(resolved.node).toEqual({ type: "string" });
  });

  it("terminates a mutually recursive pair and produces a real cycle", () => {
    const doc = {
      components: {
        schemas: {
          A: { type: "object", properties: { b: { $ref: "#/components/schemas/B" } } },
          B: { type: "object", properties: { a: { $ref: "#/components/schemas/A" } } },
        },
      },
    };
    const resolved = resolveLocalRefs(doc);
    const components = resolved["components"] as SchemaNode;
    const schemas = components.schemas as Record<string, SchemaNode>;
    const schemaA = schemas["A"];
    const propB = schemaA?.properties?.["b"] as SchemaNode;
    const propA = propB?.properties?.["a"] as SchemaNode;
    expect(propA.properties).toBe(schemaA.properties);
    expect(() => JSON.stringify(resolved)).toThrow();
  });

  it("terminates a self-referential schema", () => {
    const doc = {
      components: {
        schemas: {
          Node: { type: "object", properties: { child: { $ref: "#/components/schemas/Node" } } },
        },
      },
    };
    const resolved = resolveLocalRefs(doc);
    const components = resolved["components"] as SchemaNode;
    const schemas = components.schemas as Record<string, SchemaNode>;
    const node = schemas["Node"];
    const child = node?.properties?.["child"] as SchemaNode;
    expect(child.properties).toBe(node.properties);
  });

  it("does not loop on a ref pointing directly at itself", () => {
    const doc = {
      components: { schemas: { X: { $ref: "#/components/schemas/X" } } },
    };
    const resolved = resolveLocalRefs(doc);
    const components = resolved["components"] as SchemaNode;
    const schemas = components.schemas as Record<string, SchemaNode>;
    const x = schemas["X"];
    expect(x.$ref).toBeUndefined();
  });

  it("unescapes pointer tokens in the correct order", () => {
    const doc1 = {
      components: { schemas: { "a/b~c": { type: "string" } } },
      node: { $ref: "#/components/schemas/a~1b~0c" },
    };
    const resolved1 = resolveLocalRefs(doc1);
    expect(resolved1.node).toEqual({ type: "string" });

    // A key literally named "~1", addressed as "~01" — resolves only if `~0`
    // is unescaped AFTER `~1`, else "~01" -> "~1" -> "/".
    const doc2 = {
      x: { "~1": { type: "number" } },
      node: { $ref: "#/x/~01" },
    };
    const resolved2 = resolveLocalRefs(doc2);
    expect(resolved2.node).toEqual({ type: "number" });
  });

  it("resolves a percent-encoded segment", () => {
    const doc = {
      x: { "A B": { type: "boolean" } },
      node: { $ref: "#/x/A%20B" },
    };
    const resolved = resolveLocalRefs(doc);
    expect(resolved.node).toEqual({ type: "boolean" });
  });

  it("leaves a pointer that does not resolve in place", () => {
    const doc = { node: { $ref: "#/components/schemas/Missing" } };
    const resolved = resolveLocalRefs(doc);
    expect(resolved.node).toEqual({ $ref: "#/components/schemas/Missing" });
  });

  it("leaves a malformed percent-escape in place", () => {
    const doc = { node: { $ref: "#/x/%zz" } };
    const resolved = resolveLocalRefs(doc);
    expect(resolved.node).toEqual({ $ref: "#/x/%zz" });
  });

  it("leaves an external URL ref in place and never fetches", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const doc = { node: { $ref: "https://example.com/s.json#/A" } };
    const resolved = resolveLocalRefs(doc);
    expect(resolved.node).toEqual({ $ref: "https://example.com/s.json#/A" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("leaves a relative file ref in place", () => {
    const doc = {
      a: { $ref: "other.yaml#/A" },
      b: { $ref: "other.yaml" },
    };
    const resolved = resolveLocalRefs(doc);
    expect(resolved.a).toEqual({ $ref: "other.yaml#/A" });
    expect(resolved.b).toEqual({ $ref: "other.yaml" });
  });

  it("does not modify the input document", () => {
    const doc = {
      components: { schemas: { Cat: { type: "object" } } },
      node: { $ref: "#/components/schemas/Cat" },
    };
    const snapshot = JSON.parse(JSON.stringify(doc)) as typeof doc;
    resolveLocalRefs(doc);
    expect(doc).toEqual(snapshot);
    const docNode = doc.node as SchemaNode;
    expect(docNode.$ref).toBe("#/components/schemas/Cat");
  });

  it("keeps a key written next to a $ref over the target's key", () => {
    const doc = {
      components: { schemas: { Cat: { description: "theirs", type: "object" } } },
      node: { $ref: "#/components/schemas/Cat", description: "mine" },
    };
    const resolved = resolveLocalRefs(doc);
    expect(resolved.node).toEqual({ description: "mine", type: "object" });
  });

  it("leaves a non-string $ref alone", () => {
    const doc = { node: { $ref: 42 } };
    const resolved = resolveLocalRefs(doc);
    expect(resolved.node).toEqual({ $ref: 42 });
  });

  it("walks arrays", () => {
    const doc = {
      components: { parameters: { Id: { name: "id", in: "path" } } },
      parameters: [{ $ref: "#/components/parameters/Id" }],
    };
    const resolved = resolveLocalRefs(doc);
    expect(resolved.parameters).toEqual([{ name: "id", in: "path" }]);
  });
});
