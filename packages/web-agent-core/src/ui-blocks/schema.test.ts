import { describe, it, expect } from "vitest";
import {
  validateRenderableBlock,
  validateUIBlock,
} from "./schema.js";

describe("RenderableBlockSchema (extensible union)", () => {
  it("validates an unknown/plugin block type via passthrough and preserves fields", async () => {
    const raw = { type: "kanban", columns: [{ id: "todo" }], title: "Board" };
    const r = await validateRenderableBlock(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("kanban");
      expect((r.value as unknown as { columns: unknown }).columns).toEqual([{ id: "todo" }]);
      expect((r.value as unknown as { title: unknown }).title).toBe("Board");
    }
  });

  it("still validates core form via its strong schema", async () => {
    const r = await validateRenderableBlock({ type: "form", id: "f1", fields: [] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.type).toBe("form");
  });

  it("validates a chart block via plugin passthrough (chart now lives in its own package)", async () => {
    const r = await validateRenderableBlock({
      type: "chart",
      config: { type: "bar", data: { labels: ["A"], datasets: [{ data: [1] }] } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.type).toBe("chart");
  });

  it("still validates core buttons via its strong schema", async () => {
    const r = await validateRenderableBlock({
      type: "buttons",
      options: [{ label: "Hi", prompt: "hi" }],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a block with no string type", async () => {
    expect((await validateRenderableBlock({ foo: 1 })).ok).toBe(false);
    expect((await validateRenderableBlock({ type: 42 })).ok).toBe(false);
  });

  describe("FormField select options normalization", () => {
    it("unwraps XML { item: [...] } wrapper to a plain string array", async () => {
      const form = {
        type: "form",
        id: "f_opt",
        fields: [{ kind: "select", name: "shipping", label: "Shipping", options: { item: ["standard", "express"] } }],
      };
      const r = await validateUIBlock(form);
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "form") {
        const field = r.value.fields[0];
        if (field.kind === "select") {
          expect(field.options).toEqual(["standard", "express"]);
        }
      }
    });

    it("parses a plain array of options unchanged", async () => {
      const form = {
        type: "form",
        id: "f_opt2",
        fields: [{ kind: "select", name: "shipping", label: "Shipping", options: ["standard", "express"] }],
      };
      const r = await validateUIBlock(form);
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "form") {
        const field = r.value.fields[0];
        if (field.kind === "select") {
          expect(field.options).toEqual(["standard", "express"]);
        }
      }
    });

    it("rejects an unrecognized object shape for options", async () => {
      const form = {
        type: "form",
        id: "f_bad",
        fields: [{ kind: "select", name: "shipping", label: "Shipping", options: { unknownKey: "foo" } }],
      };
      const r = await validateUIBlock(form);
      expect(r.ok).toBe(false);
    });
  });
});
