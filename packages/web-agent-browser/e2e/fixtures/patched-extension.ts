import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The built extension every spec starts from. This file sits one level below
 *  `e2e/`, so `dist/` is two levels up — not one, as in the spec files. */
const DIST = path.resolve(HERE, "../../dist");

/** One folder per spec. `temp/` is gitignored, so a crashed run leaves nothing
 *  a commit can pick up. */
const ROOT = path.resolve(HERE, "../../temp/e2e-extensions");

/** Where `patchedExtension(specName, …)` writes. Exported so a spec can name
 *  the folder in a log line without rebuilding the path. */
export function patchedExtensionDir(specName: string): string {
  return path.join(ROOT, specName);
}

/** Copies `dist/` to `temp/e2e-extensions/<specName>/` and merges `patch` into
 *  its `brand.json`, so a demo spec can load a different brand without a
 *  rebuild and without touching the checked-in `brand/` or `dist/`.
 *
 *  The merge is a TOP-LEVEL spread, the same as the mock tier's private copy
 *  (`e2e/brand-skills.mock.spec.ts:25-32`): a patch key REPLACES that whole key
 *  on the brand. `{ tools: { genui: { enabled: false } } }` therefore replaces
 *  the entire `tools` object, which is `{}` in the shipped brand.
 *
 *  `manifest.json` is copied unchanged, so host permissions and every other
 *  manifest field stay exactly as the real build produced them.
 *
 *  @param specName folder name under `temp/e2e-extensions/`, unique per spec
 *  @param patch    top-level `brand.json` keys to replace
 *  @returns the absolute path to pass to `--load-extension`
 */
export async function patchedExtension(
  specName: string,
  patch: Record<string, unknown>,
): Promise<string> {
  const dest = patchedExtensionDir(specName);
  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(DIST, dest, { recursive: true });
  const file = path.join(dest, "brand.json");
  const brand = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  await fs.writeFile(file, JSON.stringify({ ...brand, ...patch }, null, 2), "utf8");
  return dest;
}

/** Removes one spec's folder. Safe to call when it was never created. */
export async function removePatchedExtension(specName: string): Promise<void> {
  await fs.rm(patchedExtensionDir(specName), { recursive: true, force: true });
}
