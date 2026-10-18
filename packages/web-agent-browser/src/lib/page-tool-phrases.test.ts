import { describe, it, expect } from "vitest";
import { toolStepPhrase } from "@cuatoi/web-agent-lit/chat-ui/tool-phrases";
import type { AuditEntry, CustomToolDef } from "@cuatoi/web-agent-core";
import { attachPhrases, createHostTracker, isPageFailure, pageToolPhrases } from "./page-tool-phrases";
import { NOT_ACTIVATED } from "./constants";

const AGENT = "tesagent";

function entry(name: string, input: Record<string, unknown>, outcomeSummary: string, failed?: boolean): AuditEntry {
  return { name, input, outcomeSummary, ts: Date.now(), failed };
}

/** Drives the phrase table through the real `toolStepPhrase` lookup, exactly
 *  as the thread does, so this proves the wiring — not just the table. */
function phraseFor(name: string, input: Record<string, unknown>, outcomeSummary: string, failed?: boolean): string {
  const map = new Map(Object.entries(pageToolPhrases((tabId) => (tabId === 5 ? "localhost:10040" : "the page"))));
  const isFailed = failed ?? (isPageFailure(name, outcomeSummary) || outcomeSummary.includes("failed") || outcomeSummary.includes("not confirmed"));
  return toolStepPhrase(entry(name, input, outcomeSummary, isFailed), AGENT, map);
}

function progressFor(name: string): string {
  const map = new Map(Object.entries(pageToolPhrases(() => "the page")));
  return toolStepPhrase(entry(name, {}, ""), AGENT, map);
}

const TOOL_NAMES = [
  "page_snapshot", "page_click", "page_fill_form", "page_select_option",
  "page_verify", "page_generate_locator", "page_network", "page_dialog",
  "start_recording", "stop_recording",
  "start_debugging", "stop_debugging", "page_hover", "page_press_key",
  "page_upload_file", "page_emulate", "page_screenshot",
];

describe("createHostTracker", () => {
  it('hostFor is "the page" before any origin', () => {
    expect(createHostTracker().hostFor(5)).toBe("the page");
  });

  it("hostFor returns the host after onActivatedOrigin", () => {
    const t = createHostTracker();
    t.onActivatedOrigin(5, "http://localhost:10040");
    expect(t.hostFor(5)).toBe("localhost:10040");
  });

  it("hostFor keeps the port", () => {
    const t = createHostTracker();
    t.onActivatedOrigin(5, "http://localhost:10040");
    expect(t.hostFor(5)).not.toBe("localhost");
    expect(t.hostFor(5)).toBe("localhost:10040");
  });

  it('hostFor is "the page" for a different tab', () => {
    const t = createHostTracker();
    t.onActivatedOrigin(5, "http://localhost:10040");
    expect(t.hostFor(6)).toBe("the page");
  });

  it('hostFor is "the page" for an unparsable origin', () => {
    const t = createHostTracker();
    t.onActivatedOrigin(5, "not a url");
    expect(t.hostFor(5)).toBe("the page");
  });

  it('hostFor is "the page" for a non-numeric tabId', () => {
    expect(createHostTracker().hostFor(undefined)).toBe("the page");
  });

  it("a later origin replaces an earlier one", () => {
    const t = createHostTracker();
    t.onActivatedOrigin(5, "http://localhost:10040");
    t.onActivatedOrigin(5, "http://localhost:9999");
    expect(t.hostFor(5)).toBe("localhost:9999");
  });
});

describe("isPageFailure", () => {
  it("the not-on text is a failure", () => {
    expect(isPageFailure("page_snapshot", NOT_ACTIVATED(5, "http://x"))).toBe(true);
  });

  it("this tool's timeout text is a failure", () => {
    expect(isPageFailure("page_snapshot", "page_snapshot timed out after 10000 ms waiting for tab #5.")).toBe(true);
  });

  it("another tool's timeout text is not", () => {
    expect(isPageFailure("page_snapshot", "page_click timed out after 10000 ms waiting for tab #5.")).toBe(false);
  });

  it("the debugger-not-started text is a failure", () => {
    expect(isPageFailure("start_debugging", "Debugging is not started on tab #5. Call start_debugging first.")).toBe(true);
  });

  it("the debugger-cancelled text is a failure", () => {
    expect(
      isPageFailure("start_debugging", "Debugging stopped on tab #5: the user pressed Cancel on Chrome's bar. Call start_debugging to continue."),
    ).toBe(true);
  });

  it("a normal result is not a failure", () => {
    expect(isPageFailure("page_snapshot", "Snapshot: 12 nodes.")).toBe(false);
  });
});

