import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentScheduleClock, scheduleSummary } from "../../src/chat-ui/schedule-clock.js";

if (!customElements.get("agent-schedule-clock")) {
  customElements.define("agent-schedule-clock", AgentScheduleClock);
}

describe("scheduleSummary", () => {
  it("both kinds, plural", () => {
    expect(scheduleSummary(3, 1)).toBe(
      "3 schedules, 1 reminder. Use /schedule-list to see or cancel them."
    );
  });

  it("both kinds, singular", () => {
    expect(scheduleSummary(1, 1)).toBe(
      "1 schedule, 1 reminder. Use /schedule-list to see or cancel them."
    );
  });

  it("schedules only", () => {
    expect(scheduleSummary(2, 0)).toBe("2 schedules. Use /schedule-list to see or cancel them.");
    expect(scheduleSummary(2, 0)).not.toContain("reminder");
  });

  it("reminders only", () => {
    expect(scheduleSummary(0, 1)).toBe("1 reminder. Use /schedule-list to see or cancel them.");
    expect(scheduleSummary(0, 1)).not.toContain("0 schedules");
  });
});

describe("AgentScheduleClock", () => {
  let element: AgentScheduleClock;

  beforeEach(() => {
    element = document.createElement("agent-schedule-clock");
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  it("renders its own <style> when it has no panel ancestor", async () => {
    await element.updateComplete;
    expect(element.querySelector("style")).not.toBeNull();
  });

  it("badge shows the total", async () => {
    element.schedules = 3;
    element.reminders = 1;
    await element.updateComplete;
    expect(element.querySelector(".clock-badge")!.textContent.trim()).toBe("4");
  });

  it("tooltip and label agree", async () => {
    element.schedules = 3;
    element.reminders = 1;
    await element.updateComplete;
    const wrapper = element.querySelector(".clock-wrapper")!;
    const expected = scheduleSummary(3, 1);
    expect(wrapper.getAttribute("title")).toBe(expected);
    expect(wrapper.getAttribute("aria-label")).toBe(expected);
    expect(wrapper.getAttribute("title")).toBe(wrapper.getAttribute("aria-label"));
  });

  it("is not a control", async () => {
    await element.updateComplete;
    const wrapper = element.querySelector(".clock-wrapper")!;
    expect(wrapper.hasAttribute("tabindex")).toBe(false);
    expect(wrapper.getAttribute("role")).toBe("img");
    const svg = element.querySelector(".clock-svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("setting a property re-renders", async () => {
    element.schedules = 1;
    await element.updateComplete;
    expect(element.querySelector(".clock-badge")!.textContent.trim()).toBe("1");

    element.schedules = 5;
    await element.updateComplete;
    expect(element.querySelector(".clock-badge")!.textContent.trim()).toBe("5");
  });
});
