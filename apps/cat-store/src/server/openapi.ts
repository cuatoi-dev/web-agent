export const ordersOpenApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Cat Store Orders API",
    version: "1.0.0",
    description: "REST API for managing and querying Cat Store customer orders.",
  },
  paths: {
    "/api/orders/describe": {
      get: {
        summary: "Describe dataset metadata",
        operationId: "describeOrders",
        responses: {
          "200": {
            description: "Source metadata and field schemas",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SourceInfo" },
              },
            },
          },
        },
      },
    },
    "/api/orders": {
      get: {
        summary: "Query orders",
        operationId: "queryOrders",
        parameters: [
          {
            name: "q",
            in: "query",
            required: false,
            description: "JSON-encoded DataQuery object, including the optional free-text `search` term",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Query result containing matching order rows",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/QueryResult" },
              },
            },
          },
          "400": {
            description: "Bad Request — invalid JSON or malformed query",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
      post: {
        summary: "Create a new order",
        operationId: "createOrder",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateOrderInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "Created order object",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Order" },
              },
            },
          },
          "400": {
            description: "Bad Request — validation failed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/orders/openapi.json": {
      get: {
        summary: "Get OpenAPI specification",
        operationId: "getOpenApiSpec",
        responses: {
          "200": {
            description: "OpenAPI 3.0.3 JSON document",
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      FieldSchema: {
        type: "object",
        required: ["name", "type"],
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["string", "number", "date", "enum", "boolean"] },
          description: { type: "string" },
          enumValues: { type: "array", items: { type: "string" } },
        },
      },
      SourceInfo: {
        type: "object",
        required: ["name", "fields", "rowCount"],
        properties: {
          name: { type: "string", example: "orders" },
          description: { type: "string" },
          fields: { type: "array", items: { $ref: "#/components/schemas/FieldSchema" } },
          rowCount: { type: "integer" },
        },
      },
      Order: {
        type: "object",
        required: ["id", "createdAt", "customer", "category", "total", "status", "itemCount", "items"],
        properties: {
          id: { type: "string", example: "ORD-1001" },
          createdAt: { type: "string", format: "date-time" },
          customer: { type: "string" },
          category: { type: "string", enum: ["Food", "Toys", "Beds", "Grooming", "Health"] },
          total: { type: "number" },
          status: { type: "string", enum: ["placed", "shipped", "delivered", "cancelled"] },
          itemCount: { type: "integer" },
          items: { type: "string" },
        },
      },
      CreateOrderInput: {
        type: "object",
        properties: {
          customer: { type: "string" },
          category: { type: "string" },
          total: { type: "number" },
          status: { type: "string" },
          itemCount: { type: "integer" },
          items: { type: "string" },
        },
      },
      QueryResult: {
        type: "object",
        required: ["source", "aggregated", "fields", "rows", "page"],
        properties: {
          source: { type: "string", example: "orders" },
          aggregated: { type: "boolean" },
          fields: { type: "array", items: { $ref: "#/components/schemas/FieldSchema" } },
          rows: { type: "array", items: { $ref: "#/components/schemas/Order" } },
          page: {
            type: "object",
            required: ["total", "hasMore"],
            properties: {
              total: { type: "integer" },
              hasMore: { type: "boolean" },
              offset: { type: "integer" },
              limit: { type: "integer" },
            },
          },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" },
        },
      },
    },
  },
};
