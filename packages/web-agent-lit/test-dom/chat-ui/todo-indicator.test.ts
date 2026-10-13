import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentTodoIndicator } from "../../src/chat-ui/todo-indicator.js";
import type { TodoItem } from "@cuatoi/web-agent-core";

if (!customElements.get("agent-todo-indicator")) {
  customElements.define("agent-todo-indicator", AgentTodoIndicator);
}

describe("AgentTodoIndicator", () => {
  let element: AgentTodoIndicator;

  beforeEach(() => {
    element = document.createElement("agent-todo-indicator");
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  it("badge counts what is left", async () => {
    element.items = [
      { id: "1", text: "Task 1", status: "done" },
      { id: "2", text: "Task 2", status: "pending" },
      { id: "3", text: "Task 3", status: "in_progress" },
    ];
    await element.updateComplete;
    expect(element.querySelector(".todo-badge")!.textContent?.trim()).toBe("2");

    element.items = [
      { id: "1", text: "Task 1", status: "done" },
      { id: "2", text: "Task 2", status: "done" },
      { id: "3", text: "Task 3", status: "in_progress" },
    ];
    await element.updateComplete;
    expect(element.querySelector(".todo-badge")!.textContent?.trim()).toBe("1");
  });

  it("all done swaps the number for a tick", async () => {
    element.items = [
      { id: "1", text: "Task 1", status: "done" },
      { id: "2", text: "Task 2", status: "done" },
      { id: "3", text: "Task 3", status: "done" },
    ];
    await element.updateComplete;
    const badge = element.querySelector(".todo-badge")!;
    expect(badge.classList.contains("all-done")).toBe(true);
    expect(badge.querySelectorAll("svg").length).toBe(1);
    expect(badge.textContent?.trim()).toBe("");
  });

  it("a mixed list is not all-done", async () => {
    element.items = [
      { id: "1", text: "Task 1", status: "done" },
      { id: "2", text: "Task 2", status: "done" },
      { id: "3", text: "Task 3", status: "pending" },
    ];
    await element.updateComplete;
    const badge = element.querySelector(".todo-badge")!;
    expect(badge.classList.contains("all-done")).toBe(false);
  });

  it("aria-label names both halves", async () => {
    element.items = [
      { id: "1", text: "Task 1", status: "done" },
      { id: "2", text: "Task 2", status: "pending" },
      { id: "3", text: "Task 3", status: "in_progress" },
    ];
    await element.updateComplete;
    const wrapper = element.querySelector(".todo-wrapper")!;
    const expected = "Todo list: 1 of 3 done, 2 remaining";
    expect(wrapper.getAttribute("aria-label")).toBe(expected);
    expect(wrapper.getAttribute("title")).toBe(expected);
  });

  it("aria-label when all done", async () => {
    element.items = [
      { id: "1", text: "Task 1", status: "done" },
      { id: "2", text: "Task 2", status: "done" },
      { id: "3", text: "Task 3", status: "done" },
    ];
    await element.updateComplete;
    const wrapper = element.querySelector(".todo-wrapper")!;
    expect(wrapper.getAttribute("aria-label")).toBe("Todo list: all 3 done");
  });

  it("closed at rest", async () => {
    element.items = [
      { id: "1", text: "Task 1", status: "pending" },
    ];
    await element.updateComplete;
    expect(element.querySelector(".todo-pop")).toBeNull();
  });

  it("pointerenter opens, pointerleave closes", async () => {
    element.items = [
      { id: "1", text: "Task 1", status: "pending" },
    ];
    await element.updateComplete;
    const wrapper = element.querySelector(".todo-wrapper")!;

    wrapper.dispatchEvent(new Event("pointerenter"));
    await element.updateComplete;
    expect(element.querySelector(".todo-pop")).not.toBeNull();

    wrapper.dispatchEvent(new Event("pointerleave"));
    await element.updateComplete;
    expect(element.querySelector(".todo-pop")).toBeNull();
  });

  it("focusin opens, focusout closes", async () => {
    element.items = [
      { id: "1", text: "Task 1", status: "pending" },
    ];
    await element.updateComplete;
    const wrapper = element.querySelector(".todo-wrapper")!;

    wrapper.dispatchEvent(new Event("focusin"));
    await element.updateComplete;
    expect(element.querySelector(".todo-pop")).not.toBeNull();

    wrapper.dispatchEvent(new Event("focusout"));
    await element.updateComplete;
    expect(element.querySelector(".todo-pop")).toBeNull();
  });

  it("Escape closes", async () => {
    element.items = [
      { id: "1", text: "Task 1", status: "pending" },
    ];
    await element.updateComplete;
    const wrapper = element.querySelector(".todo-wrapper")!;

    wrapper.dispatchEvent(new Event("focusin"));
    await element.updateComplete;
    expect(element.querySelector(".todo-pop")).not.toBeNull();

    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await element.updateComplete;
    expect(element.querySelector(".todo-pop")).toBeNull();
  });

  it("the wrapper is reachable by keyboard", async () => {
    await element.updateComplete;
    const wrapper = element.querySelector(".todo-wrapper")!;
    expect(wrapper.getAttribute("tabindex")).toBe("0");
    expect(wrapper.getAttribute("role")).toBe("img");
    const svg = element.querySelector(".todo-svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("head counts done of total", async () => {
    element.items = [
      { id: "1", text: "Task 1", status: "done" },
      { id: "2", text: "Task 2", status: "pending" },
      { id: "3", text: "Task 3", status: "in_progress" },
    ];
    await element.updateComplete;
    element.querySelector(".todo-wrapper")!.dispatchEvent(new Event("pointerenter"));
    await element.updateComplete;
    const headN = element.querySelector(".todo-pop-head .n")!;
    expect(headN.textContent?.trim()).toBe("1 of 3 done");
  });

  it("one row per item, in order", async () => {
    element.items = [
      { id: "1", text: "First task", status: "pending" },
      { id: "2", text: "Second task", status: "in_progress" },
      { id: "3", text: "Third task", status: "done" },
    ];
    await element.updateComplete;
    element.querySelector(".todo-wrapper")!.dispatchEvent(new Event("pointerenter"));
    await element.updateComplete;

    const rows = element.querySelectorAll(".todo-row");
    expect(rows.length).toBe(3);
    const texts = Array.from(element.querySelectorAll(".todo-text")).map((el) => el.textContent?.trim());
    expect(texts).toEqual(["First task", "Second task", "Third task"]);
  });

  it("status drives the dot class", async () => {
    element.items = [
      { id: "1", text: "Task 1", status: "pending" },
      { id: "2", text: "Task 2", status: "in_progress" },
      { id: "3", text: "Task 3", status: "done" },
    ];
    await element.updateComplete;
    element.querySelector(".todo-wrapper")!.dispatchEvent(new Event("pointerenter"));
    await element.updateComplete;

    expect(element.querySelectorAll(".todo-dot.pending").length).toBe(1);
    expect(element.querySelectorAll(".todo-dot.in_progress").length).toBe(1);
    expect(element.querySelectorAll(".todo-dot.done").length).toBe(1);
  });

  it("done rows are struck through", async () => {
    element.items = [
      { id: "1", text: "Task 1", status: "done" },
      { id: "2", text: "Task 2", status: "pending" },
    ];
    await element.updateComplete;
    element.querySelector(".todo-wrapper")!.dispatchEvent(new Event("pointerenter"));
    await element.updateComplete;

    const rows = element.querySelectorAll(".todo-row");
    expect(rows[0].classList.contains("is-done")).toBe(true);
    expect(rows[1].classList.contains("is-done")).toBe(false);
  });

  it("re-setting items re-renders", async () => {
    element.items = [
      { id: "1", text: "Task 1", status: "pending" },
      { id: "2", text: "Task 2", status: "pending" },
    ];
    await element.updateComplete;
    expect(element.querySelector(".todo-badge")!.textContent?.trim()).toBe("2");

    element.items = [
      { id: "1", text: "Task 1", status: "done" },
      { id: "2", text: "Task 2", status: "pending" },
      { id: "3", text: "Task 3", status: "pending" },
      { id: "4", text: "Task 4", status: "pending" },
    ];
    await element.updateComplete;
    expect(element.querySelector(".todo-badge")!.textContent?.trim()).toBe("3");
  });

  it("a non-array is ignored", async () => {
    element.items = undefined as unknown as TodoItem[];
    await element.updateComplete;
    expect(element.querySelector(".todo-badge")!.textContent?.trim()).toBe("0");

    element.querySelector(".todo-wrapper")!.dispatchEvent(new Event("pointerenter"));
    await element.updateComplete;
    expect(element.querySelectorAll(".todo-row").length).toBe(0);
  });

  it("max height comes from the panel", async () => {
    element.items = [
      { id: "1", text: "Task 1", status: "pending" },
    ];
    await element.updateComplete;
    element.querySelector(".todo-wrapper")!.dispatchEvent(new Event("pointerenter"));
    await element.updateComplete;

    const pop = element.querySelector<HTMLElement>(".todo-pop")!;
    expect(pop.style.maxHeight).toBe("50vh");
  });
});
