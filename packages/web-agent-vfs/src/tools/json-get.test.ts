import { describe, expect, it } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { jsonGetTool } from "./json-get.js";
import { editFileTool } from "./edit-file.js";
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

async function withDoc(doc: unknown) {
  const home = MemoryBackend();
  await home.set!("/users.json", {
    content: JSON.stringify(doc, null, 2),
    encoding: "utf8",
    mimeType: "application/json",
    mtimeMs: 4242,
  });
  const mounts: VfsMount[] = [{ prefix: "/home/agent", backend: home }];
  const tracker = createReadTracker();
  return { home, tracker, tool: jsonGetTool(mounts, tracker) };
}

describe("json_get", () => {
  it("reads the whole document as 2-space JSON when no path is given", async () => {
    const { tool } = await withDoc({ settings: { retries: 2 } });
    const out = await tool.execute({ file_path: "/home/agent/users.json" }, ctx);
    expect(out.isError).toBeUndefined();
    expect(out.content).toBe(JSON.stringify({ settings: { retries: 2 } }, null, 2));
  });

  it("returns a scalar or object at a path as 2-space JSON", async () => {
    const { tool } = await withDoc(users20());
    expect((await tool.execute({ file_path: "/home/agent/users.json", path: "settings.retries" }, ctx)).content).toBe("2");
    expect((await tool.execute({ file_path: "/home/agent/users.json", path: "settings" }, ctx)).content).toBe(
      JSON.stringify({ retries: 2, debug: false }, null, 2),
    );
    expect((await tool.execute({ file_path: "/home/agent/users.json", path: "users[3].email" }, ctx)).content).toBe(
      '"user4@example.com"',
    );
  });

  it("filters list items with where equality and names each item's real index", async () => {
    const doc = users20();
    const { tool } = await withDoc(doc);
    const out = await tool.execute(
      { file_path: "/home/agent/users.json", path: "users", where: { role: "buyer" } },
      ctx,
    );
    const lines = out.content.split("\n");
    expect(lines[0]).toBe("12 of 20 items in users match.");
    expect(lines).toHaveLength(13);
    expect(lines[1]).toBe(`[0] ${JSON.stringify(doc.users[0])}`);
    expect(lines[12]).toBe(`[11] ${JSON.stringify(doc.users[11])}`);
  });

  it("reaches a nested field through a dotted where key", async () => {
    const { tool } = await withDoc(users20());
    const out = await tool.execute(
      { file_path: "/home/agent/users.json", path: "users", where: { "address.country": "MY" } },
      ctx,
    );
    expect(out.content.split("\n")[0]).toBe("8 of 20 items in users match.");
  });

  it("projects only the requested fields, in the order given", async () => {
    const { tool } = await withDoc(users20());
    const out = await tool.execute(
      {
        file_path: "/home/agent/users.json",
        path: "users",
        where: { role: "buyer" },
        fields: ["email", "id"],
      },
      ctx,
    );
    expect(out.content.split("\n")[1]).toBe(`[0] {"email":"user1@example.com","id":"u-001"}`);
    expect(out.content).not.toContain("address");
  });

  it("defaults to 50 items and reports how many are left", async () => {
    const big = Array.from({ length: 120 }, (_, i) => ({ id: `i-${i}` }));
    const { tool } = await withDoc({ items: big });
    const out = await tool.execute({ file_path: "/home/agent/users.json", path: "items" }, ctx);
    const lines = out.content.split("\n");
    expect(lines[0]).toBe("120 of 120 items in items match.");
    expect(lines).toHaveLength(52);
    expect(lines[50]).toBe(`[49] {"id":"i-49"}`);
    expect(lines[51]).toBe("… 70 more. Use offset to see them.");
  });

  it("honours offset and limit together", async () => {
    const big = Array.from({ length: 120 }, (_, i) => ({ id: `i-${i}` }));
    const { tool } = await withDoc({ items: big });
    const out = await tool.execute(
      { file_path: "/home/agent/users.json", path: "items", offset: 100, limit: 5 },
      ctx,
    );
    const lines = out.content.split("\n");
    expect(lines[0]).toBe("120 of 120 items in items match.");
    expect(lines.slice(1, 6)).toEqual([
      "[100] {\"id\":\"i-100\"}",
      "[101] {\"id\":\"i-101\"}",
      "[102] {\"id\":\"i-102\"}",
      "[103] {\"id\":\"i-103\"}",
      "[104] {\"id\":\"i-104\"}",
    ]);
    expect(lines[6]).toBe("… 15 more. Use offset to see them.");
  });

  it("reports the document as the target when no path names a list", async () => {
    const { tool } = await withDoc([{ a: 1 }, { a: 2 }]);
    expect((await tool.execute({ file_path: "/home/agent/users.json" }, ctx)).content.split("\n")[0]).toBe(
      "2 of 2 items in the document match.",
    );
  });

  it("marks the file read so edit_file works without a read_file first", async () => {
    const { tool, tracker, home } = await withDoc(users20());
    await tool.execute({ file_path: "/home/agent/users.json", path: "settings.retries" }, ctx);
    expect(tracker.wasRead("s1", "/home/agent/users.json")).toBe(true);
    expect(tracker.readMtime("s1", "/home/agent/users.json")).toBe(4242);
    const edits: VfsMount[] = [{ prefix: "/home/agent", backend: home }];
    const out = await editFileTool(edits, tracker).execute(
      { file_path: "/home/agent/users.json", old_string: '"retries": 2', new_string: '"retries": 4' },
      ctx,
    );
    expect(out.isError).toBeUndefined();
    expect(JSON.parse((await home.get("/users.json"))!.content).settings.retries).toBe(4);
  });

  it("errors when the file does not exist or is outside every mount", async () => {
    const { tool } = await withDoc({});
    expect(await tool.execute({ file_path: "/home/agent/missing.json" }, ctx)).toEqual({
      content: "/home/agent/missing.json does not exist.",
      isError: true,
    });
    expect(await tool.execute({ file_path: "/elsewhere/data.json" }, ctx)).toEqual({
      content: "/elsewhere/data.json does not exist.",
      isError: true,
    });
  });

  it("errors when the file is not utf8 text", async () => {
    const home = MemoryBackend();
    await home.set!("/logo.png", { content: "aW1hZ2U=", encoding: "base64", mimeType: "image/png", mtimeMs: 1 });
    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend: home }];
    const out = await jsonGetTool(mounts, createReadTracker()).execute(
      { file_path: "/home/agent/logo.png" },
      ctx,
    );
    expect(out).toEqual({ content: "/home/agent/logo.png is not a text file.", isError: true });
  });

  it("errors with the parser's message when the file is not valid JSON", async () => {
    const home = MemoryBackend();
    await home.set!("/bad.json", { content: "{ nope }", encoding: "utf8", mimeType: "application/json", mtimeMs: 1 });
    const mounts: VfsMount[] = [{ prefix: "/home/agent", backend: home }];
    const out = await jsonGetTool(mounts, createReadTracker()).execute({ file_path: "/home/agent/bad.json" }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content.startsWith("/home/agent/bad.json is not valid JSON: ")).toBe(true);
  });

  it("errors when the path is not in the document, and does not mark the file read", async () => {
    const { tool, tracker } = await withDoc(users20());
    expect(await tool.execute({ file_path: "/home/agent/users.json", path: "nope.field" }, ctx)).toEqual({
      content: "Nothing at nope.field in /home/agent/users.json.",
      isError: true,
    });
    expect(tracker.wasRead("s1", "/home/agent/users.json")).toBe(false);
  });
});

