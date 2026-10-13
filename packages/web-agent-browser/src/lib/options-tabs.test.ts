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
