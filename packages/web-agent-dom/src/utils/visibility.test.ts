import { describe, it, expect, vi } from "vitest";
import { isElementVisible, isElementVisibleFallback } from "./visibility.js";

describe("isElementVisible", () => {
  it("uses the native checkVisibility method when present", () => {
    const el = document.createElement("div");
    const checkVisibility = vi.fn(() => false);
    (el as unknown as { checkVisibility: typeof checkVisibility }).checkVisibility = checkVisibility;

    const result = isElementVisible(el);

    expect(result).toBe(false);
    expect(checkVisibility).toHaveBeenCalledWith({
      checkOpacity: true,
      checkVisibilityCSS: true,
    });
  });

  it("falls back to isElementVisibleFallback when native method is missing", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    try {
      expect((el as { checkVisibility?: unknown }).checkVisibility).toBeUndefined();
      const result = isElementVisible(el);
      expect(result).toBe(true);
    } finally {
      el.remove();
    }
  });
});

describe("isElementVisibleFallback", () => {
  it("returns false for style='display:none'", () => {
    const el = document.createElement("div");
    el.style.display = "none";
    document.body.appendChild(el);
    try {
      expect(isElementVisibleFallback(el)).toBe(false);
    } finally {
      el.remove();
    }
  });

  it("returns false for style='visibility:hidden'", () => {
    const el = document.createElement("div");
    el.style.visibility = "hidden";
    document.body.appendChild(el);
    try {
      expect(isElementVisibleFallback(el)).toBe(false);
    } finally {
      el.remove();
    }
  });

  it("returns false for style='visibility:collapse'", () => {
    const el = document.createElement("div");
    el.style.visibility = "collapse";
    document.body.appendChild(el);
    try {
      expect(isElementVisibleFallback(el)).toBe(false);
    } finally {
      el.remove();
    }
  });

  it("returns false for style='opacity:0'", () => {
    const el = document.createElement("div");
    el.style.opacity = "0";
    document.body.appendChild(el);
    try {
      expect(isElementVisibleFallback(el)).toBe(false);
    } finally {
      el.remove();
    }
  });

  it("returns false when an ancestor carries display:none", () => {
    const parent = document.createElement("div");
    parent.style.display = "none";
    const child = document.createElement("span");
    parent.appendChild(child);
    document.body.appendChild(parent);
    try {
      expect(isElementVisibleFallback(child)).toBe(false);
    } finally {
      parent.remove();
    }
  });

  it("returns true when opacity is unset (regression guard for Number('') === 0)", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    try {
      expect(isElementVisibleFallback(el)).toBe(true);
    } finally {
      el.remove();
    }
  });

  it("returns true for clip-path elements (fallback deliberately does not catch clip-path)", () => {
    const el = document.createElement("div");
    el.style.clipPath = "inset(50%)";
    document.body.appendChild(el);
    try {
      expect(isElementVisibleFallback(el)).toBe(true);
    } finally {
      el.remove();
    }
  });
});
