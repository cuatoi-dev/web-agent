// picker-provider.test.ts — vitest + jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { MessagePart } from "@cuatoi/web-agent-core";
import { pickerAttachmentProvider } from "./picker-provider.js";
import { DomAdapter } from "./adapters/dom-adapter.js";

function click(el: Element) {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
  el.dispatchEvent(ev);
}

/** Asserts a part is a text part and returns its text. Keeps the
 *  `block.type === "text"` check the tests already make. */
function textOf(part: MessagePart): string {
  expect(part.type).toBe("text");
  if (part.type !== "text") throw new Error(`expected a text part, got ${part.type}`);
  return part.text;
}

describe("pickerAttachmentProvider", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.classList.remove("wa-dom-picking");
  });

  afterEach(() => {
    document.documentElement.classList.remove("wa-dom-picking");
  });

  it("hasPending() is false with no picks", () => {
    const p = pickerAttachmentProvider();
    expect(p.hasPending()).toBe(false);
  });

  it("pick() toggles picking mode on the document", () => {
    const p = pickerAttachmentProvider();
    void p.pick();
    expect(document.documentElement.classList.contains("wa-dom-picking")).toBe(true);
    void p.pick();
    expect(document.documentElement.classList.contains("wa-dom-picking")).toBe(false);
    p.dispose();
  });

  it("clicking an element while picking pins it and notifies subscribers", () => {
    document.body.innerHTML = '<button id="btn">Add to cart</button>';
    const p = pickerAttachmentProvider();
    let notified = 0;
    const unsub = p.subscribe(() => notified++);
    void p.pick();
    click(document.getElementById("btn")!);
    expect(p.hasPending()).toBe(true);
    expect(notified).toBeGreaterThan(0);
    unsub();
    p.dispose();
  });

  it("clicking inside the agentUiSelector is ignored", () => {
    document.body.innerHTML = '<div data-agent-ui><button id="btn">Agent UI</button></div>';
    const p = pickerAttachmentProvider();
    void p.pick();
    click(document.getElementById("btn")!);
    expect(p.hasPending()).toBe(false);
    p.dispose();
  });

  it("onUserPrompt contributes a text block + chip and clears pending", async () => {
    document.body.innerHTML = '<button id="btn">Add to cart</button>';
    const p = pickerAttachmentProvider();
    void p.pick();
    click(document.getElementById("btn")!);
    const result = await p.onUserPrompt({ parts: [{ type: "text", text: "hi" }] });
    expect(result).toBeDefined();
    expect(result!.parts).toHaveLength(2);
    const blockText = textOf(result!.parts![1]);
    expect(blockText).toContain("# Pointed elements");
    expect(blockText).toContain('button "Add to cart"');
    expect(result!.userDisplayText).toBe("hi");
    expect(result!.meta!.attachmentChips).toEqual([{ providerId: "picker", label: "1 element pointed" }]);
    expect(p.hasPending()).toBe(false);
    p.dispose();
  });

  it("onUserPrompt joins multiple typed-text parts into userDisplayText and reports a chip for N pins", async () => {
    document.body.innerHTML = '<button id="btn">Add to cart</button><a id="lnk" href="#">Salmon</a>';
    const p = pickerAttachmentProvider();
    void p.pick();
    click(document.getElementById("btn")!);
    click(document.getElementById("lnk")!);
    const result = await p.onUserPrompt({
      parts: [{ type: "text", text: "line one" }, { type: "text", text: "line two" }],
    });
    expect(result!.userDisplayText).toBe("line one\nline two");
    expect(result!.meta!.attachmentChips).toEqual([{ providerId: "picker", label: "2 elements pointed" }]);
    p.dispose();
  });

  it("uses the supplied getDomAdapter to build the focused snapshot", async () => {
    document.body.innerHTML = '<button id="btn">Add to cart</button>';
    const snapshotFocused = vi.fn((els: Element[]) =>
      Promise.resolve(els.map((_, i) => ({ ref: i + 1, text: `button "stubbed"` }))),
    );
    const p = pickerAttachmentProvider({
      getDomAdapter: () => ({ snapshotFocused } as unknown as DomAdapter),
    });
    void p.pick();
    const btn = document.getElementById("btn")!;
    click(btn);
    await p.onUserPrompt({ parts: [] });
    expect(snapshotFocused).toHaveBeenCalledWith([btn]);
    p.dispose();
  });

  it("onUserPrompt returns undefined and adds no part when nothing is pending", async () => {
    const p = pickerAttachmentProvider();
    const result = await p.onUserPrompt({ parts: [] });
    expect(result).toBeUndefined();
    p.dispose();
  });

  it("dispose() removes listeners and DOM nodes", () => {
    const p = pickerAttachmentProvider();
    void p.pick();
    p.dispose();
    expect(document.documentElement.classList.contains("wa-dom-picking")).toBe(false);
  });

  it("renders the strip stylesheet inside its own slot, not in document.head", () => {
    const p = pickerAttachmentProvider();
    const sheet = p.slot().querySelector('style[data-wa-styles="dom-picker-strip"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain(".wa-dom-picker-strip");
    expect(sheet!.textContent).toContain("--wa-background-color-100");
    expect(document.getElementById("wa-dom-picker-styles")).toBeNull();
    expect(document.head.querySelector("style")).toBeNull();
    p.dispose();
  });

  it("the outline carries the outline stylesheet", () => {
    const p = pickerAttachmentProvider();
    void p.pick();
    const outline = document.querySelector(".wa-dom-picker-outline");
    expect(outline).not.toBeNull();
    const sheet = outline!.querySelector('style[data-wa-styles="dom-picker-outline"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain(".wa-dom-picker-outline");
    expect(sheet!.textContent).toContain("html.wa-dom-picking");
    p.dispose();
  });

  it("the two sheets partition the original rules with no overlap", () => {
    const p = pickerAttachmentProvider();
    void p.pick();
    const stripText = p.slot().querySelector('style[data-wa-styles="dom-picker-strip"]')!.textContent;
    const outlineText = document
      .querySelector(".wa-dom-picker-outline")!
      .querySelector('style[data-wa-styles="dom-picker-outline"]')!.textContent;
    expect(stripText).not.toContain(".wa-dom-picker-outline");
    expect(stripText).not.toContain("html.wa-dom-picking");
    expect(outlineText).not.toContain(".wa-dom-picker-strip");
    expect(outlineText).not.toContain(".wa-dom-picker-chip");
    p.dispose();
  });

  it("dispose() removes both sheets with their containers", () => {
    const p = pickerAttachmentProvider();
    void p.pick();
    p.dispose();
    expect(document.querySelector('style[data-wa-styles^="dom-picker"]')).toBeNull();
  });
});
