import { describe, it, expect } from "vitest";
import { originPattern } from "./origin";

describe("originPattern", () => {
  it("returns a portless https pattern for a URL that carries a port", () => {
    expect(originPattern("http://localhost:30000/api/openai/v1")).toBe(
      "http://localhost/*",
    );
  });

  it("keeps the http scheme", () => {
    expect(originPattern("http://localhost:10040/x")).toBe("http://localhost/*");
  });

  it("returns null for a string that is not a URL", () => {
    expect(originPattern("not a url")).toBeNull();
  });

  it("returns null for a non-http scheme", () => {
    expect(originPattern("ftp://example.com/x")).toBeNull();
    expect(originPattern("chrome-extension://abc/options.html")).toBeNull();
  });
});

