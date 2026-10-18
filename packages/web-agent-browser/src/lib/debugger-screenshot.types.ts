import type { RefTarget } from "./debugger-helper-world.types";

/** What the screenshot bridge needs from the helper world. Passed in, so the
 *  bridge never imports debugger-helper-world.ts back. */
export interface ScreenshotWorldAccess {
  context(tabId: number, at: { sessionId?: string; frameId: string }): Promise<number>;
  resolve(tabId: number, ref: string): { ok: true; at: RefTarget } | { ok: false; error: string };
}