describe("pageToolPhrases — done lines", () => {
  it("page_snapshot", () => {
    expect(phraseFor("page_snapshot", { tabId: 5 }, 'Snapshot of localhost:10040:\n- button "Apply" [2]'))
      .toBe("tesagent read the page outline of localhost:10040");
  });

  it("page_click", () => {
    expect(phraseFor("page_click", {}, 'Clicked [2] button "Apply".'))
      .toBe('tesagent clicked the button "Apply"');
  });

  it("page_fill_form: 1 field", () => {
    expect(phraseFor("page_fill_form", {}, 'Filled 1 field: [3] textbox "Coupon".'))
      .toBe("tesagent filled 1 field");
  });

  it("page_fill_form: 2 fields", () => {
    expect(phraseFor("page_fill_form", {}, "Filled 2 fields: [3] textbox, [4] textbox."))
      .toBe("tesagent filled 2 fields");
  });

  it("page_select_option: one value", () => {
    expect(phraseFor("page_select_option", { values: ["Express"] }, 'Selected "Express" in [5] combobox "Shipping".'))
      .toBe('tesagent selected "Express"');
  });

  it("page_select_option: multiple values", () => {
    expect(phraseFor("page_select_option", { values: ["A", "B"] }, 'Selected "Express" in [5] combobox "Shipping".'))
      .toBe('tesagent selected "A", "B"');
  });

  it("page_verify: text_visible PASS", () => {
    expect(
      phraseFor("page_verify", { kind: "text_visible", text: "Discount: -$4.20" }, 'PASS Text "Discount: -$4.20" is visible.'),
    ).toBe('tesagent checked the text "Discount: -$4.20" — PASS');
  });

  it("page_verify: text_visible FAIL", () => {
    expect(
      phraseFor("page_verify", { kind: "text_visible", text: "Discount: -$4.20" }, 'FAIL Text "Discount: -$4.20" is not visible.'),
    ).toBe('tesagent checked the text "Discount: -$4.20" — FAIL');
  });

  it("page_verify: element_visible with role", () => {
    expect(
      phraseFor("page_verify", { kind: "element_visible", role: "button", name: "Apply" }, "PASS Element is visible."),
    ).toBe('tesagent checked that the button "Apply" is visible — PASS');
  });

  it("page_verify: element_visible with ref only", () => {
    expect(phraseFor("page_verify", { kind: "element_visible", ref: "7" }, "PASS Element is visible."))
      .toBe("tesagent checked that element [7] is visible — PASS");
  });

  it("page_verify: value", () => {
    expect(phraseFor("page_verify", { kind: "value", ref: "3" }, "PASS Value matches."))
      .toBe("tesagent checked the value of element [3] — PASS");
  });

  it("page_verify: list", () => {
    expect(phraseFor("page_verify", { kind: "list", role: "list", name: "Cart" }, "PASS List matches."))
      .toBe('tesagent checked the list the list "Cart" — PASS');
  });

  it("page_generate_locator", () => {
    expect(phraseFor("page_generate_locator", { ref: "2" }, '[2] button "Apply"\n  role+name: button "Apply" (matches 1)'))
      .toBe("tesagent made a locator for element [2]");
  });

  it("page_network: list", () => {
    expect(phraseFor("page_network", {}, "Requests since debugging started (3):\n…"))
      .toBe("tesagent read the network requests");
  });

  it("page_network: index", () => {
    expect(phraseFor("page_network", { index: 3 }, "Method: GET\nURL: …"))
      .toBe("tesagent read request #3");
  });

  it("page_dialog: accept", () => {
    expect(phraseFor("page_dialog", { accept: true }, "The next dialog will be accepted."))
      .toBe("tesagent set the next dialog to be accepted");
  });

  it("page_dialog: dismiss", () => {
    expect(phraseFor("page_dialog", { accept: false }, "The next dialog will be dismissed."))
      .toBe("tesagent set the next dialog to be dismissed");
  });

  it("start_recording", () => {
    expect(
      phraseFor("start_recording", { tabId: 5 }, "Recording on localhost:10040. Steps appear when the user stops or the page navigates."),
    ).toBe("tesagent started recording on localhost:10040");
  });

  it("stop_recording: 1 step", () => {
    expect(phraseFor("stop_recording", {}, "Recorded 1 step on localhost:10040:\n1. [2] click …"))
      .toBe("tesagent stopped recording: 1 step");
  });

  it("stop_recording: 4 steps", () => {
    expect(phraseFor("stop_recording", {}, "Recorded 4 steps on localhost:10040:\n…"))
      .toBe("tesagent stopped recording: 4 steps");
  });

  it("start_debugging: fresh", () => {
    expect(phraseFor("start_debugging", { tabId: 5 }, "Debugging tab #5 (localhost:10040)."))
      .toBe("tesagent started debugging localhost:10040");
  });

  it("start_debugging: already debugging", () => {
    expect(phraseFor("start_debugging", { tabId: 5 }, "Tab #5 is already being debugged."))
      .toBe("tesagent started debugging localhost:10040");
  });

  it("stop_debugging: fresh", () => {
    expect(phraseFor("stop_debugging", { tabId: 5 }, "Stopped debugging tab #5. Emulation was reset."))
      .toBe("tesagent stopped debugging localhost:10040");
  });

  it("stop_debugging: not being debugged", () => {
    expect(phraseFor("stop_debugging", { tabId: 5 }, "Tab #5 is not being debugged."))
      .toBe("tesagent stopped debugging localhost:10040");
  });

  it("page_hover", () => {
    expect(phraseFor("page_hover", {}, 'Hovered [2] button "Apply".'))
      .toBe('tesagent hovered over the button "Apply"');
  });

  it("page_press_key", () => {
    expect(phraseFor("page_press_key", {}, "Pressed Control+Enter."))
      .toBe("tesagent pressed Control+Enter");
  });

  it("page_upload_file: 1 file", () => {
    expect(phraseFor("page_upload_file", {}, "Uploaded 1 file to [14] button: orders.csv."))
      .toBe("tesagent uploaded 1 file");
  });

  it("page_upload_file: 2 files", () => {
    expect(phraseFor("page_upload_file", {}, "Uploaded 2 files to [14] button: a, b."))
      .toBe("tesagent uploaded 2 files");
  });

  it("page_emulate: preset", () => {
    expect(phraseFor("page_emulate", { preset: "iPhone 15" }, "Emulating iPhone 15 (393 × 852, scale 3, mobile, touch)."))
      .toBe("tesagent set the emulation to iPhone 15");
  });

  it("page_emulate: custom", () => {
    expect(phraseFor("page_emulate", { width: 800, height: 600 }, "Emulating a custom device (800 × 600, …)."))
      .toBe("tesagent set the emulation to 800 × 600");
  });

  it("page_emulate: reset", () => {
    expect(phraseFor("page_emulate", { reset: true }, "Emulation was reset."))
      .toBe("tesagent reset the emulation");
  });

  it("page_screenshot: full page", () => {
    expect(phraseFor("page_screenshot", { fullPage: true }, "Full-page screenshot, 1280 × 4200."))
      .toBe("tesagent took a full-page screenshot");
  });

  it("page_screenshot: ref", () => {
    expect(phraseFor("page_screenshot", { ref: "7" }, 'Screenshot of [7] button "Apply", 80 × 32.'))
      .toBe('tesagent took a screenshot of the button "Apply"');
  });

  it("page_screenshot: viewport", () => {
    expect(phraseFor("page_screenshot", {}, "Viewport screenshot, 1280 × 720."))
      .toBe("tesagent took a screenshot");
  });

  it("page_screenshot: zero-size viewport", () => {
    expect(phraseFor("page_screenshot", {}, "Viewport of tab #5 captured."))
      .toBe("tesagent took a screenshot");
  });
});

