import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import type { MockInstance } from "vitest";

// Polyfill ElementInternals for jsdom before importing material components.
if (typeof window !== "undefined") {
  if (!window.ElementInternals) {
    window.ElementInternals = class {} as unknown as typeof ElementInternals;
  }
  const internalsProto = window.ElementInternals.prototype;
  if (!internalsProto.setFormValue) internalsProto.setFormValue = () => {};
  if (!internalsProto.setValidity) internalsProto.setValidity = () => {};
  if (!internalsProto.checkValidity) internalsProto.checkValidity = () => true;
  if (!internalsProto.reportValidity) internalsProto.reportValidity = () => true;
}

import {
  panelProps,
  configureAgentPanel,
  applyProviderEntry,
  PROVIDER_ENTRIES,
  DEFAULT_PROVIDER_ENTRY_INDEX,
} from "./agent-panel-config";
import { defaultBaseURLFor, LocalStorageSkillRegistry, type ToolContext } from "@cuatoi/web-agent-core";
import { chartingSkills } from "@cuatoi/web-agent-charting";
import { ANY_MODEL_ENDPOINT_TYPE, ANY_MODEL_CHAIN } from "./any-model-chain";
import type { AgentChatPanel, AgentHooks } from "@cuatoi/web-agent-lit";

const EVENTS: (keyof AgentHooks)[] = [
  "onSessionStart",
  "onUserPrompt",
  "onPreTool",
  "onPostTool",
  "onTurnEnd",
  "onPreCompact",
  "onPostCompact",
];

/** A partial stand-in for the real <agent-chat-panel> element:
 *  configureAgentPanel() only ever writes properties, so a plain object with
 *  real setters' worth of storage behaves identically for these tests. The
 *  cast is the one documented place this file admits it is not a real
 *  AgentChatPanel. */
function makePanelStub(): AgentChatPanel {
  return {
    confirmInteraction: vi.fn(),
  } as Partial<AgentChatPanel> as unknown as AgentChatPanel;
}

describe("panelProps", () => {
  it("returns a complete property dictionary with the default provider and tools", () => {
    const props = panelProps({ domAccess: false });
    const expectedKeys = [
      "fetch",
      "store",
      "appContext",
      "config",
      "agentName",
      "agentShortName",
      "agentAvatar",
      "type",
      "path",
      "model",
      "models",
      "imageInput",
      "renderers",
      "sources",
      "tools",
      "skills",
      "skillRegistry",
      "toolProviders",
      "screens",
      "notify",
      "hooks",
    ];
    expect(Object.keys(props).sort()).toEqual(expectedKeys.sort());
    const entry = PROVIDER_ENTRIES[DEFAULT_PROVIDER_ENTRY_INDEX];
    expect(props.type).toBe(entry.endpointType);
    expect(props.path).toBe(entry.path);
    expect(props.model).toBe(entry.model);
    expect(props.toolProviders.map((provider) => provider.name)).toContain("demomcp");
    expect(props.tools.map((tool) => tool.name)).toContain("add_to_cart");
    expect(typeof props.fetch).toBe("function");
    expect(typeof props.notify).toBe("function");
    for (const event of EVENTS) expect(typeof props.hooks[event]).toBe("function");
  });

  it("omits the DOM provider and multi_step_ui skill without DOM access", () => {
    const props = panelProps({ domAccess: false });
    expect(props.toolProviders.map((provider) => provider.name)).not.toContain("dom");
    expect(props.skills.map((skill) => skill.name)).not.toContain("multi_step_ui");
  });

  it("includes the DOM provider and cues with DOM access", () => {
    const props = panelProps({ domAccess: true });
    expect(props.toolProviders.map((provider) => provider.name)).toContain("dom");
    expect(props.skills.map((skill) => skill.name)).toContain("multi_step_ui");
    expect(props.cues).toEqual({ enabled: true, speed: "slow" });
  });

  it("assigns every panelProps property onto the target panel", () => {
    const expected = panelProps({ domAccess: false });
    const target = {} as Partial<AgentChatPanel> as AgentChatPanel;
    configureAgentPanel(target, { domAccess: false });
    expect(Object.keys(target).sort()).toEqual(Object.keys(expected).sort());
    expect(target.type).toBe(expected.type);
    expect(target.path).toBe(expected.path);
    expect(target.model).toBe(expected.model);
    expect(target.tools!.map((tool) => tool.name)).toEqual(
      expected.tools.map((tool) => tool.name),
    );
    expect(target.toolProviders!.map((provider) => provider.name)).toEqual(
      expected.toolProviders.map((provider) => provider.name),
    );
    expect(typeof target.hooks!.onTurnEnd).toBe("function");
  });
});

