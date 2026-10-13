import { BRAND_MESSAGE, RELAY_PORT } from "./lib/constants";
import { bytesToBase64, type RelayToWorker } from "./lib/relay-protocol";
import { getSettings, getToken } from "./lib/settings";
import { buildAuthHeaders } from "./lib/auth-headers";
import { readPackagedBrand } from "./lib/brand-source";

// 118/004 — The toolbar icon click both opens the side panel and grants the
// `activeTab` permission for the clicked tab. We disable Chrome's automatic
// openPanelOnActionClick behavior so that chrome.action.onClicked fires,
// providing the user gesture required by chrome.sidePanel.open and granting
// activeTab so page_screenshot can capture the viewport without <all_urls>.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch((e) => console.error("[web-agent] setPanelBehavior failed:", e));

chrome.action.onClicked.addListener((tab) => {
  if (typeof tab.id === "number") {
    chrome.sidePanel.open({ tabId: tab.id }).catch((e) => {
      console.error("[web-agent] sidePanel.open failed:", e);
    });
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== RELAY_PORT) return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  port.onMessage.addListener((msg: RelayToWorker) => {
    if (msg.type === "abort") { controller.abort(); return; }
    if (msg.type !== "request") return;
    void (async () => {
      try {
        // The token is added HERE, in the worker, so the page never holds it
        // and the header cannot be stripped by page code.
        const [settings, sharedToken] = await Promise.all([getSettings(), getToken()]);
        const headers = { ...msg.headers, ...buildAuthHeaders(settings, sharedToken) };
        const res = await fetch(msg.url, {
          method: msg.method,
          headers,
          body: msg.body ?? undefined,
          signal: controller.signal,
        });
        port.postMessage({
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
            // Each chunk message also resets the worker's 30-second idle
            // timer, which is what carries a 48-second queued stream
            // (sse-reader.ts:72).
            port.postMessage({ type: "chunk", b64: bytesToBase64(value) });
          }
        }
        port.postMessage({ type: "end" });
      } catch (e) {
        port.postMessage({ type: "error", message: (e as Error)?.message ?? String(e) });
      } finally {
        port.disconnect();
      }
    })();
  });
});

// Returning true keeps the message channel open for the async sendResponse,
// the same way bridge.ts:229 does. A message this worker does not recognise
// returns undefined, which leaves it for any other listener.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const req: unknown = msg;
  if (typeof req !== "object" || req === null) return undefined;
  if ((req as { type?: unknown }).type !== BRAND_MESSAGE) return undefined;
  void readPackagedBrand().then(sendResponse);
  return true;
});
