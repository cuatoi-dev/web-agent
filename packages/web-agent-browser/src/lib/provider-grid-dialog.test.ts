// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { openProviderGrid } from "./provider-grid-dialog";

const q = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const tiles = () => [...document.querySelectorAll<HTMLButtonElement>(".provider-tile")];

describe("openProviderGrid", () => {
  it("lists the seven built-in providers in order, then Custom", () => {
    void openProviderGrid();
    expect(tiles().map((t) => t.querySelector(".tile-label")?.textContent)).toEqual([
      "OpenRouter",
      "Anthropic",
      "OpenAI",
      "xAI",
      "Google AI",
      "DeepSeek",
      "Moonshot (Kimi)",
      "Custom",
    ]);
    expect(tiles().every((t) => t.querySelector("svg.logo") !== null)).toBe(true);
    q<HTMLButtonElement>(".cancel-btn").click();
  });

  it("keeps Next disabled until one tile is chosen, and selects one at a time", async () => {
    const p = openProviderGrid();
    const next = q<HTMLButtonElement>(".next-btn");
    expect(next.disabled).toBe(true);
    tiles()[0].click();
    tiles()[1].click();
    expect(tiles()[0].getAttribute("aria-pressed")).toBe("false");
    expect(next.disabled).toBe(false);
    expect(tiles()[1].getAttribute("aria-pressed")).toBe("true");
    expect(tiles().filter((t) => t.getAttribute("aria-pressed") === "true").length).toBe(1);
    next.click();
    expect(await p).toEqual({ builtIn: "anthropic" });
  });

  it("resolves the Custom tile as the custom form", async () => {
    const p = openProviderGrid();
    tiles()[7].click();
    q<HTMLButtonElement>(".next-btn").click();
    expect(await p).toBe("custom");
  });

  it("resolves null on Cancel", async () => {
    const p = openProviderGrid();
    q<HTMLButtonElement>(".cancel-btn").click();
    expect(await p).toBeNull();
  });
  it("resolves null on Escape cancellation", async () => {
    const result = openProviderGrid();
    q<HTMLDialogElement>("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(await result).toBeNull();
    expect(document.querySelector("dialog")).toBeNull();
  });
});
