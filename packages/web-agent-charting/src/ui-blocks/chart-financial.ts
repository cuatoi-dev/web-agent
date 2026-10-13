import { isObj, get, arr } from "./chart-config-utils.js";

// ── Financial (candlestick / ohlc) config transform ──

const FINANCIAL_TYPES = new Set(["candlestick", "ohlc"]);

/** Rewrite a candlestick/ohlc config → native scatter carrier + stashed _ohlc.
 *  Pure & idempotent; returns the config unchanged for any other type. */
export function transformFinancialConfig(config: unknown): unknown {
  if (!isObj(config) || !FINANCIAL_TYPES.has(config.type as string)) {
    return config;
  }
  const kind = config.type; // "candlestick" | "ohlc"
  const out: Record<string, unknown> = { ...config, type: "scatter" };
  const data: Record<string, unknown> = { ...(isObj(config.data) ? config.data : {}) };
  out.data = data;
  data.datasets = arr(get(config.data, "datasets")).map((ds) => {
    const ohlc = arr(get(ds, "data"));
    // Hidden carrier points: feed every high & low to the y-scale so it ranges
    // over the full candle extent; x carries the timestamp/category value.
    const carrier: { x: unknown; y: unknown }[] = [];
    for (const d of ohlc) {
      if (isObj(d) && "h" in d && "l" in d) {
        carrier.push({ x: d.x, y: d.h });
        carrier.push({ x: d.x, y: d.l });
      }
    }
    return {
      ...(isObj(ds) ? ds : {}),
      _ohlc: ohlc,        // survives JSON-clone sanitize (plain data)
      _finKind: kind,     // "candlestick" | "ohlc"
      data: carrier,
      showLine: false,
      pointRadius: 0,     // carrier invisible; plugin draws the candles
      pointHitRadius: 0,
    };
  });
  return out;
}
