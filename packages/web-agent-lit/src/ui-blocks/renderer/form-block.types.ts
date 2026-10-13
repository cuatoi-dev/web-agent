import type { FormBlock } from "@cuatoi/web-agent-core";

/**
 * `FormBlock` extended with a lit-side marker for the values it was last
 * submitted with. `generative-ui-renderer.ts:14` creates a BRAND-NEW
 * `<agent-form-block>` element on every re-render — which happens right after
 * submit, when `controller-messages.ts:404` disables every earlier block — so
 * a fresh element cannot rely on the old element's in-memory `_values`. The
 * `block` object itself, though, is the SAME reference across re-renders:
 * core's `toolBlocks` map keeps it (`controller-messages.ts:84-87`). Stashing
 * the submitted values there, not on the element, is what survives.
 *
 * Kept local to `web-agent-lit` (not added to core's `FormBlock`) — task 007
 * scopes the fix to the renderer, and core's submit path already works.
 */
export type FormBlockWithSubmission = FormBlock & {
  __submittedValues?: Record<string, string | number | boolean | null>;
};
