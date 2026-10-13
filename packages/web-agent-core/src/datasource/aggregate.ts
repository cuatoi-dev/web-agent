import { FieldSchema, Dimension, Measure, Aggregation, FilterExpr } from "./types.js";
import type { DimKey } from "./types.js";
import { matchesFilter, compareValues } from "./filter.js";

/**
 * Groups rows by dimensions, computes measures, applies having/sort/limit.
 * Returns aggregated rows + result field schemas (dimensions + measures).
 */
export function aggregate(
  rows: Record<string, unknown>[],
  schema: FieldSchema[],
  agg: Aggregation
): { rows: Record<string, unknown>[]; fields: FieldSchema[] } {
  // Resolve field schemas for groupBy dimensions
  const dimSchemas: { dim: Dimension; fs: FieldSchema; alias: string }[] = [];
  for (const dim of agg.groupBy) {
    const fs = schema.find(f => f.name === dim.field);
    if (!fs) {
      throw new Error(`Unknown groupBy field "${dim.field}". Fields: ${schema.map(f => f.name).join(", ")}`);
    }
    // Validate granularity is only on date fields
    if (dim.granularity && fs.type !== "date") {
      throw new Error(
        `granularity "${dim.granularity}" is only valid on date fields, but "${dim.field}" is ${fs.type}.`
      );
    }
    const alias = dim.as || (dim.granularity ? `${dim.field}_${dim.granularity}` : dim.field);
    dimSchemas.push({ dim, fs, alias });
  }

  // Resolve measure schemas
  const measureDefs: { m: Measure; alias: string }[] = [];
  for (const m of agg.measures) {
    if (m.op !== "count" && !m.field) {
      throw new Error(`Measure "${m.op}" requires a "field".`);
    }
    if (m.field) {
      const fs = schema.find(f => f.name === m.field);
      if (!fs) {
        throw new Error(`Unknown measure field "${m.field}". Fields: ${schema.map(f => f.name).join(", ")}`);
      }
      // sum/avg/min/max/first/last operate on numeric values (first/last = open/close)
      if (["sum", "avg", "min", "max", "first", "last"].includes(m.op) && fs.type !== "number") {
        throw new Error(
          `Measure "${m.op}" on field "${m.field}" requires a number type, but it is ${fs.type}.`
        );
      }
    }
    const alias = m.as || (m.op === "count" && !m.field ? "count" : `${m.op}_${m.field}`);
    measureDefs.push({ m, alias });
  }

  // Ordering key for first/last (open/close): the raw field of the first
  // date-typed field in the source schema (independent of groupBy); undefined
  // → use source row order.
  const needsOrder = agg.measures.some(m => m.op === "first" || m.op === "last");
  const orderField = needsOrder
    ? schema.find(f => f.type === "date")?.name
    : undefined;

  // 1. Group rows by composite dimension key
  const groups = new Map<DimKey, Record<string, unknown>[]>();

  for (const row of rows) {
    const key = buildDimKey(row, dimSchemas);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(row);
  }

  // 2. Compute result fields (dimensions + measures)
  const resultFields: FieldSchema[] = dimSchemas.map(({ dim, fs, alias }) => {
    // Bucketed date dimensions become "string" type for the output
    const outType = dim.granularity ? ("string" as const) : fs.type;
    return { name: alias, type: outType, description: fs.description };
  });

  for (const { alias } of measureDefs) {
    resultFields.push({ name: alias, type: "number", description: undefined });
  }

  // 3. Build aggregated rows
  const aggRows: Record<string, unknown>[] = [];

  for (const [, groupRows] of groups) {
    const row: Record<string, unknown> = {};

    const orderedRows = orderField
      ? [...groupRows].sort((a, b) => compareValues(a[orderField], b[orderField], "date"))
      : groupRows;

    // Dimension values (from first row in group — all same)
    for (const { dim, alias } of dimSchemas) {
      const val = groupRows[0][dim.field];
      if (dim.granularity && val != null) {
        row[alias] = bucketDate(val, dim.granularity);
      } else {
        row[alias] = val;
      }
    }

    // Measure values
    for (const { m, alias } of measureDefs) {
      row[alias] = computeMeasure(m, orderedRows);
    }

    aggRows.push(row);
  }

  // 4. Having — filter aggregated rows by measure aliases
  let result = aggRows;
  if (agg.having) {
    result = result.filter(r => matchesFilter(r, agg.having as FilterExpr, resultFields));
  }

  // 5. Sort — by dimension or measure alias
  if (agg.sort && agg.sort.length > 0) {
    for (const item of agg.sort) {
      const fs = resultFields.find(f => f.name === item.field);
      if (!fs) {
        throw new Error(
          `Unknown sort field "${item.field}" in aggregate sort. Available: ${resultFields.map(f => f.name).join(", ")}`
        );
      }
    }
    result.sort((a, b) => {
      for (const item of agg.sort!) {
        const fs = resultFields.find(f => f.name === item.field)!;
        const valA = a[item.field];
        const valB = b[item.field];
        const cmp = compareValues(valA, valB, fs.type);
        if (cmp !== 0) {
          return item.dir === "desc" ? -cmp : cmp;
        }
      }
      return 0;
    });
  }

  // 6. Limit
  const limit = agg.limit !== undefined ? Math.min(Math.max(agg.limit, 1), 500) : 100;
  if (result.length > limit) {
    result = result.slice(0, limit);
  }

  return { rows: result, fields: resultFields };
}

