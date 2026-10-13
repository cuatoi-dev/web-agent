import { describe, it, expect } from "vitest";
import { DEMO_STATES } from "./gallery-demos";
import { GALLERY_STATES } from "./gallery-states";

describe("gallery folded demos", () => {
  it("every DEMO_STATES entry declares a mount factory", () => {
    for (const gs of DEMO_STATES) {
      expect(typeof gs.mount).toBe("function");
      expect(gs.kind).toBe("demo");
    }
  });

  it("DEMO_STATES ids are unique and disjoint from GALLERY_STATES ids", () => {
    const demoIds = DEMO_STATES.map((s) => s.id);
    const galleryIds = GALLERY_STATES.map((s) => s.id);
    expect(new Set(demoIds).size).toBe(demoIds.length);
    expect(new Set([...demoIds, ...galleryIds]).size).toBe(
      demoIds.length + galleryIds.length,
    );
  });

  it("no DEMO_STATES entry would be rendered as a catalog tile", () => {
    for (const gs of DEMO_STATES) {
      const skippedByCatalog = gs.id === "present-demo" || Boolean(gs.mount);
      expect(skippedByCatalog).toBe(true);
    }
  });
});
