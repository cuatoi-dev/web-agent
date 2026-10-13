/** How long mountIntoFrame waits for every chart in a freshly mounted source to
 *  draw or fail.
 *
 *  Why 5 s. The only async step is the data source query. The `orders` source
 *  is one fetch to the local Express API (`/api/orders`,
 *  apps/cat-store/src/web/orders-backend/backend.ts:25-29), which is a
 *  same-host round trip. The provider's own `ready` promise — four describes,
 *  one of them Elasticsearch — is built once at page load
 *  (agent-page.ts firstUpdated), so it has normally resolved long before a
 *  chart is mounted. 5 s is far above that and stays under the screenshot
 *  bound of GENUI_SCREENSHOT_TIMEOUT_MS = 10_000, so the tool's whole turn
 *  stays bounded. */
export const GENUI_CHART_READY_TIMEOUT_MS = 5_000;

/** How often the frame re-tests whether a chart has settled. A poll, not a
 *  MutationObserver: the settle test reads public accessors on the element, and
 *  a poll makes no assumption about which render pass produces a DOM mutation.
 *  The interval is cleared on settle and on timeout, and the frame is reloaded
 *  on every mount, so it cannot leak. */
export const GENUI_CHART_POLL_MS = 50;

export type { GenuiChartsReadyResult } from "./types.js";
