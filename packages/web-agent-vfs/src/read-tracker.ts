import type { ReadTracker } from "./types.js";

/** Which files the agent has read, per chat, and the file's modification time
 *  when it was read. In memory only: after a page
 *  reload the agent must read a file again before it edits it.
 *  A context with no `sessionId` shares one bucket keyed "". */
export function createReadTracker(): ReadTracker {
  const reads = new Map<string, Map<string, number>>();
  const bucket = (sessionId: string | undefined): Map<string, number> => {
    const key = sessionId ?? "";
    let map = reads.get(key);
    if (!map) {
      map = new Map<string, number>();
      reads.set(key, map);
    }
    return map;
  };
  return {
    markRead: (sessionId, p, mtimeMs) => void bucket(sessionId).set(p, mtimeMs),
    readMtime: (sessionId, p) => bucket(sessionId).get(p),
    wasRead: (sessionId, p) => bucket(sessionId).get(p) !== undefined,
    forget: (sessionId, p) => void bucket(sessionId).delete(p),
    moveRead: (sessionId, from, to) => {
      const map = bucket(sessionId);
      const m = map.get(from);
      if (m !== undefined) {
        map.delete(from);
        map.set(to, m);
      }
    },
    forgetUnder: (prefix) => {
      for (const map of reads.values()) {
        for (const p of map.keys()) {
          if (p === prefix || p.startsWith(prefix + "/")) map.delete(p);
        }
      }
    },
  };
}
