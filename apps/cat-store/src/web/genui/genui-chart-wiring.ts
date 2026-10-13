import {
  GENUI_CHART_POLL_MS,
  GENUI_CHART_READY_TIMEOUT_MS,
  type GenuiChartsReadyResult,
} from "../../shared/genui-chart";

import type { ChartBlockElement, Pending } from "./types";

const pending: Pending[] = [];

/** Reads each <agent-chart-block>'s JSON child and wires the element.
 *
 *  MUST be called synchronously in the same task that inserted the elements.
 *  Component.connectedCallback schedules the first render in a microtask
 *  (packages/web-agent-lit/src/ui/component.ts:12-31), and that render writes
 *  into the element's own light DOM (`render(t, this)`, `:41-43`), which
 *  destroys the JSON child. Setting `block` in the same synchronous turn also
 *  keeps the element from ever rendering blockless, which would fire the
 *  spurious "Invalid chart block: missing block" error at
 *  chart-block.ts:301-304. */
export function wireChartBlocks(root: ParentNode): void {
  pending.length = 0;
  const dataSource = readHostDataSource();
  const els = Array.from(
    root.querySelectorAll("agent-chart-block"),
  ) as ChartBlockElement[];

  for (const el of els) {
    const script = el.querySelector('script[type="application/json"]');
    if (!script) {
      console.error(
        "[agent-chart-block] no <script type=\"application/json\"> child. " +
          "A chart block must carry its block JSON as that child.",
      );
      pending.push({ el, hasQuery: false, settled: true });
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(script.textContent ?? "") as Record<string, unknown>;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[agent-chart-block] the <script type="application/json"> child is not ` +
          `valid JSON: ${message}`,
      );
      pending.push({ el, hasQuery: false, settled: true });
      continue;
    }
    const hasQuery = !!parsed.query && !!parsed.encoding;
    if (dataSource) el.dataSource = dataSource;
    el.block = parsed;
    pending.push({ el, hasQuery, settled: false });
  }
}

/** The host's provider, read across the same-origin boundary. */
function readHostDataSource(): unknown {
  try {
    return (window.parent as unknown as Record<string, unknown>)
      ?.__WA_GENUI_DATA_SOURCE__;
  } catch {
    /* A cross-origin or closed parent must never break the mounted code. */
    return undefined;
  }
}

/** True once this chart has drawn or failed.
 *
 *  Query path: `_renderChart` stamps `lastUpdated` only after `new Chart(...)`
 *  returns (chart-block.ts:373-379), and routes every failure through
 *  `_setError`, which sets `error` (`:380-382`, `:273-283`). So
 *  `error || lastUpdated != null` is exactly drawn-or-failed.
 *
 *  Config path and parse failures: nothing async is awaited. wireChartBlocks
 *  marks parse failures settled, and a config chart counts as settled at once. */
function isSettled(p: Pending): boolean {
  if (p.settled) return true;
  if (p.el.error) return true;
  return p.hasQuery ? p.el.lastUpdated != null : true;
}

/** Resolves when every wired chart has drawn or failed, or when the bound
 *  expires. Never rejects. */
export function waitForChartsSettled(
  timeoutMs: number = GENUI_CHART_READY_TIMEOUT_MS,
): Promise<GenuiChartsReadyResult> {
  return new Promise<GenuiChartsReadyResult>((resolve) => {
    if (pending.length === 0) {
      resolve({ total: 0, drawn: 0, failed: 0, timedOut: false });
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    function tally(): GenuiChartsReadyResult {
      let drawn = 0;
      let failed = 0;
      for (const p of pending) {
        if (p.settled) {
          // Pre-settled means no-JSON or parse failure → failed
          failed++;
        } else if (p.el.error) {
          failed++;
        } else if (p.el.lastUpdated != null) {
          drawn++;
        }
      }
      return { total: pending.length, drawn, failed, timedOut: false };
    }

    function allSettled(): boolean {
      return pending.every(isSettled);
    }

    function cleanup(): void {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    }

    timeoutId = setTimeout(() => {
      cleanup();
      const unsettled = pending.filter((p) => !isSettled(p)).length;
      console.warn(
        `[genui-chart-wiring] waitForChartsSettled: timed out after ${timeoutMs} ms; ` +
          `${unsettled} chart(s) still unsettled.`,
      );
      const result = tally();
      resolve({ ...result, timedOut: true });
    }, timeoutMs);

    intervalId = setInterval(() => {
      if (allSettled()) {
        cleanup();
        resolve(tally());
      }
    }, GENUI_CHART_POLL_MS);
  });
}
