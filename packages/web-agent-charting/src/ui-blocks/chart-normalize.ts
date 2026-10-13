/**
 * Normalization that the pre-migration zod schemas performed through
 * `z.preprocess`. JSON Schema validates but never transforms, so the same
 * coercion now runs as an explicit step BEFORE validation; show-chart.ts
 * validates the normalized value. Core's normalizeBlockOutput (task 006,
 * web-agent-core/src/ui-blocks/schema.ts) runs its step after validation.
 */

export function unwrapXmlText(val: unknown): unknown {
  if (typeof val === "object" && val !== null) {
    if (Array.isArray(val)) {
      return val.map(unwrapXmlText);
    }
    const keys = Object.keys(val);
    if (keys.length === 1 && (keys[0] === "$text" || keys[0] === "$" || keys[0] === "_")) {
      return unwrapXmlText((val as Record<string, unknown>)[keys[0]]);
    }
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = unwrapXmlText((val as Record<string, unknown>)[key]);
    }
    return out;
  }
  return val;
}

export function coerceDataPoint(val: unknown): unknown {
  val = unwrapXmlText(val);
  if (typeof val === "string") {
    const cleaned = val.trim().replace(/^\$/, "");
    const num = Number(cleaned);
    if (cleaned !== "" && Number.isFinite(num)) {
      return num;
    }
  }
  if (typeof val === "object" && val !== null && !Array.isArray(val)) {
    const obj = { ...(val as Record<string, unknown>) };
    for (const key of ["y", "r", "o", "h", "l", "c"]) {
      if (typeof obj[key] === "string") {
        const cleaned = (obj[key]).trim().replace(/^\$/, "");
        const num = Number(cleaned);
        if (cleaned !== "" && Number.isFinite(num)) {
          obj[key] = num;
        }
      }
    }
    return obj;
  }
  return val;
}

export function coerceOptions(val: unknown): unknown {
  if (typeof val === "object" && val !== null) {
    if (Array.isArray(val)) {
      return val.map(coerceOptions);
    }
    const keys = Object.keys(val);
    if (keys.length === 1 && (keys[0] === "$text" || keys[0] === "$" || keys[0] === "_")) {
      return coerceOptions((val as Record<string, unknown>)[keys[0]]);
    }
    const rec = val as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if ((key === "xAxes" || key === "yAxes") && typeof rec[key] === "object" && rec[key] !== null && !Array.isArray(rec[key])) {
        const inner = rec[key] as Record<string, unknown>;
        const innerKeys = Object.keys(inner);
        if (innerKeys.length === 1 && (innerKeys[0] === "item" || innerKeys[0] === "$text")) {
          const itemVal = inner[innerKeys[0]];
          out[key] = coerceOptions(Array.isArray(itemVal) ? itemVal : [itemVal]);
          continue;
        }
      }
      out[key] = coerceOptions((val as Record<string, unknown>)[key]);
    }
    return out;
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    const num = Number(trimmed);
    if (trimmed !== "" && Number.isFinite(num)) {
      return num;
    }
  }
  return val;
}

/** Apply every coercion the old ChartConfigSchema applied, in the same order:
 *  unwrapXmlText over the whole config, coerceDataPoint over each dataset
 *  data point, unwrapXmlText over each label, coerceOptions over options. */
export function normalizeChartConfig(raw: unknown): unknown {
  const config = unwrapXmlText(raw);
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return config;
  }
  const out: Record<string, unknown> = { ...(config as Record<string, unknown>) };

  const data = out.data;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const dataOut: Record<string, unknown> = { ...(data as Record<string, unknown>) };

    if (Array.isArray(dataOut.labels)) {
      dataOut.labels = dataOut.labels.map(unwrapXmlText);
    }

    if (Array.isArray(dataOut.datasets)) {
      dataOut.datasets = dataOut.datasets.map((dataset: unknown) => {
        if (typeof dataset !== "object" || dataset === null || Array.isArray(dataset)) {
          return dataset;
        }
        const datasetOut: Record<string, unknown> = { ...(dataset as Record<string, unknown>) };
        if (Array.isArray(datasetOut.data)) {
          datasetOut.data = datasetOut.data.map(coerceDataPoint);
        }
        return datasetOut;
      });
    }

    out.data = dataOut;
  }

  if ("options" in out) {
    out.options = coerceOptions(out.options);
  }

  return out;
}
