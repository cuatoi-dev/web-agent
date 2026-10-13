import { describe, it, expect } from "vitest";
import { normaliseInput, buildUserContent, UserMessageInput } from "./types.js";

describe("normaliseInput", () => {
  it("converts a plain string to { text, images:[] }", () => {
    const result = normaliseInput("hello");
    expect(result).toEqual({ text: "hello" });
  });

  it("returns UserMessageInput as-is when already an object", () => {
    const input: UserMessageInput = { text: "hello", images: [{ dataUrl: "data:...", mediaType: "image/png" }] };
    const result = normaliseInput(input);
    expect(result).toBe(input);
  });

  it("handles empty images array", () => {
    const input: UserMessageInput = { text: "hello", images: [] };
    const result = normaliseInput(input);
    expect(result).toEqual(input);
  });
});

describe("buildUserContent", () => {
  it("returns plain string when no images", () => {
    const result = buildUserContent({ text: "hello" });
    expect(result).toBe("hello");
  });

  it("returns plain string for empty images array", () => {
    const result = buildUserContent({ text: "hello", images: [] });
    expect(result).toBe("hello");
  });

  it("returns parts array [text, image] when one image present", () => {
    const result = buildUserContent({
      text: "describe this",
      images: [{ dataUrl: "data:image/png;base64,abc", mediaType: "image/png" }],
    }) as Array<{ type: string; [k: string]: unknown }>;
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: "text", text: "describe this" });
    expect(result[1]).toEqual({ type: "image", image: "data:image/png;base64,abc", mediaType: "image/png" });
  });

  it("returns parts array [text, image, image] for two images", () => {
    const result = buildUserContent({
      text: "compare these",
      images: [
        { dataUrl: "data:image/png;base64,a", mediaType: "image/png" },
        { dataUrl: "data:image/jpeg;base64,b", mediaType: "image/jpeg" },
      ],
    }) as Array<{ type: string; [k: string]: unknown }>;
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "text", text: "compare these" });
    expect(result[1]).toEqual({ type: "image", image: "data:image/png;base64,a", mediaType: "image/png" });
    expect(result[2]).toEqual({ type: "image", image: "data:image/jpeg;base64,b", mediaType: "image/jpeg" });
  });
});
