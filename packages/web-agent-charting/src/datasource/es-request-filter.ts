import type { DataQuery, FilterExpr, Condition } from "@cuatoi/web-agent-core";
import type { EsFieldInfo, EsSchema } from "./types.js";
import {
  STRING_OPS,
  RANGE_OPS,
  escWildcard,
  fieldInfo,
  isScalar,
  requireTermPath,
} from "./es-request-fields.js";

function checkOperatorType(op: string, name: string, info: EsFieldInfo): void {
  if (STRING_OPS.has(op) && info.type !== "string" && info.type !== "enum") {
    throw new Error(`Operator ${op} is not valid for ${info.type} field "${name}".`);
  }
  if (
    RANGE_OPS.has(op) &&
    info.type !== "number" &&
    info.type !== "date" &&
    info.type !== "string" &&
    info.type !== "enum"
  ) {
    throw new Error(`Operator ${op} is not valid for ${info.type} field "${name}".`);
  }
}

// Lucene `regexp` matches the WHOLE term, and treats ^ and $ as literals —
// measured on ES 8.15.3, 2026-08-18: {"regexp":{"name":"li"}} returns nothing
// for "Alice" while ".*li.*" returns it. JavaScript's RegExp.test is
// unanchored, so wrap the pattern to reproduce the in-memory behaviour.
// Lookahead and backreference are NOT supported and fail SILENTLY with zero
// hits rather than an error — do not translate them into something else.
function translateRegex(t: string, pattern: string): Record<string, unknown> {
  if (pattern.length > 200) {
    throw new Error(`Regex pattern length exceeds limit of 200 characters.`);
  }
  let source = pattern;
  let caseInsensitive = false;
  if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
    const lastSlash = pattern.lastIndexOf("/");
    source = pattern.substring(1, lastSlash);
    const rawFlags = pattern.substring(lastSlash + 1);
    if (rawFlags.includes("i")) caseInsensitive = true;
  }

  source = source.startsWith("^") ? source.slice(1) : ".*" + source;
  source = source.endsWith("$") && !source.endsWith("\\$") ? source.slice(0, -1) : source + ".*";

  return {
    regexp: { [t]: { value: source, flags: "ALL", case_insensitive: caseInsensitive } },
  };
}

function translateOp(
  schema: EsSchema,
  name: string,
  op: string,
  opVal: unknown,
  info: EsFieldInfo,
): Record<string, unknown> {
  checkOperatorType(op, name, info);

  if (op === "$exists") {
    const t = requireTermPath(schema, name, info);
    return opVal ? { exists: { field: t } } : { bool: { must_not: [{ exists: { field: t } }] } };
  }
  if (op === "$isNull") {
    const t = requireTermPath(schema, name, info);
    return opVal ? { bool: { must_not: [{ exists: { field: t } }] } } : { exists: { field: t } };
  }

  const t = requireTermPath(schema, name, info);

  switch (op) {
    case "$eq":
      return { term: { [t]: opVal } };
    case "$ne":
      return { bool: { must_not: [{ term: { [t]: opVal } }] } };
    case "$gt":
      return { range: { [t]: { gt: opVal } } };
    case "$gte":
      return { range: { [t]: { gte: opVal } } };
    case "$lt":
      return { range: { [t]: { lt: opVal } } };
    case "$lte":
      return { range: { [t]: { lte: opVal } } };
    case "$between": {
      if (!Array.isArray(opVal) || opVal.length !== 2) {
        throw new Error(`Operator $between expects an array of two values.`);
      }
      const [gte, lte] = opVal as unknown[];
      return { range: { [t]: { gte, lte } } };
    }
    case "$in": {
      if (!Array.isArray(opVal)) throw new Error(`Operator $in expects an array value.`);
      return { terms: { [t]: opVal } };
    }
    case "$nin": {
      if (!Array.isArray(opVal)) throw new Error(`Operator $nin expects an array value.`);
      return { bool: { must_not: [{ terms: { [t]: opVal } }] } };
    }
    case "$contains": {
      if (typeof opVal !== "string") throw new Error(`Operator $contains expects a string value.`);
      return { wildcard: { [t]: { value: `*${escWildcard(opVal)}*` } } };
    }
    case "$startsWith": {
      if (typeof opVal !== "string") throw new Error(`Operator $startsWith expects a string value.`);
      return { prefix: { [t]: { value: opVal } } };
    }
    case "$endsWith": {
      if (typeof opVal !== "string") throw new Error(`Operator $endsWith expects a string value.`);
      return { wildcard: { [t]: { value: `*${escWildcard(opVal)}` } } };
    }
    case "$regex": {
      if (typeof opVal !== "string") throw new Error(`Operator $regex expects a string value.`);
      return translateRegex(t, opVal);
    }
    default:
      throw new Error(`Unknown operator "${op}".`);
  }
}

