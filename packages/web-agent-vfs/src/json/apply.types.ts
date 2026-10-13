// The change shapes `json_edit` accepts, and what applying them returns.

export type JsonEditChange =
  | { op: "set"; path: string; value: unknown }
  | { op: "delete"; path: string }
  | { op: "append"; path: string; value: unknown }
  | { op: "insert"; path: string; index: number; value: unknown }
  | { op: "update"; path: string; where: Record<string, unknown>; merge: Record<string, unknown>; expect?: number }
  | { op: "remove"; path: string; where: Record<string, unknown>; expect?: number }
  | { op: "upsert"; path: string; key: string; value: Record<string, unknown> };

export interface ApplySuccess {
  success: true;
  doc: unknown;
  report: string[];
}

export interface ApplyFailure {
  success: false;
  error: string;
}

export type ApplyResult = ApplySuccess | ApplyFailure;
