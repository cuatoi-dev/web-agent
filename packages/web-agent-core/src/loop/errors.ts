import type { AgentErrorKind } from "./errors.types.js";
export type { AgentErrorKind } from "./errors.types.js";

/** Base error with a `kind` discriminator so callers can branch on cause. */
export class AgentError extends Error {
  readonly kind: AgentErrorKind;

  constructor(message: string, kind: AgentErrorKind = "network") {
    super(message);
    this.name = "AgentError";
    this.kind = kind;
  }
}

/** Map an HTTP status code to the matching AgentErrorKind. */
export function classifyHttpError(status: number): AgentErrorKind {
  if (status === 429 || status === 529) return "rate_limit";
  if (status === 401 || status === 403) return "fatal_auth";
  if (status === 400) return "bad_request";
  return "network";
}

/** Return a human-readable label for the kind (used in error messages). */
export function agentErrorLabel(kind: AgentErrorKind): string {
  switch (kind) {
    case "rate_limit": return "Rate limited";
    case "fatal_auth": return "Authentication error";
    case "bad_request": return "Bad request";
    case "network": return "Network error";
    case "aborted": return "Request aborted";
    case "max_iterations": return "Max iterations exceeded";
  }
}

/** Map unknown caught exceptions (SDK errors, DOMException, HTTP errors) to AgentError. */
export function mapToAgentError(err: unknown): AgentError {
  if (err instanceof AgentError) return err;

  const inner = (err as { lastError?: unknown } | null | undefined)?.lastError ?? err;

  if (
    (err instanceof Error && err.name === "AbortError") ||
    (inner instanceof Error && inner.name === "AbortError") ||
    (err as { name?: unknown } | null | undefined)?.name === "AbortError" ||
    (inner as { name?: unknown } | null | undefined)?.name === "AbortError"
  ) {
    return new AgentError(agentErrorLabel("aborted"), "aborted");
  }

  const innerObj = inner as { statusCode?: number; status?: number } | null | undefined;
  const statusCode: number | undefined = innerObj?.statusCode ?? innerObj?.status;
  if (typeof statusCode === "number") {
    const kind = classifyHttpError(statusCode);
    return new AgentError(
      `${agentErrorLabel(kind)} (HTTP ${statusCode})`,
      kind,
    );
  }

  return new AgentError(
    err instanceof Error ? err.message : String(err),
    "network",
  );
}

