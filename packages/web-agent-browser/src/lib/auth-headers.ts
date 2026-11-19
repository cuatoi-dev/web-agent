import type { ResolvedProvider } from "./types";

/** The Anthropic API version every anthropic-format request names. */
export const ANTHROPIC_VERSION = "2023-06-01";

/** The headers one request to `provider` carries.
 *
 *  - A key: the header the wire format uses. For a brand provider the key is
 *    the Key-button key or the brand's default key.
 *  - No key: no auth header, for brand and custom providers alike.
 *  - anthropic format: `anthropic-version` and
 *    `anthropic-dangerous-direct-browser-access`, which a direct browser call
 *    to Anthropic needs.
 *  - Custom headers last; one wins over an auth header of the same name in
 *    any letter case. */
export function authHeaders(provider: ResolvedProvider): Record<string, string> {
  const h: Record<string, string> = {};
  const key = provider.apiKey.trim();
  if (key) {
    if (provider.wireFormat === "openai") h["Authorization"] = `Bearer ${key}`;
    else if (provider.wireFormat === "anthropic") h["x-api-key"] = key;
    else h["x-goog-api-key"] = key;
  }
  if (provider.wireFormat === "anthropic") {
    h["anthropic-version"] = ANTHROPIC_VERSION;
    h["anthropic-dangerous-direct-browser-access"] = "true";
  }
  for (const { name, value } of provider.headers) {
    for (const existing of Object.keys(h)) {
      if (existing.toLowerCase() === name.toLowerCase()) delete h[existing];
    }
    h[name] = value;
  }
  return h;
}
