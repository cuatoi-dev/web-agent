import type { SkillDef } from "@cuatoi/web-agent-lit";

/* eslint-disable wa/no-raw-colour -- Chart.js paints this to a canvas from a JS option value, so a CSS custom property cannot resolve here (chart-theme.ts:9-10). Data-encoding colour, the same case DATA_ENCODING_FILES records for chart-skill.ts. */
const definition = `# Cat Store — Finance Chart Demo

You are running a scripted finance-charting demo. FIRST call \`load_skill("chart")\`
to learn the chart config shape. Then perform EACH step in order, narrate one line
before each \`show_chart\` call, and do not skip or reorder. Use the exact configs.

---

**Step 1 — Candlestick.** Narrate that you are showing ACME's recent daily price
action, then call \`show_chart\` with:
\`\`\`json
{
  "type": "candlestick",
  "data": {
    "datasets": [{
      "label": "ACME",
      "data": [
        { "x": "2026-01-05", "o": 100, "h": 104, "l": 99, "c": 103 },
        { "x": "2026-01-06", "o": 103, "h": 106, "l": 102, "c": 102.5 },
        { "x": "2026-01-07", "o": 102.5, "h": 103, "l": 98, "c": 99 },
        { "x": "2026-01-08", "o": 99, "h": 101, "l": 97.5, "c": 100.5 },
        { "x": "2026-01-09", "o": 100.5, "h": 108, "l": 100, "c": 107 },
        { "x": "2026-01-12", "o": 107, "h": 109, "l": 105, "c": 105.5 }
      ]
    }]
  },
  "options": {
    "scales": { "xAxes": [{ "type": "time", "time": { "unit": "day" } }] },
    "annotation": { "lines": [{ "axis": "y", "value": 103, "color": "#6200ee", "label": "entry", "dash": [4, 4] }] }
  }
}
\`\`\`

**Step 2 — Options payoff.** Narrate that you are showing the payoff for a bull
call spread, then call \`show_chart\` with:
\`\`\`json
{
  "type": "payoff",
  "data": { "datasets": [] },
  "options": {
    "payoff": {
      "legs": [
        { "kind": "call", "strike": 100, "premium": 5, "qty": 1, "side": "long" },
        { "kind": "call", "strike": 110, "premium": 2, "qty": 1, "side": "short" }
      ],
      "priceRange": [90, 120]
    }
  }
}
\`\`\`

**Step 3 — Equity curve.** Narrate that you are showing the cumulative P&L for
the strategy, then call \`show_chart\` with:
\`\`\`json
{
  "type": "equity",
  "data": { "datasets": [] },
  "options": {
    "pnl": {
      "returns": [200, -150, -180, 120, 260, -90, 300],
      "x": ["2026-01-02", "2026-01-09", "2026-01-16", "2026-01-23", "2026-01-30", "2026-02-06", "2026-02-13"]
    }
  }
}
\`\`\`

**Step 4 — Volume under price.** Narrate that you are showing price with volume
underneath, then call \`show_chart\` with:
\`\`\`json
{
  "type": "bar",
  "data": {
    "labels": ["Jan 05", "Jan 06", "Jan 07", "Jan 08", "Jan 09", "Jan 12"],
    "datasets": [
      { "type": "line", "label": "Price", "yAxisID": "price",
        "data": [103, 102.5, 99, 100.5, 107, 105.5],
        "borderColor": "#37474f", "fill": false, "pointRadius": 0, "lineTension": 0 },
      { "type": "bar", "label": "Volume", "yAxisID": "volume",
        "data": [1200, 1800, 2400, 900, 2100, 1500],
        "backgroundColor": "rgba(38,166,154,0.4)" }
    ]
  },
  "options": {
    "scales": {
      "yAxes": [
        { "id": "price", "position": "left" },
        { "id": "volume", "position": "right", "ticks": { "beginAtZero": true, "max": 8000 }, "gridLines": { "display": false } }
      ]
    }
  }
}
\`\`\`

**Step 5 — Waterfall / P&L bridge.** Narrate that you are showing the P&L bridge
for the trade, then call \`show_chart\` with:
\`\`\`json
{
  "type": "waterfall",
  "data": { "datasets": [] },
  "options": {
    "waterfall": {
      "start": 0,
      "steps": [
        { "label": "Open", "value": 1000 },
        { "label": "Fees", "value": -120 },
        { "label": "Gains", "value": 640 },
        { "label": "Slippage", "value": -80 }
      ],
      "total": "Net P&L",
      "showTotalLine": true
    }
  }
}
\`\`\`

**Step 6 — Close.** State a one-line summary listing the five finance chart types
demonstrated: candlestick, payoff, equity, volume (dual-axis), waterfall.
`;
/* eslint-enable wa/no-raw-colour */

export const financeDemoSkill: SkillDef = {
  name: "finance-demo",
  command: true,
  aliases: ["finance"],
  description:
    "Scripted finance-charting demo of the Cat Store agent: candlestick, options payoff, " +
    "equity curve, dual-axis volume, and a P&L waterfall. Trigger with /finance.",
  definition,
};
