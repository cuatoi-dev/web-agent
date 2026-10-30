import { describe, it, expect, beforeEach, vi } from "vitest";
import { ContextManager, classifyParts, type AuditEntry, type JournalEntry } from "./context-manager.js";
import type { ModelMessage, ContentPart, TextPart, ImagePart, ToolResultPart } from "../types.js";
import type { ToolTtlPolicy } from "./context-manager.js";
import { ContextConfig } from "../config.js";


const TEST_CFG: ContextConfig = {
  kTurnsVerbatim: 3,
  contextLength: 600,
  autoCompactPercent: 200 / 600,
  charsPerToken: 4,
  jsonOverhead: 1.15,
  compactionMaxTokens: 100,
};

describe("ContextManager", () => {
  let cm: ContextManager;

  beforeEach(() => {
    cm = new ContextManager(TEST_CFG);
  });

  // ------------------------------------------------------------
  // P0: Tagging at Append
  // ------------------------------------------------------------
  describe("P0: Tagging", () => {
    it("classifies user prose and ui actions", () => {
      const u1: ModelMessage = { role: "user", content: "hello world" };
      const u2: ModelMessage = { role: "user", content: "[ui_action:click] 1" };

      expect(classifyParts(u1)).toEqual(["user_prose"]);
      expect(classifyParts(u2)).toEqual(["ui_action"]);
    });

    it("classifies assistant prose and ui blocks", () => {
      const a1: ModelMessage = { role: "assistant", content: "I will click it." };
      const a2: ModelMessage = { role: "assistant", content: "Check this out:\n```ui\n{\n  \"type\": \"chart\"\n}\n```" };

      expect(classifyParts(a1)).toEqual(["assistant_prose"]);
      expect(classifyParts(a2)).toEqual(["assistant_ui_block"]);
    });

    it("classifies tool result parts by toolName", () => {
      const t1: ModelMessage = {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "snapshot_page",
            output: { type: "text", value: "generation: 1\nbody content" }
          }
        ]
      };
      const t2: ModelMessage = {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c2",
            toolName: "query_state",
            output: { type: "json", value: { total_matches: 5 } }
          }
        ]
      };
      const t3: ModelMessage = {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c3",
            toolName: "click",
            output: { type: "text", value: "Clicked [1] button" }
          }
        ]
      };
      const t4: ModelMessage = {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c4",
            toolName: "wait_for",
            output: { type: "text", value: "Condition met" }
          }
        ]
      };

      expect(classifyParts(t1)).toEqual(["tool_result_snapshot"]);
      expect(classifyParts(t2)).toEqual(["tool_result_query"]);
      expect(classifyParts(t3)).toEqual(["tool_result_action"]);
      expect(classifyParts(t4)).toEqual(["tool_result_wait"]);
    });
  });

  // ------------------------------------------------------------
  // I4 Invariant
  // ------------------------------------------------------------
  describe("I4: Verbatim Latest Snapshot", () => {
    it("never redacts the latest snapshot", () => {
      const panicCm = new ContextManager({
        ...TEST_CFG,
        contextLength: 50,
      });

      panicCm.appendUser({ role: "user", content: "A very long message to blow up budget limits rapidly" });
      const call: ModelMessage = {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "sc", toolName: "snapshot_page", input: {} }]
      };
      const result: ModelMessage = {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "sc", toolName: "snapshot_page", output: { type: "text", value: "generation: 4\nlatest snapshot data verbatim" } }]
      };
      panicCm.recordStep([call]);
      panicCm.recordStep([result]);
      panicCm.commitTurn();

      // Drive it through the sweep: four same-argument results, ttl: 1, so the
      // newest is never redacted.
      for (let i = 2; i <= 4; i++) {
        panicCm.appendUser({ role: "user", content: `turn ${i}` });
        const c: ModelMessage = {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: `sc${i}`, toolName: "snapshot_page", input: {} }]
        };
        const r: ModelMessage = {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: `sc${i}`, toolName: "snapshot_page", output: { type: "text", value: `generation: ${i}\nsnapshot ${i}` } }]
        };
        panicCm.recordStep([c]);
        panicCm.recordStep([r]);
        panicCm.commitTurn();
      }

      panicCm.redactExpiredResults([{ name: "snapshot_page", ttl: 1 }]);
      panicCm.mode = "assert";
      expect(() => panicCm.compose()).not.toThrow();

      // The newest snapshot's output is verbatim.
      const lastTool = [...panicCm.journal].reverse().find((e) => e.msg.role === "tool")!;
      const part = (lastTool.msg.content as ToolResultPart[])[0];
      expect(part.output).toEqual({ type: "text", value: "generation: 4\nsnapshot 4" });
    });
  });

  // ------------------------------------------------------------
  // P4: Budget enforcement (AC d)
  // ------------------------------------------------------------
  describe("P4: Budget Enforcement", () => {
    it("sets needsCompaction when auto-compaction threshold is exceeded", () => {
      // Exceeding soft budget requires a very long payload
      cm.appendUser({ role: "user", content: "A".repeat(1000) });
      cm.recordStep([{ role: "assistant", content: "Reply payload" }]);
      cm.commitTurn();

      cm.compose();
      expect(cm.needsCompaction).toBe(true);
    });
  });

  // ------------------------------------------------------------
  // Idempotency (AC e)
  // ------------------------------------------------------------
  describe("Idempotency", () => {
    it("yields structurally equal output when compose() is called twice", () => {
      cm.appendUser({ role: "user", content: "Idempotency test user" });
      cm.recordStep([{ role: "assistant", content: "Idempotency assistant" }]);
      cm.commitTurn();

      const r1 = cm.compose();
      const r2 = cm.compose();

      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });
  });

  // ------------------------------------------------------------
  // Invariants & Validation
  // ------------------------------------------------------------
  describe("Invariants & Validation", () => {
    it("throws error for I2 role alternation violation in validateWorkingContext", () => {
      const invalidMsgs: ModelMessage[] = [
        { role: "user", content: "U1" },
        { role: "user", content: "U2" }
      ];

      expect(() => cm.validateWorkingContext(invalidMsgs)).toThrow("I2 violation");
    });

    it("throws error for I1 tool pairing mismatch", () => {
      const mismatchMsgs: ModelMessage[] = [
        { role: "user", content: "U1" },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "err-c", toolName: "click", input: {} }]
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "other-c", toolName: "click", output: { type: "text", value: "ok" } }]
        },
        { role: "assistant", content: "A1" }
      ];

      expect(() => cm.validateWorkingContext(mismatchMsgs)).toThrow("I1 violation");
    });

    it("puts the summary in its own head message, not prefixed into the first kept user message", () => {
      for (let i = 1; i <= 4; i++) {
        cm.appendUser({ role: "user", content: `User turn ${i}` });
        cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
        cm.commitTurn();
      }
      cm.appendTombstone("Summary text");

      const working = cm.compose();
      expect(working[0]).toEqual({
        role: "user",
        content: "[conversation summary]\nSummary text",
      });
      expect(working[1].content).not.toContain("[conversation summary]");
    });

    it("validator: mode:'assert' throws on an invalid sequence; mode:'warn' logs and returns the candidate", () => {
      const invalidMsgs: ModelMessage[] = [
        { role: "user", content: "U1" },
        { role: "user", content: "U2" }
      ];

      // In assert mode, it must throw
      cm.mode = "assert";
      expect(() => cm.validateWorkingContext(invalidMsgs)).toThrow("I2 violation");

      // In warn mode, it must log a warning and return without throwing
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      cm.mode = "warn";
      expect(() => cm.validateWorkingContext(invalidMsgs)).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("returns correct usage data via getUsage()", () => {
      const usageCm = new ContextManager({
        ...TEST_CFG,
        contextLength: 1000,
      });
      expect(usageCm.getUsage()).toEqual({ tokens: 0, max: 1000, percent: 0 });

      usageCm.appendUser({ role: "user", content: "Hello world" });
      const usage = usageCm.getUsage();
      expect(usage.max).toBe(1000);
      expect(usage.tokens).toBeGreaterThan(0);
      expect(usage.percent).toBe(usage.tokens / 1000);
    });

    it("clears journal, needsCompaction, and usage on reset()", () => {
      cm.appendUser({ role: "user", content: "Hello world" });
      cm.recordStep([{ role: "assistant", content: "A".repeat(1000) }]);
      cm.commitTurn();
      cm.compose();

      expect(cm.journal.length).toBeGreaterThan(0);
      expect(cm.needsCompaction).toBe(true);
      expect(cm.getUsage().tokens).toBeGreaterThan(0);

      cm.reset();

      expect(cm.journal.length).toBe(0);
      expect(cm.needsCompaction).toBe(false);
      expect(cm.getUsage().tokens).toBe(0);
    });
  });

  // ------------------------------------------------------------
  // Multimodal message support
  // ------------------------------------------------------------
  describe("Multimodal messages", () => {
    it("stores array content in journal when images present via widened appendUser", () => {
      cm.appendUser({
        role: "user",
        content: [
          { type: "text", text: "hi" },
          { type: "image", image: "data:image/png;base64,abc", mediaType: "image/png" },
        ],
      });
      expect(cm.journal.length).toBe(1);
      expect(Array.isArray(cm.journal[0].msg.content)).toBe(true);
      const parts = cm.journal[0].msg.content as ContentPart[];
      expect(parts[0]).toEqual({ type: "text", text: "hi" });
      expect(parts[1].type).toBe("image");
      expect((parts[1] as ImagePart).image).toBe("data:image/png;base64,abc");
    });

    it("classifyParts returns user_prose for image parts", () => {
      const msg: ModelMessage = {
        role: "user",
        content: [{ type: "image", image: "data:image/png;base64,abc", mediaType: "image/png" }],
      };
      expect(classifyParts(msg)).toEqual(["user_prose"]);
    });

    it("turnsToCompact returns the eligible turn ids (serialisation removed, task 001)", () => {
      const compactCm = new ContextManager({
        ...TEST_CFG,
        kTurnsVerbatim: 1,  // only keep last 1 turn verbatim
      });
      compactCm.appendUser({
        role: "user",
        content: [
          { type: "text", text: "what is this" },
          { type: "image", image: "data:image/png;base64,verylongbase64data", mediaType: "image/png" },
        ],
      });
      compactCm.recordStep([{ role: "assistant", content: "That's a test image" }]);
      compactCm.commitTurn();

      compactCm.appendUser({ role: "user", content: "follow up" });
      compactCm.recordStep([{ role: "assistant", content: "ok" }]);
      compactCm.commitTurn();

      const compact = compactCm.turnsToCompact();
      expect(compact.turnIds.length).toBe(1);
      // Compaction now sends the full history plus one appended user turn
      // (loop/compaction.ts) instead of a serialized string.
      expect(compact.serialized).toBe("");
    });

    it("compose() passes through array-content user message to ModelMessage array", () => {
      cm.appendUser({
        role: "user",
        content: [
          { type: "text", text: "describe this" },
          { type: "image", image: "data:image/png;base64,imgdata", mediaType: "image/png" },
        ],
      });
      cm.recordStep([{ role: "assistant", content: "A serene landscape" }]);
      cm.commitTurn();

      const msgs = cm.compose();
      expect(msgs.length).toBeGreaterThanOrEqual(2);
      const userMsg = msgs[0];
      expect(userMsg.role).toBe("user");
      expect(Array.isArray(userMsg.content)).toBe(true);
      const parts = userMsg.content as ContentPart[];
      expect(parts[0].type).toBe("text");
      expect((parts[0] as TextPart).text).toBe("describe this");
      expect(parts[1].type).toBe("image");
      expect((parts[1] as ImagePart).image).toBe("data:image/png;base64,imgdata");
    });
  });

  describe("Response usage anchor", () => {
    it("recordUsage establishes real anchor and getUsage calculates anchor + delta", () => {
      const customCm = new ContextManager({
        ...TEST_CFG,
        charsPerToken: 4,
        jsonOverhead: 1.0,
      });

      customCm.appendUser({ role: "user", content: "hello" });
      
      // recordUsage with cache tokens
      customCm.recordUsage({ inputTokens: 500, cacheReadTokens: 100, cacheCreationTokens: 50 });
      // anchor = 500 + 100 + 50 = 650
      expect(customCm.getUsage().tokens).toBe(650);

      // Now add another message with known length
      const nextMsg: ModelMessage = { role: "assistant", content: "hi" };
      customCm.recordStep([nextMsg]);

      const expectedDelta = customCm.estimateTokens([nextMsg]);
      expect(customCm.getUsage().tokens).toBe(650 + expectedDelta);
    });

    it("reset() clears last known token anchor", () => {
      cm.appendUser({ role: "user", content: "hello" });
      cm.recordUsage({ inputTokens: 500 });
      expect(cm.getUsage().tokens).toBe(500);

      cm.reset();
      expect(cm.getUsage().tokens).toBe(0);

      cm.appendUser({ role: "user", content: "hello" });
      const expectedPure = cm.estimateTokens(cm.compose());
      expect(cm.getUsage().tokens).toBe(expectedPure);
    });

    it("appendTombstone invalidates the anchor, so a compaction changes getUsage() instead of being invisible to it", () => {
      // Mirrors the live app: a real turn reports real provider usage,
      // putting getUsage() on the anchor+delta fast path. Before this fix,
      // compaction left that anchor untouched, so getUsage() before and
      // after compaction returned the exact same number — the hook fired,
      // but the token accounting had no idea anything happened.
      cm.appendUser({ role: "user", content: "Turn 1" });
      cm.recordStep([{ role: "assistant", content: "reply 1" }]);
      cm.commitTurn();
      cm.recordUsage({ inputTokens: 500 });

      const before = cm.getUsage().tokens;
      expect(before).toBe(500);

      cm.appendTombstone("SUMMARY");

      const after = cm.getUsage().tokens;
      expect(after).not.toBe(before);
      // Falls back to an honest recompute over the rebuilt context,
      // the same estimate compose()/getUsage() would produce unaided.
      expect(after).toBe(cm.estimateTokens(cm.compose()));
    });
  });

  // ------------------------------------------------------------
  // truncateLastTurn
  // ------------------------------------------------------------
  describe("truncateLastTurn", () => {
    it("removes a partial last turn", () => {
      const userA: ModelMessage = { role: "user", content: "hello user A" };
      const assistantA: ModelMessage = { role: "assistant", content: "hello assistant A" };
      cm.appendUser(userA);
      cm.recordStep([assistantA]);
      cm.commitTurn();

      const turnA = cm.journal[0].meta.turnId;

      const userB: ModelMessage = { role: "user", content: "hello user B" };
      const partialB: ModelMessage = { role: "assistant", content: "hello partial B" };
      cm.appendUser(userB);
      cm.recordStep([partialB]);

      const removed = cm.truncateLastTurn();

      expect(cm.journal.length).toBe(2);
      expect(cm.journal[0].msg).toEqual(userA);
      expect(cm.journal[1].msg).toEqual(assistantA);
      expect(cm.getCompletedTurnsInOrder()).toEqual([turnA]);

      expect(removed.length).toBe(2);
      expect(removed[0].msg).toEqual(userB);
      expect(removed[1].msg).toEqual(partialB);
    });

    it("prior turns intact / rehydrates identically", () => {
      const userA: ModelMessage = { role: "user", content: "hello user A" };
      const assistantA: ModelMessage = { role: "assistant", content: "hello assistant A" };
      cm.appendUser(userA);
      cm.recordStep([assistantA]);
      cm.commitTurn();

      const journalPre = JSON.stringify(cm.journal);
      const auditPre = JSON.stringify(cm.audit);
      const usagePre = cm.getUsage().tokens;
      const composePre = JSON.stringify(cm.compose());

      cm.appendUser({ role: "user", content: "hello user B" });
      cm.recordStep([{ role: "assistant", content: "hello partial B" }]);
      cm.truncateLastTurn();

      expect(JSON.stringify(cm.journal)).toBe(journalPre);
      expect(JSON.stringify(cm.audit)).toBe(auditPre);
      expect(cm.getUsage().tokens).toBe(usagePre);
      expect(JSON.stringify(cm.compose())).toBe(composePre);

      const cm2 = new ContextManager(TEST_CFG);
      cm2.appendUser(userA);
      cm2.recordStep([assistantA]);
      cm2.commitTurn();
      expect(cm.journal.map(e => e.msg)).toEqual(cm2.journal.map(e => e.msg));
    });

    it("audit + turnAudits stay consistent", () => {
      const aeA: AuditEntry = { ts: Date.now(), name: "click", input: {}, outcomeSummary: "Clicked turn A" };
      cm.appendUser({ role: "user", content: "turn A" });
      cm.recordStep([{ role: "assistant", content: "ok" }], [aeA]);
      cm.commitTurn();

      const aeB: AuditEntry = { ts: Date.now(), name: "click", input: {}, outcomeSummary: "Clicked turn B" };
      cm.appendUser({ role: "user", content: "turn B" });
      cm.recordStep([{ role: "assistant", content: "ok B" }], [aeB]);

      cm.truncateLastTurn();

      expect(cm.audit).toContain(aeA);
      expect(cm.audit).not.toContain(aeB);

      const aeC: AuditEntry = { ts: Date.now(), name: "click", input: {}, outcomeSummary: "Clicked turn C" };
      cm.appendUser({ role: "user", content: "turn C" });
      cm.recordStep([{ role: "assistant", content: "ok C" }], [aeC]);

      expect(cm.audit).toContain(aeA);
      expect(cm.audit).toContain(aeC);
      expect(cm.audit).not.toContain(aeB);
    });

    it("no double-append after truncate + re-run", () => {
      cm.appendUser({ role: "user", content: "turn A" });
      cm.recordStep([{ role: "assistant", content: "ok" }]);
      cm.truncateLastTurn();

      cm.appendUser({ role: "user", content: "turn A retry" });
      cm.recordStep([{ role: "assistant", content: "ok retry" }]);
      cm.commitTurn();

      expect(cm.journal.filter(e => e.msg.role === "user").length).toBe(1);
      expect(cm.getCompletedTurnsInOrder().length).toBe(1);
    });

    it("pointers reset", () => {
      cm.appendUser({ role: "user", content: "turn A" });
      cm.recordStep([{ role: "assistant", content: "ok" }]);
      cm.truncateLastTurn();

      expect(cm.journal.length).toBe(0);
      expect(cm.getUsage().tokens).toBe(0);

      cm.appendUser({ role: "user", content: "turn B" });
      expect(cm.journal[0].meta.stepNo).toBe(0);
    });

    it("empty journal is a no-op", () => {
      const removed = cm.truncateLastTurn();
      expect(removed).toEqual([]);
      expect(cm.journal.length).toBe(0);
      expect(cm.audit.length).toBe(0);
    });

    it("a tombstone in an earlier turn survives truncateLastTurn", () => {
      cm.appendUser({ role: "user", content: "turn A" });
      cm.recordStep([{ role: "assistant", content: "ok" }]);
      cm.commitTurn();

      cm.appendTombstone("Summary for turn A");

      cm.appendUser({ role: "user", content: "turn B" });
      cm.recordStep([{ role: "assistant", content: "ok B" }]);
      
      cm.truncateLastTurn();

      expect(cm.journal.some(e => e.meta.tombstone)).toBe(true);
      expect(cm.compose()[0].content).toContain("[conversation summary]");
    });
  });

  describe("appendUser (007: pointedItems removed, userDisplayText + promptMeta remain)", () => {
    it("stores userDisplayText and promptMeta when passed", () => {
      const meta = { tag: "test" };
      cm.appendUser({ role: "user", content: "full prompt" }, "typed prose", meta);
      const last = cm.journal[cm.journal.length - 1];
      expect(last.meta.userDisplayText).toBe("typed prose");
      expect(last.meta.promptMeta).toBe(meta);
    });

    it("leaves userDisplayText/promptMeta undefined for the existing 1-arg call shape", () => {
      cm.appendUser({ role: "user", content: "hi" });
      const last = cm.journal[cm.journal.length - 1];
      expect(last.meta.userDisplayText).toBeUndefined();
      expect(last.meta.promptMeta).toBeUndefined();
    });
  });

  // ------------------------------------------------------------
  // 011: commitTurn deduplication
  // ------------------------------------------------------------
  describe("commitTurn deduplication (011)", () => {
    it("does not serialize messages recordStep already journaled", () => {
      cm.appendUser({ role: "user", content: "hi" });
      const assistant: ModelMessage = { role: "assistant", content: "hello" };
      cm.recordStep([assistant]);

      const stringify = vi.spyOn(JSON, "stringify");
      cm.commitTurn([assistant]);
      expect(stringify).not.toHaveBeenCalled();
      stringify.mockRestore();

      expect(cm.journal.filter((e) => e.msg === assistant)).toHaveLength(1);
    });

    it("still deduplicates a structurally equal clone, and appends a new message", () => {
      cm.appendUser({ role: "user", content: "hi" });
      const assistant: ModelMessage = { role: "assistant", content: "hello" };
      cm.recordStep([assistant]);

      const clone: ModelMessage = JSON.parse(JSON.stringify(assistant)) as ModelMessage;
      const fresh: ModelMessage = { role: "assistant", content: "later" };
      cm.commitTurn([clone, fresh]);

      expect(cm.journal.some((e) => e.msg === clone)).toBe(false);
      expect(cm.journal.filter((e) => e.msg === fresh)).toHaveLength(1);
      expect(cm.journal).toHaveLength(3);
    });
  });

  // ------------------------------------------------------------
  // 074: activeTurnId getter
  // ------------------------------------------------------------
  describe("activeTurnId (074)", () => {
    it("activeTurnId reflects an open turn and clears on commit", () => {
      expect(cm.activeTurnId).toBeUndefined();

      cm.appendUser({ role: "user", content: "hello" });
      const tid = cm.activeTurnId;
      expect(tid).toBeTruthy();
      expect(typeof tid).toBe("string");

      // still open after recordStep
      cm.recordStep([{ role: "assistant", content: "thinking..." }]);
      expect(cm.activeTurnId).toBe(tid);

      // clears after commitTurn
      cm.commitTurn();
      expect(cm.activeTurnId).toBeUndefined();
    });

    it("activeTurnId is undefined before any turn is opened", () => {
      expect(cm.activeTurnId).toBeUndefined();
    });
  });

  describe("getUsage() memoization and version tracking", () => {
    it("memoizes getUsage() until journal or state version changes", () => {
      const mgr = new ContextManager(TEST_CFG);
      mgr.appendUser({ role: "user", content: "hello" });

      const u1 = mgr.getUsage();
      const u2 = mgr.getUsage();
      expect(u1).toBe(u2); // exact reference equality

      const nextMsg: ModelMessage = { role: "assistant", content: "hi" };
      mgr.recordStep([nextMsg]);
      const u3 = mgr.getUsage();
      expect(u3).not.toBe(u1);
      expect(u3.tokens).toBeGreaterThan(u1.tokens);

      const u4 = mgr.getUsage();
      expect(u4).toBe(u3);

      mgr.recordUsage({ inputTokens: 500 });
      const u5 = mgr.getUsage();
      expect(u5).not.toBe(u4);
      expect(u5.tokens).toBe(500);
    });

    it("getUsage() remains accurate after truncateLastTurn and reset", () => {
      const mgr = new ContextManager(TEST_CFG);
      mgr.appendUser({ role: "user", content: "turn 1" });
      mgr.recordStep([{ role: "assistant", content: "reply 1" }]);
      mgr.commitTurn();

      mgr.appendUser({ role: "user", content: "turn 2" });
      mgr.recordStep([{ role: "assistant", content: "reply 2" }]);

      const uTurn2 = mgr.getUsage();
      const versionBefore = mgr.version;

      mgr.truncateLastTurn();
      expect(mgr.version).toBeGreaterThan(versionBefore);

      const uTruncated = mgr.getUsage();
      expect(uTruncated).not.toBe(uTurn2);
      expect(uTruncated.tokens).toBeLessThan(uTurn2.tokens);

      mgr.reset();
      const uReset = mgr.getUsage();
      expect(uReset.tokens).toBe(0);
      expect(uReset.percent).toBe(0);
    });
  });

  // ------------------------------------------------------------
  // Tombstone context rebuild (107/002)
  // ------------------------------------------------------------
  describe("Tombstone context rebuild (107/002)", () => {
    it("no tombstone keeps every turn", () => {
      const largeCm = new ContextManager({
        ...TEST_CFG,
        contextLength: 100_000,
      });

      for (let i = 1; i <= 12; i++) {
        largeCm.appendUser({ role: "user", content: `Unique user query ${i}` });
        largeCm.recordStep([{ role: "assistant", content: `Assistant answer ${i}` }]);
        largeCm.commitTurn();
      }

      const composed = largeCm.compose();
      expect(composed.length).toBe(largeCm.journal.length);
      for (let i = 1; i <= 12; i++) {
        expect(composed.some((m) => m.content === `Unique user query ${i}`)).toBe(true);
      }
    });

    it("appendTombstone appends and rewrites nothing", () => {
      for (let i = 1; i <= 3; i++) {
        cm.appendUser({ role: "user", content: `User turn ${i}` });
        cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
        cm.commitTurn();
      }

      const snapshotBefore = JSON.stringify(cm.journal);
      cm.appendTombstone("SUMMARY TEXT");

      expect(cm.journal.length).toBe(JSON.parse(snapshotBefore).length + 1);
      expect(JSON.stringify(cm.journal.slice(0, -1))).toBe(snapshotBefore);
      expect(cm.journal[cm.journal.length - 1].meta.tombstone?.summary).toBe("SUMMARY TEXT");
    });

    it("rebuild = summary + the 2 turns before + everything after", () => {
      for (let i = 1; i <= 5; i++) {
        cm.appendUser({ role: "user", content: `User turn ${i}` });
        cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
        cm.commitTurn();
      }

      cm.appendTombstone("SUMMARY OF 1-5");

      for (let i = 6; i <= 7; i++) {
        cm.appendUser({ role: "user", content: `User turn ${i}` });
        cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
        cm.commitTurn();
      }

      const composed = cm.compose();
      expect(composed[0]).toEqual({
        role: "user",
        content: "[conversation summary]\nSUMMARY OF 1-5",
      });

      const userMessages = composed.filter((m) => m.role === "user");
      // Summary + 2 turns before (4, 5) + 2 turns after (6, 7) = 5 user messages
      expect(userMessages.length).toBe(5);
      expect(userMessages[1].content).toBe("User turn 4");
      expect(userMessages[2].content).toBe("User turn 5");
      expect(userMessages[3].content).toBe("User turn 6");
      expect(userMessages[4].content).toBe("User turn 7");

      expect(composed.some((m) => m.content === "User turn 1")).toBe(false);
      expect(composed.some((m) => m.content === "User turn 2")).toBe(false);
      expect(composed.some((m) => m.content === "User turn 3")).toBe(false);
    });

    it("the cut lands on a turn start, never inside a tool call", () => {
      for (let i = 1; i <= 5; i++) {
        cm.appendUser({ role: "user", content: `User turn ${i}` });
        cm.recordStep([
          { role: "assistant", content: [{ type: "tool-call", toolCallId: `call-${i}`, toolName: "click", input: { ref: "1" } }] }
        ]);
        cm.recordStep([
          { role: "tool", content: [{ type: "tool-result", toolCallId: `call-${i}`, toolName: "click", output: { type: "text", value: "ok" } }] }
        ]);
        cm.recordStep([{ role: "assistant", content: `Done ${i}` }]);
        cm.commitTurn();
      }

      cm.appendTombstone("SUMMARY");

      const composed = cm.compose();
      expect(() => cm.validateWorkingContext(composed)).not.toThrow();

      // Check tool pairing in composed
      const calls = new Set<string>();
      const results = new Set<string>();
      for (const m of composed) {
        if (Array.isArray(m.content)) {
          for (const p of m.content) {
            if (p.type === "tool-call") calls.add(p.toolCallId);
            if (p.type === "tool-result") results.add(p.toolCallId);
          }
        }
      }
      expect(calls.size).toBe(results.size);
      for (const id of calls) {
        expect(results.has(id)).toBe(true);
      }
    });

    it("the second compaction cuts forward from the first tombstone", () => {
      for (let i = 1; i <= 4; i++) {
        cm.appendUser({ role: "user", content: `Turn ${i}` });
        cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
        cm.commitTurn();
      }

      cm.appendTombstone("FIRST SUMMARY");

      for (let i = 5; i <= 7; i++) {
        cm.appendUser({ role: "user", content: `Turn ${i}` });
        cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
        cm.commitTurn();
      }

      cm.appendTombstone("SECOND SUMMARY");

      const composed = cm.compose();
      expect(composed[0].content).toContain("SECOND SUMMARY");
      expect(JSON.stringify(composed)).not.toContain("FIRST SUMMARY");
    });

    it("an older tombstone inside the kept window emits no empty message", () => {
      for (let i = 1; i <= 3; i++) {
        cm.appendUser({ role: "user", content: `Turn ${i}` });
        cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
        cm.commitTurn();
      }

      cm.appendTombstone("FIRST SUMMARY");

      // Only 1 turn between compactions
      cm.appendUser({ role: "user", content: "Turn 4" });
      cm.recordStep([{ role: "assistant", content: "Reply 4" }]);
      cm.commitTurn();

      cm.appendTombstone("SECOND SUMMARY");

      const composed = cm.compose();
      expect(() => cm.validateWorkingContext(composed)).not.toThrow();
      for (const m of composed) {
        expect(m.content).not.toBe("");
      }
    });

    it("the tombstone entry contributes no message to the request", () => {
      for (let i = 1; i <= 4; i++) {
        cm.appendUser({ role: "user", content: `Turn ${i}` });
        cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
        cm.commitTurn();
      }

      cm.appendTombstone("SUMMARY");

      const composed = cm.compose();
      for (const m of composed) {
        expect(m.content).not.toBe("");
      }
    });
  });

  describe("messagesSummarisedByLastTombstone (idea 105/004)", () => {
    it("returns 0 when no tombstone exists in the journal", () => {
      for (let i = 1; i <= 3; i++) {
        cm.appendUser({ role: "user", content: `Turn ${i}` });
        cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
        cm.commitTurn();
      }

      expect(cm.messagesSummarisedByLastTombstone()).toBe(0);
    });

    it("returns dropped entry count excluding the 2 kept turns", () => {
      // 5 turns = 10 entries (user + reply each). The 2 kept turns before the
      // tombstone are turns 4 and 5 (4 entries); turns 1-3 (6 entries) drop.
      for (let i = 1; i <= 5; i++) {
        cm.appendUser({ role: "user", content: `Turn ${i}` });
        cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
        cm.commitTurn();
      }

      cm.appendTombstone("SUMMARY OF 1-5");

      expect(cm.messagesSummarisedByLastTombstone()).toBe(6);
    });

    it("counts a single dropped message when only 1 entry precedes the kept turns", () => {
      // A user turn with no assistant reply yet, followed by 2 full turns,
      // then a tombstone: only the first bare user entry is dropped.
      cm.appendUser({ role: "user", content: "Orphan turn" });
      cm.commitTurn();

      for (let i = 1; i <= 2; i++) {
        cm.appendUser({ role: "user", content: `Turn ${i}` });
        cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
        cm.commitTurn();
      }

      cm.appendTombstone("SUMMARY");

      expect(cm.messagesSummarisedByLastTombstone()).toBe(1);
    });

    it("second compaction excludes the previous tombstone from the count", () => {
      for (let i = 1; i <= 4; i++) {
        cm.appendUser({ role: "user", content: `Turn ${i}` });
        cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
        cm.commitTurn();
      }

      cm.appendTombstone("FIRST SUMMARY");
      expect(cm.messagesSummarisedByLastTombstone()).toBe(4);

      for (let i = 5; i <= 7; i++) {
        cm.appendUser({ role: "user", content: `Turn ${i}` });
        cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
        cm.commitTurn();
      }

      cm.appendTombstone("SECOND SUMMARY");

      // The count walks the whole journal from the start, not just since the
      // first tombstone: turns 1-4 (8 entries) + turn 5 (2 entries) = 10
      // dropped, keeping turns 6-7. The first tombstone MARKER itself is
      // excluded (it is not a message), but the turns it already summarised
      // are still physical journal entries and are counted again.
      expect(cm.messagesSummarisedByLastTombstone()).toBe(10);
    });
  });

  describe("toolCallsRedactedByLastTombstone (idea 105/004, requirement change 1)", () => {
    it("returns 0 when no tombstone exists in the journal", () => {
      cm.appendUser({ role: "user", content: "Turn 1" });
      cm.recordStep([{ role: "assistant", content: "Reply 1" }]);
      cm.commitTurn();

      expect(cm.toolCallsRedactedByLastTombstone()).toBe(0);
    });

    it("counts tool-call parts among the dropped entries, not the kept ones", () => {
      // Turn 1: one tool call + result, dropped by the tombstone below.
      cm.appendUser({ role: "user", content: "Turn 1" });
      cm.recordStep([
        { role: "assistant", content: [{ type: "tool-call", toolCallId: "call-1", toolName: "click", input: {} }] },
      ]);
      cm.recordStep([
        { role: "tool", content: [{ type: "tool-result", toolCallId: "call-1", toolName: "click", output: { type: "text", value: "ok" } }] },
      ]);
      cm.recordStep([{ role: "assistant", content: "Done 1" }]);
      cm.commitTurn();

      // Turns 2-3: plain text, kept (the 2-turn window before the tombstone).
      for (let i = 2; i <= 3; i++) {
        cm.appendUser({ role: "user", content: `Turn ${i}` });
        cm.recordStep([
          { role: "assistant", content: [{ type: "tool-call", toolCallId: `call-${i}`, toolName: "click", input: {} }] },
        ]);
        cm.recordStep([
          { role: "tool", content: [{ type: "tool-result", toolCallId: `call-${i}`, toolName: "click", output: { type: "text", value: "ok" } }] },
        ]);
        cm.commitTurn();
      }

      cm.appendTombstone("SUMMARY");

      // Only turn 1's tool call is dropped; turns 2-3 are kept, so their tool
      // calls do not count as redacted.
      expect(cm.toolCallsRedactedByLastTombstone()).toBe(1);
    });

    it("counts multiple tool-call parts in a single message", () => {
      cm.appendUser({ role: "user", content: "Turn 1" });
      cm.recordStep([
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "call-1", toolName: "click", input: {} },
            { type: "tool-call", toolCallId: "call-2", toolName: "fill", input: {} },
          ],
        },
      ]);
      cm.commitTurn();

      for (let i = 2; i <= 3; i++) {
        cm.appendUser({ role: "user", content: `Turn ${i}` });
        cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
        cm.commitTurn();
      }

      cm.appendTombstone("SUMMARY");

      expect(cm.toolCallsRedactedByLastTombstone()).toBe(2);
    });

    it("returns 0 when the dropped range has no tool calls", () => {
      for (let i = 1; i <= 3; i++) {
        cm.appendUser({ role: "user", content: `Turn ${i}` });
        cm.recordStep([{ role: "assistant", content: `Reply ${i}` }]);
        cm.commitTurn();
      }

      cm.appendTombstone("SUMMARY");

      expect(cm.toolCallsRedactedByLastTombstone()).toBe(0);
    });
  });

  // -----------------------------------------------------------
  // 107/004: per-tool result TTL
  // -----------------------------------------------------------
  describe("107/004: per-tool result TTL", () => {
    /** Helper: build a journal with one user turn containing N tool calls and
     *  results, using the real API so meta.userTurn is stamped correctly. */
    function buildTurnWithResults(
      n: number,
      toolName: string,
      input: Record<string, unknown>,
    ) {
      const cm = new ContextManager({ ...TEST_CFG, contextLength: 100_000 });
      cm.appendUser({ role: "user", content: "go" });
      const calls: ModelMessage = {
        role: "assistant",
        content: Array.from({ length: n }, (_, i) => ({
          type: "tool-call" as const,
          toolCallId: `c${i + 1}`,
          toolName,
          input,
        })),
      };
      cm.recordStep([calls]);
      const results: ModelMessage = {
        role: "tool",
        content: Array.from({ length: n }, (_, i) => ({
          type: "tool-result" as const,
          toolCallId: `c${i + 1}`,
          toolName,
          output: { type: "text", value: `result ${i + 1}` },
        })),
      };
      cm.recordStep([results]);
      cm.commitTurn();
      return cm;
    }

    it("1. declares neither: never redacted", () => {
      const c = buildTurnWithResults(6, "my_tool", {});
      const defs: ToolTtlPolicy[] = [{ name: "my_tool" }];
      expect(c.redactExpiredResults(defs)).toBe(0);
      for (const e of c.journal) {
        if (e.msg.role !== "tool" || !Array.isArray(e.msg.content)) continue;
        for (const p of e.msg.content) {
          if (p.type === "tool-result") {
            expect(p.redacted).toBeUndefined();
          }
        }
      }
    });

    it("2. ttl: 1, same arguments → newest 1 intact, oldest 3 redacted", () => {
      const c = buildTurnWithResults(4, "snapshot_page", { ref: "main" });
      const defs: ToolTtlPolicy[] = [{ name: "snapshot_page", ttl: 1 }];
      expect(c.redactExpiredResults(defs)).toBe(3);
      const toolEntry = c.journal.find((e) => e.msg.role === "tool")!;
      const parts = toolEntry.msg.content as ToolResultPart[];
      expect(parts[0].redacted).toBe(true);
      expect(parts[1].redacted).toBe(true);
      expect(parts[2].redacted).toBe(true);
      expect(parts[3].redacted).toBeUndefined();
      // All toolCallIds still present (I1 pairing preserved)
      expect(parts.map((p) => p.toolCallId)).toEqual(["c1", "c2", "c3", "c4"]);
    });

    it("3. ttl: 3, four different arguments → all four intact", () => {
      const c = new ContextManager({ ...TEST_CFG, contextLength: 100_000 });
      c.appendUser({ role: "user", content: "go" });
      c.recordStep([{
        role: "assistant",
        content: ["a", "b", "c", "d"].map((ref, i) => ({
          type: "tool-call" as const, toolCallId: `c${i + 1}`, toolName: "query_state", input: { path: `$.${ref}` },
        })),
      }]);
      c.recordStep([{
        role: "tool",
        content: ["a", "b", "c", "d"].map((ref, i) => ({
          type: "tool-result" as const, toolCallId: `c${i + 1}`, toolName: "query_state",
          output: { type: "text", value: `snap ${ref}` },
        })),
      }]);
      c.commitTurn();

      const defs: ToolTtlPolicy[] = [{ name: "query_state", ttl: 3 }];
      expect(c.redactExpiredResults(defs)).toBe(0);
    });

    it("4. key order: {a:1,b:2} and {b:2,a:1} share one window", () => {
      const c = new ContextManager({ ...TEST_CFG, contextLength: 100_000 });
      c.appendUser({ role: "user", content: "go" });
      c.recordStep([{
        role: "assistant",
        content: [
          { type: "tool-call" as const, toolCallId: "c1", toolName: "snapshot_page", input: { a: 1, b: 2 } },
          { type: "tool-call" as const, toolCallId: "c2", toolName: "snapshot_page", input: { b: 2, a: 1 } },
        ],
      }]);
      c.recordStep([{
        role: "tool",
        content: [
          { type: "tool-result" as const, toolCallId: "c1", toolName: "snapshot_page", output: { type: "text", value: "r1" } },
          { type: "tool-result" as const, toolCallId: "c2", toolName: "snapshot_page", output: { type: "text", value: "r2" } },
        ],
      }]);
      c.commitTurn();

      const defs: ToolTtlPolicy[] = [{ name: "snapshot_page", ttl: 1 }];
      expect(c.redactExpiredResults(defs)).toBe(1);
      const toolEntry = c.journal.find((e) => e.msg.role === "tool")!;
      const parts = toolEntry.msg.content as ToolResultPart[];
      // The older one (c1) is redacted
      expect(parts[0].redacted).toBe(true);
      expect(parts[1].redacted).toBeUndefined();
    });

    it("5. uttl: 2, result from 3 turns ago is expired", () => {
      // Build turn 1 with a result
      const c = new ContextManager({ ...TEST_CFG, contextLength: 100_000 });
      c.appendUser({ role: "user", content: "turn 1" });
      c.recordStep([{ role: "assistant", content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "my_tool", input: {} }] }]);
      c.recordStep([{ role: "tool", content: [{ type: "tool-result" as const, toolCallId: "c1", toolName: "my_tool", output: { type: "text", value: "r1" } }] }]);
      c.commitTurn();

      // Turn 2, 3, 4
      for (let i = 2; i <= 4; i++) {
        c.appendUser({ role: "user", content: `turn ${i}` });
        c.recordStep([{ role: "assistant", content: `reply ${i}` }]);
        c.commitTurn();
      }

      // Now currentUserTurn is 5, age = 5 - 1 = 4, 4 > 2 → expired
      const defs: ToolTtlPolicy[] = [{ name: "my_tool", uttl: 2 }];
      expect(c.redactExpiredResults(defs)).toBe(1);
      const toolEntry = c.journal.find((e) => e.msg.role === "tool")!;
      const part = (toolEntry.msg.content as ToolResultPart[])[0];
      expect(part.redacted).toBe(true);
      expect((part.output as { value: string }).value).toContain("4 user turns old");
    });

    it("6. uttl: 2, result from 2 turns ago is NOT expired", () => {
      const c = new ContextManager({ ...TEST_CFG, contextLength: 100_000 });
      c.appendUser({ role: "user", content: "turn 1" });
      c.recordStep([{ role: "assistant", content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "my_tool", input: {} }] }]);
      c.recordStep([{ role: "tool", content: [{ type: "tool-result" as const, toolCallId: "c1", toolName: "my_tool", output: { type: "text", value: "r1" } }] }]);
      c.commitTurn();

      // Turn 2
      c.appendUser({ role: "user", content: "turn 2" });
      c.recordStep([{ role: "assistant", content: "reply 2" }]);
      c.commitTurn();

      // currentUserTurn is 3, age = 3 - 1 = 2, 2 > 2 is false → not expired
      const defs: ToolTtlPolicy[] = [{ name: "my_tool", uttl: 2 }];
      expect(c.redactExpiredResults(defs)).toBe(0);
    });

    it("7. both set, ttl expires first", () => {
      const c = new ContextManager({ ...TEST_CFG, contextLength: 100_000 });
      c.appendUser({ role: "user", content: "go" });
      c.recordStep([{ role: "assistant", content: [
        { type: "tool-call" as const, toolCallId: "c1", toolName: "my_tool", input: {} },
        { type: "tool-call" as const, toolCallId: "c2", toolName: "my_tool", input: {} },
      ] }]);
      c.recordStep([{ role: "tool", content: [
        { type: "tool-result" as const, toolCallId: "c1", toolName: "my_tool", output: { type: "text", value: "r1" } },
        { type: "tool-result" as const, toolCallId: "c2", toolName: "my_tool", output: { type: "text", value: "r2" } },
      ] }]);
      c.commitTurn();

      const defs: ToolTtlPolicy[] = [{ name: "my_tool", ttl: 1, uttl: 99 }];
      expect(c.redactExpiredResults(defs)).toBe(1);
      const toolEntry = c.journal.find((e) => e.msg.role === "tool")!;
      const parts = toolEntry.msg.content as ToolResultPart[];
      expect(parts[0].redacted).toBe(true);
      expect(parts[1].redacted).toBeUndefined();
    });

    it("8. both set, uttl expires first", () => {
      const c = new ContextManager({ ...TEST_CFG, contextLength: 100_000 });
      c.appendUser({ role: "user", content: "turn 1" });
      c.recordStep([{ role: "assistant", content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "my_tool", input: {} }] }]);
      c.recordStep([{ role: "tool", content: [{ type: "tool-result" as const, toolCallId: "c1", toolName: "my_tool", output: { type: "text", value: "r1" } }] }]);
      c.commitTurn();

      c.appendUser({ role: "user", content: "turn 2" });
      c.recordStep([{ role: "assistant", content: "reply 2" }]);
      c.commitTurn();

      // age = 3 - 1 = 2, 2 > 0 → uttl expires; ttl = 99 so ttl wouldn't
      const defs: ToolTtlPolicy[] = [{ name: "my_tool", ttl: 99, uttl: 0 }];
      expect(c.redactExpiredResults(defs)).toBe(1);
      const toolEntry = c.journal.find((e) => e.msg.role === "tool")!;
      const part = (toolEntry.msg.content as ToolResultPart[])[0];
      expect(part.redacted).toBe(true);
    });

    it("9. idempotent: second sweep changes nothing", () => {
      const c = buildTurnWithResults(4, "snapshot_page", { ref: "main" });
      const defs: ToolTtlPolicy[] = [{ name: "snapshot_page", ttl: 1 }];
      c.redactExpiredResults(defs);
      const before = JSON.stringify(c.journal);
      expect(c.redactExpiredResults(defs)).toBe(0);
      expect(JSON.stringify(c.journal)).toBe(before);
    });

    it("10. unknown tool is never redacted", () => {
      const c = buildTurnWithResults(4, "unknown_tool", {});
      const defs: ToolTtlPolicy[] = [{ name: "snapshot_page", ttl: 1 }];
      expect(c.redactExpiredResults(defs)).toBe(0);
    });

    it("11. usage drops after redaction", () => {
      const c = buildTurnWithResults(4, "snapshot_page", { ref: "main" });
      c.recordUsage({ inputTokens: 5000 });
      const before = c.getUsage().tokens;
      c.redactExpiredResults([{ name: "snapshot_page", ttl: 1 }]);
      expect(c.getUsage().tokens).toBeLessThan(before);
    });

    it("12. I4 holds after sweep with ttl: 1 and four same-arg results", () => {
      const c = new ContextManager({ ...TEST_CFG, contextLength: 100_000 });
      // Build 4 snapshot results in one turn
      c.appendUser({ role: "user", content: "go" });
      c.recordStep([{ role: "assistant", content: [
        { type: "tool-call" as const, toolCallId: "c1", toolName: "snapshot_page", input: {} },
        { type: "tool-call" as const, toolCallId: "c2", toolName: "snapshot_page", input: {} },
        { type: "tool-call" as const, toolCallId: "c3", toolName: "snapshot_page", input: {} },
        { type: "tool-call" as const, toolCallId: "c4", toolName: "snapshot_page", input: {} },
      ] }]);
      c.recordStep([{ role: "tool", content: [
        { type: "tool-result" as const, toolCallId: "c1", toolName: "snapshot_page", output: { type: "text", value: "snap 1" } },
        { type: "tool-result" as const, toolCallId: "c2", toolName: "snapshot_page", output: { type: "text", value: "snap 2" } },
        { type: "tool-result" as const, toolCallId: "c3", toolName: "snapshot_page", output: { type: "text", value: "snap 3" } },
        { type: "tool-result" as const, toolCallId: "c4", toolName: "snapshot_page", output: { type: "text", value: "snap 4" } },
      ] }]);
      c.commitTurn();

      c.redactExpiredResults([{ name: "snapshot_page", ttl: 1 }]);
      c.mode = "assert";
      expect(() => c.compose()).not.toThrow();
    });

    it("13. backward compat: entry with no meta.userTurn is not expired by uttl", () => {
      const c = new ContextManager({ ...TEST_CFG, contextLength: 100_000 });
      c.appendUser({ role: "user", content: "go" });
      c.recordStep([{ role: "assistant", content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "my_tool", input: {} }] }]);
      c.recordStep([{ role: "tool", content: [{ type: "tool-result" as const, toolCallId: "c1", toolName: "my_tool", output: { type: "text", value: "r1" } }] }]);
      c.commitTurn();

      // Delete userTurn from the tool entry to simulate a pre-107/004 journal
      const toolEntry = c.journal.find((e) => e.msg.role === "tool")!;
      delete (toolEntry.meta as Record<string, unknown>).userTurn;

      // uttl: 0 would expire if age > 0, but without userTurn age reads as 0
      const defs: ToolTtlPolicy[] = [{ name: "my_tool", uttl: 0 }];
      expect(c.redactExpiredResults(defs)).toBe(0);
    });
  });

  describe("rehydrateState — restored history audit failed backfill", () => {
    it("restores session holding a tool isError: true result, a core-rejected call, and a successful call", () => {
      const c = new ContextManager(TEST_CFG);

      const rawAudits: AuditEntry[] = [
        { ts: 1000, name: "move_file", input: { source_path: "/missing.md" }, outcomeSummary: "Error: /missing.md does not exist." },
        { ts: 2000, name: "move_file", input: {}, outcomeSummary: "Could not read the arguments for move_file: ... the tool did not run" },
        { ts: 3000, name: "read_file", input: { file_path: "/notes.md" }, outcomeSummary: "File content here" },
      ];

      const journal: JournalEntry[] = [
        {
          msg: { role: "user", content: "turn 1" },
          meta: { turnId: "turn-1", stepNo: 0, kinds: ["user_prose"], chars: 6, createdAt: 1000, userTurn: 1 },
        },
        {
          msg: {
            role: "tool",
            content: [
              { type: "tool-result", toolCallId: "call-1", toolName: "move_file", output: "Error: /missing.md does not exist.", isError: true },
            ],
          },
          meta: { turnId: "turn-1", stepNo: 1, kinds: ["tool_call"], chars: 50, createdAt: 1100, userTurn: 1 },
        },
        {
          msg: { role: "user", content: "turn 2" },
          meta: { turnId: "turn-2", stepNo: 0, kinds: ["user_prose"], chars: 6, createdAt: 2000, userTurn: 2 },
        },
        {
          msg: {
            role: "tool",
            content: [
              { type: "tool-result", toolCallId: "call-2", toolName: "move_file", output: "Could not read the arguments for move_file: ... the tool did not run", isError: true },
            ],
          },
          meta: { turnId: "turn-2", stepNo: 1, kinds: ["tool_call"], chars: 80, createdAt: 2100, userTurn: 2 },
        },
        {
          msg: { role: "user", content: "turn 3" },
          meta: { turnId: "turn-3", stepNo: 0, kinds: ["user_prose"], chars: 6, createdAt: 3000, userTurn: 3 },
        },
        {
          msg: {
            role: "tool",
            content: [
              { type: "tool-result", toolCallId: "call-3", toolName: "read_file", output: "File content here" },
            ],
          },
          meta: { turnId: "turn-3", stepNo: 1, kinds: ["tool_call"], chars: 50, createdAt: 3100, userTurn: 3 },
        },
      ];

      c.rehydrateState(journal, rawAudits);

      // Verify turnAudits via getTurnAudits
      const turn1Audits = c.getTurnAudits("turn-1");
      const turn2Audits = c.getTurnAudits("turn-2");
      const turn3Audits = c.getTurnAudits("turn-3");

      expect(turn1Audits).toBeDefined();
      expect(turn1Audits).toHaveLength(1);
      expect(turn1Audits![0].failed).toBe(true);

      expect(turn2Audits).toBeDefined();
      expect(turn2Audits).toHaveLength(1);
      expect(turn2Audits![0].failed).toBe(true);

      expect(turn3Audits).toBeDefined();
      expect(turn3Audits).toHaveLength(1);
      expect(turn3Audits![0].failed).toBe(false);

      // Verify c.audit is also backfilled and in sync
      expect(c.audit).toHaveLength(3);
      expect(c.audit[0].failed).toBe(true);
      expect(c.audit[1].failed).toBe(true);
      expect(c.audit[2].failed).toBe(false);

      // Verify truncateLastTurn cleans up turn-3 from c.audit and turnAudits
      c.truncateLastTurn();
      expect(c.audit).toHaveLength(2);
      expect(c.getTurnAudits("turn-3")).toBeUndefined();
    });
  });

  describe("recordStep tool images (003)", () => {
    it("attaches tool images to meta.toolImages on tool messages and not assistant messages", () => {
      const imgA = [{ dataUrl: "data:image/png;base64,AAAA", mediaType: "image/png" }];
      const imgB = [{ dataUrl: "data:image/png;base64,BBBB", mediaType: "image/png" }];
      const imgC = [{ dataUrl: "data:image/png;base64,CCCC", mediaType: "image/png" }];

      cm.appendUser({ role: "user", content: "hi" });
      const assistantMsg: ModelMessage = {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "c1", toolName: "read_file", input: {} },
          { type: "tool-call", toolCallId: "c2", toolName: "read_file", input: {} },
        ],
      };
      cm.recordStep([assistantMsg], undefined, { c1: imgA, c2: imgB, c9: imgC });

      const toolMsg: ModelMessage = {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "c1", toolName: "read_file", output: "file 1" },
          { type: "tool-result", toolCallId: "c2", toolName: "read_file", output: "file 2" },
        ],
      };
      cm.recordStep([toolMsg], undefined, { c1: imgA, c2: imgB, c9: imgC });

      expect(cm.journal[1].msg.role).toBe("assistant");
      expect(cm.journal[1].meta.toolImages).toBeUndefined();

      expect(cm.journal[2].msg.role).toBe("tool");
      expect(cm.journal[2].meta.toolImages).toEqual({ c1: imgA, c2: imgB });
    });

    it("does not set meta.toolImages or audit.images when empty", () => {
      const toolMsg: ModelMessage = {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "c1", toolName: "read_file", output: "file 1" },
        ],
      };
      const auditEntry: AuditEntry = {
        id: "a1",
        toolCallId: "c1",
        name: "read_file",
        input: {},
        output: "file 1",
        failed: false,
        durationMs: 10,
        createdAt: Date.now(),
      };
      cm.appendUser({ role: "user", content: "hi" });
      cm.recordStep([toolMsg], [auditEntry], {});

      const entry = cm.journal[cm.journal.length - 1];
      expect(entry.meta.toolImages).toBeUndefined();
      expect("images" in cm.audit[0]).toBe(false);
    });
  });
});

