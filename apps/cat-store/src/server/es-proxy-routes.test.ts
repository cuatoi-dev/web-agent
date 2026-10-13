// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import { createEsProxyRouter, createEsNotConfiguredRouter } from "./es-proxy-routes.js";
import type { EsConfig } from "./es-config.js";
import { startTestServer, type TestServer } from "./test-helpers.js";

// The network boundary is the only thing mocked — a fetchImpl stub passed to
// createEsProxyRouter. Express and the router run for real.

const CFG: EsConfig = {
  url: "http://es.invalid:9200",
  user: "elastic",
  password: "s3cr3t-pw",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let server: TestServer | undefined;

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
});

function buildApp(fetchImpl: typeof fetch): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/es-orders", createEsProxyRouter(CFG, fetchImpl));
  return app;
}

describe("createEsProxyRouter", () => {
  it("forwards GET /<index>/_mapping to CATSTORE_ES_URL, with Authorization attached", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl = ((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(200, { "catstore-orders-v1": { mappings: { properties: {} } } });
    }) as unknown as typeof fetch;

    server = await startTestServer(buildApp(fetchImpl));
    const res = await fetch(`${server.url}/api/es-orders/catstore-orders-v1/_mapping`);
    const body = (await res.json()) as unknown;

    expect(capturedUrl).toBe("http://es.invalid:9200/catstore-orders-v1/_mapping");
    expect((capturedInit?.headers as Record<string, string>).Authorization).toBe(
      "Basic " + Buffer.from("elastic:s3cr3t-pw").toString("base64"),
    );
    expect(res.status).toBe(200);
    expect(body).toEqual({ "catstore-orders-v1": { mappings: { properties: {} } } });
  });

  it("forwards POST /<index>/_search with the same JSON body, byte-for-byte after re-parse", async () => {
    let capturedBody: unknown;
    let capturedContentType = "";
    const fetchImpl = ((_url: string, init?: RequestInit) => {
      capturedContentType = (init?.headers as Record<string, string>)["Content-Type"];
      capturedBody = JSON.parse(init!.body as string);
      return jsonResponse(200, { hits: { total: { value: 0 }, hits: [] } });
    }) as unknown as typeof fetch;

    server = await startTestServer(buildApp(fetchImpl));
    const sentBody = { size: 0, query: { match_all: {} } };
    const res = await fetch(`${server.url}/api/es-orders/catstore-orders-v1/_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sentBody),
    });

    expect(res.status).toBe(200);
    expect(capturedBody).toEqual(sentBody);
    expect(capturedContentType).toBe("application/json");
  });

  it("a query string survives the hop", async () => {
    let capturedUrl = "";
    const fetchImpl = ((url: string) => {
      capturedUrl = url;
      return jsonResponse(200, {});
    }) as unknown as typeof fetch;

    server = await startTestServer(buildApp(fetchImpl));
    await fetch(`${server.url}/api/es-orders/catstore-orders-v1/_search?scroll=1m`);

    expect(capturedUrl).toBe("http://es.invalid:9200/catstore-orders-v1/_search?scroll=1m");
  });

  it("an upstream 404 index_not_found_exception reaches the client unchanged", async () => {
    const missingBody = JSON.stringify({
      error: { root_cause: [{ type: "index_not_found_exception", reason: "no such index [x]" }], status: 404 },
    });
    const fetchImpl = (() => new Response(missingBody, { status: 404 })) as unknown as typeof fetch;

    server = await startTestServer(buildApp(fetchImpl));
    const res = await fetch(`${server.url}/api/es-orders/missing-index/_mapping`);
    const text = await res.text();

    expect(res.status).toBe(404);
    expect(text).toBe(missingBody);
  });

  it("an upstream 400 reaches the client as a 400 with the upstream message", async () => {
    const badBody = JSON.stringify({ error: "Format [...] created output it couldn't parse" });
    const fetchImpl = (() => new Response(badBody, { status: 400 })) as unknown as typeof fetch;

    server = await startTestServer(buildApp(fetchImpl));
    const res = await fetch(`${server.url}/api/es-orders/catstore-orders-v1/_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const text = await res.text();

    expect(res.status).toBe(400);
    expect(text).toBe(badBody);
  });

  it("a rejected fetch -> 502, message names the host origin only, never the password", async () => {
    const fetchImpl = (() => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;

    server = await startTestServer(buildApp(fetchImpl));
    const res = await fetch(`${server.url}/api/es-orders/catstore-orders-v1/_mapping`);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(502);
    expect(body.error).toContain("http://es.invalid:9200");
    expect(body.error).not.toContain(CFG.password);
    expect(body.error).not.toContain(CFG.url + "/catstore-orders-v1");
  });

  it("the password appears in no response body, on any path, including the 502", async () => {
    const okFetch = (() => jsonResponse(200, { ok: true })) as unknown as typeof fetch;
    server = await startTestServer(buildApp(okFetch));
    const res1 = await fetch(`${server.url}/api/es-orders/catstore-orders-v1/_mapping`);
    const text1 = await res1.text();
    expect(text1).not.toContain(CFG.password);
    await server.close();

    const failFetch = (() => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    server = await startTestServer(buildApp(failFetch));
    const res2 = await fetch(`${server.url}/api/es-orders/catstore-orders-v1/_mapping`);
    const text2 = await res2.text();
    expect(text2).not.toContain(CFG.password);
  });
});

describe("createEsNotConfiguredRouter", () => {
  it("with no configuration, any path under the mount -> 500 listing the missing variable names", async () => {
    const app = express();
    app.use("/api/es-orders", createEsNotConfiguredRouter(["CATSTORE_ES_URL", "CATSTORE_ES_PASSWORD"]));
    server = await startTestServer(app);

    const res = await fetch(`${server.url}/api/es-orders/catstore-orders-v1/_mapping`);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(body.error).toContain("CATSTORE_ES_URL");
    expect(body.error).toContain("CATSTORE_ES_PASSWORD");
  });
});
