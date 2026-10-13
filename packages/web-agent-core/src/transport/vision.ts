/** Substrings that mean a model accepts image input on the Anthropic and
 *  OpenAI transports. Both providers held the same set before this file
 *  existed — anthropic-provider.ts:342-352 and openai-provider.ts:329-338
 *  listed the same six markers in a different order, and both are an OR over
 *  `includes`, so one list is the same answer for both. */
const VISION_MODEL_MARKERS = [
  "claude-3",
  "gemma-4",
  "gemma4",
  "gpt-4o",
  "gpt-4-turbo",
  "vision",
  // The gateway's `sonnet` router alias. Its model name carries no marker
  // above, so without this entry every host on the default Sonnet profile hid
  // its image tools.
  "sonnet",
];

/** Whether the named model accepts image input on the given transport.
 *  An endpoint type this file does not know (for example a host's own
 *  fallback chain) returns false: we cannot show that an image reaches it. */
export function modelSupportsVision(endpointType: string, model: string): boolean {
  const lower = model.toLowerCase();
  switch (endpointType) {
    case "anthropic":
    case "openai":
      return VISION_MODEL_MARKERS.some((marker) => lower.includes(marker));
    case "gemini":
      return lower.includes("gemini");
    default:
      return false;
  }
}

/** Whether an image in a user message survives the trip to the model.
 *  `imageInputEnabled === true` is the host saying yes explicitly, and wins
 *  over the model-name guess; `undefined` falls back to that guess. This is the
 *  inverse of the `isImageDisabledOrUnsupported` test the three message
 *  converters ran inline. */
export function imageReachesModel(
  imageInputEnabled?: boolean,
  supportsVision?: boolean,
): boolean {
  return !(
    imageInputEnabled === false ||
    (imageInputEnabled === undefined && supportsVision === false)
  );
}
