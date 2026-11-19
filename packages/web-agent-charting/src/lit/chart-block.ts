import Chart from "chart.js";
import { Component, html } from "@cuatoi/web-agent-lit";
import type { DataSourceProvider, QueryResult, FieldSchema } from "@cuatoi/web-agent-core";
import type { ChartBlock, ChartEncoding } from "../ui-blocks/chart-schema.js";
import { hasDataUrl, checkRowCountExceeded, sanitizeChartConfig, checkAxisIdMismatch, transformFinancialConfig, transformPayoffConfig, transformPnlConfig, transformWaterfallConfig } from "../ui-blocks/chart-spec.js";
import "../chart/register-finance-plugin.js"; // side-effect: register the finance draw plugin
import { applyChartDefaults } from "../chart/chart-theme.js";
import { CHART_BLOCK_STYLES } from "./chart-block-styles.js";
import { buildChartJsConfig } from "./chart-config-builder.js";

const DEFAULT_INTERVAL_MS = 60000;
const MIN_INTERVAL_MS = 5000;

/** The `message` of a thrown value when it has a string one — matching the
 *  `err?.message` read this file used before `err` was typed. Anything else
 *  yields undefined so the caller's `||` fallback applies. */
function errMessage(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = err.message;
    return typeof m === "string" ? m : undefined;
  }
  return undefined;
}

export class AgentChartBlock extends Component {
  private _block!: ChartBlock;
  private _disabled = false;
  private _dataSource?: DataSourceProvider;

  private _error: string | null = null;
  private _loading = false;
  private _mode: "auto" | "manual" | "off" = "auto";
  private _lastUpdated: number | null = null;

  private _chartInstance: Chart | null = null;
  private _intersectionObserver: IntersectionObserver | null = null;
  private _refreshTimer: ReturnType<typeof setInterval> | null = null;
  private _themeObserver: MutationObserver | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  /** Box the chart was laid out at; a same-size or hidden (0 x 0) delivery is skipped. */
  private _lastResizeW = 0;
  private _lastResizeH = 0;
  private _inView = false;
  private _boundVisibilityHandler = () => this._syncTimer();
  private _lastRenderedBlock: ChartBlock | null = null;
  // setInterval does not wait for the previous callback, so without this
  // flag every tick started another query and they piled up against a slow
  // source. True while a data source query started by this block is still
  // running. Both the render query and the refresh tick set it; both clear it
  // in a `finally`, so a rejected or aborted query releases it too.
  private _queryInFlight = false;
  // Bumped for every query started, and again on teardown. A query whose
  // token is no longer current has been superseded or cancelled, so its
  // `finally` must not clear the flag that belongs to the query which replaced
  // it. This is what keeps the flag from getting stuck in either direction.
  private _queryToken = 0;

  get block() { return this._block; }
  set block(v) {
    this._block = v;
    this.requestUpdate();
  }

  get disabled() { return this._disabled; }
  set disabled(v) {
    this._disabled = !!v;
    this.requestUpdate();
  }

  get dataSource() { return this._dataSource; }
  set dataSource(v) {
    this._dataSource = v;
    this.requestUpdate();
  }

  get error() { return this._error; }
  set error(v) {
    this._error = v;
    this.requestUpdate();
  }

  get loading() { return this._loading; }
  set loading(v) {
    this._loading = !!v;
    this.requestUpdate();
  }

  get mode() { return this._mode; }
  set mode(v) {
    this._mode = v;
    this.requestUpdate();
  }

