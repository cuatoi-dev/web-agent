import { describe, it, expect, vi } from "vitest";
import { toolStepPhrase } from "./tool-phrases.js";
import type { AuditEntry } from "@cuatoi/web-agent-core";
import type { ToolPhraseDef } from "./types.js";

function entry(name: string, input: Record<string, unknown>, outcomeSummary: string): AuditEntry {
  return { name, input, outcomeSummary, ts: Date.now() };
}

describe("toolStepPhrase", () => {
  // click cases
  it("click: success with labeled element", () => {
    const e = entry("click", { ref: "7" }, 'Clicked [7] button "Add to Cart". Page may have changed; snapshot again if you need to verify.');
    expect(toolStepPhrase(e)).toBe('Agent clicked the button "Add to Cart"');
  });

  it("click: success with unnamed element (no name in label)", () => {
    const e = entry("click", { ref: "3" }, "Clicked [3] link. Page may have changed; snapshot again if you need to verify.");
    expect(toolStepPhrase(e)).toBe("Agent clicked the link");
  });

  it("click: blocked/declined outcome", () => {
    const e = entry("click", { ref: "5" }, "Blocked by interaction policy for element [5].");
    expect(toolStepPhrase(e)).toBe("Agent tried to click an element");
  });

  // fill cases
  it("fill: success interpolates value + target", () => {
    const e = entry("fill", { ref: "2", value: "hi@example.com" }, 'Filled [2] textbox "Email" → hi@example.com.');
    expect(toolStepPhrase(e)).toBe('Agent entered "hi@example.com" into the textbox "Email"');
  });

  it("fill: readback-mismatch success variant still starts with 'Filled ['", () => {
    const e = entry("fill", { ref: "2", value: "x" }, 'Filled [2] textbox "Email" → x. Note: value read back as y.');
    expect(toolStepPhrase(e)).toBe('Agent entered "x" into the textbox "Email"');
  });

  it("fill: not-confirmed outcome", () => {
    const e = entry("fill", { ref: "1", value: "x" }, 'Action "fill" on [1] was not confirmed by the user.');
    expect(toolStepPhrase(e)).toBe('Agent tried to enter "x"');
  });

  // select_option cases
  it("select_option: success reads option from input", () => {
    const e = entry("select_option", { ref: "9", option: "Blue" }, 'Selected "Blue" in [9] combobox "Color".');
    expect(toolStepPhrase(e)).toBe('Agent selected "Blue"');
  });

  it("select_option: failure (no matching option)", () => {
    const e = entry("select_option", { ref: "9", option: "Blue" }, 'No option "Blue". Available: Red, Green.');
    expect(toolStepPhrase(e)).toBe('Agent tried to select "Blue"');
  });

  // see cases
  it("see: whole-page screenshot, no ref", () => {
    const e = entry(
      "see",
      {},
      "Screenshot captured. A screenshot has been added as a user image message for visual analysis.",
    );
    expect(toolStepPhrase(e)).toBe("Agent took a screenshot of the page");
  });

  it("see: element-scoped screenshot, ref present", () => {
    const e = entry(
      "see",
      { ref: "4" },
      "Screenshot captured. A screenshot has been added as a user image message for visual analysis.",
    );
    expect(toolStepPhrase(e)).toBe("Agent took a screenshot of part of the page");
  });

  it("see: failure (stale/detached ref)", () => {
    const e = entry("see", { ref: "4" }, "Ref 4 is stale or detached.");
    expect(toolStepPhrase(e)).toBe("Agent tried to take a screenshot");
  });

  // fallback
  it("unknown/custom tool uses default fallback", () => {
    const e = entry("add_to_cart", {}, "Added to cart.");
    expect(toolStepPhrase(e)).toBe("Agent used the tool add_to_cart");
  });

  // agentShortName
  it("agentShortName substitutes for generic 'Agent'", () => {
    const e = entry("click", { ref: "7" }, 'Clicked [7] button "Add to Cart". Page may have changed; snapshot again if you need to verify.');
    expect(toolStepPhrase(e, "Whiskers")).toBe('Whiskers clicked the button "Add to Cart"');
  });

  it("blank/whitespace-only agentShortName falls back to generic 'Agent'", () => {
    const e = entry("click", { ref: "7" }, 'Clicked [7] button "Add to Cart". Page may have changed; snapshot again if you need to verify.');
    expect(toolStepPhrase(e, "   ")).toBe('Agent clicked the button "Add to Cart"');
  });

  // in-progress cases (empty outcomeSummary = unresolved, not failed)
  it("click: in progress (empty outcomeSummary) uses neutral phrase, not 'tried to'", () => {
    const e = entry("click", { ref: "7" }, "");
    const phrase = toolStepPhrase(e);
    expect(phrase).toBe("Agent is clicking…");
    expect(phrase).not.toContain("tried to");
  });

  it("fill: in progress (empty outcomeSummary) uses neutral phrase, not 'tried to'", () => {
    const e = entry("fill", { ref: "2", value: "hi@example.com" }, "");
    const phrase = toolStepPhrase(e);
    expect(phrase).toBe("Agent is typing…");
    expect(phrase).not.toContain("tried to");
  });

  it("select_option: in progress (empty outcomeSummary) uses neutral phrase, not 'tried to'", () => {
    const e = entry("select_option", { ref: "9", option: "Blue" }, "");
    const phrase = toolStepPhrase(e);
    expect(phrase).toBe("Agent is selecting an option…");
    expect(phrase).not.toContain("tried to");
  });

  it("see: in progress (empty outcomeSummary) uses neutral phrase, not 'tried to'", () => {
    const e = entry("see", {}, "");
    const phrase = toolStepPhrase(e);
    expect(phrase).toBe("Agent is taking a screenshot…");
    expect(phrase).not.toContain("tried to");
  });

  it("custom tool: in progress (empty outcomeSummary) uses generic neutral phrase", () => {
    const e = entry("add_to_cart", {}, "");
    const phrase = toolStepPhrase(e);
    expect(phrase).toBe("Agent is using add_to_cart…");
    expect(phrase).not.toContain("tried to");
  });

  // Friendly phrases for the 9 previously-uncovered core/library tools
  it("snapshot_page: completed", () =>
    expect(toolStepPhrase(entry("snapshot_page", {}, "Snapshot: 12 nodes."))).toBe("Agent looked at the page"));
  it("query_state: completed", () =>
    expect(toolStepPhrase(entry("query_state", { path: "$.cart" }, "Cart: 3 items."))).toBe("Agent checked the app's data"));
  it("wait_for: completed", () =>
    expect(toolStepPhrase(entry("wait_for", { condition: "dom_idle" }, "dom_idle met."))).toBe("Agent waited for the page to update"));
  it("list_data_sources: completed", () =>
    expect(toolStepPhrase(entry("list_data_sources", {}, "orders, products, cart."))).toBe("Agent looked at the available data"));
  it("query_data: interpolates source", () =>
    expect(toolStepPhrase(entry("query_data", { source: "orders" }, "5 rows."))).toBe("Agent looked through the orders data"));
  it("query_data: no source → generic", () =>
    expect(toolStepPhrase(entry("query_data", {}, "5 rows."))).toBe("Agent looked through the data"));
  it("show_generative_ui: buttons", () =>
    expect(toolStepPhrase(entry("show_generative_ui", { type: "buttons" }, "Rendered."))).toBe("Agent showed you some options"));
  it("show_generative_ui: form", () =>
    expect(toolStepPhrase(entry("show_generative_ui", { type: "form" }, "Rendered."))).toBe("Agent showed you a form"));
  it("search_skills: interpolates query", () =>
    expect(toolStepPhrase(entry("search_skills", { query: "charts" }, "1 match."))).toBe('Agent searched skills for "charts"'));
  it("search_skills: no query → generic", () =>
    expect(toolStepPhrase(entry("search_skills", {}, "1 match."))).toBe("Agent searched its skills"));
  it("load_skill: interpolates name", () =>
    expect(toolStepPhrase(entry("load_skill", { name: "chart" }, "Loaded."))).toBe("Agent loaded the chart skill"));
  it("load_skill: missing-name failure reads as a failure", () =>
    expect(
      toolStepPhrase(
        entry(
          "load_skill",
          {},
          'load_skill was called without a skill name. The "name" argument is required. Call load_skill again with {"name": "<exact skill name>"}, or call search_skills first to list the names.',
        ),
      ),
    ).toBe("Agent could not load a skill — no skill name was given"));
  it("load_skill: not-found failure names the skill", () =>
    expect(
      toolStepPhrase(
        entry(
          "load_skill",
          { name: "nope" },
          'Skill "nope" not found. Use search_skills to discover available skills.',
        ),
      ),
    ).toBe("Agent could not load the nope skill — there is no such skill"));
  it("load_skill: not-found failure with no name in the input", () =>
    expect(
      toolStepPhrase(
        entry(
          "load_skill",
          {},
          'Skill "" not found. Use search_skills to discover available skills.',
        ),
      ),
    ).toBe("Agent could not load a skill — there is no such skill"));
  it("show_chart: interpolates title", () =>
    expect(toolStepPhrase(entry("show_chart", { title: "Revenue" }, "Rendered."))).toBe("Agent drew a chart: Revenue"));
  it("show_chart: no title → generic", () =>
    expect(toolStepPhrase(entry("show_chart", {}, "Rendered."))).toBe("Agent drew a chart"));

  it("wait: completed with seconds", () =>
    expect(toolStepPhrase(entry("wait", { seconds: 5 }, "Waited 5s."))).toBe("Agent waited 5s"));

  it("wait: completed without seconds in input (defensive)", () =>
    expect(toolStepPhrase(entry("wait", {}, "Waited 5s."))).toBe("Agent waited"));

  it("wait: in progress", () =>
    expect(toolStepPhrase(entry("wait", { seconds: 5 }, ""))).toBe("Agent is waiting…"));

  it("search_skills: in-progress phrase (empty outcomeSummary)", () =>
    expect(toolStepPhrase(entry("search_skills", { query: "x" }, ""))).toBe("Agent is searching its skills…"));

  it("load_skill: interpolates short agent name", () =>
    expect(toolStepPhrase(entry("load_skill", { name: "chart" }, "Loaded."), "Whiskers")).toBe("Whiskers loaded the chart skill"));

  it("create_skill: success interpolates name", () =>
    expect(
      toolStepPhrase(entry("create_skill", { name: "order_lookup" }, 'Skill "order_lookup" saved successfully. It is available immediately via load_skill and search_skills.')),
    ).toBe("Agent saved the order_lookup skill"));
  it("create_skill: success, no name in input → generic", () =>
    expect(
      toolStepPhrase(entry("create_skill", {}, 'Skill "order_lookup" saved successfully. It is available immediately via load_skill and search_skills.')),
    ).toBe("Agent saved a skill"));
  it("create_skill: declined outcome reads as 'tried to'", () =>
    expect(
      toolStepPhrase(entry("create_skill", { name: "order_lookup" }, 'Creation of skill "order_lookup" was not confirmed by the user; not saved.')),
    ).toBe("Agent tried to save the order_lookup skill"));
  it("create_skill: validation/save failure reads as 'tried to'", () =>
    expect(
      toolStepPhrase(entry("create_skill", { name: "order_lookup" }, 'Failed to save skill "order_lookup": storage quota exceeded')),
    ).toBe("Agent tried to save the order_lookup skill"));
  it("create_skill: in progress (empty outcomeSummary)", () =>
    expect(toolStepPhrase(entry("create_skill", { name: "order_lookup" }, ""))).toBe("Agent is saving a skill…"));

  it("set_schedule: completed with name and every", () =>
    expect(
      toolStepPhrase(
        entry("set_schedule", { name: "ticker", every: "30s" }, "Scheduled ticker."),
        "Whiskers",
      ),
    ).toBe('Whiskers set the schedule "ticker" to run every 30 seconds'));

  it("set_schedule: completed with every only", () =>
    expect(
      toolStepPhrase(
        entry("set_schedule", { every: "10s" }, "Scheduled."),
        "Whiskers",
      ),
    ).toBe("Whiskers set a schedule of 10 seconds"));

  it("set_schedule: completed with default agent", () =>
    expect(
      toolStepPhrase(
        entry("set_schedule", { every: "10s" }, "Scheduled."),
      ),
    ).toBe("Agent set a schedule of 10 seconds"));

  it("set_schedule: missing input safe fallback", () =>
    expect(
      toolStepPhrase(
        entry("set_schedule", {}, "Scheduled."),
      ),
    ).toBe("Agent set a schedule"));

  it("set_schedule: in progress", () =>
    expect(
      toolStepPhrase(
        entry("set_schedule", { every: "10s" }, ""),
      ),
    ).toBe("Agent is setting a schedule…"));

  it("list_schedules: completed", () =>
    expect(
      toolStepPhrase(
        entry("list_schedules", {}, "Nothing scheduled."),
      ),
    ).toBe("Agent checked what is scheduled"));

  it("list_schedules: in progress", () =>
    expect(
      toolStepPhrase(
        entry("list_schedules", {}, ""),
      ),
    ).toBe("Agent is checking what is scheduled…"));

  it("cancel_schedule: completed with name", () =>
    expect(
      toolStepPhrase(
        entry("cancel_schedule", { name: "ticker" }, "Cancelled ticker."),
      ),
    ).toBe('Agent cancelled the schedule "ticker"'));

  it("cancel_schedule: completed without name", () =>
    expect(
      toolStepPhrase(
        entry("cancel_schedule", {}, "Cancelled."),
      ),
    ).toBe("Agent cancelled a schedule"));

  it("cancel_schedule: in progress", () =>
    expect(
      toolStepPhrase(
        entry("cancel_schedule", {}, ""),
      ),
    ).toBe("Agent is cancelling a schedule…"));

  it("get_time: completed", () =>
    expect(
      toolStepPhrase(
        entry("get_time", {}, "2026-09-05 19:12:12 (Asia/Singapore, system timezone)"),
      ),
    ).toBe("Agent checked the time"));

  it("get_time: completed with an explicit timezone still reads the same", () =>
    expect(
      toolStepPhrase(
        entry("get_time", { timezone: "UTC" }, "2026-09-05 11:12:12 (UTC)"),
        "Whiskers",
      ),
    ).toBe("Whiskers checked the time"));

  it("get_time: in progress", () =>
    expect(
      toolStepPhrase(
        entry("get_time", {}, ""),
      ),
    ).toBe("Agent is checking the time…"));

  // todo_write / todo_read. The outcome strings below are the real
  // ones: a committed plan is todo.ts renderList() output, and the rejections
  // are verbatim from todo.ts and todo-tools.ts.
  const PLAN_RENDER = "1. [ ] Pick a bed  (id: t1)\n2. [ ] Check the price  (id: t2)\n3. [ ] Add it to the cart  (id: t3)";

  it("todo_write: a committed plan of 3 items counts the steps", () =>
    expect(
      toolStepPhrase(
        entry("todo_write", { items: [{ text: "Pick a bed" }, { text: "Check the price" }, { text: "Add it to the cart" }] }, PLAN_RENDER),
        "Whiskers",
      ),
    ).toBe("Whiskers set a 3-step plan"));

  it("todo_write: a one-item plan still counts the steps", () =>
    expect(
      toolStepPhrase(
        entry("todo_write", { items: [{ text: "Pick a bed" }] }, "1. [ ] Pick a bed  (id: t1)"),
        "Whiskers",
      ),
    ).toBe("Whiskers set a 1-step plan"));

  // An empty `items` array reaches this builder only when the summary is a
  // committed-plan render — the store returns "" for an empty plan, and
  // toolStepPhrase routes an empty summary to the in-progress phrase before
  // any builder runs (a known limitation the plan records). The entry below is
  // therefore synthetic on purpose: it pins the builder's own branch, which is
  // the phrase-builder layer.
  it("todo_write: an empty items array reads as cleared", () =>
    expect(
      toolStepPhrase(entry("todo_write", { items: [] }, PLAN_RENDER), "Whiskers"),
    ).toBe("Whiskers cleared its plan"));

  it("todo_write: an updates payload stays generic", () =>
    expect(
      toolStepPhrase(
        entry("todo_write", { updates: [{ id: "t1", status: "done" }] }, "1. [x] Pick a bed  (id: t1)"),
        "Whiskers",
      ),
    ).toBe("Whiskers updated its plan"));

  it("todo_write: a rejected write reads as an attempt", () =>
    expect(
      toolStepPhrase(
        entry("todo_write", { items: [{ text: "a" }], updates: [{ id: "t1" }] }, "Send either items or updates, not both."),
        "Whiskers",
      ),
    ).toBe("Whiskers tried to update its plan"));

  it("todo_write: an unknown-id rejection also reads as an attempt", () =>
    expect(
      toolStepPhrase(
        entry("todo_write", { updates: [{ id: "t9" }] }, "No todo with id t9. Call todo_read for the current ids."),
        "Whiskers",
      ),
    ).toBe("Whiskers tried to update its plan"));

  it("todo_write: malformed input that still committed reads as updated", () =>
    expect(
      toolStepPhrase(entry("todo_write", {}, PLAN_RENDER), "Whiskers"),
    ).toBe("Whiskers updated its plan"));

  it("todo_read: a rendered list reads as checked", () =>
    expect(
      toolStepPhrase(entry("todo_read", {}, PLAN_RENDER), "Whiskers"),
    ).toBe("Whiskers checked its plan"));

  it("todo_read: an empty list still reads as checked", () =>
    expect(
      toolStepPhrase(entry("todo_read", {}, "No todos."), "Whiskers"),
    ).toBe("Whiskers checked its plan"));

  it("todo_read: todo turned off reads as an attempt", () =>
    expect(
      toolStepPhrase(entry("todo_read", {}, "Todo tracking is turned off in this app."), "Whiskers"),
    ).toBe("Whiskers tried to check its plan"));

  it("todo_write: in progress", () =>
    expect(
      toolStepPhrase(entry("todo_write", { items: [{ text: "Pick a bed" }] }, ""), "Whiskers"),
    ).toBe("Whiskers is updating its plan…"));

  it("todo_read: in progress", () =>
    expect(
      toolStepPhrase(entry("todo_read", {}, ""), "Whiskers"),
    ).toBe("Whiskers is checking its plan…"));

  it("a tool with no entry in either map still falls back to 'used the tool'", () => {
    expect(toolStepPhrase(entry("open_tab", { url: "https://example.com" }, "Opened tab."), "Whiskers"))
      .toBe("Whiskers used the tool open_tab");
    expect(toolStepPhrase(entry("open_tab", {}, ""), "Whiskers"))
      .toBe("Whiskers is using open_tab…");
  });

  it("guard: no built-in/library demo tool falls through to the generic 'used the tool' fallback", () => {
    // Enumerated demo tool set that MUST have a friendly phrase (renderer-backed
    // host tools add_to_cart/search_docs are covered separately by message-view).
    const BUILTIN_DEMO_TOOLS = [
      "snapshot_page", "query_state", "click", "fill", "select_option",
      "wait_for", "wait", "see", "list_data_sources", "query_data",
      "show_generative_ui", "search_skills", "load_skill", "show_chart",
      "create_skill", "set_schedule", "list_schedules", "cancel_schedule",
      "get_time", "todo_write", "todo_read",
    ];
    for (const name of BUILTIN_DEMO_TOOLS) {
      const phrase = toolStepPhrase(entry(name, {}, "done."));
      expect(phrase, `${name} must have a friendly phrase`).not.toContain("used the tool");
    }
  });
});

