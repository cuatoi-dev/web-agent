import { describe, it, expect } from "vitest";
import { validateChartBlock } from "@cuatoi/web-agent-charting";
import { panelChartSkill } from "./panel-chart-skill";
import { configureAgentPanel } from "../agent-panel-config";
import type { AgentChatPanel } from "@cuatoi/web-agent-lit";

const def = panelChartSkill.definition;

function jsonBlocks(): unknown[] {
  const out: unknown[] = [];
  // Match real <script> children only. The prose documents the tag inside
  // backticks (\`<script type="application/json">\`), so exclude any block
  // whose opening tag is immediately preceded by a backtick.
  const scriptRegex = /(?<!`)<script\s+type="application\/json">\s*([\s\S]*?)\s*<\/script>/g;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(def)) !== null) {
    out.push(JSON.parse(match[1]));
  }
  const fencedRegex = /```json\n([\s\S]*?)```/g;
  while ((match = fencedRegex.exec(def)) !== null) {
    out.push(JSON.parse(match[1]));
  }
  return out;
}

function aliasesOf(query: any): string[] {
  const agg = query?.aggregate;
  if (!agg) return [];
  const dims = (agg.groupBy ?? []).map((d: any) =>
    d.as ?? (d.granularity ? `${d.field}_${d.granularity}` : d.field));
  const meas = (agg.measures ?? []).map((m: any) =>
    m.as ?? (m.op === "count" && !m.field ? "count" : `${m.op}_${m.field}`));
  return [...dims, ...meas];
}

describe("panelChartSkill", () => {
  it("names the custom element and required script child", () => {
    expect(def).toContain("<agent-chart-block>");
    expect(def).toContain('<script type="application/json">');
  });

  it("explicitly states the no-JavaScript rule for panel charts", () => {
    expect(def).toMatch(/NEVER write JavaScript/i);
    expect(def).toContain("No-JavaScript Rule");
  });

  it("documents the four valid cat-store data sources", () => {
    expect(def).toContain("`orders`");
    expect(def).toContain("`products`");
    expect(def).toContain("`cart`");
    expect(def).toContain("`es-orders`");
  });

  it("the products source entry lists cost and inStock and claims no hidden field", () => {
    expect(def).toContain('`cost` ("Unit cost")');
    expect(def).toContain('`inStock` ("In stock")');
    expect(def).not.toContain("host-hidden");
  });

  it("every JSON block in the definition is valid JSON and parses cleanly", () => {
    expect(() => jsonBlocks()).not.toThrow();
    expect(jsonBlocks().length).toBeGreaterThanOrEqual(4);
  });

  it("every chart configuration validates against the panel chart block schema", async () => {
    // The panel chart block contract is ChartBlockSchema (type "chart" +
    // query + encoding). SHOW_LIVE_CHART_SCHEMA is the show_live_chart tool's
    // additionalProperties:false schema and would reject the required "type"
    // key, so it is not the right gate for a declarative panel chart.
    const blocks = jsonBlocks();
    for (const b of blocks) {
      const res = await validateChartBlock(b);
      expect(res.ok, res.ok ? "" : res.message).toBe(true);
    }
  });

  it("every aggregated query has sort inside aggregate and encoding channels matching aliases", () => {
    const blocks = jsonBlocks() as any[];
    for (const b of blocks) {
      if (!b.query?.aggregate) continue;
      expect(b.query.sort).toBeUndefined();
      const aliases = aliasesOf(b.query);
      for (const s of b.query.aggregate.sort ?? []) {
        expect(aliases).toContain(s.field);
      }
      if (b.encoding?.x?.field) expect(aliases).toContain(b.encoding.x.field);
      if (b.encoding?.y?.field) expect(aliases).toContain(b.encoding.y.field);
      for (const t of b.encoding?.tooltip ?? []) {
        expect(aliases).toContain(t);
      }
    }
  });

  it("draws a clear boundary between chat charts (show_live_chart) and panel charts (render_agent_ui)", () => {
    expect(def).toContain("render_agent_ui");
    expect(def).toContain("show_live_chart");
    expect(def).toContain("generative UI panel");
  });

  it("leads with an unambiguous decide-first routing rule naming panel trigger words", () => {
    // Regression guard for a live-model finding: the model loaded the skill on
    // a request that named the panel and still routed to show_live_chart. The
    // skill must lead with an imperative decision rule and name the trigger
    // words, not bury the choice under the JSON/alias documentation.
    expect(def.startsWith("# Panel Chart Reference Skill\n\nLoad this skill")).toBe(true);
    expect(def).toContain("Decide First: Panel or Chat?");
    expect(def).toContain("dashboard");
    expect(def).toContain("MUST be rendered");
    expect(def.indexOf("Decide First: Panel or Chat?")).toBeLessThan(def.indexOf("## JSON Child Specification"));
    expect(def.indexOf("dashboard")).toBeLessThan(def.indexOf("## JSON Child Specification"));
  });

  it("is registered in configureAgentPanel skills array", () => {
    const panel = { confirmInteraction: () => {} } as unknown as AgentChatPanel;
    configureAgentPanel(panel, { domAccess: false });
    const registered = panel.skills?.find((s) => s.name === "panel-chart");
    expect(registered).toBeDefined();
    expect(registered?.definition).toBe(panelChartSkill.definition);
  });
});