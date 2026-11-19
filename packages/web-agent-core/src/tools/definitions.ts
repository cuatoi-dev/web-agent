import { DataQuerySchema } from "../datasource/types.js";
import type { ToolDef, JsonSchemaObject } from "./types.js";
export type { ToolDef } from "./types.js";

// ---------------------------------------------------------------------------
// Tool definitions — single source of truth for tool schemas + metadata.
// All schemas set additionalProperties: false to reject unknown keys.
// ---------------------------------------------------------------------------

export const snapshotPageSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    scope: {
      type: "string",
      description: "Optional ref from a previous snapshot, e.g. '34', to snapshot only that subtree.",
    },
    interactive_only: {
      type: "boolean",
      description: "If true, omit non-interactive text nodes. Default false.",
    },
    include_text: {
      type: "string",
      description: "Only include elements whose text or label contains this string, case-insensitive, plus the ancestors leading to them. Use it to find something specific on a large page.",
    },
  },
  additionalProperties: false,
};

export const queryStateSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "JSONPath expression starting with $",
    },
    keys_only: {
      type: "boolean",
      description: "Return only the keys of matched objects (for exploration). Default false.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      description: "Max matches to return. Default 20.",
    },
  },
  required: ["path"],
  additionalProperties: false,
};

export const clickSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    ref: {
      type: "string",
      description: "Ref number, e.g. '7'",
    },
  },
  required: ["ref"],
  additionalProperties: false,
};

export const fillSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    ref: {
      type: "string",
      description: "Ref number, e.g. '7'",
    },
    value: {
      type: "string",
      description: "Value to set",
    },
  },
  required: ["ref", "value"],
  additionalProperties: false,
};

export const selectOptionSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    ref: {
      type: "string",
      description: "Ref number, e.g. '7'",
    },
    option: {
      type: "string",
      description: "Option label or value to select",
    },
  },
  required: ["ref", "option"],
  additionalProperties: false,
};

export const waitForSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    condition: {
      type: "string",
      enum: ["dom_idle", "text_present", "state_path_truthy"],
      description: "What to wait for",
    },
    argument: {
      type: "string",
      description: "Text for text_present; JSONPath for state_path_truthy; ignored for dom_idle.",
    },
    timeout_ms: {
      type: "integer",
      minimum: 100,
      maximum: 15000,
      description: "Default 5000.",
    },
  },
  required: ["condition"],
  additionalProperties: false,
};

/** Hard cap for the `wait` tool — kept as a single named constant so it's one
 *  place to change. Not host-configurable (see refine plan's decision). */
export const WAIT_MAX_SECONDS = 30;

export const waitSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    seconds: {
      type: "integer",
      minimum: 1,
      maximum: WAIT_MAX_SECONDS,
      description: `Seconds to pause, unconditionally. 1-${WAIT_MAX_SECONDS}.`,
    },
  },
  required: ["seconds"],
  additionalProperties: false,
};

export const seeSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    ref: {
      type: "string",
      description: "Ref from a snapshot to screenshot just that element; omit for the whole visible page.",
    },
  },
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Tool descriptor (`ToolDef`, declared in types.ts) — carries everything needed by the SDK + system-prompt builder.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// The eight tools defined here.
// ---------------------------------------------------------------------------
export const SNAPSHOT_PAGE_DEF: ToolDef = {
  name: "snapshot_page",
  description:
    "Take a snapshot of the page as a compact, breadth-first outline. Interactive elements (and any collapsed container) get numbered refs like [12]. Large subtrees are shown shallow: a collapsed node ends with '… +N nodes hidden — snapshot_page(scope=\"<ref>\") to expand'. To see inside, call snapshot_page again with scope set to that ref — do NOT blindly re-snapshot the whole page. You MUST snapshot before click/fill/select_option; refs are only valid from the most recent snapshot. To find one thing on a large page, set include_text to a word or phrase: the snapshot then holds only the elements whose text or label contains it, plus the ancestors leading to them.",
  inputSchema: snapshotPageSchema,
  promptSnippet:
    "snapshot_page: observe the page as a shallow tree. Collapsed nodes show '+N nodes hidden — snapshot_page(scope=\"<ref>\")'; drill in with that scope instead of re-snapshotting. interactive_only skips text. include_text=\"<term>\" keeps only elements whose text or label contains that term, plus their ancestors — use it to find a specific control on a large page instead of paging through it.",
};

