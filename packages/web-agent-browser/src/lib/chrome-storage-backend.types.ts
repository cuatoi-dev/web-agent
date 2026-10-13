// The shape for chrome-storage-backend.ts. Split out per wa/types-in-types-file.

/** The slice of a `chrome.storage` area this backend uses. Declared
 *  structurally rather than as `chrome.storage.StorageArea` so a unit test can
 *  pass a plain object with no `chrome` global in scope. Both
 *  `chrome.storage.local` and `chrome.storage.session` satisfy it — checked
 *  with `tsc --noEmit` against this package's tsconfig on 2026-09-19, so no
 *  cast is needed at either call site. */
export interface ChromeStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}
