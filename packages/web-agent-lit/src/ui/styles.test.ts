import { describe, it, expect } from "vitest";
import { styles } from "./styles.js";

describe("styles", () => {
  it("contains --wa-* design token custom properties in styles", () => {
    expect(styles).toContain("--wa-padding-m");
    expect(styles).toContain("--wa-padding-l");
    expect(styles).toContain("--wa-component-size-l");
  });

  it("contains container-type rules", () => {
    expect(styles).toContain("container-type: inline-size;");
    expect(styles).toContain("@container");
  });
});
