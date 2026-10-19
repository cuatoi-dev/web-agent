import { describe, it, expect } from "vitest";
import { mountTabs } from "./options-tabs";

function setupTabsFixture() {
  document.body.innerHTML = `
    <div class="tabs" role="tablist">
      <button type="button" class="tab" role="tab" id="tab-0" aria-controls="p-0">Models</button>
      <button type="button" class="tab" role="tab" id="tab-1" aria-controls="p-1">Skills</button>
    </div>
    <section role="tabpanel" id="p-0" aria-labelledby="tab-0">Models Content</section>
    <section role="tabpanel" id="p-1" aria-labelledby="tab-1">Skills Content</section>
  `;
  const tabs = [
    document.getElementById("tab-0") as HTMLButtonElement,
    document.getElementById("tab-1") as HTMLButtonElement,
  ];
  const panels = [
    document.getElementById("p-0") as HTMLElement,
    document.getElementById("p-1") as HTMLElement,
  ];
  return { tabs, panels };
}

function setupFourTabsFixture() {
  document.body.innerHTML = `
    <div class="tabs" role="tablist">
      <button type="button" class="tab" role="tab" id="tab-g" aria-controls="p-g">General</button>
      <button type="button" class="tab" role="tab" id="tab-m" aria-controls="p-m">Models</button>
      <button type="button" class="tab" role="tab" id="tab-s" aria-controls="p-s">Skills</button>
      <button type="button" class="tab" role="tab" id="tab-a" aria-controls="p-a">Agents</button>
    </div>
    <section role="tabpanel" id="p-g" aria-labelledby="tab-g">General Content</section>
    <section role="tabpanel" id="p-m" aria-labelledby="tab-m">Models Content</section>
    <section role="tabpanel" id="p-s" aria-labelledby="tab-s">Skills Content</section>
    <section role="tabpanel" id="p-a" aria-labelledby="tab-a">Agents Content</section>
  `;
  const ids = ["g", "m", "s", "a"];
  const tabs = ids.map((id) => document.getElementById(`tab-${id}`) as HTMLButtonElement);
  const panels = ids.map((id) => document.getElementById(`p-${id}`) as HTMLElement);
  return { tabs, panels };
}

/** Asserts that exactly `index` is selected: aria-selected, tabindex and
 *  panel visibility. */
function expectSelected(tabs: HTMLButtonElement[], panels: HTMLElement[], index: number): void {
  tabs.forEach((tab, j) => {
    expect(tab.getAttribute("aria-selected")).toBe(j === index ? "true" : "false");
    expect(tab.tabIndex).toBe(j === index ? 0 : -1);
    expect(panels[j].hidden).toBe(j !== index);
  });
}

/** `expectSelected` plus the focus move a keyboard navigation performs. */
function expectActive(tabs: HTMLButtonElement[], panels: HTMLElement[], index: number): void {
  expectSelected(tabs, panels, index);
  expect(document.activeElement).toBe(tabs[index]);
}

describe("options-tabs mountTabs", () => {
  it("initializes tab 0 as selected and panel 0 as visible; panel 1 hidden", () => {
    const { tabs, panels } = setupTabsFixture();
    mountTabs(tabs, panels);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].tabIndex).toBe(0);
    expect(panels[0].hidden).toBe(false);

    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
    expect(tabs[1].tabIndex).toBe(-1);
    expect(panels[1].hidden).toBe(true);
  });

  it("click switches selected tab and visible panel", () => {
    const { tabs, panels } = setupTabsFixture();
    mountTabs(tabs, panels);
    tabs[1].dispatchEvent(new MouseEvent("click"));

    expect(tabs[0].getAttribute("aria-selected")).toBe("false");
    expect(tabs[0].tabIndex).toBe(-1);
    expect(panels[0].hidden).toBe(true);

    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].tabIndex).toBe(0);
    expect(panels[1].hidden).toBe(false);
  });

  it("ArrowRight advances tab and wraps around", () => {
    const { tabs, panels } = setupTabsFixture();
    mountTabs(tabs, panels);

    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }));
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(panels[1].hidden).toBe(false);

    tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }));
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(panels[0].hidden).toBe(false);
  });

  it("ArrowLeft navigates backward and wraps around", () => {
    const { tabs, panels } = setupTabsFixture();
    mountTabs(tabs, panels);

    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }));
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(panels[1].hidden).toBe(false);

    tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }));
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(panels[0].hidden).toBe(false);
  });

  it("Home selects tab 0 and End selects last tab", () => {
    const { tabs, panels } = setupTabsFixture();
    mountTabs(tabs, panels);

    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", cancelable: true }));
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");

    tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", cancelable: true }));
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  it("other keys are ignored and do not change selected tab", () => {
    const { tabs, panels } = setupTabsFixture();
    mountTabs(tabs, panels);

    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Space", cancelable: true }));
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(panels[0].hidden).toBe(false);
  });
});

describe("options-tabs with four tabs", () => {
  it("opens on the first tab (General)", () => {
    const { tabs, panels } = setupFourTabsFixture();
    mountTabs(tabs, panels);
    expectSelected(tabs, panels, 0);
    expect(tabs.map((t) => t.textContent)).toEqual(["General", "Models", "Skills", "Agents"]);
  });

  it("click selects a tab and shows only its panel", () => {
    const { tabs, panels } = setupFourTabsFixture();
    mountTabs(tabs, panels);
    tabs[1].dispatchEvent(new MouseEvent("click"));
    expect(panels[0].hidden).toBe(true);
    expect(panels[1].hidden).toBe(false);
    expect(panels[2].hidden).toBe(true);
    expect(panels[3].hidden).toBe(true);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].tabIndex).toBe(0);
  });

  it("ArrowRight walks Models, Skills, Agents, then wraps to General", () => {
    const { tabs, panels } = setupFourTabsFixture();
    mountTabs(tabs, panels);
    tabs[1].dispatchEvent(new MouseEvent("click"));

    const expectedOrder = [2, 3, 0];
    let current = 1;
    for (const expected of expectedOrder) {
      tabs[current].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }));
      expectActive(tabs, panels, expected);
      current = expected;
    }
  });

  it("ArrowLeft from General wraps to Agents, Home goes to General, End to Agents", () => {
    const { tabs, panels } = setupFourTabsFixture();
    mountTabs(tabs, panels);

    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }));
    expectActive(tabs, panels, 3);

    tabs[3].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", cancelable: true }));
    expectActive(tabs, panels, 0);

    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", cancelable: true }));
    expectActive(tabs, panels, 3);
  });
});
