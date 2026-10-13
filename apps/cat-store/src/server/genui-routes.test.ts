// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "./app.js";
import { OrdersStore } from "./orders-store.js";
import { startTestServer, type TestServer } from "./test-helpers.js";
import { renderGenuiFrameHtml } from "./genui-routes.js";

describe("genui routes", () => {
  let srv: TestServer;

  beforeEach(async () => {
    srv = await startTestServer(createApp(new OrdersStore()));
  });

  afterEach(async () => {
    await srv.close();
  });

  it("GET /genui/frame returns HTML with Material profile by default", async () => {
    const res = await fetch(`${srv.url}/genui/frame`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('src="genui-material.js"');
    expect(html).toContain('href="../vendor/public-sans/public-sans.css"');
    expect(html).toContain('href="wa-tokens.css"');
    expect(html).toContain('data-theme="wa2-dark"');
  });

  it("GET /genui/frame?profile=plain returns HTML without Material bundle", async () => {
    const res = await fetch(`${srv.url}/genui/frame?profile=plain`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).not.toContain("genui-material.js");
    expect(html).toContain('href="../vendor/public-sans/public-sans.css"');
    expect(html).toContain('href="wa-tokens.css"');
  });

  it("GET /genui/wa-tokens.css returns CSS stylesheet", async () => {
    const res = await fetch(`${srv.url}/genui/wa-tokens.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
    const css = await res.text();
    expect(css).toContain("--wa-");
  });

  it("GET /genui/genui-material.js returns JavaScript bundle", async () => {
    const res = await fetch(`${srv.url}/genui/genui-material.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  it("the frame's first script is the bootstrap", async () => {
    const res = await fetch(`${srv.url}/genui/frame`);
    const html = await res.text();
    const firstScript = html.indexOf("<script>");
    const firstLink = html.indexOf('<link rel="stylesheet"');
    const firstMaterial = html.indexOf('src="genui-material.js"');
    expect(firstScript).toBeGreaterThan(-1);
    expect(firstScript).toBeLessThan(firstLink);
    expect(firstScript).toBeLessThan(firstMaterial);
  });

  it("the bootstrap is present in the plain profile too", async () => {
    const res = await fetch(`${srv.url}/genui/frame?profile=plain`);
    const html = await res.text();
    expect(html).toContain("wa-genui-diagnostic");
    expect(html).toContain('addEventListener("error"');
  });

  it("the bootstrap does not break out of its script tag", async () => {
    const res = await fetch(`${srv.url}/genui/frame`);
    const html = await res.text();
    const firstScript = html.indexOf("<script>");
    const firstScriptEnd = html.indexOf("</script>", firstScript);
    const content = html.slice(firstScript, firstScriptEnd);
    expect(content).not.toContain("</script>");
  });

  it("the capture script is in the Material profile", async () => {
    const res = await fetch(`${srv.url}/genui/frame`);
    const html = await res.text();
    expect(html).toContain('<script src="genui-capture.js"></script>');
  });

  it("the capture script is in the plain profile too", async () => {
    const res = await fetch(`${srv.url}/genui/frame?profile=plain`);
    const html = await res.text();
    expect(html).toContain('<script src="genui-capture.js"></script>');
    expect(html).not.toContain("genui-material.js");
  });

  it("the capture script comes after the bootstrap", async () => {
    const res = await fetch(`${srv.url}/genui/frame`);
    const html = await res.text();
    const bootstrapIdx = html.indexOf("wa-genui-diagnostic");
    const captureIdx = html.indexOf("genui-capture.js");
    expect(bootstrapIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeGreaterThan(bootstrapIdx);
  });

  it("GET /genui/genui-capture.js returns JavaScript", async () => {
    const res = await fetch(`${srv.url}/genui/genui-capture.js`);
    // The file may not be built yet in the test environment; 404 is acceptable
    if (res.status === 200) {
      expect(res.headers.get("content-type")).toContain("javascript");
    }
  });

  it("GET /genui/genui-capture.js returns JavaScript or 404", async () => {
    const res = await fetch(`${srv.url}/genui/genui-capture.js`);
    if (res.status === 200) {
      expect(res.headers.get("content-type")).toContain("javascript");
    } else {
      expect(res.status).toBe(404);
    }
  });

  it("the chart script is in the Material profile", async () => {
    const res = await fetch(`${srv.url}/genui/frame`);
    const html = await res.text();
    expect(html).toContain('<script src="genui-chart.js"></script>');
  });

  it("the chart script is not in the plain profile", async () => {
    const res = await fetch(`${srv.url}/genui/frame?profile=plain`);
    const html = await res.text();
    expect(html).not.toContain("genui-chart.js");
  });

  it("the chart script comes after the bootstrap", async () => {
    const res = await fetch(`${srv.url}/genui/frame`);
    const html = await res.text();
    const bootstrapIdx = html.indexOf("wa-genui-diagnostic");
    const chartIdx = html.indexOf("genui-chart.js");
    expect(bootstrapIdx).toBeGreaterThan(-1);
    expect(chartIdx).toBeGreaterThan(bootstrapIdx);
  });

  it("GET /genui/genui-chart.js returns JavaScript or 404", async () => {
    const res = await fetch(`${srv.url}/genui/genui-chart.js`);
    if (res.status === 200) {
      expect(res.headers.get("content-type")).toContain("javascript");
    } else {
      expect(res.status).toBe(404);
    }
  });

  it("renderGenuiFrameHtml links public-sans font stylesheet and emits overflow-x: auto and overflow-y: auto in both profiles", async () => {
    const htmlMaterial = renderGenuiFrameHtml("material");
    expect(htmlMaterial).toContain('href="../vendor/public-sans/public-sans.css"');
    expect(htmlMaterial).toContain("overflow-x: auto;");
    expect(htmlMaterial).toContain("overflow-y: auto;");
    const htmlPlain = renderGenuiFrameHtml("plain");
    expect(htmlPlain).toContain('href="../vendor/public-sans/public-sans.css"');
    expect(htmlPlain).toContain("overflow-x: auto;");
    expect(htmlPlain).toContain("overflow-y: auto;");

    const res = await fetch(`${srv.url}/genui/frame`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('href="../vendor/public-sans/public-sans.css"');
    expect(body).toContain("overflow-x: auto;");
    expect(body).toContain("overflow-y: auto;");
  });
});
