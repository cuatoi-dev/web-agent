import { describe, it, expect } from "vitest";
import {
  buildSessionMessages,
  isEmptyCompletedTurn,
  EMPTY_TURN_NOTICE,
} from "./controller-messages.js";
import type { JournalEntry } from "./loop/context-manager.js";
import type { AuditEntry } from "./loop/types.js";
import type { BuildMessagesParams } from "./controller-messages.types.js";

function entry(
  turnId: string,
  role: "user" | "assistant" | "tool",
  content: JournalEntry["msg"]["content"],
  stepNo: number,
  failed?: { message: string; retryable: boolean },
): JournalEntry {
  return {
    msg: { role, content },
    meta: {
      turnId,
      stepNo,
      kinds: [],
      chars: 0,
      createdAt: 0,
      ...(failed ? { failed } : {}),
    },
  } as unknown as JournalEntry;
}

function params(
  journal: JournalEntry[],
  inProgressTurnId: string | undefined = undefined,
  audit: AuditEntry[] = [],
): BuildMessagesParams {
  return {
    journal,
    audit,
    inProgressTurnId,
    compactionRows: [],
    turnCache: new Map(),
    toolBlocks: new Map(),
    toolBlocksVersion: 0,
    running: false,
  };
}

describe("isEmptyCompletedTurn", () => {
  it("is true for a turn whose only assistant entry is empty", () => {
    expect(
      isEmptyCompletedTurn([entry("t1", "user", "hi", 0), entry("t1", "assistant", [], 1)]),
    ).toBe(true);
  });

  it("is false while the turn has no assistant entry yet", () => {
    expect(isEmptyCompletedTurn([entry("t1", "user", "hi", 0)])).toBe(false);
  });

  it("is false when any assistant entry carries content", () => {
    expect(
      isEmptyCompletedTurn([
        entry("t1", "user", "hi", 0),
        entry("t1", "assistant", "tool result here", 1),
        entry("t1", "assistant", [], 2),
      ]),
    ).toBe(false);
  });
});

describe("buildSessionMessages — empty completed turn", () => {
  it("an empty completed turn puts the notice on the user message", () => {
    const messages = buildSessionMessages(
      params([entry("t1", "user", "hi", 0), entry("t1", "assistant", [], 1)]),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].notice).toEqual({ message: EMPTY_TURN_NOTICE, retryable: true });
    expect(messages[0].failed).toBeUndefined();
    expect(messages.some((m) => m.role === "assistant")).toBe(false);
  });

  it("a failed turn gets failed and no notice", () => {
    const messages = buildSessionMessages(
      params([
        entry("t1", "user", "hi", 0),
        entry("t1", "assistant", [], 1, { message: "boom", retryable: true }),
      ]),
    );
    expect(messages[0].failed).toEqual({ message: "boom", retryable: true });
    expect(messages[0].notice).toBeUndefined();
  });

  it("a normal turn gets neither", () => {
    const messages = buildSessionMessages(
      params([entry("t1", "user", "hi", 0), entry("t1", "assistant", "hello", 1)]),
    );
    expect(messages).toHaveLength(2);
    expect(messages[0].failed).toBeUndefined();
    expect(messages[0].notice).toBeUndefined();
  });
});

describe("buildSessionMessages — restored history audit failed backfill", () => {
  it("restores session holding a tool isError: true result, a core-rejected call, and a successful call", () => {
    const rawAudits: AuditEntry[] = [
      { ts: 1000, name: "move_file", input: { source_path: "/a.md" }, outcomeSummary: "Error: /a.md does not exist." },
      { ts: 2000, name: "move_file", input: {}, outcomeSummary: "Could not read the arguments for move_file: ... the tool did not run" },
      { ts: 3000, name: "read_file", input: { file_path: "/b.md" }, outcomeSummary: "File content here" },
    ];

    const journal: JournalEntry[] = [
      entry("t1", "user", "run operations", 0),
      entry("t1", "assistant", [
        { type: "tool-call", toolCallId: "call-1", toolName: "move_file", input: { source_path: "/a.md" } },
      ], 1),
      entry("t1", "tool", [
        { type: "tool-result", toolCallId: "call-1", toolName: "move_file", output: "Error: /a.md does not exist.", isError: true },
      ], 2),
      entry("t1", "assistant", [
        { type: "tool-call", toolCallId: "call-2", toolName: "move_file", input: {} },
      ], 3),
      entry("t1", "tool", [
        { type: "tool-result", toolCallId: "call-2", toolName: "move_file", output: "Could not read the arguments for move_file: ... the tool did not run", isError: true },
      ], 4),
      entry("t1", "assistant", [
        { type: "tool-call", toolCallId: "call-3", toolName: "read_file", input: { file_path: "/b.md" } },
      ], 5),
      entry("t1", "tool", [
        { type: "tool-result", toolCallId: "call-3", toolName: "read_file", output: "File content here" },
      ], 6),
      entry("t1", "assistant", "finished", 7),
    ];

    const messages = buildSessionMessages(params(journal, undefined, rawAudits));
    const assistantMsg = messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();

    const trace = assistantMsg!.trace;
    expect(trace).toHaveLength(3);

    // Tool returning isError: true has failed: true
    expect(trace[0].name).toBe("move_file");
    expect(trace[0].failed).toBe(true);

    // Core-rejected call with isError: true has failed: true
    expect(trace[1].name).toBe("move_file");
    expect(trace[1].failed).toBe(true);

    // Successful tool call without isError has failed: false
    expect(trace[2].name).toBe("read_file");
    expect(trace[2].failed).toBe(false);

    // Also assert parts for the tool step lines forward the same failed flags
    const toolParts = assistantMsg!.parts?.filter((p) => p.kind === "tool") as Array<{ kind: "tool"; audit: AuditEntry }>;
    expect(toolParts).toHaveLength(3);
    expect(toolParts[0].audit.failed).toBe(true);
    expect(toolParts[1].audit.failed).toBe(true);
    expect(toolParts[2].audit.failed).toBe(false);
  });
});

