import { describe, it, expect, beforeEach } from "vitest";
import { mountPageAgentIcon, pageAgentIconText, paintPageAgentIcon } from "./page-agent-icon";
import { toggleView, type TabState } from "./panel-toggle";

const ORIGIN = "http://localhost:10040";
const off: TabState = { tabId: 1, origin: ORIGIN, mounted: false, foreign: false };
const on: TabState = { ...off, mounted: true };
const foreign: TabState = { ...off, foreign: true };

describe("pageAgentIconText", () => {
  it("joins the label and the status for each of the four tab states", () => {
    expect(pageAgentIconText(toggleView(null))).toBe(
      "Turn on the agent in this tab. Open a website in a tab to use this control.",
    );
    expect(pageAgentIconText(toggleView(off))).toBe(
      `Turn on the agent in this tab. The in-page agent is off for ${ORIGIN}.`,
    );
    expect(pageAgentIconText(toggleView(on))).toBe(
      `Turn off the agent in this tab. The in-page agent is on for ${ORIGIN}.`,
    );
    expect(pageAgentIconText(toggleView(foreign))).toBe(
      "Turn on the agent in this tab. This page already has its own agent, so nothing was added.",
    );
  });

  it("never doubles the full stop between the label and the status", () => {
    for (const state of [null, off, on, foreign]) {
      expect(pageAgentIconText(toggleView(state))).not.toContain("..");
    }
  });
});

describe("mountPageAgentIcon", () => {
  let button: HTMLButtonElement;

  beforeEach(() => {
    button = document.createElement("button");
    mountPageAgentIcon(button);
  });

  it("adds one decorative svg glyph with a drawn path and no text", () => {
    const svgs = button.querySelectorAll("svg");
    expect(svgs).toHaveLength(1);
    expect(svgs[0].getAttribute("aria-hidden")).toBe("true");
    expect(svgs[0].querySelector("path")?.getAttribute("d")).toBeTruthy();
    // The registry falls back to <i>ads_click</i> for an unknown icon name.
    expect(button.textContent).toBe("");
  });

  it("adds one decorative dot, hidden until a pressed state is painted", () => {
    const dots = button.querySelectorAll<HTMLElement>(".dot");
    expect(dots).toHaveLength(1);
    expect(dots[0].getAttribute("aria-hidden")).toBe("true");
    expect(dots[0].hidden).toBe(true);
  });
});

describe("paintPageAgentIcon", () => {
  let button: HTMLButtonElement;

  beforeEach(() => {
    button = document.createElement("button");
    mountPageAgentIcon(button);
  });

  const cases: { name: string; state: TabState | null; pressed: boolean; disabled: boolean }[] = [
    { name: "no website in the tab", state: null, pressed: false, disabled: true },
    { name: "agent off for the origin", state: off, pressed: false, disabled: false },
    { name: "agent on for the origin", state: on, pressed: true, disabled: false },
    { name: "page has its own agent", state: foreign, pressed: false, disabled: true },
  ];

  for (const c of cases) {
    it(`${c.name}: label, title, pressed, disabled, slash class and dot`, () => {
      const view = toggleView(c.state);
      paintPageAgentIcon(button, view);
      const text = pageAgentIconText(view);
      expect(button.getAttribute("aria-label")).toBe(text);
      expect(button.title).toBe(text);
      expect(button.getAttribute("aria-pressed")).toBe(String(c.pressed));
      expect(button.disabled).toBe(c.disabled);
      expect(button.classList.contains("on")).toBe(c.pressed);
      expect(button.classList.contains("off")).toBe(!c.pressed);
      expect(button.querySelector<HTMLElement>(".dot")?.hidden).toBe(!c.pressed);
    });
  }

  it("repainting from on to off removes the on class, adds off and hides the dot", () => {
    paintPageAgentIcon(button, toggleView(on));
    paintPageAgentIcon(button, toggleView(off));
    expect(button.classList.contains("on")).toBe(false);
    expect(button.classList.contains("off")).toBe(true);
    expect(button.querySelector<HTMLElement>(".dot")?.hidden).toBe(true);
    expect(button.getAttribute("aria-label")).toBe(pageAgentIconText(toggleView(off)));
  });
});
