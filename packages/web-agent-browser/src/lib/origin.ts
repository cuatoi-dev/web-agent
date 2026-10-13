/** The origin match pattern Chrome needs for an endpoint URL, or null when the
 *  URL is not a usable http(s) endpoint. Port is omitted on purpose: a pattern
 *  with no port matches every port. */
export function originPattern(endpoint: string): string | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return `${url.protocol}//${url.hostname}/*`;
}
