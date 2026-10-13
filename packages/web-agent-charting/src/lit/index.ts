import { chartRenderer } from "./chart-renderer.js";
import type { BlockRenderer } from "@cuatoi/web-agent-lit";
import "./chart-block.js"; // side-effect: register <agent-chart-block>
import "./chart-block-global.types.js"; // side-effect: HTMLElementTagNameMap augmentation

export { chartRenderer } from "./chart-renderer.js";
export { AgentChartBlock } from "./chart-block.js";

/** Chart renderers — spread into a host panel's `renderers`. */
export const chartingRenderers: BlockRenderer[] = [chartRenderer];
