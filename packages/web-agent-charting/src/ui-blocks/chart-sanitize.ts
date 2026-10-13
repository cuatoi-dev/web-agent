import { isObj, get, arr } from "./chart-config-utils.js";

// ── Chart.js config sanitizer ──

export function hasDataUrl(obj: unknown): boolean {
  if (!isObj(obj)) return false;

  // Check Chart.js config structure: data.datasets[i].url
  const data = get(obj, "data");
  if (isObj(data)) {
    if (get(data, "url")) return true;
    for (const ds of arr(get(data, "datasets"))) {
      if (isObj(ds) && get(ds, "url")) return true;
    }
  }

  // Generic recursive check (also captures nested Vega structures)
  for (const key of Object.keys(obj)) {
    if (hasDataUrl(obj[key])) return true;
  }
  return false;
}

export function checkRowCountExceeded(obj: unknown): boolean {
  let exceeded = false;
  function check(val: unknown) {
    if (exceeded) return;
    if (!isObj(val)) return;

    // Chart.js config: config.data.datasets[i].data length
    const data = get(val, "data");
    if (isObj(data)) {
      for (const ds of arr(get(data, "datasets"))) {
        if (isObj(ds) && Array.isArray(ds.data) && ds.data.length > 2000) {
          exceeded = true;
          return;
        }
      }
      const values = get(data, "values");
      if (Array.isArray(values) && values.length > 2000) {
        exceeded = true;
        return;
      }
    }

    // Generic dataset check (backward compat with Vega)
    const datasetsField = get(val, "datasets");
    if (isObj(datasetsField)) {
      for (const k of Object.keys(datasetsField)) {
        const ds = datasetsField[k];
        if (Array.isArray(ds) && ds.length > 2000) {
          exceeded = true;
          return;
        }
      }
    }

    for (const k of Object.keys(val)) {
      check(val[k]);
    }
  }
  check(obj);
  return exceeded;
}

export function checkAxisIdMismatch(config: unknown): string | null {
  if (!isObj(config)) return null;
  const rawDatasets = get(get(config, "data"), "datasets");
  if (!Array.isArray(rawDatasets)) return null;
  const datasets = rawDatasets as unknown[];

  const scales = get(get(config, "options"), "scales");
  const xIds = new Set(
    arr(get(scales, "xAxes"))
      .map((a) => get(a, "id"))
      .filter((id): id is string => typeof id === "string"),
  );
  const yIds = new Set(
    arr(get(scales, "yAxes"))
      .map((a) => get(a, "id"))
      .filter((id): id is string => typeof id === "string"),
  );

  for (let i = 0; i < datasets.length; i++) {
    const ds = datasets[i];
    if (!isObj(ds)) continue;
    const xAxisID = ds.xAxisID;
    if (typeof xAxisID === "string" && !xIds.has(xAxisID)) {
      return `data.datasets[${i}].xAxisID: "${xAxisID}" is not defined in options.scales.xAxes`;
    }
    const yAxisID = ds.yAxisID;
    if (typeof yAxisID === "string" && !yIds.has(yAxisID)) {
      return `data.datasets[${i}].yAxisID: "${yAxisID}" is not defined in options.scales.yAxes`;
    }
  }
  return null;
}

export function sanitizeChartConfig(config: unknown): unknown {
  if (!isObj(config)) return config;

  // Deep clone via JSON (strips functions/callbacks/Symbols automatically)
  const cloned: unknown = JSON.parse(JSON.stringify(config));

  function clean(val: unknown) {
    if (!isObj(val)) return;

    // Block remote data.url
    const url = val.url;
    if (typeof url === "string" && url.startsWith("http")) {
      delete val.url;
    }

    // Cap datasets at 50
    const datasets = val.datasets;
    if (Array.isArray(datasets) && datasets.length > 50) {
      val.datasets = datasets.slice(0, 50);
    }

    // Cap each dataset's data array at 2000
    const data = val.data;
    if (Array.isArray(data) && data.length > 2000) {
      val.data = data.slice(0, 2000);
    }

    for (const k of Object.keys(val)) {
      clean(val[k]);
    }
  }

  clean(cloned);
  return cloned;
}
