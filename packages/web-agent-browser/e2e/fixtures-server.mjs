import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const PORT = Number(process.env.FIXTURES_PORT ?? 10040);

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
  // 131/001 — the page's own eval is refused while CDP's is not. 'unsafe-inline'
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