describe("pageToolPhrases — failed lines", () => {
  it("page_fill_form: input.fields length 3", () => {
    expect(phraseFor("page_fill_form", { fields: [{}, {}, {}] }, NOT_ACTIVATED(5, "http://x")))
      .toBe("tesagent tried to fill in 3 fields");
  });

  it("page_fill_form: input.fields length 1", () => {
    expect(phraseFor("page_fill_form", { fields: [{}] }, NOT_ACTIVATED(5, "http://x")))
      .toBe("tesagent tried to fill in 1 field");
  });

  it("page_fill_form: no input.fields", () => {
    expect(phraseFor("page_fill_form", {}, NOT_ACTIVATED(5, "http://x")))
      .toBe("tesagent tried to fill in 0 fields");
  });

  it("page_fill_form: partial-failure text", () => {
    expect(
      phraseFor("page_fill_form", { fields: [{}, {}, {}] }, "Filled 1 of 3 fields: [2] textbox. Field [3] failed: gone"),
    ).toBe("tesagent tried to fill in 3 fields");
  });

  it("start_recording: not confirmed", () => {
    expect(phraseFor("start_recording", { tabId: 5 }, "Recording on localhost:10040 was not confirmed by the user; not started."))
      .toBe("tesagent tried to start recording");
  });
});

