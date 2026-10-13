// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import { inflateSync } from "node:zlib";
import path from "node:path";
import os from "node:os";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "./app.js";
import { OrdersStore } from "./orders-store.js";
import { buildMcpServer } from "./mcp.js";
import { startTestServer, type TestServer } from "./test-helpers.js";
import { bigJsonReport, bigTextLog } from "./dev-big-tool-results.js";
import type { Order } from "../shared/orders.js";
import type { QueryResult } from "@cuatoi/web-agent-core";

/** The error envelope the MCP transport returns for a rejected request. */
interface McpErrorBody {
  error: { code: number; message: string };
}

describe("mcp endpoint", () => {
  let store: OrdersStore;
  let srv: TestServer;
  let mcpUrl: URL;

  beforeEach(async () => {
    store = new OrdersStore();
    srv = await startTestServer(createApp(store));
    mcpUrl = new URL(`${srv.url}/mcp`);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await srv.close();
  });

  const connect = async (name = "test-client") => {
    const client = new Client({ name, version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(mcpUrl));
    return client;
  };

  // 1. buildMcpServer returns a fresh instance each call
  it("buildMcpServer returns a fresh instance each call", () => {
    expect(buildMcpServer(store)).not.toBe(buildMcpServer(store));
  });

  // 2. tools/list advertises exactly one tool in production
  it("tools/list advertises exactly one tool in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const client = await connect();
    const res = await client.listTools();
    expect(res.tools.map((t) => t.name)).toEqual(["place_order"]);
    expect(res.tools[0].description).toContain("order");
    await client.close();
  });

  // Development and test expose the fixtures after place_order.
  it("development and test advertise the dev fixtures after place_order", async () => {
    for (const env of ["development", "test"]) {
      vi.stubEnv("NODE_ENV", env);
      const client = await connect(`client-${env}`);
      try {
        const res = await client.listTools();
        expect(res.tools.map((t) => t.name), env).toEqual([
          "place_order",
          "dev_big_json_report",
          "dev_big_text_log",
          "dev_two_charts",
        ]);
      } finally {
        await client.close();
      }
    }
  });

  // 2c. an unset NODE_ENV does not expose the fixtures
  it("an unset NODE_ENV advertises place_order alone", async () => {
    const prior = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      const client = await connect("client-unset");
      const res = await client.listTools();
      expect(res.tools.map((t) => t.name)).toEqual(["place_order"]);
      await client.close();
    } finally {
      if (prior === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prior;
    }
  });

  // 3. advertised input schema mirrors CreateOrderInput
  it("advertised input schema mirrors CreateOrderInput", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const client = await connect();
    const res = await client.listTools();
    const schema = res.tools[0].inputSchema as {
      properties: Record<string, { type: string }>;
      required?: string[];
    };
    expect(Object.keys(schema.properties).sort()).toEqual([
      "category",
      "customer",
      "itemCount",
      "items",
      "status",
      "total",
    ]);
    expect(schema.required ?? []).toEqual([]);
    expect(schema.properties.itemCount.type).toBe("integer");
    await client.close();
  });

  // 4. tools/call place_order creates an order in the injected store
  it("tools/call place_order creates an order in the injected store", async () => {
    const before = store.size;
    const client = await connect();
    const result = await client.callTool({
      name: "place_order",
      arguments: {
        customer: "Ada",
        category: "Toys",
        total: 12.5,
        itemCount: 2,
        items: "Feather Wand Toy",
      },
    });
    expect(store.size).toBe(before + 1);
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const order = JSON.parse(content[0].text) as Order;
    expect(order).toMatchObject({
      customer: "Ada",
      category: "Toys",
      total: 12.5,
      itemCount: 2,
      items: "Feather Wand Toy",
      status: "placed",
    });
    expect(order.id).toMatch(/^ORD-\d+$/);
    expect(order.createdAt).toEqual(expect.any(String));
    await client.close();
  });

  // 5. place_order({}) creates a Guest/$0 order (accepted consequence)
  it("place_order({}) creates a Guest/$0 order", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "place_order", arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const order = JSON.parse(content[0].text) as Order;
    expect(order).toMatchObject({
      customer: "Guest",
      category: "Food",
      total: 0,
      status: "placed",
      itemCount: 1,
      items: "",
    });
    await client.close();
  });

  // 6. the MCP tool and the REST router share one store
  it("MCP tool and REST router share one store", async () => {
    const before = store.size;
    const client = await connect("share-test");
    await client.callTool({
      name: "place_order",
      arguments: { customer: "ShareTest" },
    });
    expect(store.size).toBe(before + 1);
    // REST API should also reflect the new order
    const res = await fetch(
      `${srv.url}/api/orders?q=${encodeURIComponent(
        JSON.stringify({ filters: [{ field: "customer", op: "eq", value: "ShareTest" }] })
      )}`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as QueryResult;
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows[0].customer).toBe("ShareTest");
    await client.close();
  });

  // 7. invalid argument type is rejected, no order created
  it("invalid argument type is rejected, no order created", async () => {
    const before = store.size;
    const client = await connect();
    const result = await client.callTool({
      name: "place_order",
      arguments: { total: "not-a-number" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("-32602");
    expect(store.size).toBe(before);
    await client.close();
  });

  // 8. CORS preflight returns wildcard
  it("CORS preflight returns wildcard", async () => {
    const res = await fetch(mcpUrl, {
      method: "OPTIONS",
      headers: {
        origin: "http://example.test",
        "access-control-request-method": "POST",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  // 9. Accept: application/json alone -> 406
  it("Accept: application/json alone returns 406", async () => {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      }),
    });
    expect(res.status).toBe(406);
    const json = (await res.json()) as McpErrorBody;
    expect(json.error.code).toBe(-32000);
  });

  // 10. concurrent multi-client — 15 unique orders, each client gets its own responses
  it("concurrent multi-client — 15 unique orders, each client gets its own responses", async () => {
    const before = store.size;
    const results = await Promise.all(
      Array.from({ length: 5 }, async (_, i) => {
        const client = await connect(`client-${i}`);
        const orders = await Promise.all(
          Array.from({ length: 3 }, (__, j) =>
            client.callTool({
              name: "place_order",
              arguments: { customer: `c${i}-${j}` },
            })
          )
        );
        await client.close();
        return orders.map((r) => {
          const content = r.content as Array<{ type: string; text: string }>;
          return JSON.parse(content[0].text) as { id: string; customer: string };
        });
      })
    );

    const allOrders = results.flat();
    expect(store.size).toBe(before + 15);
    const ids = allOrders.map((o) => o.id);
    expect(new Set(ids).size).toBe(15);
    // Verify each order has the right customer tag
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 3; j++) {
        const match = allOrders.find((o) => o.customer === `c${i}-${j}`);
        expect(match).toBeDefined();
      }
    }
  });

  // 11. route ordering: POST /mcp is not swallowed by static asset handlers
  it("route ordering: POST /mcp is not swallowed by static asset handlers", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-store-mcp-test-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "index.html"),
        "<html><body>SPA Index</body></html>"
      );
      const appWithStatic = createApp(store, tmpDir);
      const staticSrv = await startTestServer(appWithStatic);
      try {
        const res = await fetch(`${staticSrv.url}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-11-25",
              capabilities: {},
              clientInfo: { name: "test", version: "1" },
            },
          }),
        });
        expect(res.headers.get("content-type")).not.toMatch(/text\/html/);
        const text = await res.text();
        expect(text).not.toContain("SPA Index");
      } finally {
        await staticSrv.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // 12. non-POST /mcp returns 405 JSON, never static index.html
  it("non-POST /mcp returns 405 JSON, never static index.html", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-store-mcp-test-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "index.html"),
        "<html><body>SPA Index</body></html>"
      );
      const appWithStatic = createApp(store, tmpDir);
      const staticSrv = await startTestServer(appWithStatic);
      try {
        for (const method of ["GET", "DELETE", "PUT"]) {
          const res = await fetch(`${staticSrv.url}/mcp`, { method });
          expect(res.status).toBe(405);
          expect(res.headers.get("content-type")).toMatch(/^application\/json/);
          const json: unknown = await res.json();
          expect(json).toEqual({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method not allowed." },
            id: null,
          });
          // Confirm it is NOT static index.html
          const text2 = JSON.stringify(json);
          expect(text2).not.toContain("SPA Index");
        }
      } finally {
        await staticSrv.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // 13. a real SDK client does not poll /mcp (no reconnect loop)
  it(
    "a real SDK client does not poll /mcp (no reconnect loop)",
    async () => {
      // Close the default srv; we need a counting wrapper
      await srv.close();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-store-mcp-nopoll-"));
      try {
        fs.writeFileSync(
          path.join(tmpDir, "index.html"),
          "<html><body>SPA Index</body></html>"
        );

        const seen: string[] = [];
        const outer = express();
        outer.use((req, _res, next) => {
          seen.push(`${req.method} ${req.path}`);
          next();
        });
        outer.use(createApp(store, tmpDir) as ReturnType<typeof express>);
        srv = await startTestServer(outer);
        mcpUrl = new URL(`${srv.url}/mcp`);

        const client = new Client({ name: "no-poll-test", version: "1.0.0" });
        await client.connect(new StreamableHTTPClientTransport(mcpUrl));
        await client.callTool({ name: "place_order", arguments: { customer: "PollTest" } });

        // Idle for 6 seconds, then count GET /mcp hits
        await new Promise((r) => setTimeout(r, 6000));

        const getCount = seen.filter((s) => s.startsWith("GET /mcp")).length;
        expect(getCount).toBeLessThanOrEqual(2);

        await client.close();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    15_000
  );

  // 14. GET /mcp with Accept: text/event-stream returns 200 SSE stream, not 405
  it("GET /mcp with Accept: text/event-stream returns 200 SSE stream, not 405", async () => {
    const res = await fetch(`${srv.url}/mcp`, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    await res.body?.cancel();
  });

  it("dev_two_charts returns two decodable PNG charts over MCP", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const client = await connect("client-charts");
    try {
      const result = await client.callTool({ name: "dev_two_charts", arguments: {} });
      const content = result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      expect(content[0]).toEqual({ type: "text", text: "Two charts for Q3." });
      const images = content.filter((block) => block.type === "image");
      expect(images).toHaveLength(2);
      for (const [index, image] of images.entries()) {
        expect(image.mimeType).toBe("image/png");
        const png = Buffer.from(image.data!, "base64");
        expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        expect(png.readUInt32BE(16)).toBe(64);
        expect(png.readUInt32BE(20)).toBe(64);
        const compressed: Buffer[] = [];
        for (let offset = 8; offset < png.length;) {
          const length = png.readUInt32BE(offset);
          if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") {
            compressed.push(png.subarray(offset + 8, offset + 8 + length));
          }
          offset += length + 12;
        }
        const scanlines = inflateSync(Buffer.concat(compressed));
        expect(scanlines.length).toBe(64 * 193);
        const colour = index === 0 ? [220, 30, 30] : [30, 180, 50];
        let colouredPixels = 0;
        for (let y = 0; y < 64; y++) {
          expect(scanlines[y * 193]).toBe(0);
          for (let x = 0; x < 64; x++) {
            const offset = y * 193 + 1 + x * 3;
            if (colour.every((value, channel) => scanlines[offset + channel] === value)) colouredPixels++;
          }
        }
        expect(colouredPixels).toBeGreaterThan(40);
      }
    } finally {
      await client.close();
    }
  });

  // 15. dev fixture: 48,210 characters with the note outside both previews
  it("dev_big_json_report returns a 48,210-character report", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const client = await connect("client-json-fixture");
    const result = await client.callTool({ name: "dev_big_json_report", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text.length).toBe(48_210);
    expect(text).toEqual(bigJsonReport());
    const doc = JSON.parse(text) as { orders: Array<{ id: string; note: string }> };
    const noteOrder = doc.orders.find((o) => o.note === "LIVE-PROOF-7731");
    expect(noteOrder?.id).toBe("ORD-050");
    const notePos = text.indexOf("LIVE-PROOF-7731");
    expect(notePos).toBeGreaterThanOrEqual(2_000);
    expect(notePos).toBeLessThanOrEqual(text.length - 2_000 - "LIVE-PROOF-7731".length);
    await client.close();
  });

  // 16. dev fixture: 48,210 characters with the checksum line outside both previews
  it("dev_big_text_log returns a 48,210-character log", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const client = await connect("client-text-fixture");
    const result = await client.callTool({ name: "dev_big_text_log", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text.length).toBe(48_210);
    expect(text).toEqual(bigTextLog());
    const pos = text.indexOf("checksum=LIVE-PROOF-4402");
    expect(pos).toBeGreaterThanOrEqual(2_000);
    expect(pos).toBeLessThanOrEqual(text.length - 2_000 - "checksum=LIVE-PROOF-4402".length);
    expect(text.split("\n").length).toBeGreaterThan(600);
    await client.close();
  });
});
