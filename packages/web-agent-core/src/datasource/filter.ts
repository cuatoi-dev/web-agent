import { FieldSchema, FilterExpr, Condition, Scalar, FieldType } from "./types.js";

export function matchesFilter(row: Record<string, unknown>, expr: FilterExpr, schema: FieldSchema[]): boolean {
  if ("$and" in expr && Array.isArray(expr.$and)) {
    return expr.$and.every(subExpr => matchesFilter(row, subExpr, schema));
  }
  if ("$or" in expr && Array.isArray(expr.$or)) {
    return expr.$or.some(subExpr => matchesFilter(row, subExpr, schema));
  }
  if ("$not" in expr && expr.$not) {
    return !matchesFilter(row, expr.$not as FilterExpr, schema);
  }

  // Field map: multiple fields = implicit AND
  for (const [key, cond] of Object.entries(expr) as [string, Condition][]) {
    if (key === "$and" || key === "$or" || key === "$not") {
      continue;
    }

    const fieldSchema = schema.find(f => f.name === key);
    if (!fieldSchema) {
      throw new Error(`Unknown field "${key}". Fields: ${schema.map(f => f.name).join(", ")}`);
    }

    const val = row[key];
    if (!matchesCondition(val, cond, fieldSchema)) {
      return false;
    }
  }

  return true;
}

function matchesCondition(val: unknown, cond: Condition, field: FieldSchema): boolean {
  const isScalar = (v: unknown): v is Scalar => {
    return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
  };

  if (isScalar(cond)) {
    return evalOp("$eq", val, cond, field);
  }

  if (typeof cond === "object" && cond !== null) {
    for (const [op, opVal] of Object.entries(cond)) {
      if (!evalOp(op, val, opVal, field)) {
        return false;
      }
    }
    return true;
  }

  return false;
}

function evalOp(op: string, val: unknown, opVal: unknown, field: FieldSchema): boolean {
  const type = field.type;
  const name = field.name;

  const stringOps = ["$contains", "$startsWith", "$endsWith", "$regex"];
  const rangeOps = ["$gt", "$gte", "$lt", "$lte", "$between"];

  if (stringOps.includes(op)) {
    if (type !== "string" && type !== "enum") {
      throw new Error(`Operator ${op} is not valid for ${type} field "${name}".`);
    }
  }

  if (rangeOps.includes(op)) {
    if (type !== "number" && type !== "date" && type !== "string" && type !== "enum") {
      throw new Error(`Operator ${op} is not valid for ${type} field "${name}".`);
    }
  }

  if (op === "$exists") {
    const exists = val !== undefined;
    return exists === !!opVal;
  }

  if (op === "$isNull") {
    const isNull = val === null || val === undefined;
    return isNull === !!opVal;
  }

  if (op === "$eq") {
    return compareValues(val, opVal, type) === 0;
  }
  if (op === "$ne") {
    return compareValues(val, opVal, type) !== 0;
  }

  if (op === "$in") {
    if (!Array.isArray(opVal)) {
      throw new Error(`Operator $in expects an array value.`);
    }
    return opVal.some(item => compareValues(val, item, type) === 0);
  }

  if (op === "$nin") {
    if (!Array.isArray(opVal)) {
      throw new Error(`Operator $nin expects an array value.`);
    }
    return !opVal.some(item => compareValues(val, item, type) === 0);
  }

  if (op === "$contains") {
    if (typeof opVal !== "string") {
      throw new Error(`Operator $contains expects a string value.`);
    }
    if (typeof val !== "string") return false;
    return val.includes(opVal);
  }

  if (op === "$startsWith") {
    if (typeof opVal !== "string") {
      throw new Error(`Operator $startsWith expects a string value.`);
    }
    if (typeof val !== "string") return false;
    return val.startsWith(opVal);
  }

  if (op === "$endsWith") {
    if (typeof opVal !== "string") {
      throw new Error(`Operator $endsWith expects a string value.`);
    }
    if (typeof val !== "string") return false;
    return val.endsWith(opVal);
  }

  if (op === "$regex") {
    if (typeof opVal !== "string") {
      throw new Error(`Operator $regex expects a string value.`);
    }
    if (typeof val !== "string") return false;
    const re = safeCompileRegex(opVal);
    return re.test(val);
  }

  if (op === "$gt") {
    return compareValues(val, opVal, type) > 0;
  }
  if (op === "$gte") {
    return compareValues(val, opVal, type) >= 0;
  }
  if (op === "$lt") {
    return compareValues(val, opVal, type) < 0;
  }
  if (op === "$lte") {
    return compareValues(val, opVal, type) <= 0;
  }

  if (op === "$between") {
    if (!Array.isArray(opVal) || opVal.length !== 2) {
      throw new Error(`Operator $between expects an array of two values.`);
    }
    const low = (opVal as unknown[])[0];
    const high = (opVal as unknown[])[1];
    return compareValues(val, low, type) >= 0 && compareValues(val, high, type) <= 0;
  }

  throw new Error(`Unknown operator "${op}".`);
}

