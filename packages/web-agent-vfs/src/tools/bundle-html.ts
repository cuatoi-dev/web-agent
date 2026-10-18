import type { CustomToolDef, ToolOutcome } from "@cuatoi/web-agent-core";
import type { VfsHandle } from "../types.js";
import { BUNDLE_HTML_DESCRIPTION, BUNDLE_HTML_SCHEMA } from "./schemas.js";

/** The five image extensions this tool inlines. The extension decides the MIME
 *  type, so a PNG saved by page_screenshot becomes image/png whatever its
 *  stored mimeType says. */
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** An <img> tag and its double-quoted src value. Single quotes and unquoted
 *  values are not matched, and a tag they carry is left exactly as it is. */
const IMG_SRC = /<img\b[^>]*?\ssrc="([^"]*)"/g;

function fail(content: string): ToolOutcome {
  return { content, isError: true };
}

/** Base64 of a text file's UTF-8 bytes. Only reached for an image stored as
 *  text, which no current tool writes; it keeps such a file from producing
 *  invalid base64. */
function base64OfText(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function bundleHtmlTool(vfs: VfsHandle): CustomToolDef {
  return {
    name: "bundle_html",
    description: BUNDLE_HTML_DESCRIPTION,
    inputSchema: BUNDLE_HTML_SCHEMA,
    execute: async (input) => {
      const src = typeof input.src === "string" ? input.src : "";
      const out = typeof input.out === "string" ? input.out : "";
      if (!src || !out) return fail("Error: src and out are both required.");

      const source = await vfs.get(src);
      if (!source) return fail(`Error: ${src} does not exist.`);
      if (source.encoding !== "utf8") return fail(`Error: ${src} is not a text file.`);

      // Every file-system image the document names, in first-seen order, once.
      const paths = [...new Set(
        [...source.content.matchAll(IMG_SRC)].map((m) => m[1]).filter((p) => p.startsWith("/")),
      )];

      const dataUrls = new Map<string, string>();
      const missing: string[] = [];
      for (const p of paths) {
        const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
        const mime = IMAGE_MIME[ext];
        if (!mime) {
          return fail(`Error: ${p} is not a supported image. Use .png, .jpg, .jpeg, .gif or .webp.`);
        }
        const file = await vfs.get(p);
        if (!file) {
          missing.push(p);
          continue;
        }
        dataUrls.set(p, `data:${mime};base64,${file.encoding === "base64" ? file.content : base64OfText(file.content)}`);
      }
      if (missing.length > 0) return fail(`Error: Images not found: ${missing.join(", ")}`);

      const bundled = source.content.replace(IMG_SRC, (whole: string, p: string) => {
        const dataUrl = dataUrls.get(p);
        if (dataUrl === undefined) return whole;
        return whole.replace(`src="${p}"`, () => `src="${dataUrl}"`);
      });

      try {
        await vfs.write(out, bundled);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
      const kb = Math.round(new TextEncoder().encode(bundled).length / 1024);
      return { content: `Saved ${out} (${dataUrls.size} images inlined, ${kb} KB)` };
    },
    phrase: ({ input, failed }, agent) => {
      const out = typeof input.out === "string" ? input.out : "";
      if (failed) return out ? `${agent} could not bundle ${out}` : `${agent} could not bundle a file`;
      return `${agent} bundled ${out || "an HTML file"}`;
    },
    inProgressPhrase: (agent) => `${agent} is bundling the report…`,
  };
}
