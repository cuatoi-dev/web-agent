// types.ts — shared shapes for the generative-UI modules in this directory.

import type { GenuiDiagnostic } from "../../shared/types";

// --- genui-rules.ts ---------------------------------------------------------

export interface Violation {
  ruleId: string;
  message: string;
  line?: number;
  column?: number;
  snippet?: string;
}

export interface RuleContext {
  win?: Window | null;
}

export interface HtmlRule {
  id: string;
  promptSnippet?: string;
  check(source: string, ctx: RuleContext): Violation[] | Promise<Violation[]>;
}

export interface RegexRuleOptions {
  id: string;
  pattern: RegExp;
  message: string | ((match: RegExpExecArray) => string);
  promptSnippet?: string;
  stripComments?: boolean;
}

// --- genui-config.ts --------------------------------------------------------

export interface GenuiResource {
  type: "script" | "style";
  url: string;
  module?: boolean;
}

export type GenuiRule = HtmlRule;

export interface GenuiConfig {
  resources: GenuiResource[];
  rules?: HtmlRule[];
  /** Custom elements the frame registers, named in the tool description so the
   *  model writes only tags that exist. Must list exactly the tags
   *  genui-material-bundle.ts imports. */
  components?: string[];
}

// --- genui-validator.ts -----------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  violations: Violation[];
  formattedMessage: string | null;
}

// --- genui-diagnostics-collector.ts -----------------------------------------

export interface GenuiDiagnosticsCollector {
  /** Begin listening. Safe to call twice. */
  start(): void;
  /** Stop listening. The buffer is kept. */
  stop(): void;
  /** Return everything buffered since the previous drain, and empty the
   *  buffer. */
  drain(): GenuiDiagnostic[];
  /** How many entries are waiting. */
  size(): number;
}

// --- genui-screenshot.ts ----------------------------------------------------

export interface CaptureOptions {
  /** Milliseconds to wait for the frame's answer. */
  timeoutMs?: number;
  /** Window that receives the reply. Defaults to the real window; the unit
   *  tests pass a stub, the same seam validateGenuiSource uses. */
  win?: Window;
}

// --- genui-chart-wiring.ts --------------------------------------------------

/** The public surface of <agent-chart-block> this file uses. `block` and
 *  `dataSource` are written; `error` and `lastUpdated` are read. Every one is a
 *  public accessor on the element (chart-block.ts:55-95). */
export interface ChartBlockElement extends HTMLElement {
  block: unknown;
  dataSource: unknown;
  readonly error: string | null;
  readonly lastUpdated: number | null;
}

export interface Pending {
  el: ChartBlockElement;
  /** True when the JSON names both `query` and `encoding`, i.e. the async
   *  data-source path. False for a `config` chart and for a JSON parse
   *  failure. */
  hasQuery: boolean;
  settled: boolean;
}
