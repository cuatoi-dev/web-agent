/**
 * The `HTMLElementTagNameMap` augmentation for `<agent-chart-block>`.
 *
 * It lives in its own file because it names `AgentChartBlock`, the class
 * declared in `chart-block.ts`. Declaring it there would need
 * `chart-block.ts` to import its own types back, so nothing in this
 * directory imports this module; `lit/index.ts` pulls it in with a
 * side-effect import so the augmentation still reaches consumers.
 */
import type { AgentChartBlock } from "./chart-block.js";

declare global {
  interface HTMLElementTagNameMap {
    "agent-chart-block": AgentChartBlock;
  }
}