export const QUERY_STATE_DEF: ToolDef = {
  name: "query_state",
  description:
    "Query the application's Redux state with a JSONPath expression. Returns matching values as JSON. Results are truncated; use narrower paths or 'keys_only' to explore large objects. Examples: '$.orders.items[*].status', '$.user.profile', '$..error'.",
  inputSchema: queryStateSchema,
  promptSnippet:
    "query_state: explore Redux state with JSONPath. Use keys_only for exploration, limit to cap results.",
};

export const CLICK_DEF: ToolDef = {
  name: "click",
  description:
    "Click an interactive element by its ref from the MOST RECENT snapshot. Use this to activate buttons, click navigation links, menu items, or tabs to navigate between pages, toggle checkboxes, etc.",
  inputSchema: clickSchema,
  promptSnippet:
    "click: activate an element by its snapshot ref (including navigation links and tabs to change pages).",
};

export const FILL_DEF: ToolDef = {
  name: "fill",
  description:
    "Set the value of a text input, textarea, or contenteditable identified by ref, replacing existing content.",
  inputSchema: fillSchema,
  promptSnippet:
    "fill: type a value into a form field by ref. Replaces existing content.",
};

export const SELECT_OPTION_DEF: ToolDef = {
  name: "select_option",
  description:
    "Choose an option in a native <select> by visible label or value.",
  inputSchema: selectOptionSchema,
  promptSnippet:
    "select_option: pick an option in a native select by label or value.",
};

export const WAIT_FOR_DEF: ToolDef = {
  name: "wait_for",
  description:
    "Wait until a condition is met. Use after actions that trigger async updates.",
  inputSchema: waitForSchema,
  promptSnippet:
    "wait_for: pause until dom_idle, text_present, or state_path_truthy. Timeout is not an error — report what happened.",
};

export const WAIT_DEF: ToolDef = {
  name: "wait",
  description:
    `Pause for a fixed number of seconds (1-${WAIT_MAX_SECONDS}), unconditionally. ` +
    "Use only when there is no observable condition to wait on — prefer wait_for when one exists.",
  inputSchema: waitSchema,
  promptSnippet:
    `wait: pause for a fixed number of seconds (max ${WAIT_MAX_SECONDS}s) with no condition to check. ` +
    "Prefer wait_for when a condition is knowable; use wait only for genuine unconditional pacing.",
};

export const SEE_DEF: ToolDef = {
  name: "see",
  description:
    "Render the page (or an element by ref) to an image and look at it. Use when layout, appearance, colors, charts, or visual details matter and the text snapshot is insufficient.",
  inputSchema: seeSchema,
  promptSnippet:
    "see: visually inspect the page when appearance matters; prefer snapshot_page for structure/refs.",
};

// ---------------------------------------------------------------------------
// Data-source tools
// ---------------------------------------------------------------------------
export const listDataSourcesSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    source: {
      type: "string",
      description: "Optional source name to describe a specific data source.",
    },
  },
  additionalProperties: false,
};

export const getFieldDetailsSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    source: {
      type: "string",
      description: "Name of the data source to inspect.",
    },
    filter: {
      type: "string",
      description: "Optional substring filter to match against field names or descriptions, case-insensitively.",
    },
    offset: {
      type: "integer",
      minimum: 0,
      description: "0-based starting offset for pagination. Default 0.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 500,
      description: "Maximum number of fields to return in this page. Default 50.",
    },
  },
  required: ["source"],
  additionalProperties: false,
};

export const sampleFieldValuesSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    source: {
      type: "string",
      description: "Name of the data source.",
    },
    field: {
      type: "string",
      description: "Name of the field to sample distinct values from.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 500,
      description: "Maximum number of distinct values to return. Default 20.",
    },
  },
  required: ["source", "field"],
  additionalProperties: false,
};

export const queryDataSchema: JsonSchemaObject = DataQuerySchema;

