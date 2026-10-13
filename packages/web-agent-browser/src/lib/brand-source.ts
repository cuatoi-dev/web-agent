import { EMPTY_BRAND } from "./brand";
import { requestBrand } from "./brand-request";
import { errorMessage } from "./error-message";
import type { AgentBrand } from "./types";

let packaged: AgentBrand | null = null;

/** The compiled brand, read straight out of the extension package.
 *
 *  Only a context that may fetch a `chrome-extension://` URL can call this: the
 *  service worker and an extension page. A content script cannot — its fetches
 *  are bound by the visited page's origin.
 *
 *  A missing or corrupt file warns once per worker lifetime and degrades to the
 *  empty brand. `EMPTY_BRAND` is cached like a real brand so the warning is
 *  logged once, not once per request. */
export async function readPackagedBrand(): Promise<AgentBrand> {
  if (packaged) return packaged;
  try {
    const res = await fetch(chrome.runtime.getURL("brand.json"));
    if (!res.ok) throw new Error(`brand.json responded ${res.status}`);
    packaged = JSON.parse(await res.text()) as AgentBrand;
  } catch (e) {
    console.warn(`[web-agent] brand.json unreadable, using an empty brand: ${errorMessage(e)}`, e);
    packaged = EMPTY_BRAND;
  }
  return packaged;
}

/** True inside the MV3 service worker.
 *
 *  `ServiceWorkerGlobalScope` inherits `WorkerGlobalScope`, not `Window`, so
 *  `window` is undefined there. Every other context this extension runs in —
 *  the options page, the side panel, and both content-script worlds — has one. */
function inServiceWorker(): boolean {
  return typeof window === "undefined";
}

/** The brand, fetched the way this context can fetch it.
 *
 *  The worker reads the packaged file, because `chrome.runtime.sendMessage`
 *  fires `onMessage` "in every frame of your extension (except for the sender's
 *  frame)" — a worker asking itself gets no answer, one rejected promise and one
 *  console warning per call. Every other context asks the worker. */
export async function brandForThisContext(): Promise<AgentBrand> {
  return inServiceWorker() ? readPackagedBrand() : requestBrand();
}
