import { get, isEqual, set, toPath } from "lodash-es";
import { matches } from "./match.js";
import type { ApplyResult, JsonEditChange } from "./apply.types.js";

/** `lodash.get` returns `any`; every read of the document here is unknown JSON. */
function readAt(doc: unknown, path: string): unknown {
  return get(doc, path) as unknown;
}

export function applyJsonChanges(initialDoc: unknown, changes: JsonEditChange[]): ApplyResult {
  const copy = structuredClone(initialDoc);
  const report: string[] = [];

  for (let i = 0; i < changes.length; i++) {
    const n = i + 1;
    const ch = changes[i];
    const label = `Change ${n} (${ch.op} ${ch.path})`;

    switch (ch.op) {
      case "set": {
        set(copy as object, toPath(ch.path), ch.value);
        report.push(`${n}. set ${ch.path}`);
        break;
      }
      case "delete": {
        const parts = toPath(ch.path);
        const parent = (parts.length > 1 ? get(copy, parts.slice(0, -1)) : copy) as unknown;
        const last = parts[parts.length - 1];
        const isIndex = /^\d+$/.test(last);
        if (Array.isArray(parent) && isIndex) {
          const idx = parseInt(last, 10);
          if (idx < 0 || idx >= parent.length) {
            return { success: false, error: `${label} index ${last} is outside the list (${parent.length} items).` };
          }
          (parent as unknown[]).splice(idx, 1);
        } else {
          if (parent === null || typeof parent !== "object" || !(last in (parent as Record<string, unknown>))) {
            return { success: false, error: `${label} found nothing at ${ch.path}.` };
          }
          delete (parent as Record<string, unknown>)[last];
        }
        report.push(`${n}. delete ${ch.path}`);
        break;
      }
      case "append": {
        let list = readAt(copy, ch.path);
        if (list === undefined) {
          list = [];
          set(copy as object, toPath(ch.path), list);
        }
        if (!Array.isArray(list)) {
          return { success: false, error: `${label} ${ch.path} is not a list.` };
        }
        const items = list as unknown[];
        items.push(ch.value);
        report.push(`${n}. append ${ch.path}: now [${items.length - 1}]`);
        break;
      }
      case "insert": {
        const found = readAt(copy, ch.path);
        if (!Array.isArray(found)) {
          return { success: false, error: `${label} ${ch.path} is not a list.` };
        }
        const items = found as unknown[];
        if (typeof ch.index !== "number" || ch.index < 0 || ch.index > items.length) {
          return { success: false, error: `${label} index ${ch.index} is outside the list (${items.length} items).` };
        }
        items.splice(ch.index, 0, ch.value);
        report.push(`${n}. insert ${ch.path} at [${ch.index}]`);
        break;
      }
      case "update": {
        const found = readAt(copy, ch.path);
        if (!Array.isArray(found)) {
          return { success: false, error: `${label} ${ch.path} is not a list.` };
        }
        const items = found as unknown[];
        const hits: number[] = [];
        for (let idx = 0; idx < items.length; idx++) {
          if (matches(items[idx], ch.where ?? {})) hits.push(idx);
        }
        if (typeof ch.expect === "number" && hits.length !== ch.expect) {
          return { success: false, error: `${label} matched ${hits.length} items; expect is ${ch.expect}.` };
        }
        for (const idx of hits) {
          items[idx] = { ...(items[idx] as object), ...(ch.merge ?? {}) };
        }
        const hitIndices = hits.map((idx) => `[${idx}]`).join(", ");
        report.push(`${n}. update ${ch.path}: ${hits.length} items${hitIndices ? ` ${hitIndices}` : ""}`);
        break;
      }
      case "remove": {
        const found = readAt(copy, ch.path);
        if (!Array.isArray(found)) {
          return { success: false, error: `${label} ${ch.path} is not a list.` };
        }
        const items = found as unknown[];
        const hits: number[] = [];
        for (let idx = 0; idx < items.length; idx++) {
          if (matches(items[idx], ch.where ?? {})) hits.push(idx);
        }
        if (typeof ch.expect === "number" && hits.length !== ch.expect) {
          return { success: false, error: `${label} matched ${hits.length} items; expect is ${ch.expect}.` };
        }
        // Remove from highest index to lowest so earlier indexes stay accurate during splicing
        hits.sort((a, b) => b - a);
        const removedDetails: string[] = [];
        for (const idx of hits) {
          const removed = items.splice(idx, 1)[0];
          let idPart = "";
          if (removed !== null && typeof removed === "object" && "id" in removed) {
            idPart = ` (id ${String(removed.id)})`;
          }
          removedDetails.unshift(`was [${idx}]${idPart}`);
        }
        report.push(`${n}. remove ${ch.path}: ${hits.length} item(s)${removedDetails.length > 0 ? `, ${removedDetails.join(", ")}` : ""}`);
        break;
      }
      case "upsert": {
        const found = readAt(copy, ch.path);
        if (!Array.isArray(found)) {
          return { success: false, error: `${label} ${ch.path} is not a list.` };
        }
        const items = found as unknown[];
        const wantVal = ch.value[ch.key];
        const foundIdx = items.findIndex((item) => isEqual(get(item, toPath(ch.key)), wantVal));
        if (foundIdx >= 0) {
          items[foundIdx] = ch.value;
          report.push(`${n}. upsert ${ch.path}: replaced [${foundIdx}]`);
        } else {
          items.push(ch.value);
          report.push(`${n}. upsert ${ch.path}: appended [${items.length - 1}]`);
        }
        break;
      }
    }
  }

  return { success: true, doc: copy, report };
}
