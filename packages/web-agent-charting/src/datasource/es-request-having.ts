import type { FilterExpr, Condition, Aggregation } from "@cuatoi/web-agent-core";
import { STRING_OPS, isScalar } from "./es-request-fields.js";

function painlessLiteral(v: unknown): string {
  if (typeof v === "string") return `'${v.replace(/'/g, "\\'")}'`;
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function havingOpScript(varName: string, op: string, opVal: unknown): string {
  if (STRING_OPS.has(op)) {
    throw new Error(`Operator ${op} is not valid for number field "${varName}".`);
  }
  switch (op) {
    case "$eq":
      return `params.${varName} == ${painlessLiteral(opVal)}`;
    case "$ne":
      return `params.${varName} != ${painlessLiteral(opVal)}`;
    case "$gt":
      return `params.${varName} > ${painlessLiteral(opVal)}`;
    case "$gte":
      return `params.${varName} >= ${painlessLiteral(opVal)}`;
    case "$lt":
      return `params.${varName} < ${painlessLiteral(opVal)}`;
    case "$lte":
      return `params.${varName} <= ${painlessLiteral(opVal)}`;
    case "$in": {
      if (!Array.isArray(opVal)) throw new Error(`Operator $in expects an array value.`);
      return `[${opVal.map(painlessLiteral).join(", ")}].contains(params.${varName})`;
    }
    case "$nin": {
      if (!Array.isArray(opVal)) throw new Error(`Operator $nin expects an array value.`);
      return `!([${opVal.map(painlessLiteral).join(", ")}].contains(params.${varName}))`;
    }
    case "$between": {
      if (!Array.isArray(opVal) || opVal.length !== 2) {
        throw new Error(`Operator $between expects an array of two values.`);
      }
      return `(params.${varName} >= ${painlessLiteral(opVal[0])} && params.${varName} <= ${painlessLiteral(opVal[1])})`;
    }
    case "$exists":
      return opVal ? "true" : "false";
    case "$isNull":
      return opVal ? "false" : "true";
    default:
      throw new Error(`Unknown operator "${op}".`);
  }
}

function havingConditionScript(varName: string, cond: Condition): string {
  if (isScalar(cond)) {
    return `params.${varName} == ${painlessLiteral(cond)}`;
  }
  if (typeof cond === "object" && cond !== null) {
    const parts = Object.entries(cond).map(([op, opVal]) => havingOpScript(varName, op, opVal));
    return parts.length === 1 ? parts[0] : `(${parts.join(" && ")})`;
  }
  throw new Error(`Invalid having condition for "${varName}".`);
}

export function havingScript(expr: FilterExpr): string {
  if ("$and" in expr && Array.isArray((expr as { $and: FilterExpr[] }).$and)) {
    return `(${(expr as { $and: FilterExpr[] }).$and.map((e) => havingScript(e)).join(" && ")})`;
  }
  if ("$or" in expr && Array.isArray((expr as { $or: FilterExpr[] }).$or)) {
    return `(${(expr as { $or: FilterExpr[] }).$or.map((e) => havingScript(e)).join(" || ")})`;
  }
  if ("$not" in expr && (expr as { $not: FilterExpr }).$not) {
    return `!(${havingScript((expr as { $not: FilterExpr }).$not)})`;
  }
  const parts: string[] = [];
  for (const [key, cond] of Object.entries(expr)) {
    if (key === "$and" || key === "$or" || key === "$not") continue;
    parts.push(havingConditionScript(key, cond as Condition));
  }
  return parts.length === 1 ? parts[0] : `(${parts.join(" && ")})`;
}

export function collectHavingAliases(expr: FilterExpr, out: Set<string>): void {
  if ("$and" in expr && Array.isArray((expr as { $and: FilterExpr[] }).$and)) {
    (expr as { $and: FilterExpr[] }).$and.forEach((e) => collectHavingAliases(e, out));
    return;
  }
  if ("$or" in expr && Array.isArray((expr as { $or: FilterExpr[] }).$or)) {
    (expr as { $or: FilterExpr[] }).$or.forEach((e) => collectHavingAliases(e, out));
    return;
  }
  if ("$not" in expr && (expr as { $not: FilterExpr }).$not) {
    collectHavingAliases((expr as { $not: FilterExpr }).$not, out);
    return;
  }
  for (const key of Object.keys(expr)) {
    if (key === "$and" || key === "$or" || key === "$not") continue;
    out.add(key);
  }
}

export function havingBucketsPath(
  aliases: Set<string>,
  measureAliases: string[],
  agg: Aggregation,
): Record<string, string> {
  const bucketsPath: Record<string, string> = {};
  for (const alias of aliases) {
    const idx = measureAliases.indexOf(alias);
    if (idx === -1) {
      throw new Error(`Unknown having field "${alias}". Fields: ${measureAliases.join(", ")}`);
    }
    const m = agg.measures[idx];
    if (m.op === "count" && !m.field) {
      bucketsPath[alias] = "_count";
    } else if (m.op === "first" || m.op === "last") {
      throw new Error(
        `Having on measure "${alias}" (first/last) is not supported: Elasticsearch cannot ` +
          `pipeline-aggregate a top_hits value.`,
      );
    } else {
      bucketsPath[alias] = `m${idx}`;
    }
  }
  return bucketsPath;
}
