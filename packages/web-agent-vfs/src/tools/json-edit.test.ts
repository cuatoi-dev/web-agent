import { describe, expect, it } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { jsonEditTool } from "./json-edit.js";
import { createReadTracker } from "../read-tracker.js";
import { MemoryBackend } from "../backends/memory.js";
import type { VfsMount } from "../types.js";

const ctx = { sessionId: "s1" } as unknown as ToolContext;

/** 20 users: 12 buyers, 8 in MY. */
function users20() {
  const users = Array.from({ length: 20 }, (_, i) => {
    const n = i + 1;
    return {
      id: `u-${String(n).padStart(3, "0")}`,
      email: `user${n}@example.com`,
      role: n <= 12 ? "buyer" : "admin",
      address: { country: n <= 8 ? "MY" : n <= 14 ? "SG" : "US" },
    };
  });
  return { users, settings: { retries: 2, debug: false } };
}

/** A writable /home/agent holding the 20-user document, plus a read-only mount. */
async function home20() {
  const doc = users20();
  const home = MemoryBackend();
  await home.set!("/testdata.json", {
    content: JSON.stringify(doc, null, 2),
    encoding: "utf8",
    mimeType: "application/json",
    mtimeMs: 100,
  });
  const ro = {
    get: (rel: string) =>
      Promise.resolve(
        rel === "/data.json"
          ? { content: JSON.stringify(doc, null, 2), encoding: "utf8" as const, mimeType: "application/json", mtimeMs: 100 }
          : undefined,
      ),
    list: () => Promise.resolve([]),
  };
  const mounts: VfsMount[] = [
    { prefix: "/home/agent", backend: home },
    { prefix: "/data", backend: ro },
  ];
  const tracker = createReadTracker();
  return { doc, home, mounts, tracker, tool: jsonEditTool(mounts, tracker) };
}

