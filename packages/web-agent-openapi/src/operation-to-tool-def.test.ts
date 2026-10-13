import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { operationToToolDef } from "./operation-to-tool-def.js";
import type {
  ApiOperationDescriptor,
  ApiOperationParameter,
  ApiOperationRequestBody,
  ApiSourceConfig,
} from "./types.js";

function makeSource(overrides: Partial<ApiSourceConfig> = {}): ApiSourceConfig {
  return {
    name: "cat-store",
    description: "Cat store operations",
    specUrl: "/api/openapi.json",
    operations: ["getCat"],
    credentials: "same-origin",
    required: true,
    ...overrides,
  };
}

function makeParam(overrides: Partial<ApiOperationParameter>): ApiOperationParameter {
  return {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string" },
    ...overrides,
  };
}

function makeBody(overrides: Partial<ApiOperationRequestBody> = {}): ApiOperationRequestBody {
  return {
    required: true,
    schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    ...overrides,
  };
}

function makeDescriptor(overrides: Partial<ApiOperationDescriptor> = {}): ApiOperationDescriptor {
  return {
    operationId: "getCat",
    method: "get",
    path: "/cats/{id}",
    parameters: [],
    ...overrides,
  };
}

describe("operationToToolDef", () => {
  describe("name sanitization & prefixing", () => {
    it("prefixes sanitized source name with sanitized operationId", () => {
      const def = operationToToolDef(makeSource({ name: "cat-store" }), makeDescriptor());
      expect(def.toolDef.name).toBe("cat_store_getCat");
    });

    it("sanitizes punctuation in both source name and operationId", () => {
      const def = operationToToolDef(
        makeSource({ name: "my.api!v1" }),
        makeDescriptor({ operationId: "find-cats" }),
      );
      expect(def.toolDef.name).toBe("my_api_v1_find_cats");
    });

    it("falls back to 'op' when operationId sanitizes to empty", () => {
      const def = operationToToolDef(makeSource({ name: "cat-store" }), makeDescriptor({ operationId: "!!!" }));
      expect(def.toolDef.name).toBe("cat_store_op");
    });
  });

  describe("description fallback chain", () => {
    it("uses summary when present", () => {
      const def = operationToToolDef(
        makeSource(),
        makeDescriptor({ summary: "Get a cat", description: "Longer description" }),
      );
      expect(def.toolDef.description).toBe("Get a cat");
    });

    it("uses description when summary is absent", () => {
      const def = operationToToolDef(makeSource(), makeDescriptor({ description: "Longer description" }));
      expect(def.toolDef.description).toBe("Longer description");
    });

    it("uses the default template when both are absent", () => {
      const def = operationToToolDef(makeSource(), makeDescriptor());
      expect(def.toolDef.description).toBe("API operation getCat from cat-store");
    });
  });

  describe("inputSchema composition", () => {
    it("puts path params in required and query params only when required", () => {
      const descriptor = makeDescriptor({
        parameters: [
          makeParam({ name: "id", in: "path", required: true }),
          makeParam({ name: "verbose", in: "query", required: false, schema: { type: "boolean" } }),
          makeParam({ name: "limit", in: "query", required: true, schema: { type: "integer" } }),
        ],
      });
      const def = operationToToolDef(makeSource(), descriptor);
      expect(def.toolDef.inputSchema).toEqual({
        type: "object",
        properties: {
          id: { type: "string" },
          verbose: { type: "boolean" },
          limit: { type: "integer" },
        },
        required: ["id", "limit"],
      });
    });

    it("adds request body under 'body' and marks it required when the body is required", () => {
      const descriptor = makeDescriptor({
        parameters: [makeParam({ name: "id", in: "path", required: true })],
        requestBody: makeBody({ required: true }),
      });
      const def = operationToToolDef(makeSource(), descriptor);
      expect(def.toolDef.inputSchema).toEqual({
        type: "object",
        properties: {
          id: { type: "string" },
          body: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
        required: ["id", "body"],
      });
    });

    it("does not mark an optional request body as required", () => {
      const descriptor = makeDescriptor({
        requestBody: makeBody({ required: false }),
      });
      const def = operationToToolDef(makeSource(), descriptor);
      const inputSchema = def.toolDef.inputSchema as Record<string, unknown>;
      expect(inputSchema.required).toBeUndefined();
      expect((inputSchema.properties as Record<string, unknown>)["body"]).toBeDefined();
    });

    it("omits the required array when nothing is required", () => {
      const descriptor = makeDescriptor({
        parameters: [makeParam({ name: "verbose", in: "query", required: false })],
      });
      const def = operationToToolDef(makeSource(), descriptor);
      expect(def.toolDef.inputSchema).toEqual({
        type: "object",
        properties: { verbose: { type: "string" } },
      });
    });
  });

  describe("collision guards", () => {
    it("throws on a parameter name repeated across locations", () => {
      const descriptor = makeDescriptor({
        parameters: [
          makeParam({ name: "id", in: "path", required: true }),
          makeParam({ name: "id", in: "query", required: false }),
        ],
      });
      expect(() => operationToToolDef(makeSource(), descriptor)).toThrow(
        'API source "cat-store" operation "getCat" has duplicate parameter name "id" across parameter locations.',
      );
    });

    it("throws when a parameter is named 'body' and a requestBody is present", () => {
      const descriptor = makeDescriptor({
        parameters: [makeParam({ name: "body", in: "query", required: false })],
        requestBody: makeBody(),
      });
      expect(() => operationToToolDef(makeSource(), descriptor)).toThrow(
        'API source "cat-store" operation "getCat" parameter "body" collides with requestBody.',
      );
    });
  });

  describe("location metadata", () => {
    it("maps path and query names and the body flag", () => {
      const descriptor = makeDescriptor({
        parameters: [
          makeParam({ name: "id", in: "path", required: true }),
          makeParam({ name: "verbose", in: "query", required: false }),
        ],
        requestBody: makeBody(),
      });
      const def = operationToToolDef(makeSource(), descriptor);
      expect(def.paramLocations).toEqual({ path: ["id"], query: ["verbose"], hasBody: true });
    });

    it("reports no body when requestBody is absent", () => {
      const def = operationToToolDef(makeSource(), makeDescriptor());
      expect(def.paramLocations).toEqual({ path: [], query: [], hasBody: false });
    });
  });

  describe("container shape", () => {
    it("returns the source and descriptor unchanged", () => {
      const source = makeSource();
      const descriptor = makeDescriptor();
      const def = operationToToolDef(source, descriptor);
      expect(def.source).toBe(source);
      expect(def.descriptor).toBe(descriptor);
    });

    it("uses the default execute that reports not-implemented when none is supplied", async () => {
      const def = operationToToolDef(makeSource(), makeDescriptor());
      const outcome = await def.toolDef.execute({}, {} as never);
      expect(outcome.content).toBe("API operation execution not implemented.");
    });

    it("uses a supplied execute handler", async () => {
      const execute = () => Promise.resolve({ content: "handled" });
      const def = operationToToolDef(makeSource(), makeDescriptor(), execute);
      const outcome = await def.toolDef.execute({}, {} as never);
      expect(outcome.content).toBe("handled");
    });
  });

  describe("draft 2020-12 schema validity", () => {
    it("compiles every generated inputSchema with Ajv2020", () => {
      const cases: ApiOperationDescriptor[] = [
        makeDescriptor({
          parameters: [
            makeParam({ name: "id", in: "path", required: true }),
            makeParam({ name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1 } }),
          ],
        }),
        makeDescriptor({
          requestBody: makeBody({ required: false }),
        }),
        makeDescriptor({
          parameters: [
            makeParam({ name: "id", in: "path", required: true }),
            makeParam({ name: "q", in: "query", required: false, schema: { type: "string", pattern: "^[a-z]+$" } }),
          ],
          requestBody: makeBody({ required: true }),
        }),
      ];
      const Ajv2020Class = Ajv2020 as unknown as new (opts?: { strict?: boolean }) => {
        compile: (schema: unknown) => unknown;
      };
      const ajv = new Ajv2020Class({ strict: false });
      for (const descriptor of cases) {
        const def = operationToToolDef(makeSource(), descriptor);
        expect(() => {
          ajv.compile(def.toolDef.inputSchema);
        }).not.toThrow();
      }
    });
  });
});
