// Runtime renderer bundles. Kept out of `index.ts` so `embed/web-agent-embed.ts`
// can reach `defaultRenderers` without importing the package barrel back.
import { generativeUiRenderer } from "./ui-blocks/renderer/generative-ui-renderer.js";
import type { BlockRenderer } from "./ui-blocks/renderer/types.js";

/** Genui (form/buttons) renderers — spread into a host panel's `renderers`,
 *  parallel to charting's `chartingRenderers`. */
export const genuiRenderers: BlockRenderer[] = [generativeUiRenderer];
/** Back-compat alias for hosts that still use `defaultRenderers`, and the
 *  bubble's default when a host sets no `renderers`. */
export const defaultRenderers = genuiRenderers;
