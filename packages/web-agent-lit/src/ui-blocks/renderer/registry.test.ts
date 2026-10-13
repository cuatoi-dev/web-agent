import { describe, it, expect } from "vitest";
import { BlockRendererRegistry, BlockRenderer } from "./types.js";
import { generativeUiRenderer } from "./generative-ui-renderer.js";
import { RenderableBlock } from "@cuatoi/web-agent-core";
import { genuiRenderers, defaultRenderers } from "../../index.js";

describe("BlockRendererRegistry", () => {
  it("routes form and buttons to the generative UI renderer", () => {
    const registry = new BlockRendererRegistry([generativeUiRenderer]);

    const formBlock: RenderableBlock = {
      type: "form",
      id: "f1",
      fields: [],
    };

    const formResult = registry.render(formBlock, { disabled: false }) as HTMLElement;

    expect(formResult).toBeDefined();
    expect(formResult.tagName.toLowerCase()).toBe("agent-form-block");
  });

  it("hits the fallback for unregistered block types like chart", () => {
    const registry = new BlockRendererRegistry([generativeUiRenderer]);

    const chartBlock: RenderableBlock = {
      type: "chart",
      spec: {},
    };

    const fallbackResult = registry.render(chartBlock, { disabled: false }) as HTMLElement;
    expect(fallbackResult).toBeDefined();
    expect(fallbackResult.querySelector(".error-card-renderer")).not.toBeNull();
    expect(fallbackResult.textContent).toContain("Unknown Block Type");
  });

  it("collects and dedupes prompt snippets correctly", () => {
    const registryOnlyGen = new BlockRendererRegistry([generativeUiRenderer]);
    const snippetsOnlyGen = registryOnlyGen.collectPromptSnippets();

    expect(snippetsOnlyGen).toContain("Form:");
    expect(snippetsOnlyGen).toContain("Buttons:");

    const registryDup = new BlockRendererRegistry([generativeUiRenderer, generativeUiRenderer]);
    const snippetsDup = registryDup.collectPromptSnippets();
    const count = (snippetsDup.match(/Form:/g) || []).length;
    expect(count).toBe(1);
  });

  it("degrades gracefully for a plugin/unknown block type with no renderer", () => {
    const registry = new BlockRendererRegistry([generativeUiRenderer]);
    const unknownBlock = { type: "kanban", columns: [] } as unknown as RenderableBlock;

    let result: HTMLElement | undefined;
    expect(() => {
      result = registry.render(unknownBlock, { disabled: false }) as HTMLElement;
    }).not.toThrow();

    expect(result).toBeDefined();
    expect(result!.querySelector(".error-card-renderer")).not.toBeNull();
    expect(result!.textContent).toContain("Unknown Block Type");
    expect(result!.textContent).toContain("kanban");
  });

  it("lets a host renderer override the sample generativeUiRenderer for form/buttons", () => {
    const customForm: BlockRenderer = {
      types: ["form", "buttons"],
      render: () => { const el = document.createElement("host-custom-form"); return el; },
    };
    const registry = new BlockRendererRegistry([generativeUiRenderer, customForm]);
    const formResult = registry.render({ type: "form", id: "f", fields: [] }, { disabled: false }) as HTMLElement;
    expect(formResult.tagName.toLowerCase()).toBe("host-custom-form");   // override wins
    const btnResult = registry.render({ type: "buttons", options: [] }, { disabled: false }) as HTMLElement;
    expect(btnResult.tagName.toLowerCase()).toBe("host-custom-form");
  });

  it("genuiRenderers contains the generativeUiRenderer and aliases defaultRenderers", () => {
    expect(genuiRenderers[0]).toBe(generativeUiRenderer);
    expect(defaultRenderers).toBe(genuiRenderers);
  });

  it("error card and unknown fallback styles use --wa-* tokens", () => {
    const registry = new BlockRendererRegistry();

    // error_card block
    const errorBlock: RenderableBlock = { type: "error_card", error: "oops", raw: "{}" };
    const errorResult = registry.render(errorBlock, {}) as HTMLElement;
    const errorStyle = errorResult.querySelector("style");
    expect(errorStyle).not.toBeNull();
    const errorCss = errorStyle!.textContent ?? "";
    expect(errorCss).toContain("--wa-action-color-error-10opc");
    expect(errorCss).toContain("--wa-action-color-error-40opc");
    expect(errorCss).toContain("--wa-text-color");
    expect(errorCss).toContain("--wa-label-color");
    expect(errorCss).toContain("--wa-background-color-300");

    // unknown fallback block
    const unknownBlock = { type: "mystery" } as unknown as RenderableBlock;
    const unknownResult = registry.render(unknownBlock, {}) as HTMLElement;
    const unknownStyle = unknownResult.querySelector("style");
    expect(unknownStyle).not.toBeNull();
    const unknownCss = unknownStyle!.textContent ?? "";
    expect(unknownCss).toContain("--wa-action-color-error-10opc");
    expect(unknownCss).toContain("--wa-text-color");
  });
});
