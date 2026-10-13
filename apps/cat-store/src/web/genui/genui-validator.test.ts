import { describe, expect, it } from "vitest";
import { validateGenuiSource } from "./genui-validator";
import { componentEquivalentsRule } from "./genui-rules";
import type { GenuiConfig } from "./genui-config";

const emptyConfig: GenuiConfig = { resources: [], rules: [] };

describe("validateGenuiSource", () => {
  it("passes any source when rules array is empty", async () => {
    const result = await validateGenuiSource("<div>Hello</div>", emptyConfig);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.formattedMessage).toBeNull();
  });

  it("stops at syntax error before executing rules", async () => {
    const config: GenuiConfig = {
      resources: [],
      rules: [componentEquivalentsRule({ button: "md-filled-button" })],
    };
    const source = "<script>const = 1;</script><button>click</button>";
    const result = await validateGenuiSource(source, config);
    expect(result.valid).toBe(false);
    // Only syntax violations — the button rule should not have run
    expect(result.violations.every((v) => v.ruleId === "syntax-error")).toBe(true);
  });

  it("aggregates rule violations when syntax is valid", async () => {
    const config: GenuiConfig = {
      resources: [],
      rules: [componentEquivalentsRule({ button: "md-filled-button" })],
    };
    const source = "<button>click</button>";
    const result = await validateGenuiSource(source, config);
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.formattedMessage).not.toBeNull();
  });

  it("returns valid when rules pass", async () => {
    const config: GenuiConfig = {
      resources: [],
      rules: [componentEquivalentsRule({ button: "md-filled-button" })],
    };
    const source = "<md-filled-button>click</md-filled-button>";
    const result = await validateGenuiSource(source, config);
    expect(result.valid).toBe(true);
    expect(result.formattedMessage).toBeNull();
  });

  it("passes source with top-level await and empty rules", async () => {
    const source = "<script>const res = await fetch('/api');</script>";
    const result = await validateGenuiSource(source, emptyConfig);
    expect(result.valid).toBe(true);
  });

  it("a declarative chart source validates with agent-chart-block registered", async () => {
    const { registeredElementsRule, approvedColoursRule } = await import("./genui-rules");
    const config: GenuiConfig = {
      resources: [],
      rules: [
        approvedColoursRule({ available: ["--wa-text-color"] }),
        registeredElementsRule({ available: ["agent-chart-block"] }),
      ],
    };
    const chartSource = `<agent-chart-block><script type="application/json">{"query":{"source":"orders"},"encoding":{"x":"month","y":"total"}}</script></agent-chart-block>`;
    // Provide a fake win where agent-chart-block is registered
    const win = {
      customElements: {
        get: (tag: string) => (tag === "agent-chart-block" ? class {} : undefined),
      },
    } as unknown as Window;
    const result = await validateGenuiSource(chartSource, config, { win });
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("a hex literal inside the JSON child is caught by the colour rule", async () => {
    const { approvedColoursRule, registeredElementsRule } = await import("./genui-rules");
    const config: GenuiConfig = {
      resources: [],
      rules: [
        approvedColoursRule({ available: ["--wa-text-color"] }),
        registeredElementsRule({ available: ["agent-chart-block"] }),
      ],
    };
    const chartSource = `<agent-chart-block><script type="application/json">{"query":{"source":"orders"},"encoding":{"x":"month"},"backgroundColor":"#ff0000"}</script></agent-chart-block>`;
    const win = {
      customElements: {
        get: (tag: string) => (tag === "agent-chart-block" ? class {} : undefined),
      },
    } as unknown as Window;
    const result = await validateGenuiSource(chartSource, config, { win });
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.ruleId === "approved-colours")).toBe(true);
  });
});
