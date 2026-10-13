/** Resolve a relative or absolute URL against a base URL or window.location. */
export function resolveRelativeUrl(url: string, baseUrl?: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  const base = baseUrl ?? (typeof window !== "undefined" ? window.location.href : "http://localhost");
  return new URL(url, base).href;
}
