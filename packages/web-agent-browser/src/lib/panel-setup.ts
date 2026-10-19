import { PANEL_SESSION_NAMESPACE } from "./constants";
import { authHeaders } from "./auth-headers";
import { brandToolConfig } from "./brand-capabilities";
import type { AgentBrand, PanelLike, ResolvedProvider } from "./types";

export type { PanelLike } from "./types";

/**
 * A fetch that goes STRAIGHT to the gateway, with the auth headers added here.
 *
 * The bubble uses createRelayFetch() because a MAIN-world content script is
 * bound by the visited page's CORS rules. A side panel is an extension page and
 * calls the gateway itself under the existing host_permissions
 * (generated into dist/manifest.json using brand/model.yml and brand/plugin.yml
 * `hosts`), so the relay in background.ts:24-69 solves a problem
 * this page does not have. No RELAY_PORT connection is opened from here.
 *
 * 136/005 — `getProvider` is read on every request, so a model switch in the kebab
 * menu sends the next request with the new provider's headers.
 */
export function createDirectFetch(
  getProvider: () => ResolvedProvider,
  impl: typeof fetch = fetch,
): typeof fetch {
  return (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(authHeaders(getProvider()))) {
      headers.set(name, value);
    }
    return impl(input, { ...init, headers });
  };
}

/** Writes the panel's fetch and session config. 136/005 — path, type and
 *  model come from createModelSwitch (model-switch.ts). Both must run BEFORE
 *  the element is connected: <agent-chat-panel> builds its session in
 *  connectedCallback and throws when `model` is unset
 *  (packages/web-agent-core/src/controller-config.ts:90-96). */
export function applyPanelSettings(
  panel: PanelLike,
  getProvider: () => ResolvedProvider,
  brand: AgentBrand,
  fetchImpl: typeof fetch = fetch,
): void {
  panel.fetch = createDirectFetch(getProvider, fetchImpl);
  // 115/006 — todo tracking is opt-in per host
  // (packages/web-agent-core/src/controller.types.ts:119-121). Setting it here
  // is what makes the controller set the `_todos` seam
  // (controller-config.ts:188), which is what makes `todoTools(ctx)`
  // (tools/todo-tools.ts:14-15, folded into `defaultTools` at tools/builders.ts:172) return
  // `todo_write` and `todo_read` instead of an empty list.
  // 155400-001 — the scheduler is on by default here too, and a turn may
  // take up to 1000 tool steps. The core default is 200.
  panel.config = {
    persist: true,
    sessionNamespace: PANEL_SESSION_NAMESPACE,
    maxIterations: 1000,
    todo: { enabled: true },
    scheduler: { enabled: true },
    // 116/003 — LAST, so brand/plugin.yml's `tools` block overrides the host
    // opt-ins above. Adds nothing when the brand declares no flags.
    ...brandToolConfig(brand),
  };
}
