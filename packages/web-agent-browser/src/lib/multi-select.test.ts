import { describe, expect, it, vi } from "vitest";
import {
  matchesFilter,
  mountMultiSelect,
  pickValue,
  removeName,
} from "./multi-select";
import type { MultiSelectOptions } from "./multi-select.types";

function mount(over: Partial<MultiSelectOptions> = {}) {
  const onChange = vi.fn();
  const ms = mountMultiSelect({
    id: "t",
    label: "Tools",
    groups: [
      { heading: "Tabs", names: ["read_tabs", "open_tab", "navigate_tab"] },
      { heading: "Page", names: ["page_eval", "page_console"] },
      { heading: "Core", names: ["wait", "get_time"] },
    ],
    allOption: { label: "All tools (*)", hint: "includes tools added later" },
    value: "*",
    disabled: false,
    filter: true,
    onChange,
    ...over,
  });
  document.body.textContent = "";
  document.body.append(ms.root);
  const row = (name: string) => ms.root.querySelector<HTMLElement>(`[role="option"][data-name="${name}"]`)!;
  const chips = () => [...ms.box.querySelectorAll<HTMLElement>(".chip")].map((c) => c.dataset.name);
  const key = (target: HTMLElement, k: string) => {
    const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  };
  const pop = () => ms.root.querySelector<HTMLElement>(".ms-pop")!;
  const filter = () => ms.root.querySelector<HTMLInputElement>("#t-filter");
  const list = () => ms.root.querySelector<HTMLElement>("#t-list")!;
  return { ms, onChange, row, chips, key, pop, filter, list };
}

