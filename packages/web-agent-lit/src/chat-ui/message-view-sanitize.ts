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

export function sanitize(text: string): string {
  if (!text) return "";
  try {
    const rawHtml = marked.parse(escapePasswordTag(text)) as string;
    return DOMPurify.sanitize(rawHtml);
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
