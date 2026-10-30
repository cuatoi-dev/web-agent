import { marked } from "marked";
import DOMPurify from "dompurify";

/** Markdown + HTML sanitization helpers for <agent-message-view>.
 *  Moved verbatim out of message-view.ts; behaviour is unchanged. */

/** Escape pseudo-tags like <password> outside code blocks so marked doesn't treat
 *  them as unescaped raw HTML and DOMPurify doesn't strip them. */
function escapePasswordTag(text: string): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts.map((part) => {
    if (part.startsWith("`")) return part;
    return part.replace(/<password>/gi, "&lt;password&gt;");
  }).join("");
}

/** Bound on the cache below. A long session renders far more distinct
 *  markdown strings than this, so the cache must not grow without limit. */
const SANITIZE_CACHE_MAX = 256;

/** Sanitized HTML per source markdown, oldest entry dropped first. Every panel
 *  render re-reads `part.text`, and a turn re-renders the thread many times, so
 *  the same string was being parsed and sanitized again and again. */
const sanitizeCache = new Map<string, string>();

export function sanitize(text: string): string {
  if (!text) return "";
  const hit = sanitizeCache.get(text);
  if (hit !== undefined) return hit;
  try {
    const rawHtml = marked.parse(escapePasswordTag(text)) as string;
    const clean = DOMPurify.sanitize(rawHtml);
    if (sanitizeCache.size >= SANITIZE_CACHE_MAX) {
      const oldest = sanitizeCache.keys().next().value;
      if (oldest !== undefined) sanitizeCache.delete(oldest);
    }
    sanitizeCache.set(text, clean);
    return clean;
  } catch (err) {
    console.error("Markdown parse/sanitize error", err);
    return text;
  }
}

/** Sanitize a custom tool renderer's SIMPLE-HTML output. Reuses the existing
 *  DOMPurify seam (no new dep) but with a restrictive inline-only allow-list, so
 *  block-level markup (<div>/<p>/<h*>), scripts, and all attributes/handlers are
 *  stripped — text content is preserved. Does NOT run marked (input is HTML). */
export function sanitizeToolHtml(input: string): string {
  if (!input) return "";
  try {
    return DOMPurify.sanitize(input, {
      ALLOWED_TAGS: ["i", "b", "em", "strong"],
      ALLOWED_ATTR: [],
    });
  } catch (err) {
    console.error("Tool renderer sanitize error", err);
    return "";
  }
}
