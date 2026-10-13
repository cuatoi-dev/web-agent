import { describe, it, expect, vi } from "vitest";
import {
  createRenderAgentUiTool,
  buildGenuiToolDescription,
} from "./genui-tool";
import type { GenuiToolHost } from "./genui-tool";
import { DEFAULT_GENUI_CONFIG } from "../genui/genui-config";
import { componentEquivalentsRule, registeredElementsRule } from "../genui/genui-rules";
import type { GenuiDiagnostic } from "../../shared/genui-diagnostics";
import type { ToolContext } from "@cuatoi/web-agent-core";

function makeHost(overrides: Partial<GenuiToolHost> = {}): GenuiToolHost {
  return {
    genuiConfig: DEFAULT_GENUI_CONFIG,
    screenshotAvailable: false,
    validateSource: vi.fn().mockResolvedValue({ valid: true, violations: [], formattedMessage: null }),
    mount: vi.fn().mockResolvedValue(undefined),
    drainDiagnostics: vi.fn().mockReturnValue([]),
    screenshot: vi.fn().mockResolvedValue({ ok: false, error: "not-called" }),
    ...overrides,
  };
}

describe("buildGenuiToolDescription", () => {
  it("names the Material vocabulary when the Material rules are enabled", () => {
    const desc = buildGenuiToolDescription(DEFAULT_GENUI_CONFIG);
    expect(desc).toContain("md-filled-button");
    expect(desc).toContain("--wa-");
    expect(desc).toContain("md-outlined-text-field");
  });

  it("names the Vaadin vocabulary when the map is Vaadin", () => {
    const config = {
      resources: [],
      rules: [
        componentEquivalentsRule({ button: "vaadin-button" }),
        registeredElementsRule({ available: ["vaadin-button"] }),
      ],
    };
    const desc = buildGenuiToolDescription(config);
    expect(desc).toContain("vaadin-button");
    expect(desc).not.toContain("md-filled-button");
  });

  it("falls back to the base text when no rule is enabled", () => {
    const desc = buildGenuiToolDescription({ resources: [], rules: [] });
    expect(desc).not.toContain("Rules enforced");
    expect(desc.length).toBeGreaterThan(0);
  });
});

describe("render_agent_ui execute", () => {
  it("a validation failure returns isError and never mounts", async () => {
    const host = makeHost({
      validateSource: vi.fn().mockResolvedValue({
        valid: false,
        violations: [{ ruleId: "component-equivalents", message: "Replace <button> with <md-filled-button>.", line: 1, column: 1 }],
        formattedMessage: "[component-equivalents] (line 1, col 1): Replace <button> with <md-filled-button>.",
      }),
    });
    const tool = createRenderAgentUiTool(host);
    const outcome = await tool.execute({ source: "<button>Go</button>" }, {} as unknown as ToolContext);
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain("[component-equivalents]");
    expect(host.mount).not.toHaveBeenCalled();
    expect(host.screenshot).not.toHaveBeenCalled();
    expect(outcome.images).toBeUndefined();
  });

  it("a clean source mounts and reports no output", async () => {
    const host = makeHost();
    const tool = createRenderAgentUiTool(host);
    const outcome = await tool.execute({ source: "<div>ok</div>" }, {} as unknown as ToolContext);
    expect(host.mount).toHaveBeenCalledTimes(1);
    expect(host.mount).toHaveBeenCalledWith("<div>ok</div>");
    expect(outcome.isError).toBeUndefined();
    expect(outcome.content).toContain("No console output, errors or failed resources.");
  });

  it("drained diagnostics are appended", async () => {
    const diagnostics: GenuiDiagnostic[] = [
      { kind: "console", level: "log", args: ["hello"], time: Date.now() },
      { kind: "exception", message: "boom", source: "agent-ui.js", line: 1, column: 1, stack: "at agent-ui.js:1:1", time: Date.now() },
    ];
    const host = makeHost({ drainDiagnostics: vi.fn().mockReturnValue(diagnostics) });
    const tool = createRenderAgentUiTool(host);
    const outcome = await tool.execute({ source: "<div>ok</div>" }, {} as unknown as ToolContext);
    expect(outcome.content).toContain("[console.log]");
    expect(outcome.content).toContain("[uncaught error]");
    expect(outcome.content).toContain("Runtime output (2)");
  });

  it("a screenshot is attached when the host allows it", async () => {
    const host = makeHost({
      screenshotAvailable: true,
      screenshot: vi.fn().mockResolvedValue({ ok: true, dataUrl: "data:image/png;base64,AAA" }),
    });
    const tool = createRenderAgentUiTool(host);
    const outcome = await tool.execute({ source: "<div>ok</div>" }, {} as unknown as ToolContext);
    expect(outcome.images).toEqual([{ dataUrl: "data:image/png;base64,AAA", mediaType: "image/png" }]);
    expect(outcome.content).not.toContain("data:image/png;base64,AAA");
  });

  it("no screenshot when the host forbids it", async () => {
    const host = makeHost({ screenshotAvailable: false });
    const tool = createRenderAgentUiTool(host);
    const outcome = await tool.execute({ source: "<div>ok</div>" }, {} as unknown as ToolContext);
    expect(host.screenshot).not.toHaveBeenCalled();
    expect(outcome.images).toBeUndefined();
    expect(outcome.isError).toBeUndefined();
  });

  it("a capture failure degrades to a working result", async () => {
    const host = makeHost({
      screenshotAvailable: true,
      screenshot: vi.fn().mockResolvedValue({ ok: false, error: "timeout" }),
    });
    const tool = createRenderAgentUiTool(host);
    const outcome = await tool.execute({ source: "<div>ok</div>" }, {} as unknown as ToolContext);
    expect(outcome.isError).toBeUndefined();
    expect(outcome.images).toBeUndefined();
    expect(outcome.content).toContain("timeout");
  });

  it("a mount throw is returned as an error", async () => {
    const host = makeHost({
      mount: vi.fn().mockRejectedValue(new Error("Generative UI frame element not found in DOM")),
    });
    const tool = createRenderAgentUiTool(host);
    const outcome = await tool.execute({ source: "<div>ok</div>" }, {} as unknown as ToolContext);
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain("Generative UI frame element not found in DOM");
  });
});

