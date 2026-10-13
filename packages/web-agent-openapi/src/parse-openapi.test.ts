import { afterEach, describe, expect, it, vi } from "vitest";
import { parseOpenApiOperations } from "./parse-openapi.js";
import type { ApiSourceConfig } from "./types.js";

function makeSource(overrides: Partial<ApiSourceConfig> = {}): ApiSourceConfig {
  return {
    name: "cat-store",
    description: "Cat store operations",
    specUrl: "/api/openapi.json",
    operations: ["getCat", "listCats"],
    credentials: "same-origin",
    required: true,
    ...overrides,
  };
}

function makeDoc(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "Cat Store API", version: "1.0.0" },
    paths: {
      "/cats": {
        get: {
          operationId: "listCats",
          summary: "List cats",
          responses: { "200": { description: "OK" } },
        },
        post: {
          operationId: "createCat",
          summary: "Create cat",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CatInput" },
              },
            },
          },
          responses: { "201": { description: "Created" } },
        },
      },
      "/cats/{id}": {
        get: {
          operationId: "getCat",
          summary: "Get a cat",
          description: "Long desc",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "verbose",
              in: "query",
              required: false,
              schema: { type: "boolean" },
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
    },
    components: {
      schemas: {
        CatInput: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
          },
        },
      },
    },
  };
}

