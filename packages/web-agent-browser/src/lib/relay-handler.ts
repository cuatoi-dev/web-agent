import { authHeaders } from "./auth-headers";
import { errorMessage } from "./error-message";
import { resolveRef } from "./model-store";
import { bytesToBase64 } from "./relay-protocol";
import type { RelayHandlerDeps, RelayRequest } from "./types";

export const UNKNOWN_MODEL = "Unknown model.";
export const URL_MISMATCH = "The request URL does not match the model's provider.";

/** True when `url` is the provider's endpoint or under it. Both sides are
 *  normalised with `new URL`, so dot segments cannot climb out of the
 *  endpoint path. An unparseable URL never matches. */
export function urlMatchesProvider(url: string, endpoint: string): boolean {
  let target: string;
  let base: string;
  try {
    target = new URL(url).href;
    base = new URL(endpoint).href.replace(/\/+$/, "");
  } catch {
    return false;
  }
  return target === base || target.startsWith(base + "/");
}

/** The worker half of the bubble relay. Adds the model's provider
 *  headers only when the URL is under that provider's endpoint, so no key
 *  leaves the extension for another host. Posts head / chunk / end, or one
 *  error. Never throws. */
export async function handleRelayRequest(msg: RelayRequest, deps: RelayHandlerDeps): Promise<void> {
  const { readModels, fetchImpl, post, signal } = deps;
  try {
    const { entries } = await readModels();
    const entry = resolveRef(entries, msg.modelRef);
    if (!entry) {
      post({ type: "error", message: UNKNOWN_MODEL });
      return;
    }
    if (!urlMatchesProvider(msg.url, entry.provider.endpoint)) {
      post({ type: "error", message: URL_MISMATCH });
      return;
    }
    // The provider's headers are set HERE, in the worker, so the page never
    // holds them and cannot strip them. `set` replaces a page header of the
    // same name in any letter case.
    const headers = new Headers(msg.headers);
    for (const [name, value] of Object.entries(authHeaders(entry.provider))) {
      headers.set(name, value);
    }
    const res = await fetchImpl(msg.url, {
      method: msg.method,
      headers,
      body: msg.body ?? undefined,
      signal,
    });
    post({
      type: "head",
      status: res.status,
      statusText: res.statusText,
      contentType: res.headers.get("content-type"),
    });
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // Each chunk message resets the worker's 30-second idle timer.
        post({ type: "chunk", b64: bytesToBase64(value) });
      }
    }
    post({ type: "end" });
  } catch (e) {
    post({ type: "error", message: errorMessage(e) });
  }
}
