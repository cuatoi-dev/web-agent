import { get, isEqual, toPath } from "lodash-es";

/**
 * Matches an item against key-value equality pairs.
 * Dotted keys (e.g. "address.country") resolve through nested objects.
 */
export function matches(item: unknown, where: Record<string, unknown>): boolean {
  if (item === null || typeof item !== "object") return false;
  for (const [key, want] of Object.entries(where)) {
    const got = get(item, toPath(key)) as unknown;
    if (!isEqual(got, want)) return false;
  }
  return true;
}

/**
 * Keeps the listed top-level keys in the order given.
 */
export function pick(item: unknown, fields: string[]): Record<string, unknown> {
  if (item === null || typeof item !== "object") return {};
  const obj = item as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(obj, f)) {
      out[f] = obj[f];
    }
  }
  return out;
}
