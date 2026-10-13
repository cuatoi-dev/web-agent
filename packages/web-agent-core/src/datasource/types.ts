import type { JsonSchemaObject } from "../types.js";

export type FieldType = "string" | "number" | "boolean" | "date" | "enum";

export const FieldTypeSchema = {
  type: "string",
  enum: ["string", "number", "boolean", "date", "enum"],
} as const;

export interface FieldSchema {
  name: string;
  /** Friendly name the agent uses when it writes about this field to the
   *  user. Set by the source's allow-list. Absent when the source has none. */
  label?: string;
  type: FieldType;
  enumValues?: string[];
  description?: string;
  /**
   * Why this field cannot be sorted, filtered exactly, or grouped, when it
   * cannot be. The agent reads this in list_data_sources and must not choose
   * the field for an operation the reason rules out. Absent when the field
   * supports everything its type allows.
   */
  limitation?: string;
}

export const FieldSchemaSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    name: { type: "string" },
    label: { type: "string" },
    type: FieldTypeSchema,
    enumValues: { type: "array", items: { type: "string" } },
    description: { type: "string" },
    limitation: { type: "string" },
  },
  required: ["name", "type"],
  additionalProperties: false,
};

/**
 * One entry in a source's field allow-list. `name` is the real field name the
 * agent queries with; `label` is the friendly name it uses in prose.
 * Duplicate labels are allowed.
 */
export interface FieldAllowEntry {
  name: string;
  label: string;
}

/**
 * One field the source holds but cannot expose. `esType` is the source's own
 * type name and `reason` says why the field cannot be selected, filtered,
 * sorted or grouped. The agent quotes both to the user instead of saying the
 * field does not exist.
 */
export interface UnsupportedField {
  name: string;
  esType: string;
  reason: string;
}

export interface SourceInfo {
  name: string;
  description: string;
  fields: FieldSchema[];
  rowCount: number;
  /**
   * Why this source has no usable schema. Present only when something went
   * wrong. A source carrying this must not be treated as an empty but
   * healthy source: the agent reports the message rather than guessing.
   */
  error?: string;
  /**
   * Fields the source holds but cannot expose, each with the reason. Present
   * only when there is at least one. The agent tells the user the field
   * exists and why it cannot be used, instead of saying it does not exist.
   */
  unsupportedFields?: UnsupportedField[];
}

/**
 * What `list_data_sources` returns for each source when it is called with
 * no source name: enough to choose a source, and no field detail. The
 * agent calls `list_data_sources({ source })` for the field schemas.
 */
export interface SourceSummary {
  name: string;
  description: string;
  rowCount: number;
  /** How many fields the source exposes. A source with an allow-list
   *  counts only the fields the host allowed. */
  fieldCount: number;
  /** How many of those fields carry each type. A type with no field is
   *  absent rather than zero. */
  fieldTypes: Partial<Record<FieldType, number>>;
  /**
   * Why this source has no usable schema, copied from `SourceInfo.error`.
   * Present only when discovery failed. The agent reports the message
   * rather than treating the source as empty but healthy.
   */
  error?: string;
}

export interface FieldDetailsQuery {
  source: string;
  filter?: string;
  offset?: number;
  limit?: number;
}

