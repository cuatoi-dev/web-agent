import { BRAND_MESSAGE } from "./constants";
import { EMPTY_BRAND } from "./brand";
import { errorMessage } from "./error-message";
import type { AgentBrand } from "./types";

/** Asks the service worker for the compiled brand. Every caller runs where
 *  `chrome.runtime` is reachable: the side panel and the ISOLATED-world
 *  bridge. A worker that cannot answer degrades to the empty brand rather than
 *  blocking the mount.
 *
 *  The two explicit type arguments replace `sendMessage`'s `any` default
 *  (`@types/chrome/index.d.ts:8260`), so the result narrows here rather than
 *  spreading an `any` through the callers. */
export async function requestBrand(): Promise<AgentBrand> {
  try {
    const raw = await chrome.runtime.sendMessage<{ type: string }, unknown>({
      type: BRAND_MESSAGE,
    });
    return typeof raw === "object" && raw !== null ? (raw as AgentBrand) : EMPTY_BRAND;
  } catch (e) {
    console.warn(`[web-agent] brand request failed, using an empty brand: ${errorMessage(e)}`, e);
    return EMPTY_BRAND;
  }
}
