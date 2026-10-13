import { base64ToBytes } from "./relay-protocol";
import type { RelayFetchContext, RelayToPage } from "./types";

export type { RelayFetchContext } from "./types";

/** True when `value` is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createRelayFetch(ctx: RelayFetchContext = window): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const reqId = "wa-req-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
      let settled = false;

      const stream = new ReadableStream<Uint8Array>({
        start(c) { controller = c; },
        cancel() { ctx.postMessage({ type: "wa-relay-abort", reqId }, "*"); },
      });

      const onMessage = (event: MessageEvent) => {
        const data: unknown = event.data;
        if (!isRecord(data) || data.type !== "wa-relay-res" || data.reqId !== reqId) {
          return;
        }
        const msg = data.msg as RelayToPage;

        if (msg.type === "head") {
          settled = true;
          const headers = new Headers();
          if (msg.contentType) headers.set("content-type", msg.contentType);
          const bodyless = msg.status === 204 || msg.status === 205 || msg.status === 304;
          resolve(new Response(bodyless ? null : stream, {
            status: msg.status,
            statusText: msg.statusText,
            headers,
          }));
        } else if (msg.type === "chunk") {
          controller?.enqueue(base64ToBytes(msg.b64));
        } else if (msg.type === "end") {
          ctx.removeEventListener("message", onMessage);
          controller?.close();
        } else if (msg.type === "error") {
          ctx.removeEventListener("message", onMessage);
          const err = new Error(msg.message);
          if (settled) controller?.error(err); else reject(err);
        }
      };

      ctx.addEventListener("message", onMessage);

      const signal = init?.signal;
      if (signal) {
        signal.addEventListener("abort", () => {
          ctx.postMessage({ type: "wa-relay-abort", reqId }, "*");
          const err = new DOMException("The user aborted a request.", "AbortError");
          if (settled) controller?.error(err); else reject(err);
        });
      }

      const headers = new Headers(init?.headers);
      ctx.postMessage({
        type: "wa-relay-req",
        reqId,
        request: {
          type: "request",
          url: typeof input === "string" ? input : String((input as Request).url ?? input),
          method: init?.method ?? "POST",
          headers: Object.fromEntries(headers.entries()),
          body: typeof init?.body === "string" ? init.body : null,
        },
      }, "*");
    });
}
