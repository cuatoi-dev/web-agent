// The debugger network log. debugger-session.ts feeds every
// Network.* event for a debugging tab into applyNetworkEvent; page_network
// (panel-page-tools-network-dialog.ts) turns the entries into text. Pure, so
// the unit tests drive it without chrome.
import { DEFAULT_NETWORK_BUFFER_CAPACITY } from "./constants";
import type { NetworkEntry, TabDebugState } from "./debugger-tools.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** CDP `Network.Headers` is a JSON object of header name to value. */
function headersOf(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(value)) return out;
  for (const [k, v] of Object.entries(value)) out[k] = typeof v === "string" ? v : JSON.stringify(v);
  return out;
}

/** The newest entry for a request id. A redirect reuses the id, and later
 *  events belong to the newest hop. */
function newestWith(s: TabDebugState, requestId: string): NetworkEntry | undefined {
  for (let i = s.network.length - 1; i >= 0; i--) {
    if (s.network[i].requestId === requestId) return s.network[i];
  }
  return undefined;
}

export function applyNetworkEvent(s: TabDebugState, method: string, p: Record<string, unknown>): void {
  const requestId = str(p.requestId);
  if (requestId === undefined) return;
  const timestamp = num(p.timestamp);

  if (method === "Network.requestWillBeSent") {
    const request = isRecord(p.request) ? p.request : {};
    if (isRecord(p.redirectResponse)) {
      const prev = newestWith(s, requestId);
      if (prev) {
        prev.status = num(p.redirectResponse.status);
        prev.mimeType = str(p.redirectResponse.mimeType);
        prev.responseHeaders = headersOf(p.redirectResponse.headers);
        prev.endTs = timestamp;
      }
    }
    s.network.push({
      seq: s.nextSeq++,
      requestId,
      method: str(request.method) ?? "GET",
      url: str(request.url) ?? "",
      resourceType: str(p.type) ?? "Other",
      startTs: timestamp ?? 0,
      requestHeaders: headersOf(request.headers),
      postData: str(request.postData),
      hasPostData: request.hasPostData === true,
    });
    if (s.network.length > DEFAULT_NETWORK_BUFFER_CAPACITY) s.network.shift();
    return;
  }

  const e = newestWith(s, requestId);
  if (!e) return;
  if (method === "Network.responseReceived") {
    const response = isRecord(p.response) ? p.response : {};
    e.status = num(response.status);
    e.mimeType = str(response.mimeType);
    e.responseHeaders = headersOf(response.headers);
  } else if (method === "Network.loadingFinished") {
    e.endTs = timestamp;
  } else if (method === "Network.loadingFailed") {
    e.failed = str(p.errorText) ?? "";
    e.endTs = timestamp;
  }
}

/** `new URL(url).origin`, or "" when the URL cannot be parsed. */
export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/** One `page_network` line. Same-origin URLs show as path + query. */
export function networkLine(e: NetworkEntry, pageOrigin: string): string {
  let where = e.url;
  try {
    const u = new URL(e.url);
    if (pageOrigin && u.origin === pageOrigin) where = u.pathname + u.search;
  } catch {
    // Keep the raw URL.
  }
  const outcome =
    e.failed !== undefined
      ? `failed: ${e.failed}`
      : e.status === undefined
        ? "pending"
        : `${e.status} ${e.resourceType.toLowerCase()}`;
  const ms = e.endTs !== undefined ? ` (${Math.round((e.endTs - e.startTs) * 1000)} ms)` : "";
  return `#${e.seq} ${e.method} ${where} → ${outcome}${ms}`;
}

/** One `name: value` line per header, or "(none)". */
export function formatHeaders(headers: Record<string, string>): string {
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  return lines.length > 0 ? lines.join("\n") : "(none)";
}

/** Cut `s` to `max` characters, naming how many were cut. Moved verbatim from
 *  the deleted in-page network buffer. */
export function cap(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "… (" + (s.length - max) + " more characters)" : s;
}

/** Decoded byte length of a base64 string, without decoding it. */
export function base64ByteLength(b64: string): number {
  const clean = b64.replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}