describe.each(TOOL_NAMES)("%s — not-on and timeout failures, in-progress", (name) => {
  const FAILED_LINES: Record<string, string> = {
    page_snapshot: "tesagent tried to read the page outline",
    page_click: "tesagent tried to click an element",
    page_fill_form: "tesagent tried to fill in 0 fields",
    page_select_option: "tesagent tried to select an option",
    page_verify: "tesagent tried to run a check",
    page_generate_locator: "tesagent tried to make a locator",
    page_network: "tesagent tried to read the network requests",
    page_dialog: "tesagent tried to set up a dialog answer",
    start_recording: "tesagent tried to start recording",
    stop_recording: "tesagent tried to stop recording",
    start_debugging: "tesagent tried to start debugging",
    stop_debugging: "tesagent tried to stop debugging",
    page_hover: "tesagent tried to hover over an element",
    page_press_key: "tesagent tried to press a key",
    page_upload_file: "tesagent tried to upload a file",
    page_emulate: "tesagent tried to change the emulation",
    page_screenshot: "tesagent tried to take a screenshot",
  };

  const IN_PROGRESS_LINES: Record<string, string> = {
    page_snapshot: "tesagent is reading the page outline…",
    page_click: "tesagent is clicking…",
    page_fill_form: "tesagent is filling in fields…",
    page_select_option: "tesagent is selecting an option…",
    page_verify: "tesagent is running a check…",
    page_generate_locator: "tesagent is making a locator…",
    page_network: "tesagent is reading the network requests…",
    page_dialog: "tesagent is setting up a dialog answer…",
    start_recording: "tesagent is starting a recording…",
    stop_recording: "tesagent is stopping the recording…",
    start_debugging: "tesagent is starting to debug…",
    stop_debugging: "tesagent is stopping debugging…",
    page_hover: "tesagent is hovering…",
    page_press_key: "tesagent is pressing a key…",
    page_upload_file: "tesagent is uploading…",
    page_emulate: "tesagent is changing the emulation…",
    page_screenshot: "tesagent is taking a screenshot…",
  };

  it("failed: not-on text", () => {
    expect(phraseFor(name, {}, NOT_ACTIVATED(5, "http://x"))).toBe(FAILED_LINES[name]);
  });

  it("failed: timeout text", () => {
    expect(phraseFor(name, {}, `${name} timed out after 10000 ms waiting for tab #5.`)).toBe(FAILED_LINES[name]);
  });

  it("in progress", () => {
    expect(progressFor(name)).toBe(IN_PROGRESS_LINES[name]);
  });
});

describe("start_debugging / stop_debugging — the debugger gate error", () => {
  it("start_debugging renders the failed line for the gate error", () => {
    expect(phraseFor("start_debugging", {}, "Debugging is not started on tab #5. Call start_debugging first."))
      .toBe("tesagent tried to start debugging");
  });

  it("stop_debugging renders the failed line for the cancelled-debugging error", () => {
    expect(
      phraseFor("stop_debugging", {}, "Debugging stopped on tab #5: the user pressed Cancel on Chrome's bar. Call start_debugging to continue."),
    ).toBe("tesagent tried to stop debugging");
  });
});

it("covers exactly the 18 tools this task names", () => {
  expect(new Set(Object.keys(pageToolPhrases(() => "h")))).toEqual(new Set(TOOL_NAMES));
});

function fakeToolDef(name: string): CustomToolDef {
  return {
    name,
    description: `desc for ${name}`,
    inputSchema: { type: "object" },
    execute: () => Promise.resolve({ content: "ok" }),
    summarize: () => "summary",
  };
}

describe("attachPhrases", () => {
  const hostFor = () => "the page";

  it("a named tool gains both functions", () => {
    const [t] = attachPhrases([fakeToolDef("page_click")], hostFor);
    expect(typeof t.phrase).toBe("function");
    expect(typeof t.inProgressPhrase).toBe("function");
  });

  it("an unnamed tool is returned unchanged", () => {
    const [t] = attachPhrases([fakeToolDef("page_eval")], hostFor);
    expect(t.phrase).toBeUndefined();
    expect(t.inProgressPhrase).toBeUndefined();
  });

  it("the input array is not mutated", () => {
    const original = fakeToolDef("page_click");
    attachPhrases([original], hostFor);
    expect(original.phrase).toBeUndefined();
  });

  it("every other field survives", () => {
    const original = fakeToolDef("page_click");
    const [t] = attachPhrases([original], hostFor);
    expect(t.description).toBe(original.description);
    expect(t.inputSchema).toBe(original.inputSchema);
    expect(t.execute).toBe(original.execute);
    expect(t.summarize).toBe(original.summarize);
  });
});