describe("multi-select", () => {
  it("MS1 pickValue", () => {
    expect(pickValue("*", "*")).toEqual([]);
    expect(pickValue([], "*")).toEqual("*");
    expect(pickValue(["a"], "*")).toEqual("*");
    expect(pickValue("*", "read_tabs")).toEqual(["read_tabs"]);
    expect(pickValue(["read_tabs"], "read_tabs")).toEqual([]);
    expect(pickValue(["read_tabs"], "page_eval")).toEqual(["read_tabs", "page_eval"]);
  });

  it("MS2 removeName", () => {
    expect(removeName("*", "*")).toEqual([]);
    expect(removeName(["a", "b"], "a")).toEqual(["b"]);
    expect(removeName(["a"], "zzz")).toEqual(["a"]);
  });

  it("MS3 matchesFilter", () => {
    expect(matchesFilter("read_tabs", "tab")).toBe(true);
    expect(matchesFilter("Read_Tabs", " TAB ")).toBe(true);
    expect(matchesFilter("page_eval", "tab")).toBe(false);
    expect(matchesFilter("x", "")).toBe(true);
    expect(matchesFilter("x", "   ")).toBe(true);
  });

  it("MS4 initial paint", () => {
    const { ms, chips, pop, list } = mount({ value: "*" });
    expect(chips()).toEqual(["*"]);
    const chip = ms.box.querySelector<HTMLElement>(".chip")!;
    expect(chip.textContent).toContain("All tools (*)");
    const x = chip.querySelector<HTMLButtonElement>(".x")!;
    expect(x.getAttribute("aria-label")).toBe("Remove All tools (*)");
    expect(ms.box.getAttribute("role")).toBe("combobox");
    expect(ms.box.getAttribute("aria-expanded")).toBe("false");
    expect(ms.box.getAttribute("aria-controls")).toBe("t-list");
    expect(pop().hidden).toBe(true);
    expect(list().getAttribute("role")).toBe("listbox");
    expect(list().getAttribute("aria-multiselectable")).toBe("true");
    expect(list().querySelector("input")).toBeNull();
  });

  it("MS5 open by click; aria-selected", () => {
    const { ms, pop, list, row } = mount({ value: "*" });
    ms.box.click();
    expect(ms.box.getAttribute("aria-expanded")).toBe("true");
    expect(pop().hidden).toBe(false);
    const options = list().querySelectorAll<HTMLElement>('[role="option"]');
    expect(options.length).toBe(8);
    expect(row("*").getAttribute("aria-selected")).toBe("true");
    expect(row("*").querySelector(".tick")!.classList.contains("on")).toBe(true);

    for (const opt of options) {
      if (opt.dataset.name !== "*") {
        expect(opt.getAttribute("aria-selected")).toBe("false");
        expect(opt.querySelector(".tick")!.classList.contains("on")).toBe(false);
      }
      const isSelected = opt.getAttribute("aria-selected") === "true";
      const hasOn = opt.querySelector(".tick")!.classList.contains("on");
      expect(isSelected).toBe(hasOn);
    }
  });

  it("MS6 pick replaces All", () => {
    const { ms, onChange, row, chips } = mount({ value: "*" });
    ms.open();
    row("read_tabs").click();
    expect(onChange).toHaveBeenLastCalledWith(["read_tabs"]);
    expect(chips()).toEqual(["read_tabs"]);
    expect(row("*").getAttribute("aria-selected")).toBe("false");
    expect(row("read_tabs").getAttribute("aria-selected")).toBe("true");
    expect(ms.isOpen()).toBe(true);
  });

  it("MS7 pick order", () => {
    const { onChange, row, chips } = mount({ value: [] });
    row("read_tabs").click();
    row("page_eval").click();
    expect(onChange).toHaveBeenLastCalledWith(["read_tabs", "page_eval"]);
    expect(chips()).toEqual(["read_tabs", "page_eval"]);
  });

  it("MS8 unselect and chip ×", () => {
    const { ms, onChange, row, chips } = mount({ value: ["read_tabs", "page_eval"] });
    ms.open();
    row("read_tabs").click();
    expect(onChange).toHaveBeenLastCalledWith(["page_eval"]);
    ms.close();
    const pageEvalX = ms.box.querySelector<HTMLButtonElement>('.chip[data-name="page_eval"] .x')!;
    pageEvalX.click();
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(chips()).toEqual([]);
    expect(ms.isOpen()).toBe(false);
  });

  it("MS9 × on All", () => {
    const { ms, onChange } = mount({ value: "*" });
    const allX = ms.box.querySelector<HTMLButtonElement>('.chip[data-name="*"] .x')!;
    allX.click();
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("MS10 filter", () => {
    const { ms, filter, row } = mount();
    ms.open();
    filter()!.value = "tab";
    filter()!.dispatchEvent(new Event("input", { bubbles: true }));

    const visibleNames = [...ms.root.querySelectorAll<HTMLElement>('#t-list [role="option"]')]
      .filter((el) => !el.hidden)
      .map((el) => el.dataset.name);
    expect(visibleNames).toEqual(["*", "read_tabs", "open_tab", "navigate_tab"]);

    const visibleGroups = [...ms.root.querySelectorAll<HTMLElement>("#t-list .ms-group")]
      .filter((el) => !el.hidden)
      .map((el) => el.textContent);
    expect(visibleGroups).toEqual(["Tabs"]);

    const empty = ms.root.querySelector<HTMLElement>("#t-list .ms-empty")!;
    expect(empty.hidden).toBe(true);

    filter()!.value = "zzz";
    filter()!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe("No matching names");
    expect(row("*").hidden).toBe(false);
    const hiddenGroups = [...ms.root.querySelectorAll<HTMLElement>("#t-list .ms-group")].filter((el) => !el.hidden);
    expect(hiddenGroups.length).toBe(0);
  });

  it("MS11 keyboard with filter", () => {
    const { ms, filter, key, row, onChange } = mount();
    ms.box.focus();
    key(ms.box, "Enter");
    expect(ms.isOpen()).toBe(true);
    expect(document.activeElement).toBe(filter());
    expect(filter()!.getAttribute("aria-activedescendant")).toBe(row("*").id);

    key(filter()!, "ArrowDown");
    key(filter()!, "ArrowDown");
    expect(filter()!.getAttribute("aria-activedescendant")).toBe(row("open_tab").id);

    const spaceEvt = key(filter()!, " ");
    expect(spaceEvt.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(["open_tab"]);
    expect(ms.isOpen()).toBe(true);

    for (let i = 0; i < 20; i++) key(filter()!, "ArrowDown");
    expect(filter()!.getAttribute("aria-activedescendant")).toBe(row("get_time").id);

    for (let i = 0; i < 20; i++) key(filter()!, "ArrowUp");
    expect(filter()!.getAttribute("aria-activedescendant")).toBe(row("*").id);

    key(filter()!, "Escape");
    expect(ms.isOpen()).toBe(false);
    expect(document.activeElement).toBe(ms.box);
    expect(filter()!.hasAttribute("aria-activedescendant")).toBe(false);

    // Also space and arrowdown on box open the list
    key(ms.box, " ");
    expect(ms.isOpen()).toBe(true);
    key(filter()!, "Escape");
    expect(ms.isOpen()).toBe(false);

    key(ms.box, "ArrowDown");
    expect(ms.isOpen()).toBe(true);
  });

  it("MS12 keyboard without filter", () => {
    const { ms, list, key, filter, row } = mount({ filter: false });
    ms.box.focus();
    key(ms.box, "Enter");
    expect(document.activeElement).toBe(list());
    expect(list().getAttribute("aria-activedescendant")).toBe(row("*").id);
    expect(filter()).toBeNull();
  });

  it("MS13 typing resets active", () => {
    const { ms, filter, key, row } = mount();
    ms.open();
    key(filter()!, "ArrowDown");
    key(filter()!, "ArrowDown");
    key(filter()!, "ArrowDown");
    filter()!.value = "page";
    filter()!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(filter()!.getAttribute("aria-activedescendant")).toBe(row("*").id);
  });

  it("MS14 setDisabled", () => {
    const { ms, key } = mount();
    ms.open();
    ms.setDisabled(true);
    expect(ms.isOpen()).toBe(false);
    expect(ms.box.getAttribute("aria-disabled")).toBe("true");
    expect(ms.box.tabIndex).toBe(-1);
    const chipsX = ms.box.querySelectorAll<HTMLButtonElement>(".chip .x");
    for (const x of chipsX) expect(x.disabled).toBe(true);

    ms.box.click();
    expect(ms.isOpen()).toBe(false);
    key(ms.box, "Enter");
    expect(ms.isOpen()).toBe(false);

    ms.setDisabled(false);
    expect(ms.box.getAttribute("aria-disabled")).toBe("false");
    expect(ms.box.tabIndex).toBe(0);
    for (const x of ms.box.querySelectorAll<HTMLButtonElement>(".chip .x")) {
      expect(x.disabled).toBe(false);
    }
    ms.box.click();
    expect(ms.isOpen()).toBe(true);
  });

  it("MS15 outside mousedown", () => {
    const { ms, row } = mount();
    ms.open();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(ms.isOpen()).toBe(false);

    ms.open();
    row("wait").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(ms.isOpen()).toBe(true);
  });

  it("MS16 no All option", () => {
    const { ms, chips, row } = mount({ allOption: null, value: [] });
    const allEl = ms.root.querySelector<HTMLElement>('[role="option"][data-name="*"]');
    expect(allEl).toBeNull();
    expect(chips()).toEqual([]);
    ms.open();
    const filterEl = ms.root.querySelector<HTMLInputElement>("#t-filter")!;
    expect(filterEl.getAttribute("aria-activedescendant")).toBe(row("read_tabs").id);
  });

  it("MS17 setValue", () => {
    const { ms, chips, row, onChange } = mount();
    ms.setValue(["wait"]);
    expect(chips()).toEqual(["wait"]);
    expect(row("wait").getAttribute("aria-selected")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("MS18 no heading group", () => {
    const { ms } = mount({ groups: [{ heading: null, names: ["a"] }] });
    const groups = ms.root.querySelectorAll(".ms-group");
    expect(groups.length).toBe(0);
  });
});
