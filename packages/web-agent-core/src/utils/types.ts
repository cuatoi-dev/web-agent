/** Limits that control automatic image downscaling before it enters a message. */
export interface ImageLimits {
  /** Longest edge (px). Images wider/taller than this are scaled down. Default 1024. */
  maxDimension?: number;
  /** Max encoded byte size of the final base64 data-URL (bytes). Default 512 KB. */
  maxBytes?: number;
  /** JPEG quality 0–1. Default 0.82. */
  quality?: number;
}

/** A single image attachment. mediaType is the MIME type (e.g. "image/png"). */
export interface ImageAttachment {
  dataUrl: string;
  mediaType: string;   // e.g. "image/png", "image/jpeg", "image/webp"
}

/**
 * Richer user-message input: text (required) plus optional image attachments.
 * Pass a plain `string` anywhere this type is accepted as a convenience —
 * call sites normalise via `normaliseInput()`.
 */
export interface UserMessageInput {
  text: string;
  images?: ImageAttachment[];
  /** The user's original typed prose before prompt-hook overrides or block formatting. */
  userDisplayText?: string;
  /** Opaque object from an `onUserPrompt` handler, stored in turn metadata. */
  promptMeta?: Record<string, unknown>;
}

/** Normalise a string | UserMessageInput to UserMessageInput. */
export function normaliseInput(input: string | UserMessageInput): UserMessageInput {
  if (typeof input === "string") return { text: input };
  return input;
}

/**
 * Build the `content` value for a user message.
 * - If no images: returns the plain string (avoid wrapping in an array when
 *   unnecessary).
 * - If images present: returns a parts array:
 *     [{type:"text", text}, {type:"image", image: dataUrl, mediaType}, ...]
 */
export function buildUserContent(
  input: UserMessageInput,
): string | Array<{ type: string; [k: string]: unknown }> {
  if (!input.images || input.images.length === 0) {
    return input.text;
  }
  const parts: Array<{ type: string; [k: string]: unknown }> = [
    { type: "text", text: input.text },
  ];
  for (const img of input.images) {
    parts.push({ type: "image", image: img.dataUrl, mediaType: img.mediaType });
  }
  return parts;
}
