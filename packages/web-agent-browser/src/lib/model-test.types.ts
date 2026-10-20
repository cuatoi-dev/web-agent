import type { ResolvedProvider } from "./model-store.types";

/** What one model test found (138/001). */
export type TestKind = "pass" | "auth" | "notfound" | "http" | "noOk" | "denied" | "network" | "timeout";

export interface TestResult {
  ok: boolean;
  /** Time from send to result, in milliseconds. */
  ms: number;
  kind: TestKind;
  /** HTTP status, for auth / notfound / http. */
  status?: number;
  /** HTTP status text, for auth / http. "" when unknown. */
  statusText?: string;
  /** The provider's error message, for http. */
  message?: string;
  /** The reply text, for noOk. */
  reply?: string;
}

/** The line shown under a row: `ok` picks the colour, `text` carries the meaning. */
export interface ResultLine {
  ok: boolean;
  text: string;
}

/** Injected for unit tests. Defaults: the global fetch and performance.now(). */
export interface ModelTestDeps {
  fetchImpl?: typeof fetch;
  now?: (this: void) => number;
}

/** `runTest` also asks Chrome for the host permission. */
export interface RunTestDeps extends ModelTestDeps {
  requestPermission?: (this: void, origin: string) => Promise<boolean>;
}

/** Per-row counter: a result whose generation is no longer current is dropped. */
export interface RowTestState {
  generation: number;
}

/** What a form row needs to run a test: the current, unsaved form values. */
export interface RowTestContext {
  getProvider: (this: void) => ResolvedProvider;
  deps: RunTestDeps;
}
