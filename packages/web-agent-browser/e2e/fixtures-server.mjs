import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const PORT = Number(process.env.FIXTURES_PORT ?? 10040);

/** Requests the stub LLM received, per run id. */
const LLM_LOG = new Map();
const MTEST_LOG = new Map();

/** Extra response headers for individual fixture pages.
 *
 *  `page-eval-csp.html` proves the page_eval CSP refusal path. The policy
 *  omits 'unsafe-eval', so the AsyncFunction constructor throws an EvalError
 *  in the page realm; it keeps 'unsafe-inline' so the fixture's own inline
 *  script can still define the globals the test reads. Both halves were
 *  measured in Chromium on 2026-08-31. */
const FIXTURE_HEADERS = {
  "page-eval-csp.html": {
    "content-security-policy": "script-src 'self' 'unsafe-inline'; object-src 'none'",
  },
  "dialog-csp.html": {
    "content-security-policy": "script-src 'self'; object-src 'none'",
  },
  // The page's own eval is refused while CDP's is not. 'unsafe-inline'
  // is kept so the fixture's inline script can still run.
  "page-eval-cdp.html": {
    "content-security-policy": "script-src 'self' 'unsafe-inline'; object-src 'none'",
  },
};

createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;
  console.log(`[fixtures] ${req.method} ${pathname} origin=${req.headers.origin ?? "(none)"}`);

  if (pathname.startsWith("/api/")) {
    if (pathname === "/api/coupon" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        let code = "";
        try {
          const parsed = JSON.parse(body);
          code = typeof parsed.code === "string" ? parsed.code : "";
        } catch {
          code = body;
        }
        if (code.length > 100) {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Coupon code exceeds maximum length" }));
          return;
        }
        if (code === "SAVE10") {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ discount: "-$4.20" }));
          return;
        }
        res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Coupon not valid" }));
      });
      return;
    }
    if (pathname === "/api/totals" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ subtotal: "$42.00", discount: "-$4.20", total: "$37.80" }));
      return;
    }
    if (pathname === "/api/inventory" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          status: "ok",
          items: [
            { id: "item-001", name: "Cat Bed Deluxe", stock: 14, price: 29.99 },
            { id: "item-002", name: "Catnip Toy Mouse", stock: 45, price: 4.99 },
          ],
        }),
      );
      return;
    }
    if (pathname === "/api/echo" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ received: body, method: req.method }));
      });
      return;
    }
    if (pathname === "/api/large" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "ok", data: "A".repeat(10_000) }));
      return;
    }
    // A stub LLM for the bubble relay e2e. A brand.json patched by
    // the test points its endpoints at /api/llm/<run>/anthropic and
    // /api/llm/<run>/openai/v1; GET /api/llm/<run>/requests returns what
    // arrived, headers included.
    const llm = pathname.match(/^\/api\/llm\/([A-Za-z0-9-]+)\/(.+)$/);
    if (llm) {
      const [, run, rest] = llm;
      if (!LLM_LOG.has(run)) LLM_LOG.set(run, []);
      const log = LLM_LOG.get(run);
      if (rest === "requests" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(log));
        return;
      }
      if (req.method === "POST" && (rest === "anthropic/v1/messages" || rest === "openai/v1/chat/completions")) {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch { parsed = null; }
          log.push({ path: rest, headers: req.headers, body: parsed });
          const model = parsed && typeof parsed.model === "string" ? parsed.model : "stub";
          const reply = rest.startsWith("anthropic/")
            ? {
                id: "msg_stub", type: "message", role: "assistant", model,
                content: [{ type: "text", text: "Stub reply from anthropic." }],
                stop_reason: "end_turn", stop_sequence: null,
                usage: { input_tokens: 1, output_tokens: 1 },
              }
            : {
                id: "chatcmpl-stub", object: "chat.completion", created: 0, model,
                choices: [{ index: 0, message: { role: "assistant", content: "Stub reply from openai." }, finish_reason: "stop" }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              };
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(reply));
        });
        return;
      }
    }
    // A stub for the model Test button. The model id picks the
    // answer; GET /api/mtest/<run>/requests returns what arrived. CORS headers
    // are sent so the stub works with or without the host permission.
    const mtest = pathname.match(/^\/api\/mtest\/([A-Za-z0-9-]+)\/(.+)$/);
    if (mtest) {
      const [, run, rest] = mtest;
      if (!MTEST_LOG.has(run)) MTEST_LOG.set(run, []);
      const log = MTEST_LOG.get(run);
      const cors = {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*",
      };
      if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
      if (rest === "requests" && req.method === "GET") {
        res.writeHead(200, { ...cors, "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(log));
        return;
      }
      const gemini = rest.match(/^gemini\/v1beta\/models\/([^/:]+):generateContent$/);
      const known = gemini || rest === "openai/v1/chat/completions" || rest === "anthropic/v1/messages";
      if (req.method === "POST" && known) {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch { parsed = null; }
          const model = gemini ? decodeURIComponent(gemini[1]) : (parsed && typeof parsed.model === "string" ? parsed.model : "");
          log.push({ path: rest, model, headers: req.headers, body: parsed });
          if (model === "hang") return;
          const json = (status, obj) => {
            res.writeHead(status, { ...cors, "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(obj));
          };
          const errors = { e401: [401, "bad key"], e403: [403, "forbidden"], e404: [404, "no such model"], e500: [500, "boom"] };
          if (errors[model]) { json(errors[model][0], { error: { message: errors[model][1] } }); return; }
          if (model === "e502") {
            res.writeHead(502, { ...cors, "content-type": "text/html; charset=utf-8" });
            res.end(`<html><body>${"x".repeat(200)}</body></html>`);
            return;
          }
          const text = model === "okay" ? "Okay, done" : model === "token" ? "token" : "ok.";
          const reply = gemini
            ? { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }
            : rest.startsWith("anthropic/")
              ? { id: "msg_stub", type: "message", role: "assistant", model, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
              : { id: "chatcmpl-stub", object: "chat.completion", created: 0, model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
          if (model === "slow") { setTimeout(() => json(200, reply), 2000); return; }
          json(200, reply);
        });
        return;
      }
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Endpoint not found" }));
    return;
  }

  const name = path.basename(pathname) || "plain.html";
  try {
    const content = await readFile(path.join(DIR, name));
    const isJs = name.endsWith(".js");
    const mime = isJs ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8";
    res.writeHead(200, {
      "content-type": mime,
      ...(FIXTURE_HEADERS[name] ?? {}),
    });
    res.end(content);
  } catch {
    if (!res.headersSent) {
      res.writeHead(404, { "content-type": "text/plain" });
    }
    res.end("not found");
  }
}).listen(PORT, () => console.log(`fixtures on http://localhost:${PORT}/`));
