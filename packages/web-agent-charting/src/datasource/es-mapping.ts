import type { FieldSchema, FieldType } from "@cuatoi/web-agent-core";
import type { EsSchema, EsFieldInfo, EsUnsupportedField, MappingProperty } from "./types.js";

/**
 * Mapping type → DataQuery type. Verified against a live 8.15.3 _mapping.
 * `flattened`, `ip` and `version` were each probed on 2026-08-20: sorting and
 * a `terms` aggregation succeeded on all three, and all three are present in
 * `_source`. `match_only_text` is here too, but it gets no `termPath` — the
 * same probe returned "match_only_text fields do not support sorting and
 * aggregations".
 *
 * A type that is NOT in this map and is not `alias` is reported through
 * EsSchema.unsupported. There is deliberately no list of unsupported types:
 * the report is the complement of this map, so a type Elasticsearch adds
 * later is reported rather than silently dropped.
 */
const TYPE_MAP: Record<string, FieldType> = {
  keyword: "string", text: "string", constant_keyword: "string", wildcard: "string",
  match_only_text: "string",
  flattened: "string", ip: "string", version: "string",
  date: "date", date_nanos: "date",
  boolean: "boolean",
  long: "number", integer: "number", short: "number", byte: "number",
  double: "number", float: "number", half_float: "number", scaled_float: "number",
  unsigned_long: "number",
};

/** Elasticsearch types that are searchable as free text but carry no doc values. */
const NO_DOC_VALUES_TEXT = new Set(["text", "match_only_text"]);

const TEXT_NO_KEYWORD_LIMITATION =
  "Free-text search only: this is a text field with no keyword subfield, " +
  "so Elasticsearch cannot sort, filter exactly, or group by it.";

const MATCH_ONLY_TEXT_LIMITATION =
  "Free-text search only: Elasticsearch does not support sorting or " +
  "aggregating a match_only_text field.";

/**
 * Reads a `GET /<target>/_mapping` body, where `<target>` may be a concrete
 * index, an alias, or a data stream.
 *
 * Elasticsearch keys the response by the CONCRETE index name, never by the
 * name you asked for. Verified against 8.15.3 on 2026-08-20:
 * `GET /wide-fixture/_mapping` on the alias returned `keys: ["wide-fixture-v1"]`,
 * and a data stream returned one key per backing index
 * (`[".ds-…-000001", ".ds-…-000002"]` after a rollover). So: use
 * `body[indexName]` when it is there, and otherwise merge every entry in key
 * order. When two entries define the same field name, the first wins — the
 * backing indices of one data stream share a template, so they agree.
 *
 * An object property with nested `properties` is flattened to dotted names
 * (`a.b`). A `fields` subfield is not a field of its own — a `keyword`
 * subfield becomes the parent's `termPath`. A property whose type has no
 * DataQuery equivalent is recorded in `unsupported`, never dropped.
 *
 * Returns `{ fields: [], byName: {}, unsupported: [] }` when the body holds
 * no properties at all, so an empty body degrades instead of throwing. The
 * caller reports that emptiness; see es-source.ts.
 */
export function esSchemaFromMapping(body: unknown, indexName: string): EsSchema {
  const fields: FieldSchema[] = [];
  const byName: Record<string, EsFieldInfo> = {};
  const unsupported: EsUnsupportedField[] = [];

  const properties = resolveProperties(body, indexName);
  if (!properties) {
    return { fields, byName, unsupported };
  }

  walkProperties(properties, "", fields, byName, unsupported);
  resolveAliases(properties, fields, byName, unsupported);
  return { fields, byName, unsupported };
}

/** Merges the mapping properties of every entry the response carries. */
function resolveProperties(
  body: unknown,
  indexName: string,
): Record<string, MappingProperty> | undefined {
  const root = body as Record<string, unknown> | null;
  if (!root || typeof root !== "object") return undefined;

  const entries =
    root[indexName] !== undefined ? [root[indexName]] : Object.values(root);

  const merged: Record<string, MappingProperty> = {};
  let found = false;
  for (const entry of entries) {
    const mappings = (entry as Record<string, unknown> | null)?.mappings as
      | Record<string, unknown>
      | undefined;
    const properties = mappings?.properties as Record<string, MappingProperty> | undefined;
    if (!properties) continue;
    found = true;
    for (const [key, prop] of Object.entries(properties)) {
      if (!(key in merged)) merged[key] = prop;
    }
  }
  return found ? merged : undefined;
}