function translateCondition(
  name: string,
  cond: Condition,
  info: EsFieldInfo,
  schema: EsSchema,
): Record<string, unknown> {
  if (isScalar(cond)) {
    return translateOp(schema, name, "$eq", cond, info);
  }
  if (typeof cond === "object" && cond !== null) {
    const clauses = Object.entries(cond).map(([op, opVal]) =>
      translateOp(schema, name, op, opVal, info),
    );
    return clauses.length === 1 ? clauses[0] : { bool: { filter: clauses } };
  }
  throw new Error(`Invalid condition for field "${name}".`);
}

function translateFilter(expr: FilterExpr, schema: EsSchema): Record<string, unknown> {
  if ("$and" in expr && Array.isArray((expr as { $and: FilterExpr[] }).$and)) {
    const clauses = (expr as { $and: FilterExpr[] }).$and.map((e) => translateFilter(e, schema));
    return { bool: { filter: clauses } };
  }
  if ("$or" in expr && Array.isArray((expr as { $or: FilterExpr[] }).$or)) {
    const clauses = (expr as { $or: FilterExpr[] }).$or.map((e) => translateFilter(e, schema));
    return { bool: { should: clauses, minimum_should_match: 1 } };
  }
  if ("$not" in expr && (expr as { $not: FilterExpr }).$not) {
    return { bool: { must_not: [translateFilter((expr as { $not: FilterExpr }).$not, schema)] } };
  }

  const clauses: Record<string, unknown>[] = [];
  for (const [name, cond] of Object.entries(expr)) {
    if (name === "$and" || name === "$or" || name === "$not") continue;
    const info = fieldInfo(schema, name);
    clauses.push(translateCondition(name, cond as Condition, info, schema));
  }
  return clauses.length === 1 ? clauses[0] : { bool: { filter: clauses } };
}

// matchesSearch (core filter.ts:252-264) is a case-insensitive SUBSTRING scan
// over text fields. multi_match and query_string are token-based, so "almon"
// would not find "Salmon" and the two backends would disagree. A case
// insensitive wildcard over each field's keyword path is an exact match for
// the in-memory rule — measured working on ES 8.15.3, 2026-08-18.
function translateSearch(term: string, schema: EsSchema): Record<string, unknown> {
  const should: Record<string, unknown>[] = [];
  for (const f of schema.fields) {
    if (f.type !== "string" && f.type !== "enum") continue;
    const info = schema.byName[f.name];
    if (!info?.termPath) continue;
    should.push({
      wildcard: { [info.termPath]: { value: `*${escWildcard(term)}*`, case_insensitive: true } },
    });
  }
  if (should.length === 0) {
    return { bool: { must_not: [{ match_all: {} }] } };
  }
  return { bool: { minimum_should_match: 1, should } };
}

export function buildQueryClause(q: DataQuery, schema: EsSchema): Record<string, unknown> | undefined {
  const clauses: Record<string, unknown>[] = [];
  const needle = q.search?.trim().toLowerCase();
  if (needle) clauses.push(translateSearch(needle, schema));
  if (q.filter) clauses.push(translateFilter(q.filter, schema));
  if (clauses.length === 0) return undefined;
  return { bool: { filter: clauses } };
}