describe("the result budget", () => {
  it("the whole result is capped at ctx.queryResultMaxChars", async () => {
    const entries: GenuiDiagnostic[] = Array.from({ length: 200 }, () => ({
      kind: "console" as const,
      level: "log" as const,
      args: ["x".repeat(400)],
      time: Date.now(),
    }));
    const host = makeHost({ drainDiagnostics: vi.fn().mockReturnValue(entries) });
    const tool = createRenderAgentUiTool(host);
    const outcome = await tool.execute({ source: "<div>ok</div>" }, { queryResultMaxChars: 1200 } as unknown as ToolContext);
    expect(outcome.content.length).toBeLessThanOrEqual(1200);
    expect(outcome.content).toContain("[result truncated:");
  });

  it("the cap comes from the context, not a constant", async () => {
    const entries: GenuiDiagnostic[] = Array.from({ length: 200 }, () => ({
      kind: "console" as const,
      level: "log" as const,
      args: ["x".repeat(400)],
      time: Date.now(),
    }));
    const host1200 = makeHost({ drainDiagnostics: vi.fn().mockReturnValue(entries) });
    const host4000 = makeHost({ drainDiagnostics: vi.fn().mockReturnValue(entries) });
    const tool1200 = createRenderAgentUiTool(host1200);
    const tool4000 = createRenderAgentUiTool(host4000);
    const out1200 = await tool1200.execute({ source: "<div>ok</div>" }, { queryResultMaxChars: 1200 } as unknown as ToolContext);
    const out4000 = await tool4000.execute({ source: "<div>ok</div>" }, { queryResultMaxChars: 4000 } as unknown as ToolContext);
    expect(out4000.content.length).toBeGreaterThan(out1200.content.length);
    expect(out1200.content.length).toBeLessThanOrEqual(1200);
    expect(out4000.content.length).toBeLessThanOrEqual(4000);
  });

  it("an over-long single diagnostic is cut with a visible marker", async () => {
    const entries: GenuiDiagnostic[] = [
      { kind: "console", level: "log", args: ["x".repeat(5000)], time: Date.now() },
    ];
    const host = makeHost({ drainDiagnostics: vi.fn().mockReturnValue(entries) });
    const tool = createRenderAgentUiTool(host);
    const outcome = await tool.execute({ source: "<div>ok</div>" }, {} as unknown as ToolContext);
    expect(outcome.content).toContain("… [+");
    expect(outcome.content).toContain("characters cut]");
  });

  it("more than MAX_DIAGNOSTIC_ENTRIES entries reports how many were dropped", async () => {
    const entries: GenuiDiagnostic[] = Array.from({ length: 25 }, () => ({
      kind: "console" as const,
      level: "log" as const,
      args: ["entry"],
      time: Date.now(),
    }));
    const host = makeHost({ drainDiagnostics: vi.fn().mockReturnValue(entries) });
    const tool = createRenderAgentUiTool(host);
    const outcome = await tool.execute({ source: "<div>ok</div>" }, {} as unknown as ToolContext);
    expect(outcome.content).toContain("[+5 more diagnostics not shown]");
  });
});