describe("buildSessionMessages — unknown-tool calls are not rendered as tool steps", () => {
  it("omits the step line for a call core refused as unknown, keeping text and real steps", () => {
    const rawAudits: AuditEntry[] = [
      {
        ts: 1000,
        name: "page_screenshot",
        input: {},
        outcomeSummary: "Unknown tool: page_screenshot",
        failed: true,
        unknownTool: true,
      },
      {
        ts: 2000,
        name: "page_console",
        input: { level: "error" },
        outcomeSummary: "no errors",
      },
    ];
    const journal: JournalEntry[] = [
      entry("t1", "user", "take a screenshot", 0),
      entry("t1", "assistant", [
        { type: "text", text: "I have no screenshot tool." },
        { type: "tool-call", toolCallId: "call-1", toolName: "page_screenshot", input: {} },
      ], 1),
      entry("t1", "tool", [
        { type: "tool-result", toolCallId: "call-1", toolName: "page_screenshot", output: "Unknown tool: page_screenshot", isError: true },
      ], 2),
      entry("t1", "assistant", [
        { type: "tool-call", toolCallId: "call-2", toolName: "page_console", input: { level: "error" } },
      ], 3),
      entry("t1", "tool", [
        { type: "tool-result", toolCallId: "call-2", toolName: "page_console", output: "no errors" },
      ], 4),
      entry("t1", "assistant", "done", 5),
    ];

    const messages = buildSessionMessages(params(journal, undefined, rawAudits));
    const assistantMsg = messages.find((m) => m.role === "assistant");
    const toolParts = assistantMsg!.parts?.filter((p) => p.kind === "tool");
    expect(toolParts?.map((p) => (p.kind === "tool" ? p.audit?.name : undefined)))
      .toEqual(["page_console"]);
    // The honest trace still records the attempt, flagged as unknown.
    expect(assistantMsg!.trace?.map((t) => t.name)).toEqual(["page_screenshot", "page_console"]);
    expect(assistantMsg!.trace?.[0].unknownTool).toBe(true);
  });

  describe("buildSessionMessages — tool images", () => {
    it("attaches saved tool images to audit.images without mutating rawAudits", () => {
      const imgA = { dataUrl: "data:image/png;base64,AAAA", mediaType: "image/png" };
      const rawAudits = [
        { toolCallId: "call-1", name: "read_file", input: { path: "a.png" }, outcomeSummary: "ok" },
        { toolCallId: "call-2", name: "other_tool", input: {}, outcomeSummary: "ok" },
      ] as unknown as AuditEntry[];

      const toolEntry = entry(
        "t1",
        "tool",
        [
          { type: "tool-result", toolCallId: "call-1", toolName: "read_file", output: "ok" },
          { type: "tool-result", toolCallId: "call-2", toolName: "other_tool", output: "ok" },
        ],
        2,
      );
      toolEntry.meta.toolImages = { "call-1": [imgA] };

      const journal: JournalEntry[] = [
        entry("t1", "user", "read it", 0),
        entry(
          "t1",
          "assistant",
          [
            { type: "tool-call", toolCallId: "call-1", toolName: "read_file", input: { path: "a.png" } },
            { type: "tool-call", toolCallId: "call-2", toolName: "other_tool", input: {} },
          ],
          1,
        ),
        toolEntry,
        entry("t1", "assistant", "done", 3),
      ];

      const messages = buildSessionMessages(params(journal, undefined, rawAudits));
      const assistantMsg = messages.find((m) => m.role === "assistant");
      const toolParts = assistantMsg!.parts?.filter((p) => p.kind === "tool");

      expect(toolParts).toHaveLength(2);
      expect(toolParts?.[0].kind === "tool" ? toolParts[0].audit?.images : undefined).toEqual([imgA]);
      expect("images" in rawAudits[0]).toBe(false);
      expect(toolParts?.[1].kind === "tool" ? toolParts[1].audit?.images : undefined).toBeUndefined();
    });
  });
});