describe("toolStepPhrase with a tool's own phrase", () => {
  it("a tool's own phrase renders", () => {
    const map = new Map<string, ToolPhraseDef>([
      ["acme_x", { phrase: (s, a) => `${a} did ${String(s.input.a)}` }],
    ]);
    expect(toolStepPhrase(entry("acme_x", { a: 1 }, "done."), "tesagent", map)).toBe("tesagent did 1");
  });

  it("a tool's own inProgressPhrase renders", () => {
    const map = new Map<string, ToolPhraseDef>([
      ["acme_x", { inProgressPhrase: (a) => `${a} is doing…` }],
    ]);
    expect(toolStepPhrase(entry("acme_x", { a: 1 }, ""), "tesagent", map)).toBe("tesagent is doing…");
  });

  it("a tool's phrase beats PHRASE_BUILDERS", () => {
    const map = new Map<string, ToolPhraseDef>([["click", { phrase: () => "X" }]]);
    const e = entry("click", { ref: "2" }, 'Clicked [2] button "Apply".');
    expect(toolStepPhrase(e, "tesagent", map)).toBe("X");
  });

  it("a tool's inProgressPhrase beats IN_PROGRESS_PHRASES", () => {
    const map = new Map<string, ToolPhraseDef>([["click", { inProgressPhrase: () => "Y" }]]);
    expect(toolStepPhrase(entry("click", {}, ""), "tesagent", map)).toBe("Y");
  });

  it("no map falls back exactly as today", () => {
    const e = entry("click", {}, 'Clicked [2] button "Apply".');
    expect(toolStepPhrase(e, "tesagent")).toBe('tesagent clicked the button "Apply"');
  });

  it("a map without this tool falls back", () => {
    const map = new Map<string, ToolPhraseDef>([["other", { phrase: () => "unused" }]]);
    const e = entry("click", {}, 'Clicked [2] button "Apply".');
    expect(toolStepPhrase(e, "tesagent", map)).toBe('tesagent clicked the button "Apply"');
  });

  it("a map without this tool falls to used-the-tool", () => {
    const map = new Map<string, ToolPhraseDef>([["other", { phrase: () => "unused" }]]);
    expect(toolStepPhrase(entry("acme_x", {}, "done."), "tesagent", map)).toBe("tesagent used the tool acme_x");
  });

  it("a phrase that throws logs and falls back", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const map = new Map<string, ToolPhraseDef>([
      ["click", { phrase: () => { throw new Error("boom"); } }],
    ]);
    const e = entry("click", {}, 'Clicked [2] button "Apply".');
    expect(toolStepPhrase(e, "tesagent", map)).toBe('tesagent clicked the button "Apply"');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("an inProgressPhrase that throws logs and falls back", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const map = new Map<string, ToolPhraseDef>([
      ["click", { inProgressPhrase: () => { throw new Error("boom"); } }],
    ]);
    expect(toolStepPhrase(entry("click", {}, ""), "tesagent", map)).toBe("tesagent is clicking…");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("the phrase receives an object input even when the audit input is null", () => {
    let sawObject = false;
    const map = new Map<string, ToolPhraseDef>([
      ["acme_x", {
        phrase: (s) => {
          sawObject = typeof s.input === "object" && s.input !== null;
          return "ok";
        },
      }],
    ]);
    const e: AuditEntry = { name: "acme_x", input: null, outcomeSummary: "done.", ts: Date.now() };
    expect(() => toolStepPhrase(e, "tesagent", map)).not.toThrow();
    expect(sawObject).toBe(true);
  });

  it("the phrase receives the outcomeSummary verbatim", () => {
    const map = new Map<string, ToolPhraseDef>([
      ["acme_x", { phrase: (s) => s.outcomeSummary }],
    ]);
    expect(toolStepPhrase(entry("acme_x", {}, "the exact summary"), "tesagent", map)).toBe("the exact summary");
  });

  it("the phrase receives failed boolean reflecting entry.failed", () => {
    let sawFailed: boolean | undefined;
    const map = new Map<string, ToolPhraseDef>([
      ["acme_x", {
        phrase: (s) => {
          sawFailed = s.failed;
          return s.failed ? "failed" : "success";
        },
      }],
    ]);

    const failEntry: AuditEntry = { name: "acme_x", input: {}, outcomeSummary: "err", failed: true, ts: Date.now() };
    expect(toolStepPhrase(failEntry, "tesagent", map)).toBe("failed");
    expect(sawFailed).toBe(true);

    const successEntry: AuditEntry = { name: "acme_x", input: {}, outcomeSummary: "ok", failed: false, ts: Date.now() };
    expect(toolStepPhrase(successEntry, "tesagent", map)).toBe("success");
    expect(sawFailed).toBe(false);
  });
});

// A saved result appends its path to whatever phrase was chosen.
describe("toolStepPhrase saved-output suffix", () => {
  const saved = (path: string) => `<saved-output path="${path}" chars="48210">\nOutput too large…`;

  it("appends the path after a built-in phrase", () => {
    expect(toolStepPhrase(entry("get_time", {}, saved("/tmp/tool-results/a.txt")))).toBe(
      "Agent checked the time — full output saved to /tmp/tool-results/a.txt",
    );
  });

  it("appends the path after a host phrase", () => {
    const map = new Map<string, ToolPhraseDef>([["acme_x", { phrase: () => "did it" }]]);
    expect(toolStepPhrase(entry("acme_x", {}, saved("/tmp/tool-results/b.json")), "tesagent", map)).toBe(
      "did it — full output saved to /tmp/tool-results/b.json",
    );
  });

  it("appends the path after the generic fallback", () => {
    expect(toolStepPhrase(entry("open_tab", {}, saved("/tmp/tool-results/c.txt")))).toBe(
      "Agent used the tool open_tab — full output saved to /tmp/tool-results/c.txt",
    );
  });

  it("keeps the existing phrase for unsaved, plain, in-progress and pathless results", () => {
    expect(toolStepPhrase(entry("get_time", {}, '<saved-output chars="48210" saved="false">\nOutput too large…'))).toBe(
      "Agent checked the time",
    );
    expect(toolStepPhrase(entry("get_time", {}, "done."))).toBe("Agent checked the time");
    expect(toolStepPhrase(entry("get_time", {}, ""))).toBe("Agent is checking the time…");
    expect(toolStepPhrase(entry("get_time", {}, '<saved-output chars="13000">\nOutput too large…'))).toBe(
      "Agent checked the time",
    );
  });

  it("still falls back and then adds the suffix when a host phrase throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const map = new Map<string, ToolPhraseDef>([
      ["click", { phrase: () => { throw new Error("boom"); } }],
    ]);
    const e = entry("click", {}, saved("/tmp/tool-results/d.txt"));
    expect(toolStepPhrase(e, "tesagent", map)).toBe(
      "tesagent tried to click an element — full output saved to /tmp/tool-results/d.txt",
    );
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("adds the suffix to a failed entry when the result was saved", () => {
    const map = new Map<string, ToolPhraseDef>([
      ["acme_x", { phrase: (s) => (s.failed ? "failed it" : "did it") }],
    ]);
    const e: AuditEntry = { name: "acme_x", input: {}, outcomeSummary: saved("/tmp/tool-results/e.txt"), failed: true, ts: Date.now() };
    expect(toolStepPhrase(e, "tesagent", map)).toBe(
      "failed it — full output saved to /tmp/tool-results/e.txt",
    );
  });
});

describe("toolStepPhrase — a step with images is finished", () => {
  const images = [{ dataUrl: "data:image/png;base64,AAA=", mediaType: "image/png" }];

  it("a tool with images and an empty outcomeSummary uses the finished phrase, not 'is using'", () => {
    const e: AuditEntry = { name: "mcp_render", input: {}, outcomeSummary: "", images, ts: Date.now() };
    expect(toolStepPhrase(e)).toBe("Agent used the tool mcp_render");
    expect(toolStepPhrase(e)).not.toContain("is using");
  });

  it("a builder-backed tool with images and an empty summary still takes the finished branch", () => {
    const e: AuditEntry = { name: "see", input: {}, outcomeSummary: "", images, ts: Date.now() };
    expect(toolStepPhrase(e)).toBe("Agent tried to take a screenshot");
  });

  it("an empty images array does not count as finished", () => {
    const e: AuditEntry = { name: "mcp_render", input: {}, outcomeSummary: "", images: [], ts: Date.now() };
    expect(toolStepPhrase(e)).toContain("is using");
  });
});
