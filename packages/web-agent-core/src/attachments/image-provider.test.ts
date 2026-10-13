import { describe, it, expect, vi } from "vitest";
import { imageAttachmentProvider } from "./image-provider.js";
import { readAttachmentChips } from "./types.js";

describe("imageAttachmentProvider", () => {
  it("pick() clicks the hidden file input", () => {
    const provider = imageAttachmentProvider();
    const slot = provider.slot!()!;
    const input = slot.querySelector("input[type=file]") as HTMLInputElement;
    const spy = vi.spyOn(input, "click");
    void provider.pick();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("remove button drops the attachment and triggers subscription", () => {
    const provider = imageAttachmentProvider();
    const subSpy = vi.fn();
    const unsub = provider.subscribe!(subSpy);

    provider.restorePending!([
      { type: "image", dataUrl: "data:image/jpeg;base64,123", mediaType: "image/jpeg" },
    ]);
    expect(provider.hasPending()).toBe(true);
    expect(subSpy).toHaveBeenCalled();

    const slot = provider.slot!()!;
    const removeBtn = slot.querySelector("[aria-label='Remove attachment 1']") as HTMLButtonElement;
    expect(removeBtn).not.toBeNull();
    removeBtn.click();

    expect(provider.hasPending()).toBe(false);
    unsub();
  });

  it("onUserPrompt appends image parts and clears pending", async () => {
    const provider = imageAttachmentProvider();
    provider.restorePending!([
      { type: "image", dataUrl: "data:image/jpeg;base64,ABC", mediaType: "image/jpeg" },
    ]);

    const result = await provider.onUserPrompt({ parts: [{ type: "text", text: "hello" }] });
    expect(result).toBeDefined();
    expect(result?.parts).toEqual([
      { type: "text", text: "hello" },
      { type: "image", dataUrl: "data:image/jpeg;base64,ABC", mediaType: "image/jpeg" },
    ]);
    expect(readAttachmentChips(result?.meta)).toEqual([
      { providerId: "image", label: "1 image" },
    ]);
    expect(provider.hasPending()).toBe(false);
  });

  it("onUserPrompt returns undefined when nothing is pending", () => {
    const provider = imageAttachmentProvider();
    const result = provider.onUserPrompt({ parts: [{ type: "text", text: "hello" }] });
    expect(result).toBeUndefined();
  });

  it("onPaste consumes image clipboard item and returns true", () => {
    const provider = imageAttachmentProvider();
    const file = new File(["dummy"], "test.png", { type: "image/png" });
    const event = {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => file,
          },
        ],
      },
    } as unknown as ClipboardEvent;

    const consumed = provider.onPaste!(event);
    expect(consumed).toBe(true);
  });

  it("onPaste returns false for text-only clipboard", () => {
    const provider = imageAttachmentProvider();
    const event = {
      clipboardData: {
        items: [
          {
            kind: "string",
            type: "text/plain",
            getAsFile: () => null,
          },
        ],
      },
    } as unknown as ClipboardEvent;

    const consumed = provider.onPaste!(event);
    expect(consumed).toBe(false);
  });

  it("onDrop consumes image files and returns true", () => {
    const provider = imageAttachmentProvider();
    const file = new File(["dummy"], "test.png", { type: "image/png" });
    const event = {
      dataTransfer: {
        files: [file],
      },
    } as unknown as DragEvent;

    const consumed = provider.onDrop!(event);
    expect(consumed).toBe(true);
  });

  it("the staged card fills its wrap exactly, so the mat cannot grow the footprint", () => {
    const provider = imageAttachmentProvider();
    provider.restorePending!([
      { type: "image", dataUrl: "data:image/jpeg;base64,ABC", mediaType: "image/jpeg" },
    ]);
    const wrap = provider.slot!()!.querySelector(".wa-thumb-wrap") as HTMLElement;
    const img = wrap.querySelector("img") as HTMLImageElement;
    expect(img.style.boxSizing).toBe("border-box");
    expect(img.style.width).toBe(wrap.style.width);
    expect(img.style.height).toBe(wrap.style.height);
  });

  it("the mat is themed, not a raw colour literal", () => {
    const provider = imageAttachmentProvider();
    provider.restorePending!([
      { type: "image", dataUrl: "data:image/jpeg;base64,ABC", mediaType: "image/jpeg" },
    ]);
    const wrap = provider.slot!()!.querySelector(".wa-thumb-wrap") as HTMLElement;
    const img = wrap.querySelector("img") as HTMLImageElement;
    expect(img.style.background).toMatch(/^var\(--wa-[a-z0-9-]+/);
    expect(img.style.background).not.toMatch(/--wa-background-color-700/);
  });

  it("the mat is a theme spacing token, applied on all four sides", () => {
    const provider = imageAttachmentProvider();
    provider.restorePending!([
      { type: "image", dataUrl: "data:image/jpeg;base64,ABC", mediaType: "image/jpeg" },
    ]);
    const wrap = provider.slot!()!.querySelector(".wa-thumb-wrap") as HTMLElement;
    const img = wrap.querySelector("img") as HTMLImageElement;
    expect(img.style.padding).toMatch(/^var\(--wa-padding-/);
    // The padding shorthand must carry a single value, so the mat is equal
    // on all four sides.
    expect(img.style.padding).not.toMatch(/\s\d+px\s+\d+px/);
  });
});