function buildDimKey(row: Record<string, unknown>, dimSchemas: { dim: Dimension; fs: FieldSchema; alias: string }[]): string {
  const parts: string[] = [];
  for (const { dim } of dimSchemas) {
    let val = row[dim.field];
    if (dim.granularity && val != null) {
      val = bucketDate(val, dim.granularity);
    }
    const safeVal = (val ?? "__null__") as { toString(): string };
    parts.push(String(safeVal));
  }
  return parts.join("|");
}

function bucketDate(val: unknown, granularity: string): string {
  const d = new Date(typeof val === "string" ? val : Number(val));
  if (isNaN(d.getTime())) return String(val);

  // Use UTC methods to avoid timezone shifts
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const HH = String(d.getUTCHours()).padStart(2, "0");
  const MM = String(d.getUTCMinutes()).padStart(2, "0");

  switch (granularity) {
    case "minute":
      return `${yyyy}-${mm}-${dd} ${HH}:${MM}`;
    case "hour":
      return `${yyyy}-${mm}-${dd} ${HH}:00`;
    case "day":
      return `${yyyy}-${mm}-${dd}`;
    case "week": {
      // ISO week start (Monday), using UTC
      const dayOfWeek = d.getUTCDay();
      const diff = d.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setUTCDate(diff);
      const mmm = String(monday.getUTCMonth() + 1).padStart(2, "0");
      const mdd = String(monday.getUTCDate()).padStart(2, "0");
      return `${monday.getUTCFullYear()}-${mmm}-${mdd}`;
    }
    case "month":
      return `${yyyy}-${mm}-01`;
    case "quarter": {
      const q = Math.floor((d.getUTCMonth()) / 3) + 1;
      return `${yyyy}-Q${q}`;
    }
    case "year":
      return `${yyyy}`;
    default:
      return `${yyyy}-${mm}-${dd}`;
  }
}

function computeMeasure(m: Measure, groupRows: Record<string, unknown>[]): number {
  const op = m.op;

  if (op === "count") {
    return groupRows.length;
  }

  const field = m.field!;
  const values = groupRows.map(r => Number(r[field])).filter(v => !isNaN(v));

  switch (op) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg": {
      if (values.length === 0) return 0;
      return values.reduce((a, b) => a + b, 0) / values.length;
    }
    case "min":
      return values.length > 0 ? Math.min(...values) : 0;
    case "max":
      return values.length > 0 ? Math.max(...values) : 0;
    case "first": {
      for (const r of groupRows) {
        if (r[field] == null) continue;
        const n = Number(r[field]);
        if (!isNaN(n)) return n;
      }
      return 0;
    }
    case "last": {
      for (let i = groupRows.length - 1; i >= 0; i--) {
        if (groupRows[i][field] == null) continue;
        const n = Number(groupRows[i][field]);
        if (!isNaN(n)) return n;
      }
      return 0;
    }
    case "countDistinct": {
      const distinct = new Set(groupRows.map(r => r[field]));
      return distinct.size;
    }
    default:
      throw new Error(`Unknown measure op: ${String(op)}`);
  }
}
