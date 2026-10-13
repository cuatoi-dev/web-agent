import type { Scalar } from "@cuatoi/web-agent-core";
import type { EsFieldInfo, EsSchema } from "./types.js";

export const STRING_OPS = new Set(["$contains", "$startsWith", "$endsWith", "$regex"]);
export const RANGE_OPS = new Set(["$gt", "$gte", "$lt", "$lte", "$between"]);

export function fieldList(schema: EsSchema): string {
  return schema.fields.map((f) => f.name).join(", ");
}

export function unknownFieldError(schema: EsSchema, name: string): Error {
  return new Error(`Unknown field "${name}". Fields: ${fieldList(schema)}`);
}

export function fieldInfo(schema: EsSchema, name: string): EsFieldInfo {
  const info = schema.byName[name];
  if (!info) throw unknownFieldError(schema, name);
  return info;
}

export function groupByFieldInfo(schema: EsSchema, name: string): EsFieldInfo {
  const info = schema.byName[name];
  if (!info) {
    throw new Error(`Unknown groupBy field "${name}". Fields: ${fieldList(schema)}`);
  }
  return info;
}

export function measureFieldInfo(schema: EsSchema, name: string): EsFieldInfo {
  const info = schema.byName[name];
  if (!info) {
    throw new Error(`Unknown measure field "${name}". Fields: ${fieldList(schema)}`);
  }
  return info;
}

/** At most this many alternative field names go into the error message. The
 *  cap exists so a 300-column source does not print 290 names; it is not a
 *  token budget. Result truncation belongs to tasks 006-009. */
const MAX_SUGGESTED_FIELDS = 10;

export function requireTermPath(schema: EsSchema, name: string, info: EsFieldInfo): string {
  if (!info.termPath) {
    const usable = schema.fields
      .filter((f) => schema.byName[f.name]?.termPath !== undefined)
      .map((f) => f.name);
    const shown = usable.slice(0, MAX_SUGGESTED_FIELDS).join(", ");
    const more = usable.length > MAX_SUGGESTED_FIELDS
      ? ` (and ${usable.length - MAX_SUGGESTED_FIELDS} more)`
      : "";
    const alternatives = usable.length
      ? ` Use "search" to match its text instead, or sort, filter or group by one of these fields: ${shown}${more}.`
      : ` Use "search" to match its text instead.`;
    throw new Error(
      `Field "${name}" cannot be filtered, sorted or grouped. ` +
      `${info.limitation ?? "It has no term path in Elasticsearch."}${alternatives}`,
    );
  }
  return info.termPath;
}

export function escWildcard(v: string): string {
  return v.replace(/([*?\\])/g, "\\$1");
}

export function isScalar(v: unknown): v is Scalar {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}
