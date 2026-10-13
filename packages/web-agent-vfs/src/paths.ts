/** The one message a relative path produces. Exported so the tools and the
 *  tests share one string. */
export const ABSOLUTE_PATH_ERROR =
  "Error: paths must be absolute, for example /home/agent/notes.md.";

/** Thrown by `normalize` for a non-string or relative path. The tools catch
 *  it and return `{ content: err.message, isError: true }`. */
export class VfsPathError extends Error {}

/** Resolve "." and ".." and collapse empty segments. ".." at the root is a
 *  no-op, so a path can never step outside "/". */
export function normalize(p: unknown): string {
  if (typeof p !== "string" || !p.startsWith("/")) {
    throw new VfsPathError(ABSOLUTE_PATH_ERROR);
  }
  const segs: string[] = [];
  for (const s of p.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") segs.pop();
    else segs.push(s);
  }
  return "/" + segs.join("/");
}

export function ancestors(p: string): string[] {
  const norm = normalize(p);
  if (norm === "/") return ["/"];
  const parts = norm.split("/").filter(Boolean);
  const res: string[] = ["/"];
  let current = "";
  for (const seg of parts) {
    current += "/" + seg;
    res.push(current);
  }
  return res;
}

export function basename(p: string): string {
  const norm = normalize(p);
  if (norm === "/") return "";
  const idx = norm.lastIndexOf("/");
  return norm.slice(idx + 1);
}

export function dirname(p: string): string {
  const norm = normalize(p);
  if (norm === "/") return "/";
  const idx = norm.lastIndexOf("/");
  if (idx === 0) return "/";
  return norm.slice(0, idx);
}

export function join(dir: string, file: string): string {
  return normalize(dir === "/" ? `/${file}` : `${dir}/${file}`);
}