  get lastUpdated() { return this._lastUpdated; }
  set lastUpdated(v) {
    this._lastUpdated = v;
    this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    this.style.display = "block";
    this.style.width = "100%";
    if (typeof MutationObserver !== "undefined") {
      this._themeObserver = new MutationObserver(() => { void this._renderChart(); });
      this._themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
    }
    if ((this.block?.query && this.block?.encoding) || this.block?.refresh) {
      this._initRefresh();
    }
    document.addEventListener("visibilitychange", this._boundVisibilityHandler);
    // Chart.js 2.x's own `responsive: true` resize detection is a legacy
    // hidden-iframe trick, which does not reliably fire when the canvas sits
    // inside a shadow root (as it now does whenever this block renders inside
    // <web-agent-bubble>). A native ResizeObserver on the host is DOM-source-
    // agnostic — it fires on this element's own box regardless of what tree it
    // lives in — so drive Chart.js's resize from it explicitly. `resize()` is
    // a no-op before a chart exists, so this is safe to install unconditionally.
    if (typeof ResizeObserver !== "undefined") {
      this._resizeObserver = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (rect) {
          const w = Math.round(rect.width);
          const h = Math.round(rect.height);
          // Hidden (0 x 0, panel closed) and unchanged boxes redraw for nothing.
          if (w === 0 || h === 0) return;
          if (w === this._lastResizeW && h === this._lastResizeH) return;
          this._lastResizeW = w;
          this._lastResizeH = h;
        }
        this._chartInstance?.resize();
      });
      this._resizeObserver.observe(this);
    }
  }

  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this._boundVisibilityHandler);
    this._cleanupRefresh();
    if (this._themeObserver) {
      this._themeObserver.disconnect();
      this._themeObserver = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._chartInstance) {
      this._chartInstance.destroy();
      this._chartInstance = null;
      this._lastResizeW = this._lastResizeH = 0;
    }
  }

  updated() {
    if (this.block !== this._lastRenderedBlock) {
      this._lastRenderedBlock = this.block;
      this._cleanupRefresh();
      this.mode = "auto";
      this.lastUpdated = null;
      this._inView = false;
      if ((this.block?.query && this.block?.encoding) || this.block?.refresh) {
        this._initRefresh();
      }
      void this._renderChart();
    }
  }

  private _initRefresh() {
    this.mode = this.block?.refresh?.mode ?? "auto";

    if (!this._intersectionObserver && typeof IntersectionObserver !== "undefined") {
      this._intersectionObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          this._inView = entry.isIntersecting;
          this._syncTimer();
        },
        { threshold: 0 }
      );
      this._intersectionObserver.observe(this);
    }

    this._syncTimer();
  }

  private _cleanupRefresh() {
    // The element is being disconnected or the block swapped, so any query
    // still running is cancelled as far as this block is concerned. Bump the
    // token so that query's `finally` cannot clear a newer query's flag, and
    // release the flag now so the next cycle is not blocked by a result nobody
    // is waiting for.
    this._queryToken++;
    this._queryInFlight = false;
    if (this._refreshTimer !== null) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    if (this._intersectionObserver) {
      this._intersectionObserver.disconnect();
      this._intersectionObserver = null;
    }
  }

  private _syncTimer() {
    if (this._refreshTimer !== null) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }

    if (
      this.block?.query &&
      this.block?.encoding &&
      this.mode === "auto" &&
      this._inView &&
      document.visibilityState === "visible" &&
      !this.disabled
    ) {
      const intervalMs = Math.max(
        this.block?.refresh?.intervalMs ?? DEFAULT_INTERVAL_MS,
        MIN_INTERVAL_MS
      );
      this._refreshTimer = setInterval(() => { void this._refreshTick(); }, intervalMs);
    }
  }

  private async _refreshTick() {
    if (
      !this.block?.query ||
      !this.block?.encoding ||
      this.mode !== "auto" ||
      !this._inView ||
      document.visibilityState !== "visible" ||
      this.disabled
    ) {
      this._syncTimer();
      return;
    }

    if (!this.block?.query || !this.dataSource) return;

    // The previous query has not finished. Skip this tick rather than
    // start a second query. The interval keeps running, so the next tick tries
    // again — nothing is queued and the timer is not paused.
    if (this._queryInFlight) return;

    const token = ++this._queryToken;
    this._queryInFlight = true;
    try {
      const result: QueryResult = await this.dataSource.query(this.block.query);

      if (this._chartInstance && this.block.encoding) {
        const newConfig = this._buildChartJsConfig(this.block.encoding, result.rows, result.fields);
        this._chartInstance.data = newConfig.data as Chart.ChartData;
        this._chartInstance.update();
      } else {
        await this._renderChart();
      }

      this.lastUpdated = Date.now();
    } catch (err) {
      console.error("Auto-refresh query failed:", err);
    } finally {
      // Clears on success, on a rejected query and on an aborted query alike.
      // Only the current query may clear the flag.
      if (this._queryToken === token) this._queryInFlight = false;
    }
  }

  private _handleModeToggle() {
    const cycle: Array<"auto" | "manual" | "off"> = ["auto", "manual", "off"];
    const idx = cycle.indexOf(this.mode);
    const next = cycle[(idx + 1) % cycle.length];
    this.mode = next;
    this._syncTimer();
  }

  private _handleManualRefresh() {
    void this._renderChart().then(() => {
      this.lastUpdated = Date.now();
    });
  }

  private _setError(error: string | null) {
    const oldError = this.error;
    this.error = error;
    if (error && error !== oldError) {
      this.dispatchEvent(new CustomEvent("chart-error", {
        detail: { error, block: this.block },
        bubbles: true,
        composed: true
      }));
    }
  }

  private _buildChartJsConfig(
    encoding: ChartEncoding,
    rows: Record<string, unknown>[],
    fields?: FieldSchema[],
  ): Record<string, unknown> {
    return buildChartJsConfig(encoding, rows, fields);
  }

  private _recordRenderedSize(): void {
    const rect = this.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this._lastResizeW = Math.round(rect.width);
      this._lastResizeH = Math.round(rect.height);
    }
  }

  private async _renderChart() {
    if (this._chartInstance) {
      this._chartInstance.destroy();
      this._chartInstance = null;
      this._lastResizeW = this._lastResizeH = 0;
    }
    this.error = null;
    applyChartDefaults(this);

    if (!this.block) {
      this._setError("Invalid chart block: missing block");
      return;
    }

    // Primary: block.config → Chart.js render
    if (this.block.config) {
      const config = this.block.config;
      if (hasDataUrl(config)) {
        this._setError("chart used a forbidden data.url");
        return;
      }
      if (checkRowCountExceeded(config)) {
        this._setError("chart exceeded 2000-row cap");
        return;
      }
      const axisMismatch = checkAxisIdMismatch(config);
      if (axisMismatch) {
        this._setError(axisMismatch);
        return;
      }
      const sanitized = sanitizeChartConfig(config) as Record<string, unknown>;
      const options: Record<string, unknown> =
        typeof sanitized.options === "object" && sanitized.options !== null
          ? (sanitized.options as Record<string, unknown>)
          : {};
      sanitized.options = options;
      if (options.responsive === undefined) options.responsive = true;
      if (options.maintainAspectRatio === undefined) options.maintainAspectRatio = false;
      // Chart.js defaults `animation.duration` to 1000 ms: a 60-frame canvas
      // redraw loop on every render, for a chart that is right from frame one.
      if (options.animation === undefined) options.animation = { duration: 0 };
      const finalConfig = transformFinancialConfig(
        transformPayoffConfig(transformPnlConfig(transformWaterfallConfig(sanitized))),
      ) as Chart.ChartConfiguration;
      const canvas = this.querySelector("#chart-el") as HTMLCanvasElement;
      if (!canvas) return;
      try {
        this._chartInstance = new Chart(canvas.getContext("2d")!, finalConfig);
        this._recordRenderedSize();
      } catch (err) {
        this._chartInstance = null;
        this._setError(errMessage(err) || "Failed to render chart");
      }
      return;
    }

    // Datasource path: block.query + block.encoding
    if (this.block.query && this.block.encoding && this.dataSource) {
      this.loading = true;
      // Mark the render query too, so a tick cannot start a second query
      // while this one is still running. This path is marked but never skipped
      // — a manual Refresh or a theme re-render must always run.
      const token = ++this._queryToken;
      this._queryInFlight = true;

      try {
        const result: QueryResult = await this.dataSource.query(this.block.query);

        this.loading = false;
        await this.updateComplete;

        const chartConfig = this._buildChartJsConfig(this.block.encoding, result.rows, result.fields);

        if (hasDataUrl(chartConfig)) {
          this._setError("chart used a forbidden data.url");
          return;
        }
        if (checkRowCountExceeded(chartConfig)) {
          this._setError("chart exceeded 2000-row cap");
          return;
        }

        const canvas = this.querySelector("#chart-el") as HTMLCanvasElement;
        if (!canvas) return;
        const ctx = canvas.getContext("2d")!;
        this._chartInstance = new Chart(
          ctx,
          transformFinancialConfig(
            transformPayoffConfig(transformPnlConfig(transformWaterfallConfig(chartConfig))),
          ) as Chart.ChartConfiguration,
        );
        this._recordRenderedSize();
        this.lastUpdated = Date.now();
      } catch (err) {
        console.error("Failed to render datasource chart:", err);
        this._setError(errMessage(err) || "Failed to query datasource or render chart");
      } finally {
        this.loading = false;
        if (this._queryToken === token) this._queryInFlight = false;
      }
      return;
    }

    if (this.block.query && this.block.encoding && !this.dataSource) {
      this._setError("Chart requires a dataSource but none is configured.");
      return;
    }

    // Deprecated spec path
    if (this.block.spec) {
      this._setError("Deprecated chart spec: use block.config (Chart.js config) instead.");
      return;
    }

    this._setError("Invalid chart block: missing config or query+encoding");
  }

  template() {
    if (this.error) {
      return html`
        ${CHART_BLOCK_STYLES}
        <div class="error-card">
          <div class="error-title">⚠️ Chart Error</div>
          <div>${this.error}</div>
          <details>
            <summary>View Block JSON</summary>
            <pre>${JSON.stringify(this.block, null, 2)}</pre>
          </details>
        </div>
      `;
    }

    const containerClass = this.disabled ? "chart-container disabled" : "chart-container";

    if (this.loading) {
      return html`
        ${CHART_BLOCK_STYLES}
        <div class=${containerClass}>
          ${this.block?.title ? html`<h3>${this.block.title}</h3>` : ""}
          <div style="padding: 40px;text-align:center;color:var(--wa-label-color, #888);">Loading chart data…</div>${/* eslint-disable-line wa/no-raw-spacing -- 40px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ ""}
        </div>
      `;
    }

    const hasRefresh = !!(this.block?.query && this.block?.encoding);

    return html`
        ${CHART_BLOCK_STYLES}
        <div class=${containerClass}>
        ${this.block?.title ? html`<h3>${this.block.title}</h3>` : ""}
        <div class="chart-canvas">
          <canvas id="chart-el"></canvas>
        </div>
        ${hasRefresh ? this._renderRefreshControls() : ""}
      </div>
    `;
  }

  private _renderRefreshControls() {
    const modeLabel = this.mode === "auto" ? "Auto" : this.mode === "manual" ? "Manual" : "Off";
    const updatedStr = this.lastUpdated
      ? new Date(this.lastUpdated).toLocaleTimeString()
      : null;

    const indicatorClass = "mode-indicator " + this.mode;

    return html`
      <div class="refresh-controls">
        <span
          class=${indicatorClass}
          @click=${() => this._handleModeToggle()}
          title="Click to change refresh mode"
        >${modeLabel}</span>
        ${this.mode === "manual"
          ? html`<button class="refresh-btn" @click=${() => this._handleManualRefresh()}>Refresh</button>`
          : ""}
        ${updatedStr ? html`<span class="updated-stamp">Updated ${updatedStr}</span>` : ""}
      </div>
    `;
  }
}

if (!customElements.get("agent-chart-block")) {
  customElements.define("agent-chart-block", AgentChartBlock);
}

