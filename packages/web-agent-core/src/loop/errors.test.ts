import { describe, it, expect } from "vitest";
import { classifyHttpError, AgentError, agentErrorLabel, mapToAgentError } from "./errors.js";

describe("classifyHttpError", () => {
  it.each([
    [429, "rate_limit"],
    [529, "rate_limit"],
    [401, "fatal_auth"],
    [403, "fatal_auth"],
    [400, "bad_request"],
    [500, "network"],
    [502, "network"],
    [0, "network"],
  ])("status %i → %s", (status, expected) => {
    expect(classifyHttpError(status)).toBe(expected);
  });
});

describe("AgentError", () => {
  it("defaults kind to network", () => {
    const e = new AgentError("something broke");
    expect(e.kind).toBe("network");
    expect(e.message).toBe("something broke");
    expect(e.name).toBe("AgentError");
  });

  it("preserves the given kind", () => {
    const e = new AgentError("too many requests", "rate_limit");
    expect(e.kind).toBe("rate_limit");
  });
});

describe("agentErrorLabel", () => {
  it("returns a human-readable label per kind", () => {
    expect(agentErrorLabel("rate_limit")).toBe("Rate limited");
    expect(agentErrorLabel("fatal_auth")).toBe("Authentication error");
    expect(agentErrorLabel("max_iterations")).toBe("Max iterations exceeded");
  });
});

describe("mapToAgentError", () => {
  it("returns existing AgentError instances untouched", () => {
    const existing = new AgentError("custom", "fatal_auth");
    expect(mapToAgentError(existing)).toBe(existing);
  });

  it("converts AbortError instances into AgentError with kind=aborted", () => {
    const abortErr = new DOMException("Aborted by user", "AbortError");
    const mapped = mapToAgentError(abortErr);
    expect(mapped.kind).toBe("aborted");
    expect(mapped).toBeInstanceOf(AgentError);
  });

  it.each([
    [400, "bad_request"],
    [401, "fatal_auth"],
    [429, "rate_limit"],
    [500, "network"],
  ] as const)("converts HTTP status %i into AgentError with kind=%s", (status, expectedKind) => {
    const httpErr = { status, message: "HTTP failure" };
    const mapped = mapToAgentError(httpErr);
    expect(mapped.kind).toBe(expectedKind);
    expect(mapped.message).toContain(`HTTP ${status}`);
  });
});

