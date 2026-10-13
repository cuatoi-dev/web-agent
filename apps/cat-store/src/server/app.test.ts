// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SourceInfo } from "@cuatoi/web-agent-core";
import { createApp } from "./app.js";
import { OrdersStore } from "./orders-store.js";
import { startTestServer, readJson, type TestServer } from "./test-helpers.js";

describe("createApp static & SPA serving", () => {
  let tmpDir: string;
  let testServer: TestServer;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-store-test-"));
    fs.writeFileSync(path.join(tmpDir, "index.html"), "<html><body>SPA Index</body></html>");
    fs.writeFileSync(path.join(tmpDir, "gallery.html"), "<html><body>Gallery Page</body></html>");
    fs.mkdirSync(path.join(tmpDir, "vendor"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "vendor", "test.css"), "body { color: red; }");

    const app = createApp(new OrdersStore(), tmpDir);
    testServer = await startTestServer(app);
  });

  afterAll(async () => {
    await testServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("serves API routes unhindered", async () => {
    const res = await fetch(`${testServer.url}/api/orders/describe`);
    expect(res.status).toBe(200);
    const body = await readJson<SourceInfo>(res);
    expect(body.name).toBe("orders");
  });

  it("serves index.html at root", async () => {
    const res = await fetch(`${testServer.url}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("SPA Index");
  });

  it("serves real static HTML pages (e.g. gallery.html)", async () => {
    const res = await fetch(`${testServer.url}/gallery.html`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Gallery Page");
  });

  it("serves vendor static assets", async () => {
    const res = await fetch(`${testServer.url}/vendor/test.css`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("color: red");
  });

  it("returns 404 for unknown client paths without SPA fallback", async () => {
    const res = await fetch(`${testServer.url}/store`);
    expect(res.status).toBe(404);
  });

  it("redirects trailing slash routes to non-trailing slash", async () => {
    const res = await fetch(`${testServer.url}/orders/`, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/orders");
  });
});
