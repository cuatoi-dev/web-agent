import { describe, it, expect, vi, beforeAll } from "vitest";

// Polyfill ElementInternals for jsdom before importing material components,
// mirroring agent-panel-config.test.ts.
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

import { shopManagerReportSkill } from "./shop-manager-skill";
import { configureAgentPanel } from "../agent-panel-config";
import type { AgentChatPanel } from "@cuatoi/web-agent-lit";

const def = shopManagerReportSkill.definition;

function makePanelStub(): AgentChatPanel {
  return {
    confirmInteraction: vi.fn(),
  } as Partial<AgentChatPanel> as unknown as AgentChatPanel;
}

describe("shopManagerReportSkill", () => {
  beforeAll(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("instructs the model to render to the generative UI panel via render_agent_ui", () => {
    expect(def).toContain("render_agent_ui({ source })");
    expect(def).toMatch(/Do NOT output the report as plain text/i);
    expect(def).toMatch(/Do NOT use `show_live_chart` or `show_chart` for panel reports/);
  });

  it("enforces arithmetic calculations exclusively via the calc tool", () => {
    expect(def).toMatch(/NEVER perform mental or in-token arithmetic/i);
    expect(def).toContain("Profit equals Revenue minus Cost");
    expect(def).toContain("Margin percent equals");
    expect(def).toMatch(/month-over-month growth deltas and averages/i);
    expect(def).toMatch(/next-month projections/i);
    // Every arithmetic rule line names calc as the mechanism.
    expect(def.match(/calc\(\{ expression \}\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("requires sums to come from a single aggregated query.data call, not per-row calc summation", () => {
    expect(def).toMatch(/AGGREGATE IN THE QUERY, NOT IN CALC/i);
    expect(def).toMatch(/never from listing individual rows and adding many terms together with `calc`/i);
    expect(def).toContain('groupBy: [{ field: "category", as: "category" }]');
    expect(def).toContain('measures: [{ op: "sum", field: "total", as: "revenue" }]');
    expect(def).toContain('"totalCost"');
    expect(def).toContain('"totalPrice"');
    expect(def).toMatch(/cost-share ratio/i);
    // Section 2 must point back at the aggregate-first rule rather than
    // re-describing a per-row summation approach.
    expect(def).toMatch(/Get category revenue from ONE aggregated `orders` query/);
  });

  it("enforces grounding rules: no invented numbers or products", () => {
    expect(def).toMatch(/GROUNDING, NO INVENTED NUMBERS/i);
    expect(def).toMatch(/MUST originate from a tool result in this turn/);
    expect(def).toMatch(/Never estimate, round untracked numbers, or fabricate catalog items/);
  });

  it("enforces declarative chart blocks with no JavaScript, and defers chart syntax to panel-chart", () => {
    expect(def).toContain("<agent-chart-block>");
    expect(def).toMatch(/NEVER write JavaScript for charts/i);
    expect(def).toContain('load_skill("panel-chart")');
    // Must not re-teach the JSON chart schema itself.
    expect(def).not.toContain('"type": "chart"');
  });

  it("uses only --wa-* theme tokens and avoids hardcoded color literals", () => {
    expect(def).toContain("var(--wa-text-color)");
    expect(def).toContain("var(--wa-background-color)");
    expect(def).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    // The skill documents rgb(...)/rgba(...) as forbidden syntax (ellipsis, no
    // digits) as part of the rule text itself; only flag an actual literal
    // color value, which would carry numeric arguments.
    expect(def).not.toMatch(/rgba?\(\s*\d/);
    // The skill names --wa-primary as an example of a non-existent token
    // to avoid; only flag it if actually used inside a var() call.
    expect(def).not.toContain("var(--wa-primary)");
  });

  it("caps every table at 3 columns for the ~240px panel width and wraps tables for overflow safety", () => {
    expect(def).toMatch(/PANEL WIDTH, DESIGN FOR ABOUT 240PX/i);
    expect(def).toMatch(/Cap every table at 3 columns/i);
    expect(def).toContain('<div style="overflow-x: auto">');
    // Each of the three previously-overflowing tables is now spec'd to 3 columns.
    expect(def).toMatch(/Category breakdown table, 3 columns only/i);
    expect(def).toMatch(/Render only 3 columns \(rule 7\): Product, Price, Status/i);
    expect(def).toMatch(/keep it to 3 columns \(rule 7\): Month, Revenue, MoM delta/i);
    // The model's own extra "cost ratio" column, the cause of the widest overflow, is explicitly forbidden.
    expect(def).toMatch(/Do NOT add Revenue, Cost, or a cost-share-ratio column/i);
  });

  it("includes explicit text status badges and print styling rules", () => {
    expect(def).toContain("[In Stock]");
    expect(def).toContain("[Out of Stock]");
    expect(def).toContain("@media print");
  });

  it("defines all four required report sections in order", () => {
    const sections = [
      "Section 1 - Executive Header and Summary KPIs",
      "Section 2 - Revenue and Profit Breakdown (Drill-Down)",
      "Section 3 - Inventory and Restock Analysis",
      "Section 4 - Next-Month Projections and Commentary",
    ];
    const indices = sections.map((s) => def.indexOf(s));
    for (const [i, idx] of indices.entries()) {
      expect(idx, `missing section: ${sections[i]}`).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  it("contains no bold-asterisk markers to prevent model imitation", () => {
    expect(def).not.toContain("**");
  });

  it("is registered in configureAgentPanel skills array in both DOM modes", () => {
    for (const domAccess of [true, false]) {
      const panel = makePanelStub();
      configureAgentPanel(panel, { domAccess });
      const names = panel.skills!.map((s) => s.name);
      expect(names).toContain("shop-manager-report");
    }
  });
});