describe("json_edit", () => {
  it("saves a change as 2-space JSON and keeps the document's key order", async () => {
    const { home, tool } = await home20();
    const out = await tool.execute(
      {
        file_path: "/home/agent/testdata.json",
        changes: [
          { op: "set", path: "settings.retries", value: 5 },
          { op: "delete", path: "settings.debug" },
        ],
      },
      ctx,
    );
    expect(out.isError).toBeUndefined();
    expect(out.content).toBe(
      [
        "2 change(s) saved to /home/agent/testdata.json.",
        "1. set settings.retries",
        "2. delete settings.debug",
      ].join("\n"),
    );
    const text = (await home.get("/testdata.json"))!.content;
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
    expect(Object.keys(JSON.parse(text))).toEqual(["users", "settings"]);
    expect(Object.keys(JSON.parse(text).settings)).toEqual(["retries"]);
    expect(JSON.parse(text).settings.retries).toBe(5);
  });

  it("creates a missing file from an empty object", async () => {
    const home = MemoryBackend();
    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend: home }];
    const tool = jsonEditTool(mounts, createReadTracker());
    const out = await tool.execute(
      { file_path: "/home/agent/new.json", changes: [{ op: "set", path: "a.b", value: [1] }] },
      ctx,
    );
    expect(out.isError).toBeUndefined();
    expect((await home.get("/new.json"))!.content).toBe(JSON.stringify({ a: { b: [1] } }, null, 2));
  });

  it("needs no earlier read — it writes without a read_file or json_get", async () => {
    const { tool } = await home20();
    const out = await tool.execute(
      { file_path: "/home/agent/testdata.json", changes: [{ op: "append", path: "users", value: { id: "u-021" } }] },
      ctx,
    );
    expect(out.isError).toBeUndefined();
  });

  it("applies each of the seven operations to the 20-user document", async () => {
    const { home, doc, tool } = await home20();
    const out = await tool.execute(
      {
        file_path: "/home/agent/testdata.json",
        changes: [
          { op: "set", path: "users[0].address.city", value: "Singapore" },
          { op: "delete", path: "settings.debug" },
          { op: "append", path: "users[0].tags", value: "vip" },
          { op: "insert", path: "users", index: 0, value: { id: "u-000" } },
          { op: "update", path: "users", where: { role: "buyer" }, merge: { password: "x" } },
          // 8 MY users, all still MY after the insert shifted them to [1]..[8].
          { op: "remove", path: "users", where: { "address.country": "MY" }, expect: 8 },
          // u-015 is in SG, so it survived the remove and upsert replaced it.
          { op: "upsert", path: "users", key: "id", value: { id: "u-015", email: "new@example.com" } },
        ],
      },
      ctx,
    );
    expect(out.isError).toBeUndefined();
    const after = JSON.parse((await home.get("/testdata.json"))!.content);
    expect(after.users).toHaveLength(doc.users.length - 8 + 1);
    expect(after.users.some((u: { id: string }) => u.id === "u-004")).toBe(false);
    expect(after.users.filter((u: { id: string }) => u.id === "u-015")).toEqual([
      { id: "u-015", email: "new@example.com" },
    ]);
    expect(after.settings.debug).toBeUndefined();
  });

  it("updates exactly the 12 buyers and leaves every other field alone", async () => {
    const { home, doc, tool } = await home20();
    await tool.execute(
      {
        file_path: "/home/agent/testdata.json",
        changes: [{ op: "update", path: "users", where: { role: "buyer" }, merge: { password: "x" } }],
      },
      ctx,
    );
    const after = JSON.parse((await home.get("/testdata.json"))!.content).users;
    expect(after.filter((u: { password?: string }) => "password" in u)).toHaveLength(12);
    after.forEach((u: Record<string, unknown>, i: number) => {
      expect(u).toEqual(i < 12 ? { ...doc.users[i], password: "x" } : doc.users[i]);
    });
  });

  it("fails and writes nothing when a remove's expect count does not match", async () => {
    const { home, tool } = await home20();
    const before = (await home.get("/testdata.json"))!.content;
    const out = await tool.execute(
      {
        file_path: "/home/agent/testdata.json",
        changes: [{ op: "remove", path: "users", where: { role: "nobody" }, expect: 1 }],
      },
      ctx,
    );
    expect(out).toEqual({
      content: "Change 1 (remove users) matched 0 items; expect is 1.",
      isError: true,
    });
    expect((await home.get("/testdata.json"))!.content).toBe(before);
  });

  it("is all or nothing: a failing second change leaves the file byte-identical", async () => {
    const { home, tool } = await home20();
    const before = (await home.get("/testdata.json"))!.content;
    const out = await tool.execute(
      {
        file_path: "/home/agent/testdata.json",
        changes: [
          { op: "set", path: "settings.retries", value: 99 },
          { op: "delete", path: "users[99]" },
        ],
      },
      ctx,
    );
    expect(out).toEqual({
      content: "Change 2 (delete users[99]) index 99 is outside the list (20 items).",
      isError: true,
    });
    expect((await home.get("/testdata.json"))!.content).toBe(before);
  });

  it("fails on invalid JSON with the parser's message and saves nothing", async () => {
    const home = MemoryBackend();
    await home.set!("/bad.json", { content: "{ oops", encoding: "utf8", mimeType: "application/json", mtimeMs: 1 });
    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend: home }];
    const out = await jsonEditTool(mounts, createReadTracker()).execute(
      { file_path: "/home/agent/bad.json", changes: [{ op: "set", path: "a", value: 1 }] },
      ctx,
    );
    expect(out.isError).toBe(true);
    expect(out.content.startsWith("/home/agent/bad.json is not valid JSON: ")).toBe(true);
    expect((await home.get("/bad.json"))!.content).toBe("{ oops");
  });

  it("stores the value exactly as given: empty lists and objects stay, key order is untouched", async () => {
    const home = MemoryBackend();
    await home.set!("/testdata.json", { content: "{}", encoding: "utf8", mimeType: "application/json", mtimeMs: 1 });
    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend: home }];
    const tool = jsonEditTool(mounts, createReadTracker());
    // An empty list must not become an empty string, and the keys must land in
    // the order they were sent, not sorted.
    const value = {
      id: "u-000",
      email: "user0@example.com",
      role: "admin",
      address: { country: "SG", city: "Kuala Lumpur" },
      tags: [] as unknown[],
      meta: { notes: [], extra: {} },
    };
    const out = await tool.execute(
      {
        file_path: "/home/agent/testdata.json",
        changes: [
          { op: "set", path: "rows", value: [] },
          { op: "insert", path: "rows", index: 0, value },
        ],
      },
      ctx,
    );
    expect(out.isError).toBeUndefined();
    const saved = JSON.parse((await home.get("/testdata.json"))!.content);
    expect(saved.rows).toHaveLength(1);
    expect(saved.rows[0]).toEqual(value);
    expect(saved.rows[0].tags).toEqual([]);
    expect(Array.isArray(saved.rows[0].tags)).toBe(true);
    expect(saved.rows[0].meta).toEqual({ notes: [], extra: {} });
    expect(Object.keys(saved.rows[0])).toEqual(["id", "email", "role", "address", "tags", "meta"]);
    expect(Object.keys(saved.rows[0].address)).toEqual(["country", "city"]);
    // And the file is that document serialised with 2 spaces, verbatim.
    expect((await home.get("/testdata.json"))!.content).toBe(JSON.stringify(saved, null, 2));
  });

  it("fails on a read-only mount and writes nothing", async () => {
    const { tool } = await home20();
    const out = await tool.execute(
      { file_path: "/data/data.json", changes: [{ op: "set", path: "a", value: 1 }] },
      ctx,
    );
    expect(out).toEqual({
      content: "Error: /data/data.json is read-only. Writable paths: /home/agent.",
      isError: true,
    });
  });

  it("fails when the file is not utf8 text", async () => {
    const home = MemoryBackend();
    await home.set!("/logo.png", { content: "aW1hZ2U=", encoding: "base64", mimeType: "image/png", mtimeMs: 1 });
    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend: home }];
    const out = await jsonEditTool(mounts, createReadTracker()).execute(
      { file_path: "/home/agent/logo.png", changes: [{ op: "set", path: "a", value: 1 }] },
      ctx,
    );
    expect(out).toEqual({ content: "Error: /home/agent/logo.png is not a text file.", isError: true });
  });

  it("marks the file read with the mtime it saved", async () => {
    const { tracker, tool } = await home20();
    await tool.execute(
      { file_path: "/home/agent/testdata.json", changes: [{ op: "set", path: "a", value: 1 }] },
      ctx,
    );
    expect(tracker.wasRead("s1", "/home/agent/testdata.json")).toBe(true);
    expect(tracker.readMtime("s1", "/home/agent/testdata.json")).toBeGreaterThan(100);
  });

  it("reports a full storage through writeFailure, with the mount prefix", async () => {
    const quota = new Error("nope") as Error & { name: string };
    quota.name = "QuotaExceededError";
    const home = MemoryBackend();
    home.set = () => Promise.reject(quota);
    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend: home }];
    const out = await jsonEditTool(mounts, createReadTracker()).execute(
      { file_path: "/home/agent/x.json", changes: [{ op: "set", path: "a", value: 1 }] },
      ctx,
    );
    expect(out).toEqual({
      content: "Error: could not write /home/agent/x.json: the storage for /home/agent is full.",
      isError: true,
    });
  });
});

describe("json_edit phrase", () => {
  const tool = () => jsonEditTool([], createReadTracker());

  it("counts the changes on success", () => {
    expect(
      tool().phrase!(
        {
          input: { file_path: "/home/agent/testdata.json", changes: [{ op: "set", path: "a", value: 1 }, { op: "set", path: "b", value: 2 }] },
          outcomeSummary: "2 change(s) saved to /home/agent/testdata.json.",
          failed: false,
        },
        "tesagent",
      ),
    ).toBe("tesagent changed /home/agent/testdata.json (2 changes)");
  });

  it("reports a failure", () => {
    expect(
      tool().phrase!({ input: { file_path: "/home/agent/testdata.json", changes: [] }, outcomeSummary: "nope", failed: true }, "tesagent"),
    ).toBe("tesagent could not change /home/agent/testdata.json");
    expect(tool().phrase!({ input: {}, outcomeSummary: "nope", failed: true }, "tesagent")).toBe(
      "tesagent could not change a file",
    );
  });
});