export interface FieldDetailsResult {
  source: string;
  fields: FieldSchema[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  /**
   * Fields the source holds but cannot be queried, narrowed by the same
   * `filter` the caller passed and by the host allow-list. Absent when the
   * source reports none, so a healthy source carries no empty array.
   * `total`, `offset`, `limit` and `hasMore` describe `fields` only; this
   * list is not paged.
   */
  unsupportedFields?: UnsupportedField[];
  truncation?: TruncationReport;
}

export interface FieldSampleQuery {
  source: string;
  field: string;
  limit?: number;
}

export interface FieldSampleResult {
  source: string;
  field: string;
  values: (string | number | boolean)[];
  hasMore: boolean;
  total?: number;
  truncation?: TruncationReport;
}

export type Scalar = string | number | boolean;

export type Condition = Scalar | {
  $eq?: Scalar;
  $ne?: Scalar;
  $gt?: Scalar;
  $gte?: Scalar;
  $lt?: Scalar;
  $lte?: Scalar;
  $in?: Scalar[];
  $nin?: Scalar[];
  $contains?: string;
  $startsWith?: string;
  $endsWith?: string;
  $regex?: string;
  $between?: [Scalar, Scalar];
  $exists?: boolean;
  $isNull?: boolean;
};

export type FilterExpr =
  | { $and: FilterExpr[] }
  | { $or: FilterExpr[] }
  | { $not: FilterExpr }
  | { [field: string]: Condition };

/**
 * The query language's shared definitions. `filterExpr` is reached from both
 * `DataQuerySchema.filter` and `aggregate.having`, exactly as the zod version
 * shared `FilterExprSchema` between them.
 *
 * The three filter levels are deliberate. The zod original expanded the filter
 * to a FIXED depth of three (BaseFilterExpr -> L1 -> L2 -> top), so a filter
 * nested four levels deep has always been rejected. A single self-referencing
 * `filterExpr` would compile and would accept any depth — that widens the query
 * language, which the schema must not do. Keep three named levels.
 */
const SCALAR_REF = { $ref: "#/$defs/scalar" } as const;

/** One level of $and/$or/$not over `innerRef`, or a bare field map. */
function filterLevel(innerRef: string): Record<string, unknown> {
  return {
    type: "object",
    anyOf: [
      {
        type: "object",
        properties: { $and: { type: "array", items: { $ref: innerRef } } },
        required: ["$and"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { $or: { type: "array", items: { $ref: innerRef } } },
        required: ["$or"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { $not: { $ref: innerRef } },
        required: ["$not"],
        additionalProperties: false,
      },
      { $ref: "#/$defs/filterLeaf" },
    ],
  };
}

export const QUERY_DEFS = {
  scalar: { type: ["string", "number", "boolean"] },
  condition: {
    anyOf: [
      SCALAR_REF,
      {
        type: "object",
        properties: {
          $eq: SCALAR_REF,
          $ne: SCALAR_REF,
          $gt: SCALAR_REF,
          $gte: SCALAR_REF,
          $lt: SCALAR_REF,
          $lte: SCALAR_REF,
          $in: { type: "array", items: SCALAR_REF },
          $nin: { type: "array", items: SCALAR_REF },
          $contains: { type: "string" },
          $startsWith: { type: "string" },
          $endsWith: { type: "string" },
          $regex: { type: "string" },
          $between: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            prefixItems: [SCALAR_REF, SCALAR_REF],
          },
          $exists: { type: "boolean" },
          $isNull: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
  },
  filterLeaf: {
    type: "object",
    additionalProperties: { $ref: "#/$defs/condition" },
  },
  filterL1: filterLevel("#/$defs/filterLeaf"),
  filterL2: filterLevel("#/$defs/filterL1"),
  filterExpr: filterLevel("#/$defs/filterL2"),
  dimension: {
    type: "object",
    properties: {
      field: { type: "string" },
      granularity: {
        type: "string",
        enum: ["hour", "minute", "day", "week", "month", "quarter", "year"],
      },
      as: { type: "string" },
    },
    required: ["field"],
    additionalProperties: false,
  },
  measure: {
    type: "object",
    properties: {
      op: {
        type: "string",
        enum: ["count", "sum", "avg", "min", "max", "countDistinct", "first", "last"],
      },
      field: { type: "string" },
      as: { type: "string" },
    },
    required: ["op"],
    additionalProperties: false,
  },
  sortList: {
    type: "array",
    items: {
      type: "object",
      properties: {
        field: { type: "string" },
        dir: { type: "string", enum: ["asc", "desc"] },
      },
      required: ["field"],
      additionalProperties: false,
    },
  },
  aggregation: {
    type: "object",
    properties: {
      groupBy: { type: "array", items: { $ref: "#/$defs/dimension" } },
      measures: { type: "array", items: { $ref: "#/$defs/measure" } },
      having: { $ref: "#/$defs/filterExpr" },
      sort: { $ref: "#/$defs/sortList" },
      limit: { type: "number" },
    },
    required: ["groupBy", "measures"],
    additionalProperties: false,
  },
} as const;

export interface Dimension {
  field: string;
  granularity?: "hour" | "minute" | "day" | "week" | "month" | "quarter" | "year";
  as?: string;
}

export type MeasureOp = "count" | "sum" | "avg" | "min" | "max" | "countDistinct" | "first" | "last";

export interface Measure {
  op: MeasureOp;
  field?: string;
  as?: string;
}

export interface Aggregation {
  groupBy: Dimension[];
  measures: Measure[];
  having?: FilterExpr;
  sort?: { field: string; dir?: "asc" | "desc" }[];
  limit?: number;
}

export interface DataQuery {
  source: string;
  select?: string[];
  filter?: FilterExpr;
  /** Free-text term matched case-insensitively across the source's text fields. */
  search?: string;
  sort?: { field: string; dir?: "asc" | "desc" }[];
  page?: { limit?: number; offset?: number };
  aggregate?: Aggregation;
}

export const DataQuerySchema: JsonSchemaObject = {
  type: "object",
  properties: {
    source: { type: "string" },
    select: { type: "array", items: { type: "string" } },
    filter: QUERY_DEFS.filterExpr,
    search: {
      type: "string",
      description:
        "Free-text term. Matches rows where any string or enum field contains it, " +
        "case-insensitively. Use when you do not know which field holds the term; " +
        "use a filter with $contains when you do. Empty or blank is ignored.",
    },
    sort: QUERY_DEFS.sortList,
    page: {
      type: "object",
      properties: { limit: { type: "number" }, offset: { type: "number" } },
      additionalProperties: false,
    },
    aggregate: QUERY_DEFS.aggregation,
  },
  required: ["source"],
  additionalProperties: false,
  $defs: QUERY_DEFS,
};

/**
 * Reports an honest gap between what a query asked for and what
 * `serializeResult` could fit inside `maxChars`. Present only when the
 * serialized output dropped rows or lightened the field list.
 */
export interface TruncationReport {
  requested: number;
  included: number;
  dropped: number;
  reason: string;
  hint: string;
  fieldsTruncated?: boolean;
}

export interface QueryResult {
  source: string;
  aggregated: boolean;
  fields: FieldSchema[];
  rows: Record<string, unknown>[];
  page: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  /** Set by `serializeResult` when the character budget forced it to drop
   *  rows or lighten field metadata. Absent when the full result fit. */
  truncation?: TruncationReport;
}

/**
 * Async because ajv reaches core only through the dynamic import in
 * tools/validate-json-schema.ts. Importing ajv statically here would put it in
 * core's static graph, which that module forbids (see its header) and which
 * every host bundle would then carry.
 */
export async function validateDataQuery(raw: unknown): Promise<
  | { ok: true; value: DataQuery }
  | { ok: false; message: string }
> {
  const { validateJsonSchemaInput } = await import("../tools/validate-json-schema.js");
  const error = await validateJsonSchemaInput("DataQuery", DataQuerySchema, raw as Record<string, unknown>);
  if (error) return { ok: false, message: error };
  return { ok: true, value: raw as DataQuery };
}

// ---------------------------------------------------------------------------
// Provider and registry shapes
// ---------------------------------------------------------------------------
export interface DataSourceProvider {
  listSources(): Promise<SourceSummary[]>;
  describeSource(name: string): Promise<SourceInfo>;
  getFieldDetails(query: FieldDetailsQuery): Promise<FieldDetailsResult>;
  sampleValues(query: FieldSampleQuery): Promise<FieldSampleResult>;
  query(q: DataQuery): Promise<QueryResult>;
}

/**
 * A registered data source. query is async; describe may be sync or async.
 */
export interface SourceEntry {
  describe(): Promise<SourceInfo> | SourceInfo;
  query(q: DataQuery): Promise<QueryResult>;
  /**
   * Optional allow-list. When present, only these fields are discoverable and
   * queryable, in this order, each carrying its label. When absent, the source
   * exposes every field it describes, exactly as before.
   */
  allowFields?: FieldAllowEntry[];
  /**
   * Optional on-demand distinct value sampling for a single field.
   * When omitted, the provider falls back to a groupBy aggregate query.
   */
  sampleValues?(field: string, limit?: number): Promise<{ values: (string | number | boolean)[]; hasMore: boolean }>;
}

export interface ProviderOptions {
  /** Optional function to get the latest state. */
  getState?: () => Record<string, unknown>;
  /** The data sources to register. */
  sources: SourceEntry[];
}

/** Composite group key built from a row's dimension values (`aggregate.ts`). */
export type DimKey = string;