function safeCompileRegex(pattern: string): RegExp {
  if (pattern.length > 200) {
    throw new Error(`Regex pattern length exceeds limit of 200 characters.`);
  }
  let source = pattern;
  let flags = "";
  if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
    const lastSlash = pattern.lastIndexOf("/");
    source = pattern.substring(1, lastSlash);
    const rawFlags = pattern.substring(lastSlash + 1);
    if (rawFlags.includes("i")) {
      flags = "i";
    }
  }
  try {
    return new RegExp(source, flags);
  } catch (e: unknown) {
    throw new Error(
      `Invalid regex pattern: ${pattern}. Error: ${(e as Error).message}`,
      { cause: e },
    );
  }
}

export function compareValues(a: unknown, b: unknown, type: FieldType): number {
  if (a === undefined || a === null) {
    if (b === undefined || b === null) return 0;
    return -1;
  }
  if (b === undefined || b === null) {
    return 1;
  }

  if (type === "number") {
    const numA = Number(a);
    const numB = Number(b);
    if (numA < numB) return -1;
    if (numA > numB) return 1;
    return 0;
  }

  if (type === "date") {
    const timeA = toTime(a);
    const timeB = toTime(b);
    if (timeA < timeB) return -1;
    if (timeA > timeB) return 1;
    return 0;
  }

  if (type === "boolean") {
    const boolA = !!a;
    const boolB = !!b;
    if (boolA === boolB) return 0;
    return boolA ? 1 : -1;
  }

  const safeA = a as { toString(): string };
  const safeB = b as { toString(): string };
  const strA = String(safeA);
  const strB = String(safeB);
  if (strA < strB) return -1;
  if (strA > strB) return 1;
  return 0;
}

function toTime(val: unknown): number {
  if (val instanceof Date) return val.getTime();
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const parsed = Date.parse(val);
    if (!isNaN(parsed)) return parsed;
  }
  throw new Error(`Invalid date value: ${String(val)}`);
}

/** Text fields are the ones the string operators accept — see evalOp's
 *  `stringOps` guard (this file, lines 59-66), which allows $contains,
 *  $startsWith, $endsWith and $regex on "string" and "enum" only. Free-text
 *  search follows the same rule, so numbers, booleans and dates are never
 *  matched as text. */
function isTextField(field: FieldSchema): boolean {
  return field.type === "string" || field.type === "enum";
}

/**
 * True when any text field of the row contains `needle` as a case-insensitive
 * substring. `needle` must already be lower-cased and non-empty; callers treat
 * an empty or whitespace-only term as "no search".
 */
export function matchesSearch(
  row: Record<string, unknown>,
  needle: string,
  schema: FieldSchema[]
): boolean {
  for (const field of schema) {
    if (!isTextField(field)) continue;
    const val = row[field.name];
    if (typeof val !== "string") continue;
    if (val.toLowerCase().includes(needle)) return true;
  }
  return false;
}
