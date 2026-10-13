// -------------------------------------------------------------------------
// Pure helpers (exported for testability) — no component state dependency.
// -------------------------------------------------------------------------

/**
 * Display label for a session row.
 * Uses the saved title, or falls back to a locale-formatted creation date.
 */
export function formatSessionLabel(
  meta: { title: string; createdAt: number }
): string {
  const t = (meta.title ?? "").trim();
  if (t) return t;
  return new Date(meta.createdAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Compact locale timestamp for the session row subtitle (updatedAt).
 */
export function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
