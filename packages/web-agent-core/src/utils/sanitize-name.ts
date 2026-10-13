/**
 * Convert an arbitrary string into a valid identifier (alphanumeric + underscore).
 * Strips leading and trailing underscores.
 */
export function sanitizeName(name: string, fallback = ""): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "") || fallback;
}
