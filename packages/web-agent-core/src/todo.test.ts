import { describe, it, expect, vi } from "vitest";
import { createTodoStore } from "./todo.js";

describe("createTodoStore", () => {
  describe("write({ items })", () => {
    it("creates new items with sequential ids in order, defaulting to pending", () => {
      const store = createTodoStore();
      const result = store.write({
        items: [{ text: "Buy oats" }, { text: "Feed cat" }, { text: "Clean litter" }],
      });
      expect(result.isError).toBeUndefined();
      expect(result.content).toBe(
        "1. [ ] Buy oats  (id: t1)\n2. [ ] Feed cat  (id: t2)\n3. [ ] Clean litter  (id: t3)"
      );
      expect(store.items()).toEqual([
        { id: "t1", text: "Buy oats", status: "pending" },
        { id: "t2", text: "Feed cat", status: "pending" },
        { id: "t3", text: "Clean litter", status: "pending" },
      ]);
    });

    it("honours an explicit status instead of forcing pending", () => {
      const store = createTodoStore();
      store.write({
        items: [
          { text: "Buy oats", status: "in_progress" },
          { text: "Feed cat", status: "done" },
        ],
      });
      expect(store.items()).toEqual([
        { id: "t1", text: "Buy oats", status: "in_progress" },
        { id: "t2", text: "Feed cat", status: "done" },
      ]);
    });

    it("clears the list when items is an empty array", () => {
      const store = createTodoStore();
      store.write({ items: [{ text: "Buy oats" }] });
      const result = store.write({ items: [] });
      expect(result.isError).toBeUndefined();
      expect(store.items()).toEqual([]);
      expect(store.read()).toEqual({ content: "No todos." });
    });

    it("replaces the whole plan on a second call and never reuses an id", () => {
      const store = createTodoStore();
      store.write({ items: [{ text: "Buy oats" }, { text: "Feed cat" }] });
      const result = store.write({ items: [{ text: "Walk dog" }] });
      expect(result.content).toBe("1. [ ] Walk dog  (id: t3)");
      expect(store.items()).toEqual([{ id: "t3", text: "Walk dog", status: "pending" }]);
    });
  });

  describe("write({ updates })", () => {
    it("patches the status of the target entry, leaving siblings unchanged", () => {
      const store = createTodoStore();
      store.write({ items: [{ text: "Buy oats" }, { text: "Feed cat" }] });
      const result = store.write({ updates: [{ id: "t1", status: "done" }] });
      expect(result.isError).toBeUndefined();
      expect(store.items()).toEqual([
        { id: "t1", text: "Buy oats", status: "done" },
        { id: "t2", text: "Feed cat", status: "pending" },
      ]);
    });

    it("patches the text of the target entry, leaving id and status unchanged", () => {
      const store = createTodoStore();
      store.write({ items: [{ text: "Buy oats", status: "in_progress" }] });
      store.write({ updates: [{ id: "t1", text: "Buy oat milk" }] });
      expect(store.items()).toEqual([{ id: "t1", text: "Buy oat milk", status: "in_progress" }]);
    });

    it("rejects an unknown id and leaves the list byte-identical, even alongside valid updates", () => {
      const store = createTodoStore();
      store.write({ items: [{ text: "Buy oats" }, { text: "Feed cat" }] });
      const before = store.items();
      const result = store.write({
        updates: [
          { id: "t1", status: "done" },
          { id: "t9", status: "done" },
        ],
      });
      expect(result.isError).toBe(true);
      expect(result.content).toBe("No todo with id t9. Call todo_read for the current ids.");
      expect(store.items()).toEqual(before);
    });

    it("rejects a call carrying both items and updates, and changes nothing", () => {
      const store = createTodoStore();
      store.write({ items: [{ text: "Buy oats" }] });
      const before = store.items();
      const result = store.write({ items: [{ text: "New plan" }], updates: [{ id: "t1" }] });
      expect(result).toEqual({
        content: "Send either items or updates, not both.",
        isError: true,
      });
      expect(store.items()).toEqual(before);
    });

    it("rejects a call carrying neither items nor updates, and changes nothing", () => {
      const store = createTodoStore();
      store.write({ items: [{ text: "Buy oats" }] });
      const before = store.items();
      const result = store.write({});
      expect(result).toEqual({
        content: "Send items to set the plan, or updates to change it.",
        isError: true,
      });
      expect(store.items()).toEqual(before);
    });
  });

  describe("read()", () => {
    it("returns 'No todos.' when the list is empty", () => {
      const store = createTodoStore();
      expect(store.read()).toEqual({ content: "No todos." });
    });

    it("returns the full formatted string when items exist", () => {
      const store = createTodoStore();
      store.write({ items: [{ text: "Buy oats", status: "in_progress" }, { text: "Feed cat" }] });
      expect(store.read()).toEqual({
        content: "1. [~] Buy oats  (id: t1)\n2. [ ] Feed cat  (id: t2)",
      });
    });
  });

  describe("items()", () => {
    it("returns a cloned array whose mutation does not affect the store", () => {
      const store = createTodoStore();
      store.write({ items: [{ text: "Buy oats" }] });
      const snapshot = store.items();
      snapshot[0].text = "tampered";
      snapshot.push({ id: "t99", text: "injected", status: "pending" });
      expect(store.items()).toEqual([{ id: "t1", text: "Buy oats", status: "pending" }]);
    });
  });

  describe("onChange", () => {
    it("is invoked with the new list on a valid write", () => {
      const onChange = vi.fn();
      const store = createTodoStore({ onChange });
      store.write({ items: [{ text: "Buy oats" }] });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([{ id: "t1", text: "Buy oats", status: "pending" }]);
    });

    it("is not invoked when a write errors", () => {
      const onChange = vi.fn();
      const store = createTodoStore({ onChange });
      store.write({});
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("onNotify", () => {
    it("is invoked on a successful commit", () => {
      const onNotify = vi.fn();
      const store = createTodoStore({ onNotify });
      store.write({ items: [{ text: "Buy oats" }] });
      expect(onNotify).toHaveBeenCalledTimes(1);
    });
  });

  describe("reset()", () => {
    it("replaces the list and advances the id sequence past any restored id", () => {
      const store = createTodoStore();
      store.reset([{ id: "t5", text: "Restored", status: "pending" }]);
      expect(store.items()).toEqual([{ id: "t5", text: "Restored", status: "pending" }]);
      const result = store.write({ items: [{ text: "Next" }] });
      expect(result.content).toBe("1. [ ] Next  (id: t6)");
    });

    it("with no argument clears the list", () => {
      const store = createTodoStore();
      store.write({ items: [{ text: "Buy oats" }] });
      store.reset();
      expect(store.items()).toEqual([]);
    });
  });
});
