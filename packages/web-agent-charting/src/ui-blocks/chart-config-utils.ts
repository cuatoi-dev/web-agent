// ── Typed accessors for walking an unknown Chart.js config ──

/** True for any non-null object, arrays included. This is exactly the test the
 *  walkers below already run (`typeof v === "object" && v !== null`), written as
 *  a type predicate so the compiler follows it. Arrays must pass: the recursive
 *  walks descend into them through `Object.keys`. */
export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** `v[key]` when `v` is an object, else undefined — the typed stand-in for the
 *  `config?.data?.datasets` optional chains that used to run on `any`. */
export function get(v: unknown, key: string): unknown {
  return isObj(v) ? v[key] : undefined;
}

/** `v` when it is an array, else an empty array. */
export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
