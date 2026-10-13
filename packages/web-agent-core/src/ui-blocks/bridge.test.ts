import { describe, it, expect } from "vitest";
import { buttonToMessage, formSubmitToMessage, isInteractive } from "./bridge.js";

describe("UI Blocks Bridge", () => {
  it("formats button clicks correctly", () => {
    expect(buttonToMessage("Show X")).toBe("[ui_action:button] Show X");
  });

  it("formats form submissions correctly", () => {
    const values = { a: 1, name: "test" };
    const formatted = formSubmitToMessage("f1", values);
    expect(formatted).toBe(`[ui_action:form_submit id=f1]\n{\n  "a": 1,\n  "name": "test"\n}`);
  });

  it("evaluates block interactivity correctly based on running status and latest index", () => {
    // When running is true, all blocks must be disabled.
    expect(isInteractive(0, 0, true)).toBe(false);
    expect(isInteractive(1, 1, true)).toBe(false);

    // When running is false, only the latest block is interactive.
    expect(isInteractive(0, 0, false)).toBe(true);
    expect(isInteractive(0, 1, false)).toBe(false);
    expect(isInteractive(1, 1, false)).toBe(true);
    expect(isInteractive(1, 2, false)).toBe(false);
  });
});
