import "@cuatoi/web-agent-charting/lit"; // side-effect: registers <agent-chart-block>
import { wireChartBlocks, waitForChartsSettled } from "./genui-chart-wiring";
import { GENUI_CHART_READY_TIMEOUT_MS } from "../../shared/genui-chart";

window.__WA_GENUI_FRAME_ON_MOUNT__ = (root: HTMLElement) => wireChartBlocks(root);
window.__WA_GENUI_FRAME_READY__ = (timeoutMs?: number) =>
  waitForChartsSettled(timeoutMs ?? GENUI_CHART_READY_TIMEOUT_MS);
