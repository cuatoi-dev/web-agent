import { createEsSourceEntry } from "@cuatoi/web-agent-charting/datasource";
import type { SourceEntry } from "@cuatoi/web-agent-lit";

/** Root-absolute so it works behind the webpack dev proxy (:10030 → :20030),
 *  when Express serves the SPA itself, and behind a reverse proxy. Same reason as
 *  ORDERS_API in backend.ts:9. Never an Elasticsearch URL. */
export const ES_PROXY_ENDPOINT = "/api/es-orders";

/** The seeded read-only Elasticsearch index. */
export const ES_ORDERS_INDEX = "catstore-orders-v1";

/**
 * The Elasticsearch orders source. All of the work — schema discovery, query
 * translation, composite paging and decoding — lives in createEsSourceEntry
 * and runs in the browser. The proxy named by ES_PROXY_ENDPOINT attaches the
 * credentials server-side; nothing here holds one.
 */
export function createEsOrdersSource(indexOverride?: string): SourceEntry {
  const index =
    indexOverride ??
    (typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("esIndex") || ES_ORDERS_INDEX
      : ES_ORDERS_INDEX);

  return createEsSourceEntry({
    endpoint: ES_PROXY_ENDPOINT,
    index,
  });
}
