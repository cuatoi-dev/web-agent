// Turns a Blob into the VFS file record. The screenshot tool
// captures a PNG as bytes; the backends store base64, not bytes, so the blob
// is read here with the browser's own FileReader. No Buffer and no fetch, so
// this runs unchanged on the airgapped target.
import type { VfsFile } from "./types.js";
import { mimeFromPath } from "./mime.js";

/** Promise<FileReader result> -> base64 payload plus VfsFile metadata. */
function readAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string" || !result.includes(",")) {
        reject(new Error("Error: could not read the file bytes."));
        return;
      }
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Error: could not read the file bytes."));
    reader.onabort = () => reject(new Error("Error: reading the file bytes was aborted."));
    reader.readAsDataURL(blob);
  });
}

/** A blob as a stored file: base64 content, the blob's own type when it has
 *  one, otherwise the type its path implies, and the current time. */
export async function blobFile(blob: Blob, path: string): Promise<VfsFile> {
  return {
    content: await readAsBase64(blob),
    encoding: "base64",
    mimeType: blob.type || mimeFromPath(path),
    mtimeMs: Date.now(),
  };
}