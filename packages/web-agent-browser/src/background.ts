import { BRAND_MESSAGE, RELAY_PORT } from "./lib/constants";
import type { RelayToWorker } from "./lib/relay-protocol";
import { getToken } from "./lib/settings";
import { readPackagedBrand } from "./lib/brand-source";
import { listModels, readModelStore } from "./lib/model-store";
import { handleRelayRequest } from "./lib/relay-handler";

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

/** The model list and the shared token, read fresh for every request, so a
 *  change on the options page reaches the next bubble request. */
async function readRelayModels() {
  const [brand, store, token] = await Promise.all([readPackagedBrand(), readModelStore(), getToken()]);
  return { entries: listModels(brand, store), token };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== RELAY_PORT) return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  port.onMessage.addListener((msg: RelayToWorker) => {
    if (msg.type === "abort") { controller.abort(); return; }
    if (msg.type !== "request") return;
    // 136/005 — handleRelayRequest checks the URL against the model's
    // provider before it adds that provider's key (lib/relay-handler.ts).
    void handleRelayRequest(msg, {
      readModels: readRelayModels,
      // A wrapper, not `fetch` itself: calling `fetch` as a method of
      // another object throws "Illegal invocation".
      fetchImpl: (input, init) => fetch(input, init),
      post: (m) => port.postMessage(m),
      signal: controller.signal,
    }).finally(() => port.disconnect());
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
