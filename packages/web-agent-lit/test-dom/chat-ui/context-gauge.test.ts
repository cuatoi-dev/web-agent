import { describe, it, expect, beforeEach } from "vitest";
import { AgentContextGauge } from "../../src/chat-ui/context-gauge.js";

if (!customElements.get("agent-context-gauge")) {
  customElements.define("agent-context-gauge", AgentContextGauge);
}

describe("AgentContextGauge Component Tests", () => {
  let element: AgentContextGauge;

  beforeEach(() => {
    document.body.innerHTML = "";
    element = document.createElement("agent-context-gauge");
    document.body.appendChild(element);
  });

  it("renders with correct tooltip and formats text", async () => {
    element.percent = 0.42;
    element.tokens = 54200;
    element.max = 128000;
    element.warnAt = 0.75;
    await element.updateComplete;

    const wrapper = element.querySelector(".gauge-wrapper");
    expect(wrapper).toBeTruthy();
    
    const title = wrapper?.getAttribute("title");
    expect(title).toBe("42% · 54,200 / 128,000 tokens");
  });

  it("strokes the gauge from theme gauge tokens", async () => {
    await element.updateComplete;
    const css = element.querySelector("style")!.textContent;
    expect(css).toContain("var(--wa-gauge-green-color, #10b981)");
    expect(css).toContain("var(--wa-gauge-orange-color, #f59e0b)");
    expect(css).toContain("var(--wa-gauge-red-color, #ef4444)");
    expect(css).toContain("var(--wa-text-color-disabled, rgba(255, 255, 255, 0.25))");
    // Every stroke resolves through a --wa-* token, mixed with the
    // theme text colour so it reads on the composer surface in both themes.
    for (const stroke of css.match(/stroke:[^;]+;/g) ?? []) {
      if (stroke.includes("stroke-width") || stroke.includes("stroke-linecap")) continue;
      expect(stroke).toContain("var(--wa-");
    }
    expect(css).not.toMatch(/stroke:\s*(#[0-9a-f]{3,8}|rgb|hsl)\b/);
  });

  it("applies green color below warnAt threshold", async () => {
    element.percent = 0.5;
    element.warnAt = 0.75;
    await element.updateComplete;

    const fgCircle = element.querySelector(".fg-circle");
    expect(fgCircle?.classList.contains("color-green")).toBe(true);
    expect(fgCircle?.classList.contains("color-amber")).toBe(false);
    expect(fgCircle?.classList.contains("color-red")).toBe(false);
  });

  it("applies amber color approaching warnAt threshold", async () => {
    element.percent = 0.65;
    element.warnAt = 0.75; // warnAt - 0.15 is 0.60
    await element.updateComplete;

    const fgCircle = element.querySelector(".fg-circle");
    expect(fgCircle?.classList.contains("color-amber")).toBe(true);
    expect(fgCircle?.classList.contains("color-green")).toBe(false);
    expect(fgCircle?.classList.contains("color-red")).toBe(false);
  });

  it("applies red color at or above warnAt threshold", async () => {
    element.percent = 0.75;
    element.warnAt = 0.75;
    await element.updateComplete;

    const fgCircle = element.querySelector(".fg-circle");
    expect(fgCircle?.classList.contains("color-red")).toBe(true);
    expect(fgCircle?.classList.contains("color-green")).toBe(false);
    expect(fgCircle?.classList.contains("color-amber")).toBe(false);
  });

  it("emits compact-request on click when enabled", async () => {
    element.disabled = false;
    element.percent = 0.5;
    element.tokens = 64000;
    element.max = 128000;
    await element.updateComplete;

    let fired = 0;
    element.addEventListener("compact-request", () => fired++);

    const wrapper = element.querySelector(".gauge-wrapper") as HTMLElement;
    wrapper?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));

    expect(fired).toBe(1);
  });

  it("does not emit when disabled", async () => {
    element.disabled = true;
    element.percent = 0.5;
    element.tokens = 64000;
    element.max = 128000;
    await element.updateComplete;

    let fired = 0;
    element.addEventListener("compact-request", () => fired++);

    const wrapper = element.querySelector(".gauge-wrapper") as HTMLElement;
    wrapper?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));

    expect(fired).toBe(0);
    expect(wrapper?.getAttribute("aria-disabled")).toBe("true");
    expect(wrapper?.getAttribute("tabindex")).toBe("-1");
  });

  it("Enter key emits compact-request when enabled", async () => {
    element.disabled = false;
    element.percent = 0.5;
    element.tokens = 64000;
    element.max = 128000;
    await element.updateComplete;

    let fired = 0;
    element.addEventListener("compact-request", () => fired++);

    const wrapper = element.querySelector(".gauge-wrapper") as HTMLElement;
    wrapper?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(fired).toBe(1);
  });

  it("clickable class toggles with disabled state", async () => {
    element.disabled = false;
    await element.updateComplete;
    const wrapper = element.querySelector(".gauge-wrapper");
    expect(wrapper?.classList.contains("clickable")).toBe(true);
    expect(wrapper?.classList.contains("disabled")).toBe(false);

    element.disabled = true;
    await element.updateComplete;
    expect(wrapper?.classList.contains("clickable")).toBe(false);
    expect(wrapper?.classList.contains("disabled")).toBe(true);
  });

  it("the disabled state applies a dashed track treatment", async () => {
    element.disabled = true;
    await element.updateComplete;
    const css = element.querySelector("style")!.textContent;
    expect(css).toContain(".gauge-wrapper.disabled .bg-circle");
    expect(css).toContain("stroke-dasharray: 2 2");
    expect(css).not.toContain("opacity: 0.45");
  });

  /** `stroke-dashoffset` and `stroke` are non-composited SVG paint properties,
   *  so a transition on them drove an 18-frame main-thread paint loop on an
   *  18 px ring for every usage update. A standalone gauge keeps its own
   *  stylesheet; inside the panel the panel sheet carries it. */
  it("renders its own stylesheet and transitions no SVG paint property", async () => {
    await element.updateComplete;
    const sheet = element.querySelector("style");
    expect(sheet).not.toBeNull();
    const css = sheet!.textContent ?? "";
    const fgRule = css.slice(css.indexOf(".fg-circle"), css.indexOf(".color-green"));
    expect(fgRule).toContain("stroke-width: 3");
    expect(fgRule).not.toContain("transition");
  });

  it("busy adds the spin class to the gauge SVG; the ring and arc stay", async () => {
    element.busy = true;
    await element.updateComplete;

    // The gauge is the same icon, busy or not — no bespoke dot markup, just a
    // CSS-driven rotation of the existing ring+arc.
    const gaugeSvg = element.querySelector(".gauge-svg");
    expect(gaugeSvg?.classList.contains("busy")).toBe(true);
    expect(element.querySelector(".bg-circle")).not.toBeNull();
    expect(element.querySelector(".fg-circle")).not.toBeNull();
    expect(element.querySelector(".busy-dot")).toBeNull();
  });

  it("clearing busy removes the spin class; ring and arc are unaffected", async () => {
    element.busy = true;
    await element.updateComplete;
    element.busy = false;
    await element.updateComplete;

    const gaugeSvg = element.querySelector(".gauge-svg");
    expect(gaugeSvg?.classList.contains("busy")).toBe(false);
    expect(element.querySelector(".bg-circle")).not.toBeNull();
    expect(element.querySelector(".fg-circle")).not.toBeNull();
  });

  it("the busy spin is CSS-driven — no dot markup or per-dot styling", async () => {
    await element.updateComplete;
    const css = element.querySelector("style")!.textContent;
    expect(css).toContain(".gauge-svg.busy");
    expect(css).toContain("agent-gauge-spin");
    expect(css).not.toContain("busy-dot");
  });

  it("a busy gauge with disabled=true does not emit compact-request", async () => {
    element.busy = true;
    element.disabled = true;
    await element.updateComplete;

    let fired = 0;
    element.addEventListener("compact-request", () => fired++);

    const wrapper = element.querySelector(".gauge-wrapper") as HTMLElement;
    wrapper?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));

    expect(fired).toBe(0);
  });

  it("the busy tooltip says compacting", async () => {
    element.busy = true;
    element.percent = 0.5;
    element.tokens = 64000;
    element.max = 128000;
    await element.updateComplete;

    const wrapper = element.querySelector(".gauge-wrapper");
    expect(wrapper?.getAttribute("title")).toMatch(/^Compacting the conversation/);
  });
});