describe("json_get phrase", () => {
  const tool = () => jsonGetTool([], createReadTracker());

  it("names the path and the match count on a list", () => {
    expect(
      tool().phrase!(
        {
          input: { file_path: "/home/agent/testdata.json", path: "users" },
          outcomeSummary: "12 of 20 items in users match.\n[0] {}",
          failed: false,
        },
        "tesagent",
      ),
    ).toBe("tesagent read users in /home/agent/testdata.json (12 match)");
  });

  it("names the path on a value, and the document when there is no path", () => {
    expect(
      tool().phrase!(
        { input: { file_path: "/home/agent/testdata.json", path: "settings.retries" }, outcomeSummary: "2", failed: false },
        "tesagent",
      ),
    ).toBe("tesagent read settings.retries in /home/agent/testdata.json");
    expect(
      tool().phrase!({ input: { file_path: "/home/agent/testdata.json" }, outcomeSummary: "{}", failed: false }, "tesagent"),
    ).toBe("tesagent read the document in /home/agent/testdata.json");
  });

  it("reports a failure", () => {
    expect(
      tool().phrase!({ input: { file_path: "/home/agent/testdata.json" }, outcomeSummary: "nope", failed: true }, "tesagent"),
    ).toBe("tesagent could not read /home/agent/testdata.json");
    expect(tool().phrase!({ input: {}, outcomeSummary: "nope", failed: true }, "tesagent")).toBe(
      "tesagent could not read a file",
    );
  });
});
