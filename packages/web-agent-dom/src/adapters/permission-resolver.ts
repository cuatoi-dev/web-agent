import type { AgentPermission, PermissionResolution } from "./types.js";

// Re-exported so importers of this module keep their existing import path.
export type { AgentPermission, PermissionResolution, ConfirmInteractionFn } from "./types.js";

const VALID_PERMISSIONS = new Set(["allow", "ask", "block"]);

export function resolveAgentPermission(el: Element): PermissionResolution {
  let current: Element | null = el;
  while (current) {
    const target = current.closest("[data-agent-permission]");
    if (target) {
      // Nearest marked ancestor in this tree. Fail open to "allow" on an
      // absent or invalid value, same as before.
      const raw = target.getAttribute("data-agent-permission") ?? "";
      if (VALID_PERMISSIONS.has(raw)) {
        const reason = target.getAttribute("data-agent-permission-reason") ?? undefined;
        return { permission: raw as AgentPermission, reason };
      }
      return { permission: "allow" };
    }
    // No marked ancestor in this tree. Cross an open shadow boundary to the
    // host and look there. Closed roots are not crossed.
    const root = current.getRootNode();
    if (root instanceof ShadowRoot && root.mode === "open") {
      current = root.host;
    } else {
      break;
    }
  }
  return { permission: "allow" };
}