describe("configureAgentPanel", () => {
  let spy: MockInstance;

  beforeAll(() => {
    spy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("domAccess: false omits the DOM tool provider", () => {
    const panel = makePanelStub();
    configureAgentPanel(panel, { domAccess: false });
    const names = panel.toolProviders!.map((p) => p.name);
    expect(names).not.toContain("dom");
  });

  it("sets maxIterations 120 over any earlier panel config", () => {
    const panel = makePanelStub();
    panel.config = { maxIterations: 7 };
    configureAgentPanel(panel, { domAccess: false });
    expect(panel.config?.maxIterations).toBe(120);
  });

  it("domAccess: true includes the DOM tool provider", () => {
    const panel = makePanelStub();
    configureAgentPanel(panel, { domAccess: true });
    const names = panel.toolProviders!.map((p) => p.name);
    expect(names).toContain("dom");
  });

  it("both modes carry the same non-DOM providers in the same order", () => {
    const withDom = makePanelStub();
    const withoutDom = makePanelStub();
    configureAgentPanel(withDom, { domAccess: true });
    configureAgentPanel(withoutDom, { domAccess: false });

    const nonDom = (providers: AgentChatPanel["toolProviders"]) =>
      providers!.filter((p) => p.name !== "dom").map((p) => p.name);

    expect(nonDom(withDom.toolProviders)).toEqual(nonDom(withoutDom.toolProviders));
  });

  it("default tool providers include demomcp, openapi and vfs, but not unreachable", () => {
    const panel = makePanelStub();
    configureAgentPanel(panel, { domAccess: false });
    const names = panel.toolProviders!.map((p) => p.name);
    expect(names).toContain("demomcp");
    expect(names).toContain("openapi");
    expect(names).toContain("vfs");
    expect(names).not.toContain("unreachable");
  });

  it("__WA_EXTRA_MCP_SERVERS__ injects extra MCP tool providers", () => {
    window.__WA_EXTRA_MCP_SERVERS__ = [
      { name: "extra_test", description: "test", url: "http://localhost:59999/mcp", required: false },
    ];
    try {
      const panel = makePanelStub();
      configureAgentPanel(panel, { domAccess: false });
      const names = panel.toolProviders!.map((p) => p.name);
      expect(names).toContain("extra_test");
    } finally {
      delete window.__WA_EXTRA_MCP_SERVERS__;
    }
  });

  it("domAccess: false omits the DOM skill", () => {
    const panel = makePanelStub();
    configureAgentPanel(panel, { domAccess: false });
    const names = panel.skills!.map((s) => s.name);
    expect(names).not.toContain("multi_step_ui");
  });

  it("domAccess: true includes the DOM skill", () => {
    const panel = makePanelStub();
    configureAgentPanel(panel, { domAccess: true });
    const names = panel.skills!.map((s) => s.name);
    expect(names).toContain("multi_step_ui");
  });

  it("only DOM access changes between the two configurations", () => {
    const withDom = makePanelStub();
    const withoutDom = makePanelStub();
    configureAgentPanel(withDom, { domAccess: true });
    configureAgentPanel(withoutDom, { domAccess: false });

    // Shared scalar properties must match.
    expect(withDom.path).toBe(withoutDom.path);
    expect(withDom.imageInput).toBe(withoutDom.imageInput);
    expect(withDom.config!.persist).toBe(withoutDom.config!.persist);
    expect(withDom.config!.sessionNamespace).toBe(withoutDom.config!.sessionNamespace);

    // tools list (by name) must match. Every CustomToolDef carries `name`.
    const toolNames = (p: AgentChatPanel) => p.tools!.map((t) => t.name);
    expect(toolNames(withDom)).toEqual(toolNames(withoutDom));

    // models list must match.
    expect(JSON.stringify(withDom.models)).toBe(JSON.stringify(withoutDom.models));

    // sources: same length.
    expect(withDom.sources!.length).toBe(withoutDom.sources!.length);

    // skills minus multi_step_ui must match in order.
    const nonDomSkills = (p: AgentChatPanel) =>
      p.skills!.filter((s) => s.name !== "multi_step_ui").map((s) => s.name);
    expect(nonDomSkills(withDom)).toEqual(nonDomSkills(withoutDom));
  });

  it("domAccess: false leaves cues undefined", () => {
    const panel = makePanelStub();
    configureAgentPanel(panel, { domAccess: false });
    expect(panel.cues).toBeUndefined();
  });

  it("domAccess: true sets cues.enabled = true with speed slow", () => {
    const panel = makePanelStub();
    configureAgentPanel(panel, { domAccess: true });
    expect(panel.cues).toEqual({ enabled: true, speed: "slow" });
  });

  it("all seven hooks are functions in both modes", () => {
    for (const domAccess of [true, false]) {
      const panel = makePanelStub();
      configureAgentPanel(panel, { domAccess });
      for (const evt of EVENTS) {
        expect(typeof panel.hooks![evt]).toBe("function");
      }
    }
  });

  it("each hook logs exactly one line carrying [cat-store hooks]", () => {
    const PAYLOADS: Record<keyof AgentHooks, unknown> = {
      onSessionStart: { sessionId: "s-1" },
      onUserPrompt: { parts: [{ type: "text" }] },
      onPreTool: { name: "add_to_cart", input: { id: "p01" }, summary: "Add" },
      onPostTool: { name: "add_to_cart", input: {}, outcome: { content: "ok" } },
      onTurnEnd: { result: { assistantText: "done", stopReason: "end_turn" }, stopReason: "end_turn" },
      onPreCompact: { tokens: 4000, percent: 0.8 },
      onPostCompact: { tokensBefore: 4000, tokensAfter: 1200 },
    };
    const panel = makePanelStub();
    configureAgentPanel(panel, { domAccess: false });
    for (const evt of EVENTS) {
      spy.mockClear();
      (panel.hooks![evt] as (p: unknown) => void)(PAYLOADS[evt]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toContain("[cat-store hooks]");
    }
  });

  // 005 invariant: chart skill loaded => a live chart tool is registered.
  it("registers a live chart tool alongside the chart skill (005)", async () => {
    const panel = makePanelStub();
    configureAgentPanel(panel, { domAccess: false });

    const skillNames = panel.skills!.map((s) => s.name);
    const chartSkillNames = chartingSkills().map((s) => s.name);
    // Derived, not a literal: renaming the skill keeps this honest.
    for (const name of chartSkillNames) {
      expect(skillNames).toContain(name);
    }

    const toolNames = panel.tools!.map((t) => t.name);
    expect(toolNames).toContain("show_live_chart");
    expect(toolNames).toContain("calc");

    // 003: the bespoke host tool is gone; the generic one replaces it.
    expect(toolNames).not.toContain("show_orders_revenue_chart");

    // A live chart tool emits a block carrying both query and encoding — that
    // pair is what makes chart-block.ts re-query and show the refresh footer.
    // Assert it from the tool the panel actually registers, not a constant.
    const liveTool = panel.tools!.find((t) => t.name === "show_live_chart")!;
    const { LIVE_REVENUE_CHART_ARGS } = await import("./store/live-revenue-chart.fixture");
    const outcome = await liveTool.execute(LIVE_REVENUE_CHART_ARGS, {} as unknown as ToolContext);
    const block = outcome.block as { query?: unknown; encoding?: unknown };
    expect(block.query).toBeDefined();
    expect(block.encoding).toBeDefined();
  });

  it("wires a LocalStorageSkillRegistry namespaced to cat-store", () => {
    const panel = makePanelStub();
    configureAgentPanel(panel, { domAccess: false });
    expect(panel.skillRegistry).toBeInstanceOf(LocalStorageSkillRegistry);
    expect(typeof panel.skillRegistry!.list).toBe("function");
    expect(typeof panel.skillRegistry!.save).toBe("function");
  });

  it("uses the same namespace for the skill registry as for sessions", async () => {
    const panel = makePanelStub();
    configureAgentPanel(panel, { domAccess: false });
    expect(panel.config?.sessionNamespace).toBe("cat-store");

    localStorage.clear();
    await panel.skillRegistry!.save!({
      name: "ns_test_skill",
      description: "testing namespace",
      definition: "def",
    });
    expect(localStorage.getItem("web-agent-skills-cat-store")).not.toBeNull();
  });

  it("panel.skills is unchanged by the registry wiring", () => {
    const panel = makePanelStub();
    configureAgentPanel(panel, { domAccess: false });
    const skillNames = panel.skills!.map((s) => s.name);
    const chartSkillNames = chartingSkills().map((s) => s.name);
    for (const name of chartSkillNames) {
      expect(skillNames).toContain(name);
    }
  });

  it("configures skills so that cat-store command skills resolve and non-commands do not", () => {
    const panel = makePanelStub();
    configureAgentPanel(panel, { domAccess: false });
    const skills = panel.skills ?? [];

    const resolve = (typed: string) => {
      const lower = typed.toLowerCase();
      return skills.find(
        (s) =>
          s.command &&
          (s.name.toLowerCase() === lower ||
            s.aliases?.some((a) => a.toLowerCase() === lower)),
      );
    };

    expect(resolve("demo")?.name).toBe("demo");
    expect(resolve("finance")?.name).toBe("finance-demo");
    expect(resolve("finance-demo")?.name).toBe("finance-demo");
    expect(resolve("report")?.name).toBe("shop-manager-report");
    expect(resolve("shop-manager-report")?.name).toBe("shop-manager-report");
    expect(resolve("panel-chart")?.name).toBe("panel-chart");

    expect(resolve("data-analysis")).toBeUndefined();
    expect(resolve("promotions-assistant")).toBeUndefined();
  });

  it("the genui tool is registered only when a host is supplied", () => {
    const withoutGenui = makePanelStub();
    const withGenui = makePanelStub();
    const stubHost = {
      genuiConfig: { resources: [], rules: [] },
      screenshotAvailable: false,
      validateSource: () => Promise.resolve({ valid: true, violations: [], formattedMessage: null }),
      mount: async () => {},
      drainDiagnostics: () => [],
      screenshot: () => Promise.resolve({ ok: false as const, error: "not-called" }),
    };
    configureAgentPanel(withoutGenui, { domAccess: false });
    configureAgentPanel(withGenui, { domAccess: false, genui: stubHost });

    const namesWithout = withoutGenui.tools!.map((t) => t.name);
    const namesWith = withGenui.tools!.map((t) => t.name);
    expect(namesWithout).not.toContain("render_agent_ui");
    expect(namesWith).toContain("render_agent_ui");
    // The two lists are otherwise identical.
    expect(namesWithout.length).toBe(namesWith.length - 1);
  });

  it("registers the stock-monitor skill by default (scheduler enabled)", () => {
    const panel = makePanelStub();
    configureAgentPanel(panel, { domAccess: false });
    const names = panel.skills!.map((s) => s.name);
    expect(names).toContain("stock-monitor");
  });

  it("omits the stock-monitor skill when scheduler is disabled", () => {
    const panel = makePanelStub();
    panel.config = { scheduler: { enabled: false } };
    configureAgentPanel(panel, { domAccess: false });
    const names = panel.skills!.map((s) => s.name);
    expect(names).not.toContain("stock-monitor");
  });
});

describe("PROVIDER_ENTRIES", () => {
  afterEach(() => {
    delete window.__WA_MOCK_SCRIPT__;
  });

  it("ids are unique", () => {
    expect(new Set(PROVIDER_ENTRIES.map((e) => e.id)).size).toBe(PROVIDER_ENTRIES.length);
  });

  it("labels are unique and ASCII", () => {
    expect(new Set(PROVIDER_ENTRIES.map((e) => e.label)).size).toBe(PROVIDER_ENTRIES.length);
    for (const entry of PROVIDER_ENTRIES) {
      expect(entry.label).toMatch(/^[\x20-\x7E]+$/);
    }
  });

  it("the path matches the endpoint type", () => {
    for (const entry of PROVIDER_ENTRIES) {
      if (entry.endpointType === "openai") {
        // openai-provider.ts:75-80 appends "/chat/completions" to a base that
        // must already end in "/v1".
        expect(entry.path.endsWith("/v1")).toBe(true);
      } else {
        // anthropic-provider.ts:172-177 and gemini-provider.ts:97,147 both
        // append their own versioned suffix, so the base must NOT carry "/v1".
        expect(entry.path.endsWith("/v1")).toBe(false);
      }
    }
  });

  it("offers exactly one entry per provider route, in route order", () => {
    const routes = PROVIDER_ENTRIES
      .filter((e) => e.endpointType !== ANY_MODEL_ENDPOINT_TYPE)
      .map((e) => e.endpointType);
    expect(routes).toEqual(["anthropic", "openai", "gemini"]);
  });

  it("the default index is inside the list", () => {
    expect(DEFAULT_PROVIDER_ENTRY_INDEX).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_PROVIDER_ENTRY_INDEX).toBeLessThan(PROVIDER_ENTRIES.length);
  });

  it("applyProviderEntry writes exactly three properties", () => {
    const panel = {} as Partial<AgentChatPanel> as unknown as AgentChatPanel;
    const entry = PROVIDER_ENTRIES[0];
    applyProviderEntry(panel, entry);
    expect(panel.type).toBe(entry.endpointType);
    expect(panel.path).toBe(entry.path);
    expect(panel.model).toBe(entry.model);
    expect(Object.keys(panel).sort()).toEqual(["model", "path", "type"]);
  });

  it("the live path applies the default entry", () => {
    const panel = makePanelStub();
    configureAgentPanel(panel, { domAccess: false });
    const entry = PROVIDER_ENTRIES[DEFAULT_PROVIDER_ENTRY_INDEX];
    expect(panel.type).toBe(entry.endpointType);
    expect(panel.path).toBe(entry.path);
    expect(panel.model).toBe(entry.model);
  });

  it("the mock seam still overrides the transport", () => {
    window.__WA_MOCK_SCRIPT__ = { text: "hi", finishReason: "stop" };
    const panel = makePanelStub();
    configureAgentPanel(panel, { domAccess: false });
    const entry = PROVIDER_ENTRIES[DEFAULT_PROVIDER_ENTRY_INDEX];
    expect(panel.type).toBe("mock");
    expect(panel.path).toBe(entry.path);
    expect(panel.model).toBe(entry.model);
  });

  it("each chain entry's baseURL matches its provider's route", () => {
    for (const entry of ANY_MODEL_CHAIN) {
      if (entry.endpointType === "openai") {
        expect(entry.baseURL).toBe(defaultBaseURLFor("openai"));
      } else if (entry.endpointType === "anthropic") {
        expect(entry.baseURL).toBe(defaultBaseURLFor("anthropic"));
      } else if (entry.endpointType === "gemini") {
        expect(entry.baseURL).toBe(defaultBaseURLFor("gemini"));
      }
    }
  });

  it("the chain has one entry per route, in route order", () => {
    expect(ANY_MODEL_CHAIN.map((e) => e.endpointType)).toEqual([
      "anthropic",
      "openai",
      "gemini",
    ]);
  });

  it("the chain endpoint type resolves through the registry", async () => {
    const { providerRegistry, DEFAULT_CONFIG } = await import("@cuatoi/web-agent-core");
    const model = providerRegistry.get({
      ...DEFAULT_CONFIG,
      model: "sonnet",
      endpointType: ANY_MODEL_ENDPOINT_TYPE,
    });
    expect(typeof model.generate).toBe("function");
  });
});
