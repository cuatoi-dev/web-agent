import { Router } from "express";
import type { EsConfig } from "./es-config.js";

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Forwards every request under the mount path to Elasticsearch, with the
 * credentials attached server-side. This is a demo passthrough: it does not
 * inspect, restrict or rewrite what the browser sends. The browser owns the
 * query; the server owns the key.
 */
export function createEsProxyRouter(cfg: EsConfig, fetchImpl: typeof fetch = fetch): Router {
  const router = Router();
  const origin = new URL(cfg.url).origin;
  const auth = "Basic " + Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64");

  router.use(async (req, res) => {
    const targetUrl = `${cfg.url}${req.url}`;
    const hasBody = req.method !== "GET" && req.method !== "HEAD";

    let response: Response;
    try {
      response = await fetchImpl(targetUrl, {
        method: req.method,
        headers: {
          Authorization: auth,
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
        },
        body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      // Origin only — never the full URL, and never the password.
      res.status(502).json({ error: `Elasticsearch at ${origin} is unreachable: ${cause}` });
      return;
    }

    const text = await response.text();
    res.status(response.status).type("application/json").send(text);
  });

  return router;
}

/** Answers every path under the mount point with 500 and the names of the unset variables. */
export function createEsNotConfiguredRouter(missing: string[]): Router {
  const router = Router();
  const message = `Elasticsearch is not configured. Set ${missing.join(", ")}.`;
  router.use((_req, res) => {
    res.status(500).json({ error: message });
  });
  return router;
}
