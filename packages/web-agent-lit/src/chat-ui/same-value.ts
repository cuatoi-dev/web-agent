/** True when `a` and `b` are the same value for a panel property.
 *
 *  - Identical values (`===`) match.
 *  - Two plain objects (for example two `appContext` literals from one Lit
 *    template render) match when they have the same keys and every value is
 *    `===`. One level only, no recursion.
 *  - Arrays, functions and class instances match only by identity. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}
