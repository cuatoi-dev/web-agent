import { describe, it, expect } from "vitest";
import { catStoreDemoSkill } from "./demo-skill";

describe("catStoreDemoSkill", () => {
  it("has a non-empty description mentioning tool-aware adaptation", () => {
    expect(catStoreDemoSkill.description.length).toBeGreaterThan(0);
    expect(catStoreDemoSkill.description).toContain("adapts automatically based on tool presence");
  });

  it("definition covers branching instructions for both DOM and non-DOM modes", () => {
    const def = catStoreDemoSkill.definition;
    expect(def).toContain("BRANCH A");
    expect(def).toContain("BRANCH B");
    expect(def).toContain("snapshot_page");
  });

  it("definition covers required tokens for both branches including show_chart", () => {
    const def = catStoreDemoSkill.definition;
    const required = [
      "get_theme",
      "set_theme",
      "wait",
      "snapshot_page",
      "click",
      "promotions-assistant",
      "add_to_cart",
      "query_state",
      "query_data",
      "demomcp_place_order",
      "ordersApi_describeOrders",
      "show_generative_ui",
      "show_chart",
      "present_to_user",
      "cat-store",
      "show_live_chart",
      "render_agent_ui",
    ];
    for (const token of required) {
      expect(def, `definition should mention "${token}"`).toContain(token);
    }
  });

  it("definition preserves the critical do-not-stop-early paragraph in the preamble", () => {
    expect(catStoreDemoSkill.definition).toContain("CRITICAL — do not stop early");
  });

  it("definition contains the vision guard phrase in Branch A", () => {
    expect(catStoreDemoSkill.definition).toContain("vision skipped");
  });

  it("theme flip twice is the first step in Branch A, before the greet/buttons step", () => {
    const def = catStoreDemoSkill.definition;
    const branchA = def.slice(
      def.indexOf("BRANCH A — Storefront Guided Tour"),
      def.indexOf("BRANCH B — Full-Page Capability Demo"),
    );
    const step1 = branchA.slice(branchA.indexOf("Step 1"), branchA.indexOf("Step 2"));
    expect(step1).toContain("get_theme");
    expect(step1).toContain('set_theme({ theme: "dark" })');
    expect(step1).toContain('set_theme({ theme: "light" })');
    expect(step1.indexOf("get_theme")).toBeLessThan(step1.indexOf('theme: "dark"'));
    expect(step1.indexOf('theme: "dark"')).toBeLessThan(step1.indexOf('theme: "light"'));
  });

  it("theme flip twice is the first step in Branch B, before the greet/buttons step", () => {
    const def = catStoreDemoSkill.definition;
    const branchB = def.slice(def.indexOf("BRANCH B — Full-Page Capability Demo"));
    const step1 = branchB.slice(branchB.indexOf("Step 1"), branchB.indexOf("Step 2"));
    expect(step1).toContain("get_theme");
    expect(step1).toContain('set_theme({ theme: "dark" })');
    expect(step1).toContain('set_theme({ theme: "light" })');
    expect(step1.indexOf("get_theme")).toBeLessThan(step1.indexOf('theme: "dark"'));
    expect(step1.indexOf('theme: "dark"')).toBeLessThan(step1.indexOf('theme: "light"'));
  });

  it("the closing summary step does not call set_theme in either branch (Step 9 in A, Step 10 in B)", () => {
    const def = catStoreDemoSkill.definition;
    const branchA = def.slice(
      def.indexOf("BRANCH A — Storefront Guided Tour"),
      def.indexOf("BRANCH B — Full-Page Capability Demo"),
    );
    const step9A = branchA.slice(branchA.indexOf("Step 9"));
    expect(step9A).not.toContain("set_theme({");

    const branchB = def.slice(def.indexOf("BRANCH B — Full-Page Capability Demo"));
    const step10B = branchB.slice(branchB.indexOf("Step 10"));
    expect(step10B).not.toContain("set_theme({");
  });

  it("a wait call separates each UI step in each branch", () => {
    const def = catStoreDemoSkill.definition;
    const waitCount = (def.match(/wait\(\{ seconds: 1 \}\)/g) ?? []).length;
    expect(waitCount).toBeGreaterThanOrEqual(8);
  });

  it("in Branch A, the DOM pass (snapshot_page/click) precedes the typed add_to_cart tool pass", () => {
    const def = catStoreDemoSkill.definition;
    const branchA = def.slice(
      def.indexOf("BRANCH A — Storefront Guided Tour"),
      def.indexOf("BRANCH B — Full-Page Capability Demo"),
    );
    expect(branchA.indexOf("snapshot_page")).toBeLessThan(branchA.indexOf("add_to_cart"));
    expect(branchA.indexOf("click")).toBeLessThan(branchA.indexOf("add_to_cart"));
  });

  // task 017 live verification: the model echoed the script's own bold
  // "**Step 9 — ...**" header into its narration and left it unclosed. The
  // script text is never rendered to the user, so it has nothing to gain from
  // bold step headers — removing "**" from the source removes the pattern the
  // model was imitating.
  it("the script text contains no bold-asterisk markers for the model to imitate", () => {
    expect(catStoreDemoSkill.definition).not.toContain("**");
  });

  // task 006 fix: a Stage-A review found show_chart was called repeatedly on
  // the live agent page but no chart ever rendered — the model had queried the
  // full catalog and built its own larger, decimal-valued chart instead of the
  // literal config given, which the chart validator rejected every time.
  // Step 7 must tell the agent, unambiguously, to use the given values as-is.
  it("Branch B Step 7 tells the agent to chart product prices from query_data({source:'products'})", () => {
    const def = catStoreDemoSkill.definition;
    const branchB = def.slice(def.indexOf("BRANCH B — Full-Page Capability Demo"));
    const step7 = branchB.slice(branchB.indexOf("Step 7"), branchB.indexOf("Step 8"));
    expect(step7).toContain('query_data({ source: "products" })');
    expect(step7).toContain("show_chart");
    expect(step7).toContain("products");
  });

  // 003: show_live_chart must appear in both branches.
  it("Branch A Step 5 calls show_live_chart with the orders aggregate", () => {
    const def = catStoreDemoSkill.definition;
    const branchA = def.slice(
      def.indexOf("BRANCH A — Storefront Guided Tour"),
      def.indexOf("BRANCH B — Full-Page Capability Demo"),
    );
    const step5 = branchA.slice(branchA.indexOf("Step 5"), branchA.indexOf("Step 6"));
    expect(step5).toContain("show_live_chart");
    expect(step5).toContain('source: "orders"');
    expect(step5).toContain("intervalMs: 30000");
  });

  it("Branch B Step 7 contains both show_chart and show_live_chart (show_chart first)", () => {
    const def = catStoreDemoSkill.definition;
    const branchB = def.slice(def.indexOf("BRANCH B — Full-Page Capability Demo"));
    const step7 = branchB.slice(branchB.indexOf("Step 7"), branchB.indexOf("Step 8"));
    expect(step7).toContain("show_chart");
    expect(step7).toContain("show_live_chart");
    expect(step7.indexOf("show_chart")).toBeLessThan(step7.indexOf("show_live_chart"));
  });

  it("show_live_chart appears in both closing summaries", () => {
    const def = catStoreDemoSkill.definition;
    const count = (def.match(/show_live_chart/g) ?? []).length;
    // At least two occurrences: one per branch summary (plus the step calls, so
    // really more — but the invariant is that it appears in BOTH summaries).
    expect(count).toBeGreaterThanOrEqual(2);

    // Each branch's summary line contains it.
    const branchA = def.slice(
      def.indexOf("BRANCH A — Storefront Guided Tour"),
      def.indexOf("BRANCH B — Full-Page Capability Demo"),
    );
    const step9A = branchA.slice(branchA.indexOf("Step 9"));
    expect(step9A).toContain("show_live_chart");

    const branchB = def.slice(def.indexOf("BRANCH B — Full-Page Capability Demo"));
    const step10B = branchB.slice(branchB.indexOf("Step 10"));
    expect(step10B).toContain("show_live_chart");
  });

  it("definition includes render_agent_ui in required tokens", () => {
    expect(catStoreDemoSkill.definition).toContain("render_agent_ui");
  });

  it("Branch B has 10 steps and Branch A has 9 steps", () => {
    const def = catStoreDemoSkill.definition;
    const branchA = def.slice(
      def.indexOf("BRANCH A — Storefront Guided Tour"),
      def.indexOf("BRANCH B — Full-Page Capability Demo"),
    );
    const branchB = def.slice(def.indexOf("BRANCH B — Full-Page Capability Demo"));

    expect(branchA).toContain("Step 9 — Vision & closing summary");
    expect(branchA).not.toContain("Step 10");

    expect(branchB).toContain("Step 8 — Generative UI Report");
    expect(branchB).toContain("Step 9 — Form");
    expect(branchB).toContain("Step 10 — Closing summary");
  });

  it("Branch B Step 8 calls render_agent_ui with the order and stock report, styled only with --wa-* tokens", () => {
    const def = catStoreDemoSkill.definition;
    const branchB = def.slice(def.indexOf("BRANCH B — Full-Page Capability Demo"));
    const step8 = branchB.slice(branchB.indexOf("Step 8"), branchB.indexOf("Step 9"));
    expect(step8).toContain("render_agent_ui");
    expect(step8).toContain("Cat Store Executive Order &amp; Stock Report");
    expect(step8).toContain("var(--wa-text-color)");
    expect(step8).toContain("var(--wa-background-color)");
    expect(step8).toContain("var(--wa-action-color-info)");
    expect(step8).toContain("var(--wa-action-color-success)");
    expect(step8).toContain("var(--wa-action-color-error)");
    // Task 008 was rejected for advertising tokens that render as nothing —
    // guard against that regressing here too.
    expect(step8).not.toContain("--wa-primary");
    expect(step8).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(step8).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/);
  });

  it("Branch B Step 8's report reads real orders/products data, not a form", () => {
    const def = catStoreDemoSkill.definition;
    const branchB = def.slice(def.indexOf("BRANCH B — Full-Page Capability Demo"));
    const step8 = branchB.slice(branchB.indexOf("Step 8"), branchB.indexOf("Step 9"));
    // The real seeded product catalog (seed.ts): p07 Crinkle Ball Set is the
    // only out-of-stock item among the four rows shown.
    expect(step8).toContain("Crinkle Ball Set");
    expect(step8).toContain("[In Stock]");
    expect(step8).toContain("[Out of Stock]");
    expect(step8).not.toContain('type: "form"');
    expect(step8).not.toContain("fields:");
  });

  it("Branch B Step 8 declares @media print rules for the report", () => {
    const def = catStoreDemoSkill.definition;
    const branchB = def.slice(def.indexOf("BRANCH B — Full-Page Capability Demo"));
    const step8 = branchB.slice(branchB.indexOf("Step 8"), branchB.indexOf("Step 9"));
    expect(step8).toContain("@media print");
  });

  it("render_agent_ui appears in Branch B's closing summary but not Branch A's", () => {
    const def = catStoreDemoSkill.definition;
    const branchA = def.slice(
      def.indexOf("BRANCH A — Storefront Guided Tour"),
      def.indexOf("BRANCH B — Full-Page Capability Demo"),
    );
    const branchB = def.slice(def.indexOf("BRANCH B — Full-Page Capability Demo"));

    const step9A = branchA.slice(branchA.indexOf("Step 9"));
    expect(step9A).not.toContain("render_agent_ui");

    const step10B = branchB.slice(branchB.indexOf("Step 10"));
    expect(step10B).toContain("render_agent_ui");
  });

  it("Branch A has no render_agent_ui call anywhere", () => {
    const def = catStoreDemoSkill.definition;
    const branchA = def.slice(
      def.indexOf("BRANCH A — Storefront Guided Tour"),
      def.indexOf("BRANCH B — Full-Page Capability Demo"),
    );
    expect(branchA).not.toContain("render_agent_ui");
  });

  it("the preamble states Branch A pauses at Step 8's form and Branch B pauses at Step 9's form", () => {
    const preamble = catStoreDemoSkill.definition.slice(
      0,
      catStoreDemoSkill.definition.indexOf("BRANCH A"),
    );
    expect(preamble).toContain("Steps 1-8 run back-to-back in ONE turn (pausing only at Step 8's form)");
    expect(preamble).toContain("Steps 1-9 run back-to-back in ONE turn (pausing only at Step 9's form)");
  });
});

