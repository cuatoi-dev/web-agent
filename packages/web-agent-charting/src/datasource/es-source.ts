import type { DataQuery, QueryResult, SourceEntry, SourceInfo } from "@cuatoi/web-agent-core";
import type { EsSchema, EsSourceOptions } from "./types.js";
import { esSchemaFromMapping } from "./es-mapping.js";
import { toEsSearchBody, nextEsCompositeBody } from "./es-request.js";
import { fromEsResponses } from "./es-response.js";
import { ES_MAX_COMPOSITE_PAGES } from "./types.js";

export type { EsSourceOptions } from "./types.js";

export const ES_SOURCE_NAME = "es-orders";
export const ES_SOURCE_DESCRIPTION =
  "Cat store orders held in Elasticsearch. Test-only reference source; the app reads it and never writes to it.";

const EMPTY_SCHEMA: EsSchema = { fields: [], byName: {}, unsupported: [] };
const REQUEST_TIMEOUT_MS = 15_000;

/** One wording for every zero-field outcome, so the agent sees a consistent
 *  message whether the target is missing or merely unusable. */
function emptyDiscoveryError(index: string, cause: string): string {
  return (
    `Elasticsearch schema discovery for "${index}" found no usable fields: ${cause}. ` +
    `Check that the index, alias or data stream name is correct.`
  );
}

/** Thrown when the proxy's response is Elasticsearch's own 404 index_not_found_exception. */
class EsIndexMissingError extends Error {}

