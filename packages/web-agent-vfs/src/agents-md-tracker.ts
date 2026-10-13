import type { AgentsMdTracker } from "./agents-md-tracker.types.js";
export type { AgentsMdTracker } from "./agents-md-tracker.types.js";

export function createAgentsMdTracker(): AgentsMdTracker {
  const seenMap = new Map<string, Map<string, number>>();
  const bucket = (sessionId: string | undefined): Map<string, number> => {
    const key = sessionId ?? "";
    let map = seenMap.get(key);
    if (!map) {
      map = new Map<string, number>();
      seenMap.set(key, map);
    }
    return map;
  };
  return {
    seen: (sessionId, p) => bucket(sessionId).get(p),
    record: (sessionId, p, m) => void bucket(sessionId).set(p, m),
  };
}
