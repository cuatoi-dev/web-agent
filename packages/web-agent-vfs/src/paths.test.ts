import { describe, expect, it } from "vitest";
import { ABSOLUTE_PATH_ERROR, VfsPathError, normalize, ancestors, basename, dirname, join } from "./paths.js";

describe("normalize", () => {
  it("ancestors returns ordered paths from root down to dirname", () => {
    expect(ancestors("/home/agent/deck")).toEqual(["/", "/home", "/home/agent", "/home/agent/deck"]);
    expect(ancestors("/")).toEqual(["/"]);
  });
  it("basename returns the file name", () => {
    expect(basename("/home/agent/notes.md")).toBe("notes.md");
    expect(basename("/")).toBe("");
  });
  it("dirname returns parent directory", () => {
    expect(dirname("/home/agent/notes.md")).toBe("/home/agent");
    expect(dirname("/notes.md")).toBe("/");
    expect(dirname("/")).toBe("/");
  });
  it("join combines directory and file name", () => {
    expect(join("/home/agent", "AGENTS.md")).toBe("/home/agent/AGENTS.md");
    expect(join("/", "AGENTS.md")).toBe("/AGENTS.md");
  });
  it("P1 — resolves .. segments, including across directories", () => {
    expect(normalize("/home/agent/../../etc")).toBe("/etc");
  });

  it("P2 — collapses . segments and double slashes", () => {
    expect(normalize("/home/./agent//notes.md")).toBe("/home/agent/notes.md");
  });

  it("P3 — .. at the root is a no-op", () => {
    expect(normalize("/..")).toBe("/");
    expect(normalize("/../..")).toBe("/");
  });

  it("P4 — a non-absolute or non-string path throws VfsPathError with the exact message", () => {
    for (const bad of ["notes.md", 42, undefined]) {
      expect(() => normalize(bad)).toThrow(VfsPathError);
      try {
        normalize(bad);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(VfsPathError);
        expect((err as Error).message).toBe(ABSOLUTE_PATH_ERROR);
      }
    }
  });

  it("P5 — the root path normalizes to itself", () => {
    expect(normalize("/")).toBe("/");
  });
});