function walkProperties(
  properties: Record<string, MappingProperty>,
  prefix: string,
  fields: FieldSchema[],
  byName: Record<string, EsFieldInfo>,
  unsupported: EsUnsupportedField[],
): void {
  for (const [key, prop] of Object.entries(properties)) {
    const name = prefix ? `${prefix}.${key}` : key;

    if (prop.properties) {
      walkProperties(prop.properties, name, fields, byName, unsupported);
      continue;
    }

    const esType = prop.type;
    if (!esType) continue;

    // An alias is a pointer. Its target may not have been walked yet, so it
    // is resolved in a second pass; see resolveAliases.
    if (esType === "alias") continue;

    const type = TYPE_MAP[esType];
    if (!type) {
      unsupported.push({
        name,
        esType,
        reason:
          `Elasticsearch type "${esType}" has no equivalent query type, so this ` +
          `field cannot be selected, filtered, sorted or grouped.`,
      });
      continue;
    }

    let termPath: string | undefined = name;
    let limitation: string | undefined;
    if (NO_DOC_VALUES_TEXT.has(esType)) {
      const keywordSub = Object.entries(prop.fields ?? {}).find(
        ([, sub]) => sub.type === "keyword",
      );
      if (esType === "match_only_text") {
        // Probed 2026-08-20: sorting and aggregating both fail, keyword
        // subfield or not.
        termPath = undefined;
        limitation = MATCH_ONLY_TEXT_LIMITATION;
      } else if (keywordSub) {
        termPath = `${name}.${keywordSub[0]}`;
      } else {
        termPath = undefined;
        limitation = TEXT_NO_KEYWORD_LIMITATION;
      }
    }

    fields.push(limitation ? { name, type, limitation } : { name, type });
    byName[name] = limitation
      ? { name, type, esType, termPath, limitation }
      : { name, type, esType, termPath };
  }
}

/**
 * Resolves `type: "alias"` properties, which point at another field by `path`.
 * An alias inherits its target's DataQuery type, termPath and limitation
 * verbatim — probed against 8.15.3 on 2026-08-20, sorting and aggregating
 * through the target's own path is exactly equivalent — and records the
 * target as `sourcePath`, because an alias is absent from `_source`.
 *
 * An alias whose target is missing from the mapping, or whose target is
 * itself unsupported, is reported rather than dropped.
 */
function resolveAliases(
  properties: Record<string, MappingProperty>,
  fields: FieldSchema[],
  byName: Record<string, EsFieldInfo>,
  unsupported: EsUnsupportedField[],
): void {
  for (const [name, prop] of Object.entries(properties)) {
    if (prop.type !== "alias") continue;
    const path = (prop as { path?: string }).path;
    const target = path ? byName[path] : undefined;
    if (!target) {
      unsupported.push({
        name,
        esType: "alias",
        reason:
          `Field alias "${name}" points at "${path ?? "(no path)"}", which is ` +
          `not a queryable field of this index.`,
      });
      continue;
    }

    const info: EsFieldInfo = {
      name,
      type: target.type,
      esType: "alias",
      termPath: target.termPath,
      sourcePath: target.sourcePath ?? target.name,
    };
    if (target.limitation) info.limitation = target.limitation;

    fields.push(
      target.limitation
        ? { name, type: target.type, limitation: target.limitation }
        : { name, type: target.type },
    );
    byName[name] = info;
  }
}

/**
 * A `_search` body with `size: 0` and one `terms` agg per candidate field, used
 * to discover `enumValues`. Candidates are fields whose DataQuery type is
 * "string" and whose termPath exists. `size` is `maxValues + 1` so an
 * over-threshold field is detectable. Returns null when there is no candidate.
 */
export function esEnumProbeBody(
  schema: EsSchema,
  maxValues: number = ES_ENUM_MAX_VALUES,
): Record<string, unknown> | null {
  const candidates = schema.fields.filter((f) => {
    const info = schema.byName[f.name];
    return f.type === "string" && info?.termPath !== undefined;
  });
  if (candidates.length === 0) return null;

  const aggs: Record<string, unknown> = {};
  for (const f of candidates) {
    const info = schema.byName[f.name];
    aggs[f.name] = { terms: { field: info.termPath, size: maxValues + 1 } };
  }
  return { size: 0, aggs };
}

/**
 * Applies the probe response. A field whose terms agg returned at most
 * `maxValues` buckets AND `sum_other_doc_count === 0` becomes type "enum" with
 * `enumValues` in bucket order. Every other field is left as it was. Returns a
 * NEW EsSchema; the input is not mutated.
 */
export function applyEsEnumProbe(
  schema: EsSchema,
  body: unknown,
  maxValues: number = ES_ENUM_MAX_VALUES,
): EsSchema {
  const aggregations = (body as Record<string, unknown> | null)?.aggregations as
    | Record<string, { buckets?: { key: unknown }[]; sum_other_doc_count?: number }>
    | undefined;
  if (!aggregations) {
    return { fields: [...schema.fields], byName: { ...schema.byName }, unsupported: schema.unsupported };
  }

  const fields: FieldSchema[] = [];
  const byName: Record<string, EsFieldInfo> = { ...schema.byName };

  for (const f of schema.fields) {
    const agg = aggregations[f.name];
    if (
      agg &&
      Array.isArray(agg.buckets) &&
      agg.buckets.length <= maxValues &&
      (agg.sum_other_doc_count ?? 0) === 0
    ) {
      const enumValues = agg.buckets.map((b) => String(b.key));
      fields.push({ ...f, type: "enum", enumValues });
      byName[f.name] = { ...byName[f.name], type: "enum" };
    } else {
      fields.push(f);
    }
  }

  return { fields, byName, unsupported: schema.unsupported };
}

/** Default enum threshold. A field with more distinct values stays "string". */
export const ES_ENUM_MAX_VALUES = 50;
