import { describe, expect, it } from "vitest";
import { stockMonitorSkill } from "./stock-monitor-skill";

describe("stockMonitorSkill", () => {
  it("prompt specifies out of stock check, interval, repeat, and cancel", () => {
    const definition = stockMonitorSkill.definition;
    expect(definition).toContain("p07");
    expect(definition).toContain("set_schedule");
    expect(definition).toContain("every");
    expect(definition).toContain("10m");
    expect(definition).toContain("repeat");
    expect(definition).toContain("add_to_cart");
    expect(definition).toContain("cancel_schedule");
  });
});