export const LIST_DATA_SOURCES_DEF: ToolDef = {
  name: "list_data_sources",
  description:
    "List available data sources. With no 'source', returns one compact summary " +
    "per source — name, description, row count, field count, and how many fields " +
    "of each type — and no field names, no enum values. Pass 'source' to get that " +
    "one source's full field schemas, including names, types, labels, limitations " +
    "and enum values. Read a summary first, then ask for the source you need.",
  inputSchema: listDataSourcesSchema,
  promptSnippet:
    "list_data_sources: no argument lists every source as a summary (row count, " +
    "field count, field types). Pass { source: \"<name>\" } for that source's field schemas.",
};

export const GET_FIELD_DETAILS_DEF: ToolDef = {
  name: "get_field_details",
  description:
    "Get detailed field schemas for a data source, including name, friendly label, data type, description, and limitations (e.g. cannot be sorted or grouped). Supports filtering by name or description substring and pagination (offset/limit). Returns matching fields, total match count, offset, and hasMore. It also returns unsupportedFields when the source holds fields it cannot expose: each carries name, esType and reason, the filter narrows them by name and esType, and the key is absent when there are none. Use this to search for fields before querying, and to explain why a field a user can see cannot be used.",
  inputSchema: getFieldDetailsSchema,
  promptSnippet:
    "get_field_details: search and page field schemas for a source (name, label, type, limitation). Supports substring filter, offset, limit. Its unsupportedFields list names fields the source holds but cannot query, with the reason — read it before telling a user a field does not exist.",
};

export const SAMPLE_FIELD_VALUES_DEF: ToolDef = {
  name: "sample_field_values",
  description:
    "Sample distinct values for a specific field in a data source. Useful for discovering valid categories, status codes, or filter values. Returns an array of sample values and whether more values exist (hasMore).",
  inputSchema: sampleFieldValuesSchema,
  promptSnippet:
    "sample_field_values: get distinct sample values for a field in a source to discover valid categories, statuses, or filter values. Respects limit and reports hasMore.",
};

export const QUERY_DATA_DEF: ToolDef = {
  name: "query_data",
  description:
    "Query a data source. Supports free-text search (a term matched across every text field), filtering (Mongo-like $and/$or/$gt/$lt/$in/$regex…), sorting, pagination (offset/limit), and Cube-style aggregation (groupBy + measures + having + sort + limit). Returns rows as JSON. Prefer this over query_state for tabular/aggregated data. If you plan to chart these rows, prefer a live chart tool from your tool list when one covers this source: a static chart config is a snapshot that never refreshes. Name the columns you want in \"select\". A wide source (see the field count in list_data_sources) refuses a row query that selects no columns, and answers with the column count and how to pick columns instead of rows. To order an aggregate result, put the sort INSIDE \"aggregate\" and name a result column (the groupBy/measure alias), not a source field: \"aggregate\": { \"sort\": [{ \"field\": \"sum_total\", \"dir\": \"desc\" }] }. A top-level \"sort\" or \"select\" next to \"aggregate\" is rejected with an error that lists this query's result columns.",
  inputSchema: queryDataSchema,
  promptSnippet:
    "query_data: read/filter/aggregate data from a source. Supports free-text search, MongoDB-style filters, Cube aggregation, offset/limit pagination. On a wide source, always pass \"select\" with the columns you need. Sort an aggregate inside \"aggregate\", on a result-column alias — a top-level \"sort\"/\"select\" next to \"aggregate\" is rejected.",
};

// ---------------------------------------------------------------------------
// Lookup convenience.
// ---------------------------------------------------------------------------
export const TOOL_DEFS: Record<string, ToolDef> = {
  snapshot_page: SNAPSHOT_PAGE_DEF,
  query_state: QUERY_STATE_DEF,
  click: CLICK_DEF,
  fill: FILL_DEF,
  select_option: SELECT_OPTION_DEF,
  wait_for: WAIT_FOR_DEF,
  wait: WAIT_DEF,
  see: SEE_DEF,
  list_data_sources: LIST_DATA_SOURCES_DEF,
  get_field_details: GET_FIELD_DETAILS_DEF,
  sample_field_values: SAMPLE_FIELD_VALUES_DEF,
  query_data: QUERY_DATA_DEF,
};

export const TOOL_NAMES: string[] = Object.keys(TOOL_DEFS);