describe("parseOpenApiOperations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns one descriptor per whitelisted operationId, in whitelist order", async () => {
    const source = makeSource({ operations: ["listCats", "getCat"] });
    const doc = makeDoc();
    const result = await parseOpenApiOperations(source, doc);
    expect(result.map((d) => d.operationId)).toEqual(["listCats", "getCat"]);
  });

  it("never produces a descriptor for an operation outside the whitelist", async () => {
    const source = makeSource({ operations: ["listCats"] });
    const doc = makeDoc();
    const result = await parseOpenApiOperations(source, doc);
    expect(result.some((d) => d.operationId === "createCat")).toBe(false);
  });

  it("fixes method and path from the spec", async () => {
    const source = makeSource({ operations: ["getCat"] });
    const doc = makeDoc();
    const result = await parseOpenApiOperations(source, doc);
    expect(result[0]).toMatchObject({ method: "get", path: "/cats/{id}" });
  });

  it("carries summary and description through", async () => {
    const source = makeSource({ operations: ["getCat"] });
    const doc = makeDoc();
    const result = await parseOpenApiOperations(source, doc);
    expect(result[0].summary).toBe("Get a cat");
    expect(result[0].description).toBe("Long desc");
  });

  it("maps path and query parameters with their schemas and required flags", async () => {
    const source = makeSource({ operations: ["getCat"] });
    const doc = makeDoc();
    const result = await parseOpenApiOperations(source, doc);
    expect(result[0].parameters).toEqual([
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      {
        name: "verbose",
        in: "query",
        required: false,
        schema: { type: "boolean" },
      },
    ]);
  });

  it("rejects an operationId the document does not define", async () => {
    const source = makeSource({ operations: ["nopeOperation"] });
    const doc = makeDoc();
    await expect(parseOpenApiOperations(source, doc)).rejects.toThrow(
      /API source "cat-store" whitelists operation "nopeOperation", which the OpenAPI document does not define\./
    );
  });

  it("rejects a header parameter", async () => {
    const source = makeSource({ operations: ["getHeaderCat"] });
    const doc = makeDoc();
    (doc["paths"] as Record<string, unknown>)["/header"] = {
      get: {
        operationId: "getHeaderCat",
        parameters: [
          { name: "X-Tenant", in: "header", required: true, schema: { type: "string" } },
        ],
      },
    };
    await expect(parseOpenApiOperations(source, doc)).rejects.toThrow(
      /unsupported parameter location "header" for parameter "X-Tenant"/
    );
  });

  it("rejects a cookie parameter", async () => {
    const source = makeSource({ operations: ["getCookieCat"] });
    const doc = makeDoc();
    (doc["paths"] as Record<string, unknown>)["/cookie"] = {
      get: {
        operationId: "getCookieCat",
        parameters: [
          { name: "session_token", in: "cookie", required: true, schema: { type: "string" } },
        ],
      },
    };
    await expect(parseOpenApiOperations(source, doc)).rejects.toThrow(
      /unsupported parameter location "cookie"/
    );
  });

  it("resolves a local $ref in the JSON request body", async () => {
    const source = makeSource({ operations: ["createCat"] });
    const doc = makeDoc();
    const result = await parseOpenApiOperations(source, doc);
    expect(result[0].requestBody).toEqual({
      required: true,
      schema: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
    });
    expect(JSON.stringify(result[0].requestBody!.schema)).not.toContain("$ref");
  });

  it("rejects an external $ref reached by a whitelisted operation and never fetches it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const source = makeSource({ operations: ["extCat"] });
    const doc = makeDoc();
    (doc["paths"] as Record<string, unknown>)["/ext"] = {
      get: {
        operationId: "extCat",
        parameters: [
          {
            name: "ext",
            in: "query",
            required: false,
            schema: { $ref: "https://example.com/s.json#/A" },
          },
        ],
      },
    };
    await expect(parseOpenApiOperations(source, doc)).rejects.toThrow(
      /unresolved external \$ref "https:\/\/example\.com\/s\.json#\/A".*not fetched/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores an external $ref that only a non-whitelisted operation reaches", async () => {
    const source = makeSource({ operations: ["listCats"] });
    const doc = makeDoc();
    (doc["paths"] as Record<string, unknown>)["/ext"] = {
      get: {
        operationId: "extCat",
        parameters: [
          {
            name: "ext",
            in: "query",
            required: false,
            schema: { $ref: "https://example.com/s.json#/A" },
          },
        ],
      },
    };
    const result = await parseOpenApiOperations(source, doc);
    expect(result).toHaveLength(1);
    expect(result[0].operationId).toBe("listCats");
  });

  it("rejects a request body with no application/json media type", async () => {
    const source = makeSource({ operations: ["xmlCat"] });
    const doc = makeDoc();
    (doc["paths"] as Record<string, unknown>)["/xml"] = {
      post: {
        operationId: "xmlCat",
        requestBody: {
          required: true,
          content: {
            "application/xml": { schema: { type: "string" } },
          },
        },
      },
    };
    await expect(parseOpenApiOperations(source, doc)).rejects.toThrow(
      /no "application\/json" media type \(found: application\/xml\)/
    );
  });

  it("returns an empty parameter list and no requestBody for a bare operation", async () => {
    const source = makeSource({ operations: ["listCats"] });
    const doc = makeDoc();
    const result = await parseOpenApiOperations(source, doc);
    expect(result[0].parameters).toEqual([]);
    expect(result[0].requestBody).toBeUndefined();
  });

  it("merges path-item-level parameters into the operation", async () => {
    const source = makeSource({ operations: ["getItem"] });
    const doc = makeDoc();
    (doc["paths"] as Record<string, unknown>)["/items/{id}"] = {
      parameters: [
        { name: "trace", in: "query", required: false, schema: { type: "string" } },
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      get: {
        operationId: "getItem",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
        ],
      },
    };
    const result = await parseOpenApiOperations(source, doc);
    expect(result[0].parameters).toEqual([
      { name: "trace", in: "query", required: false, schema: { type: "string" } },
      { name: "id", in: "path", required: true, schema: { type: "integer" } },
    ]);
  });

  it("handles a self-referential local $ref without hanging", async () => {
    const source = makeSource({ operations: ["getTree"] });
    const doc = makeDoc();
    (doc["paths"] as Record<string, unknown>)["/tree"] = {
      get: {
        operationId: "getTree",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Node" },
            },
          },
        },
      },
    };
    (doc["components"] as Record<string, unknown>)["schemas"] = {
      Node: {
        type: "object",
        properties: {
          child: { $ref: "#/components/schemas/Node" },
        },
      },
    };
    const result = await parseOpenApiOperations(source, doc);
    expect(result[0].requestBody?.schema.properties).toHaveProperty("child");
  });

  it("reports the parameter-location rejection before the external-$ref rejection", async () => {
    const source = makeSource({ operations: ["badCat"] });
    const doc = makeDoc();
    (doc["paths"] as Record<string, unknown>)["/bad"] = {
      get: {
        operationId: "badCat",
        parameters: [
          { name: "X-Auth", in: "header", required: true, schema: { type: "string" } },
          { name: "ext", in: "query", required: false, schema: { $ref: "https://example.com/s.json#/A" } },
        ],
      },
    };
    await expect(parseOpenApiOperations(source, doc)).rejects.toThrow(
      /unsupported parameter location "header"/
    );
  });
});
