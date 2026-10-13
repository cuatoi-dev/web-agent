// The `AgentError` discriminator. Its own file so `errors.ts` can import it
// without the shared `loop/types.ts` — which needs `AgentError` itself.

/** Discriminator for AgentError kinds. */
export type AgentErrorKind =
  | "rate_limit"
  | "fatal_auth"
  | "bad_request"
  | "network"
  | "aborted"
  | "max_iterations";
