import Chart from "chart.js";
import { financePlugin } from "./finance-charts.js";

// Guarded so the Chart.js mock in chart-block.test (no `.plugins`) no-ops.
// `@types/chart.js` declares `plugins` non-optional, so widen it before the
// runtime check rather than optional-chaining a value the types call certain.
const plugins = Chart.plugins as typeof Chart.plugins | undefined;
if (plugins?.register) {
  plugins.register(financePlugin as unknown as Parameters<typeof plugins.register>[0]);
}
