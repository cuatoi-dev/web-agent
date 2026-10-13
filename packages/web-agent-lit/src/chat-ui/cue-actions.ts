import { type CueKind } from "@cuatoi/web-agent-core";
import type { ActionCueFn, CueActionDeps } from "./types.js";

export type { ActionCueFn, CueActionDeps };

export function createActionCue(deps: CueActionDeps): ActionCueFn {
  return async (el: Element | undefined, kind: CueKind, detail?: {
    value?: string;
    speedMs?: number;
    point?: { x: number; y: number };
    rect?: { x: number; y: number; width: number; height: number };
  }, signal?: AbortSignal) => {
    try {
      const cursor = deps.getCursor();
      const speed = deps.speed();

      let point: { x: number; y: number } | undefined;
      if (detail?.point) {
        point = detail.point;
      } else if (detail?.rect) {
        point = {
          x: detail.rect.x + detail.rect.width / 2,
          y: detail.rect.y + detail.rect.height / 2,
        };
      } else if (el && typeof el.getBoundingClientRect === "function") {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          point = {
            x: r.left + r.width / 2,
            y: r.top + r.height / 2,
          };
        }
      }

      // 007: `moveTo`'s animation is not interruptible mid-flight, so a run
      // can be stopped while it is still resolving. The step AFTER it
      // (clickPulse/flash/focus) is skipped once that happens — each of
      // those calls `ensureElements()` too, and running it on a straggler
      // whose owning run already ended would resurrect the cursor layer
      // right after `destroy()` removed it (measured 2026-08-18, task 007).
      // `signal` is undefined for the `see` tool, which is unaffected.
      switch (kind) {
        case "click":
          if (point) {
            await cursor.moveTo(point, speed);
          }
          if (signal?.aborted) break;
          if (point) {
            cursor.clickPulse();
          }
          break;
        case "see":
          if (point) {
            await cursor.moveTo(point, speed);
          }
          if (signal?.aborted) break;
          if (detail?.rect) {
            cursor.flash(detail.rect);
          }
          break;
        case "fill":
          if (point) {
            await cursor.moveTo(point, speed);
          }
          if (signal?.aborted) break;
          try {
            if (el instanceof HTMLElement) {
              el.focus();
            }
          } catch { /* focus is best effort; a detached node must not fail the cue */ }
          break;
        case "select":
          if (point) {
            await cursor.moveTo(point, speed);
          }
          break;
        default:
          break;
      }
    } catch {
      // best-effort cue actions, do not propagate errors
    }
  };
}
