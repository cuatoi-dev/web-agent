import { describe, expect, it } from "vitest";
import { parseSavedOutput, type PostToolPayload } from "@cuatoi/web-agent-core";
import { saveToolResult, TOOL_RESULT_DIR } from "./tool-results.js";
import { MemoryBackend } from "./backends/memory.js";
import type { VfsBackend, VfsMount } from "./types.js";

function payload(content: string, overrides: Partial<PostToolPayload> = {}): PostToolPayload {
  return { name: "some_tool", input: {}, outcome: { content }, ...overrides };
}

function harness(backend: VfsBackend = MemoryBackend()) {
  const mounts: VfsMount[] = [{ prefix: "/tmp", backend }];
  return { mounts, backend, getMounts: () => mounts };
}

const bigText = () => "H".repeat(2000) + "M".repeat(44210) + "T".repeat(2000);

describe("saveToolResult", () => {
  it("saves a long text result as .txt and returns a head/tail preview", async () => {
    const text = bigText();
    const { backend, getMounts, mounts } = harness();
    const res = await saveToolResult(getMounts, payload(text, { toolCallId: "call_7" }), 12_000, 2_000);

    const block = (res as { outcome: { content: string } }).outcome.content;
    const parsed = parseSavedOutput(block)!;
    expect(parsed.saved).toBe(true);
    expect(parsed.path).toBe(`${TOOL_RESULT_DIR}/call_7.txt`);
    expect(parsed.chars).toBe(text.length);
    expect(block).toContain("H".repeat(2000));
    expect(block).toContain("T".repeat(2000));
    expect(block).toContain("44,210 characters omitted");
    expect(block).toContain("read_file (offset, limit)");

    const stored = await backend.get("/tool-results/call_7.txt");
    expect(stored!.content).toBe(text);
    expect(stored!.mimeType).toBe("text/plain");
    expect(mounts[0].prefix).toBe("/tmp");
  });

  it("saves minified JSON byte-identically with the json_get hint", async () => {
    const doc = { a: 1, b: [1, 2, 3], c: "x".repeat(13_000) };
    const text = JSON.stringify(doc);
    const { backend, getMounts } = harness();
    const res = await saveToolResult(getMounts, payload(text, { toolCallId: "call_json" }), 12_000, 2_000);
    const block = (res as { outcome: { content: string } }).outcome.content;

    expect(parseSavedOutput(block)!.path).toBe(`${TOOL_RESULT_DIR}/call_json.json`);
    expect(block).toContain("json_get");
    const stored = await backend.get("/tool-results/call_json.json");
    expect(stored!.content).toBe(text);
    expect(stored!.mimeType).toBe("application/json");
    expect(JSON.parse(stored!.content)).toEqual(doc);
  });

  it("detects JSON after leading whitespace", async () => {
    const text = "  \n" + JSON.stringify({ a: "y".repeat(13_000) });
    const { backend, getMounts } = harness();
    await saveToolResult(getMounts, payload(text, { toolCallId: "ws" }), 12_000, 2_000);
    const stored = await backend.get("/tool-results/ws.json");
    expect(stored).toBeDefined();
  });

  it("saves a broken JSON-looking string as text", async () => {
    const text = "{" + "x".repeat(13_000);
    const { backend, getMounts } = harness();
    await saveToolResult(getMounts, payload(text, { toolCallId: "broken" }), 12_000, 2_000);
    expect(await backend.get("/tool-results/broken.txt")).toBeDefined();
    expect(await backend.get("/tool-results/broken.json")).toBeUndefined();
  });

  it("saves a JSON primitive as text", async () => {
    const text = "1".repeat(13_000);
    const { backend, getMounts } = harness();
    await saveToolResult(getMounts, payload(text, { toolCallId: "prim" }), 12_000, 2_000);
    expect(await backend.get("/tool-results/prim.txt")).toBeDefined();
  });

  it("leaves a 12,000-character result untouched and does not access mounts", async () => {
    let accessed = false;
    const mounts: VfsMount[] = [{ prefix: "/tmp", backend: MemoryBackend() }];
    const res = await saveToolResult(
      () => { accessed = true; return mounts; },
      payload("a".repeat(12_000)),
      12_000,
      2_000,
    );
    expect(res).toBeUndefined();
    expect(accessed).toBe(false);
  });

  it("saves a 12,001-character result", async () => {
    const { backend, getMounts } = harness();
    const res = await saveToolResult(getMounts, payload("a".repeat(12_001), { toolCallId: "over" }), 12_000, 2_000);
    expect(res).toBeDefined();
    expect(await backend.get("/tool-results/over.txt")).toBeDefined();
  });

  it("honours custom maxChars and previewChars", async () => {
    const text = "H".repeat(500) + "M".repeat(5000) + "T".repeat(500);
    const { getMounts } = harness();
    const res = await saveToolResult(getMounts, payload(text, { toolCallId: "custom" }), 5_000, 500);
    const block = (res as { outcome: { content: string } }).outcome.content;
    expect(parseSavedOutput(block)!.chars).toBe(6000);
    expect(block).toContain("H".repeat(500));
    expect(block).toContain("T".repeat(500));
    expect(block).toContain("5,000 characters omitted");
  });

  it("never saves read_file, glob_files or search_files", async () => {
    for (const name of ["read_file", "glob_files", "search_files"]) {
      let accessed = false;
      const mounts: VfsMount[] = [{ prefix: "/tmp", backend: MemoryBackend() }];
      const res = await saveToolResult(
        () => { accessed = true; return mounts; },
        payload("x".repeat(48_210), { name, toolCallId: "nope" }),
        12_000,
        2_000,
      );
      expect(res, name).toBeUndefined();
      expect(accessed, name).toBe(false);
    }
  });

  it("falls back to a timestamp filename when the call id is missing", async () => {
    const { backend, getMounts } = harness();
    const res = await saveToolResult(getMounts, payload("z".repeat(13_000)), 12_000, 2_000);
    const path = parseSavedOutput((res as { outcome: { content: string } }).outcome.content)!.path!;
    expect(path).toMatch(new RegExp(`^${TOOL_RESULT_DIR}/result-\\d+\\.txt$`));
    expect(await backend.get(path.slice("/tmp".length))).toBeDefined();
  });

  it("keeps the error verdict and the images on a saved outcome", async () => {
    const images = [{ dataUrl: "data:image/png;base64,AAAA", mediaType: "image/png" }];
    const { getMounts } = harness();
    const res = await saveToolResult(
      getMounts,
      { name: "some_tool", input: {}, outcome: { content: "e".repeat(13_000), isError: true, images } },
      12_000,
      2_000,
    );
    const outcome = (res as { outcome: { isError?: boolean; images?: unknown } }).outcome;
    expect(outcome.isError).toBe(true);
    expect(outcome.images).toEqual(images);
  });

  it("leaves an image-only result unchanged", async () => {
    const { getMounts } = harness();
    const res = await saveToolResult(
      getMounts,
      { name: "some_tool", input: {}, outcome: { content: "", images: [{ dataUrl: "data:image/png;base64,AAAA", mediaType: "image/png" }] } },
      12_000,
      2_000,
    );
    expect(res).toBeUndefined();
  });

  it("returns the unsaved preview when the mount is full", async () => {
    const backend: VfsBackend = {
      get: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      set: () => {
        const e = new Error("exceeded");
        e.name = "QuotaExceededError";
        return Promise.reject(e);
      },
    };
    const { getMounts } = harness(backend);
    const res = await saveToolResult(getMounts, payload("q".repeat(48_210), { toolCallId: "full" }), 12_000, 2_000);
    const block = (res as { outcome: { content: string } }).outcome.content;
    const parsed = parseSavedOutput(block)!;
    expect(parsed.saved).toBe(false);
    expect(block).toContain("It could not be saved: the storage for /tmp is full.");
    expect(block).toContain("44,210 characters omitted");
  });

  it("returns the unsaved preview with the backend message for another failure", async () => {
    const backend: VfsBackend = {
      get: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      set: () => Promise.reject(new Error("disk offline")),
    };
    const { getMounts } = harness(backend);
    const res = await saveToolResult(getMounts, payload("d".repeat(13_000), { toolCallId: "err" }), 12_000, 2_000);
    const block = (res as { outcome: { content: string } }).outcome.content;
    expect(block).toContain("It could not be saved: disk offline.");
    expect(parseSavedOutput(block)!.saved).toBe(false);
  });

  it("returns the unsaved preview when the path has no mount and never throws", async () => {
    const res = await saveToolResult(() => [], payload("n".repeat(13_000), { toolCallId: "nomount" }), 12_000, 2_000);
    expect(parseSavedOutput((res as { outcome: { content: string } }).outcome.content)!.saved).toBe(false);
  });
});
