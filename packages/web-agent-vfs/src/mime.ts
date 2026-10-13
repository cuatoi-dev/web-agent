/** The four image types a base64 write may declare. Nothing else is allowed;
 *  PDF is deliberately absent (idea 069, "PDF is not supported now"). */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const BY_EXTENSION: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  ts: "text/typescript",
  csv: "text/csv",
  xml: "application/xml",
  svg: "image/svg+xml",
  yml: "application/yaml",
  yaml: "application/yaml",
  tsv: "text/tab-separated-values", tsx: "text/typescript", jsx: "text/javascript",
  toml: "application/toml", ini: "text/plain", sql: "text/plain", sh: "text/plain",
  py: "text/plain", java: "text/plain", kt: "text/plain", go: "text/plain",
  rs: "text/plain", c: "text/plain", h: "text/plain", cpp: "text/plain",
  cs: "text/plain", rb: "text/plain", php: "text/plain",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp",
};

/** The text extensions a folder on the user's disk shows, without the dot. */
export const TEXT_EXTS = new Set([
  "txt", "csv", "tsv", "md", "html", "htm", "css", "js", "mjs", "cjs", "ts", "tsx",
  "jsx", "json", "xml", "yml", "yaml", "toml", "ini", "sql", "sh", "py", "java", "kt",
  "go", "rs", "c", "h", "cpp", "cs", "rb", "php", "svg",
]);

/** True for the four raster image types a write may declare. */
export function isImageExt(name: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(name);
}

/** True when a folder on the user's disk shows this file to the agent. */
export function isVisibleFile(name: string, mimeType: string): boolean {
  if (isImageExt(name)) return true;
  if (mimeType.startsWith("text/")) return true;
  const dot = name.lastIndexOf(".");
  return dot > 0 && TEXT_EXTS.has(name.slice(dot + 1).toLowerCase());
}

/** The MIME type a text file takes from its extension. Anything unknown is
 *  text/plain. `.svg` is text/plain's exception: it is stored as text. */
export function mimeFromPath(p: string): string {
  const base = p.slice(p.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "text/plain";
  return BY_EXTENSION[base.slice(dot + 1).toLowerCase()] ?? "text/plain";
}
