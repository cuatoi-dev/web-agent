// Shapes for the fake Chrome/CDP boundary in test-screenshot-cdp.ts.

export interface FakeNode {
  x: number;
  y: number;
  width: number;
  height: number;
  connected?: boolean;
  /** Restoring this node's outline rejects. */
  restoreFails?: boolean;
}

export interface FakeSelection {
  ok: boolean;
  error?: string;
  count?: number;
  /** backendNodeId of the first match. */
  node?: number;
}

export interface FakeChromeOptions {
  nodes: Record<number, FakeNode>;
  selections?: Record<string, FakeSelection>;
  scrollX?: number;
  scrollY?: number;
  viewport?: { width: number; height: number };
  content?: { width: number; height: number };
  captureFails?: boolean;
  captureEmpty?: boolean;
}
