import type { FieldSchema, FieldType } from "@cuatoi/web-agent-core";

/** How one logical DataQuery field maps onto Elasticsearch paths. */
export interface EsFieldInfo {
  name: string;
  type: FieldType;
  esType: string;
  termPath?: string;
  /**
   * The path to read in `_source`, when it is not `name`. Set only for an
   * Elasticsearch field `alias`: an alias is absent from `_source` (verified
   * against 8.15.3 on 2026-08-20 — `_source: ["alias_customer_id"]` returned
   * `{}`), so the row carries the alias target's path instead. Undefined for
   * every other field, which keeps existing EsFieldInfo values byte-identical.
   */
  sourcePath?: string;
  /**
   * Why this field cannot be sorted, filtered exactly, or grouped. Set when
   * `termPath` is undefined. Copied onto FieldSchema.limitation so the agent
   * reads it in list_data_sources, and used by requireTermPath's error.
   */
  limitation?: string;
}

/** A mapping property that has no DataQuery type. Reported, never dropped. */
export interface EsUnsupportedField {
  /** The dotted field name, as it appears in the mapping. */
  name: string;
  /** The raw Elasticsearch mapping type, e.g. "geo_point", "integer_range". */
  esType: string;
  /** Plain-English reason the agent can act on. */
  reason: string;
}

export interface EsSchema {
  /** What describe() reports. Order follows the mapping's own key order. */
  fields: FieldSchema[];
  /** Lookup by DataQuery field name. */
  byName: Record<string, EsFieldInfo>;
  /**
   * Mapping properties that have no DataQuery type. Always present, empty
   * when every property mapped. Required, not optional, so every reader is
   * forced to decide what to do with it.
   */
  unsupported: EsUnsupportedField[];
}

/** A planned Elasticsearch request, plus what the reader needs to decode it. */
export interface EsSearchPlan {
  /** The `_search` request body. */
  body: Record<string, unknown>;
  /** True when the plan uses the composite aggregation path. */
  aggregated: boolean;
  /** Dimension alias per composite source key, by index: ["region"] names d0. */
  dimensionAliases?: string[];
  /** Measure alias per sub-aggregation name, by index: ["revenue"] names m0. */
  measureAliases?: string[];
}

/** Composite paging bounds. Exceeding them is an error, never a silent cut. */
export const ES_COMPOSITE_PAGE_SIZE = 1000;
export const ES_MAX_COMPOSITE_PAGES = 10;

/** One node of a `GET /<target>/_mapping` body, as `esSchemaFromMapping` walks it. */
export interface MappingProperty {
  type?: string;
  properties?: Record<string, MappingProperty>;
  fields?: Record<string, MappingProperty>;
  /** Only on `type: "alias"` — the field the alias points at. */
  path?: string;
}

/** Options for `createEsSourceEntry`. */
export interface EsSourceOptions {
  /**
   * Base URL of the proxy that attaches the Elasticsearch credentials, with no
   * trailing slash — for example "/api/es-orders". Never an Elasticsearch URL,
   * and never a credential.
   */
  endpoint: string;
  /** The Elasticsearch index to read, for example "catstore-orders-v1". */
  index: string;
  /** The name the agent sees. Defaults to ES_SOURCE_NAME. */
  name?: string;
  /** The description the agent sees. Defaults to ES_SOURCE_DESCRIPTION. */
  description?: string;
  /** Test seam for the network boundary. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Currently ignored: createEsSourceEntry does not read this option. */
  enumMaxValues?: number;
}