// The proxy attaches the Elasticsearch credentials. Nothing here holds one, and
// nothing here may be given one — this module is bundled into the page.
async function esFetch(
  endpoint: string,
  index: string,
  path: string,
  fetchImpl: typeof fetch,
  init: { method: string; body?: unknown },
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(`${endpoint}${path}`, {
      method: init.method,
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Elasticsearch proxy at ${endpoint} is unreachable: ${cause}`, { cause: err });
  }

  if (res.ok) {
    return res.json();
  }

  const text = await res.text().catch(() => "");
  if (res.status === 404 && text.includes("index_not_found_exception")) {
    throw new EsIndexMissingError(`Elasticsearch index "${index}" does not exist.`);
  }
  throw new Error(`Elasticsearch proxy answered ${res.status}: ${text}`);
}

/**
 * The self-contained SourceEntry a host integrator copies. Given a proxy base
 * URL and an index name, it does schema discovery, translation, composite
 * paging and decoding, with no other input. It runs in the browser, holds no
 * credential, and talks to the proxy with the global fetch.
 */
export function createEsSourceEntry(options: EsSourceOptions): SourceEntry {
  const {
    endpoint,
    index,
    name = ES_SOURCE_NAME,
    description = ES_SOURCE_DESCRIPTION,
    fetchImpl = fetch,
  } = options;

  // Holds the last resolved SourceInfo/EsSchema across calls. Cached only
  // when it describes a non-empty index — an empty answer means the index was
  // missing, and caching it would keep the source dead for the lifetime of the
  // page after the index is created.
  let cachedInfo: SourceInfo | undefined;
  let cachedSchema: EsSchema | undefined;

  async function resolveSchema(): Promise<{ info: SourceInfo; schema: EsSchema }> {
    if (cachedInfo && cachedSchema) {
      return { info: cachedInfo, schema: cachedSchema };
    }

    let mappingBody: unknown;
    try {
      mappingBody = await esFetch(endpoint, index, `/${index}/_mapping`, fetchImpl, { method: "GET" });
    } catch (err) {
      if (err instanceof EsIndexMissingError) {
        // Still degrades rather than throwing — a source whose describe()
        // throws is dropped by createDataSourceProvider (provider.ts:24-32)
        // and disappears from list_data_sources entirely, which is the very
        // silence this task removes. The error travels in the SourceInfo
        // instead, where the agent reads it. The empty answer is never
        // cached, so the source comes alive as soon as the index is created.
        return {
          info: {
            name,
            description,
            fields: [],
            rowCount: 0,
            error: emptyDiscoveryError(index, "it does not exist"),
          },
          schema: EMPTY_SCHEMA,
        };
      }
      throw err;
    }

    const schema = esSchemaFromMapping(mappingBody, index);
    let rowCount = 0;
    if (schema.fields.length > 0) {
      // Fetch row count with size: 0 without running terms aggregations.
      const probeBody = { size: 0, track_total_hits: true };
      const probeResponse = await esFetch(endpoint, index, `/${index}/_search`, fetchImpl, {
        method: "POST",
        body: probeBody,
      });
      rowCount = (probeResponse as { hits: { total: { value: number } } }).hits.total.value;
    }

    const info: SourceInfo = { name, description, fields: schema.fields, rowCount };
    if (schema.unsupported.length > 0) {
      info.unsupportedFields = schema.unsupported;
    }
    if (schema.fields.length === 0) {
      info.error = emptyDiscoveryError(
        index,
        schema.unsupported.length > 0
          ? `its mapping has ${schema.unsupported.length} properties, none of which has a usable query type`
          : "its mapping has no properties",
      );
    }

    if (schema.fields.length > 0) {
      cachedInfo = info;
      cachedSchema = schema;
    }

    return { info, schema };
  }

  return {
    async describe(): Promise<SourceInfo> {
      const { info } = await resolveSchema();
      return info;
    },

    async sampleValues(field: string, limit = 20): Promise<{ values: (string | number | boolean)[]; hasMore: boolean }> {
      const { schema } = await resolveSchema();
      const info = schema.byName[field];
      if (!info) {
        throw new Error(`Unknown field "${field}". Fields: ${schema.fields.map((f) => f.name).join(", ")}`);
      }
      if (!info.termPath) {
        throw new Error(`Field "${field}" cannot be sampled. ${info.limitation ?? "It has no term path in Elasticsearch."}`);
      }
      const searchBody = {
        size: 0,
        aggs: {
          distinct_values: {
            terms: {
              field: info.termPath,
              size: limit + 1,
            },
          },
        },
      };
      const res = (await esFetch(endpoint, index, `/${index}/_search`, fetchImpl, {
        method: "POST",
        body: searchBody,
      })) as { aggregations?: { distinct_values?: { buckets?: { key: unknown }[]; sum_other_doc_count?: number } } };
      const buckets = res.aggregations?.distinct_values?.buckets ?? [];
      const sumOther = res.aggregations?.distinct_values?.sum_other_doc_count ?? 0;
      const hasMore = buckets.length > limit || sumOther > 0;
      const values = buckets.slice(0, limit).map((b) => b.key as string | number | boolean);
      return { values, hasMore };
    },

    async query(q: DataQuery): Promise<QueryResult> {
      const { info, schema } = await resolveSchema();
      // Without this, a query with no select/filter/sort touches no field, so
      // the translator never looks one up and the source answers `rows: []`
      // with `page.total: 0` — an empty source reporting success.
      if (schema.fields.length === 0) {
        throw new Error(info.error ?? emptyDiscoveryError(index, "its mapping has no properties"));
      }
      const plan = toEsSearchBody(q, schema);

      const responses: unknown[] = [];
      let body = plan.body;
      for (let i = 0; i < ES_MAX_COMPOSITE_PAGES; i++) {
        const response = await esFetch(endpoint, index, `/${index}/_search`, fetchImpl, { method: "POST", body });
        responses.push(response);
        if (!plan.aggregated) break;
        const afterKey = (response as { aggregations?: { g?: { after_key?: Record<string, unknown> } } })
          .aggregations?.g?.after_key;
        if (!afterKey) break;
        body = nextEsCompositeBody(plan, afterKey);
      }

      // A silent fallback to generated rows would hide a broken deployment
      // behind data that looks fine. Every failure path throws or returns an
      // empty schema; none of them makes up a row.
      return fromEsResponses(plan, q, schema, responses);
    },
  };
}
