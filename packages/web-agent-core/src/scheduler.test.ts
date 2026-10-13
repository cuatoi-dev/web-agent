import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createScheduler,
  parseEvery,
  formatMs,
  formatHumanDuration,
  formatHumanEvery,
  type SchedulerDependencies,
} from "./scheduler.js";

describe("scheduler", () => {
  describe("parseEvery", () => {
    it("parses valid seconds, minutes, and hours to milliseconds", () => {
      expect(parseEvery("30s")).toEqual({ ms: 30000 });
      expect(parseEvery("10m")).toEqual({ ms: 600000 });
      expect(parseEvery("2h")).toEqual({ ms: 7200000 });
    });

    it("trims whitespace from input", () => {
      expect(parseEvery("  5s  ")).toEqual({ ms: 5000 });
    });

    it("rejects non-string inputs", () => {
      expect(parseEvery(123)).toEqual({
        error: "every must look like 30s, 10m or 2h",
      });
      expect(parseEvery(null)).toEqual({
        error: "every must look like 30s, 10m or 2h",
      });
      expect(parseEvery(undefined)).toEqual({
        error: "every must look like 30s, 10m or 2h",
      });
    });

    it("rejects invalid format or unknown unit", () => {
      expect(parseEvery("5x")).toEqual({
        error: "every must look like 30s, 10m or 2h",
      });
      expect(parseEvery("abc")).toEqual({
        error: "every must look like 30s, 10m or 2h",
      });
      expect(parseEvery("")).toEqual({
        error: "every must look like 30s, 10m or 2h",
      });
      expect(parseEvery("10d")).toEqual({
        error: "every must look like 30s, 10m or 2h",
      });
    });

    it("rejects intervals shorter than 1s", () => {
      expect(parseEvery("0s")).toEqual({
        error: "the shortest interval is 1s",
      });
      expect(parseEvery("0m")).toEqual({
        error: "the shortest interval is 1s",
      });
    });
  });

  describe("formatMs", () => {
    it("formats clean multiples of hours, minutes, and seconds", () => {
      expect(formatMs(7200000)).toBe("2h");
      expect(formatMs(3600000)).toBe("1h");
      expect(formatMs(600000)).toBe("10m");
      expect(formatMs(60000)).toBe("1m");
      expect(formatMs(30000)).toBe("30s");
      expect(formatMs(1500)).toBe("2s");
    });
  });

  describe("formatHumanDuration", () => {
    it("formats hours, minutes and seconds into human words", () => {
      expect(formatHumanDuration(7200000)).toBe("2 hours");
      expect(formatHumanDuration(3600000)).toBe("1 hour");
      expect(formatHumanDuration(600000)).toBe("10 minutes");
      expect(formatHumanDuration(60000)).toBe("1 minute");
      expect(formatHumanDuration(10000)).toBe("10 seconds");
      expect(formatHumanDuration(1000)).toBe("1 second");
    });
  });

  describe("formatHumanEvery", () => {
    it("parses duration strings into human words", () => {
      expect(formatHumanEvery("10s")).toBe("10 seconds");
      expect(formatHumanEvery("1s")).toBe("1 second");
      expect(formatHumanEvery("15m")).toBe("15 minutes");
      expect(formatHumanEvery("1m")).toBe("1 minute");
      expect(formatHumanEvery("2h")).toBe("2 hours");
      expect(formatHumanEvery("1h")).toBe("1 hour");
    });

    it("parses numeric milliseconds", () => {
      expect(formatHumanEvery(10000)).toBe("10 seconds");
    });

    it("returns undefined for invalid or empty inputs", () => {
      expect(formatHumanEvery(undefined)).toBeUndefined();
      expect(formatHumanEvery("")).toBeUndefined();
      expect(formatHumanEvery("invalid")).toBeUndefined();
    });
  });

  describe("createScheduler", () => {
    let deps: SchedulerDependencies;
    let isRunningState = false;

    beforeEach(() => {
      vi.useFakeTimers();
      isRunningState = false;
      deps = {
        isEnabled: vi.fn().mockReturnValue(true),
        enqueueCommand: vi.fn(),
        enqueueInput: vi.fn(),
        isRunning: vi.fn().mockImplementation(() => isRunningState),
        dropQueuedFromSchedule: vi.fn(),
        maybeDrainQueue: vi.fn().mockResolvedValue(undefined),
        notifyListeners: vi.fn(),
      };
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns error when scheduler is not enabled in app", () => {
      deps.isEnabled = vi.fn().mockReturnValue(false);
      const scheduler = createScheduler(deps);
      const res = scheduler.setSchedule({
        name: "test",
        every: "10s",
        repeat: 2,
        prompt: "hello",
      });
      expect(res).toEqual({
        content: "Scheduling is turned off in this app.",
        isError: true,
      });
    });

    it("validates target exclusivity: both or neither provided", () => {
      const scheduler = createScheduler(deps);
      const both = scheduler.setSchedule({
        name: "test",
        every: "10s",
        repeat: 2,
        command: "compact",
        prompt: "hello",
      });
      expect(both).toEqual({
        content: "Give either a command or a prompt, not both.",
        isError: true,
      });

      const neither = scheduler.setSchedule({
        name: "test",
        every: "10s",
        repeat: 2,
      });
      expect(neither).toEqual({
        content: "Give a command or a prompt to send when it fires.",
        isError: true,
      });

      const emptyStrings = scheduler.setSchedule({
        name: "test",
        every: "10s",
        repeat: 2,
        command: "  ",
        prompt: "",
      });
      expect(emptyStrings).toEqual({
        content: "Give a command or a prompt to send when it fires.",
        isError: true,
      });
    });

    it("validates repeat bounds (1..36000)", () => {
      const scheduler = createScheduler(deps);
      for (const invalid of [0, -1, 36001, 1.5, "2", null, undefined]) {
        const res = scheduler.setSchedule({
          name: "test",
          every: "10s",
          repeat: invalid,
          prompt: "hello",
        });
        expect(res).toEqual({
          content: "repeat must be a whole number from 1 to 36000.",
          isError: true,
        });
      }
    });

    it("validates every format and minimum interval", () => {
      const scheduler = createScheduler(deps);
      const invalid = scheduler.setSchedule({
        name: "test",
        every: "bad",
        repeat: 1,
        prompt: "hello",
      });
      expect(invalid).toEqual({
        content: "every must look like 30s, 10m or 2h",
        isError: true,
      });

      const tooShort = scheduler.setSchedule({
        name: "test",
        every: "0s",
        repeat: 1,
        prompt: "hello",
      });
      expect(tooShort).toEqual({
        content: "the shortest interval is 1s",
        isError: true,
      });
    });

    it("validates name non-empty", () => {
      const scheduler = createScheduler(deps);
      const emptyName = scheduler.setSchedule({
        name: "   ",
        every: "10s",
        repeat: 1,
        prompt: "hello",
      });
      expect(emptyName).toEqual({
        content: "Give the schedule a name.",
        isError: true,
      });
    });

    it("fires repeat runs, enqueues input, and stops after repeat count is reached", () => {
      const scheduler = createScheduler(deps);
      const res = scheduler.setSchedule({
        name: "ticker",
        every: "30s",
        repeat: 2,
        prompt: "say tick",
      });
      expect(res.content).toBe("Scheduled ticker, every 30s, 2 run(s).");
      expect(deps.notifyListeners).toHaveBeenCalledTimes(1);

      // Before 30s
      vi.advanceTimersByTime(29999);
      expect(deps.enqueueInput).not.toHaveBeenCalled();

      // First run at 30s
      vi.advanceTimersByTime(1);
      expect(deps.enqueueInput).toHaveBeenCalledTimes(1);
      expect(deps.enqueueInput).toHaveBeenCalledWith("say tick", [], { kind: "schedule", name: "ticker" });
      expect(deps.maybeDrainQueue).toHaveBeenCalledTimes(1);

      // Second run at 60s
      vi.advanceTimersByTime(30000);
      expect(deps.enqueueInput).toHaveBeenCalledTimes(2);
      expect(deps.maybeDrainQueue).toHaveBeenCalledTimes(2);

      // Third run should never happen
      vi.advanceTimersByTime(60000);
      expect(deps.enqueueInput).toHaveBeenCalledTimes(2);

      // Spent entry reports in list
      const list = scheduler.listSchedules();
      expect(list.content).toContain("ticker | schedule | every 30s | prompt \"say tick\" | 2 of 2 | spent");
    });

    it("fires command and formats as /command", () => {
      const scheduler = createScheduler(deps);
      scheduler.setSchedule({
        name: "compactor",
        every: "10m",
        repeat: 1,
        command: "compact",
      });

      vi.advanceTimersByTime(600000);
      expect(deps.enqueueCommand).toHaveBeenCalledWith("compact", "", "/compact", { kind: "schedule", name: "compactor" });
      expect(deps.maybeDrainQueue).toHaveBeenCalledTimes(1);

      const list = scheduler.listSchedules();
      expect(list.content).toContain("compactor | reminder | every 10m | command /compact | 1 of 1 | spent");
    });

    it("fires into a busy turn: enqueues without calling maybeDrainQueue", () => {
      isRunningState = true;
      const scheduler = createScheduler(deps);
      scheduler.setSchedule({
        name: "busy-job",
        every: "10s",
        repeat: 1,
        prompt: "ping",
      });

      vi.advanceTimersByTime(10000);
      expect(deps.enqueueInput).toHaveBeenCalledWith("ping", [], { kind: "schedule", name: "busy-job" });
      expect(deps.maybeDrainQueue).not.toHaveBeenCalled();
    });

    it("replaces existing schedule on name collision and clears the old timer", () => {
      const scheduler = createScheduler(deps);
      scheduler.setSchedule({
        name: "job",
        every: "30s",
        repeat: 3,
        prompt: "original",
      });

      vi.advanceTimersByTime(15000);

      const replaceRes = scheduler.setSchedule({
        name: "job",
        every: "20s",
        repeat: 1,
        prompt: "replaced",
      });
      expect(replaceRes.content).toBe(
        "Scheduled job, every 20s, 1 run(s). Replaced the previous one."
      );

      // At 30s from start (15s after replacement): old timer would have fired, but replaced should not fire yet
      vi.advanceTimersByTime(15000);
      expect(deps.enqueueInput).not.toHaveBeenCalled();

      // At 35s from start (20s after replacement): new timer fires
      vi.advanceTimersByTime(5000);
      expect(deps.enqueueInput).toHaveBeenCalledTimes(1);
      expect(deps.enqueueInput).toHaveBeenCalledWith("replaced", [], { kind: "schedule", name: "job" });

      // And never fires again
      vi.advanceTimersByTime(60000);
      expect(deps.enqueueInput).toHaveBeenCalledTimes(1);
    });

    it("cancels active schedule and clears its timer", () => {
      const scheduler = createScheduler(deps);
      scheduler.setSchedule({
        name: "to-cancel",
        every: "10s",
        repeat: 2,
        prompt: "ping",
      });

      const cancelRes = scheduler.cancelSchedule("to-cancel");
      expect(cancelRes).toEqual({ content: "Cancelled to-cancel." });

      vi.advanceTimersByTime(30000);
      expect(deps.enqueueInput).not.toHaveBeenCalled();
      expect(scheduler.listSchedules()).toEqual({ content: "Nothing is scheduled." });
    });

    it("returns error when cancelling an unknown schedule", () => {
      const scheduler = createScheduler(deps);
      const res = scheduler.cancelSchedule("ghost");
      expect(res).toEqual({ content: "No schedule called ghost.", isError: true });
    });

    it("clearAll clears all active timers and empties registry", () => {
      const scheduler = createScheduler(deps);
      scheduler.setSchedule({
        name: "j1",
        every: "10s",
        repeat: 2,
        prompt: "p1",
      });
      scheduler.setSchedule({
        name: "j2",
        every: "20s",
        repeat: 2,
        prompt: "p2",
      });

      scheduler.clearAll();
      expect(scheduler.listSchedules()).toEqual({ content: "Nothing is scheduled." });

      vi.advanceTimersByTime(60000);
      expect(deps.enqueueInput).not.toHaveBeenCalled();
    });

    it("pendingCounts tracks active schedules and reminders, excluding spent entries", () => {
      const scheduler = createScheduler(deps);
      expect(scheduler.pendingCounts()).toEqual({ schedules: 0, reminders: 0, total: 0 });

      scheduler.setSchedule({
        name: "rem1",
        every: "10s",
        repeat: 1,
        prompt: "remind me",
      });
      expect(scheduler.pendingCounts()).toEqual({ schedules: 0, reminders: 1, total: 1 });

      scheduler.setSchedule({
        name: "sched1",
        every: "30s",
        repeat: 3,
        prompt: "repeat me",
      });
      expect(scheduler.pendingCounts()).toEqual({ schedules: 1, reminders: 1, total: 2 });

      // Fire reminder 1 -> becomes spent
      vi.advanceTimersByTime(10000);
      expect(scheduler.pendingCounts()).toEqual({ schedules: 1, reminders: 0, total: 1 });

      // Fire schedule run 1, 2, 3 -> becomes spent
      vi.advanceTimersByTime(90000);
      expect(scheduler.pendingCounts()).toEqual({ schedules: 0, reminders: 0, total: 0 });
    });

    describe("110/005 — coalescing and stale-error recovery", () => {
      let queue: Array<{ text: string; source?: { kind: "schedule"; name: string } }>;

      beforeEach(() => {
        queue = [];
        deps.enqueueInput = vi.fn((text: string, _images: unknown, source?: { kind: "schedule"; name: string }) => {
          queue.push({ text, source });
        });
        deps.enqueueCommand = vi.fn((_n: string, _a: string, text: string, source?: { kind: "schedule"; name: string }) => {
          queue.push({ text, source });
        });
        deps.dropQueuedFromSchedule = vi.fn((name: string) => {
          queue = queue.filter((q) => q.source?.name !== name);
        });
      });

      it("a tick drains with clearStaleError so a stale error can be retried", () => {
        const scheduler = createScheduler(deps);
        scheduler.setSchedule({ name: "ticker", every: "30s", repeat: 1, prompt: "hi" });
        vi.advanceTimersByTime(30000);
        expect(deps.maybeDrainQueue).toHaveBeenCalledTimes(1);
        expect(deps.maybeDrainQueue).toHaveBeenCalledWith({ clearStaleError: true });
      });

      it("three ticks while the queue is never consumed leave exactly one item", () => {
        const scheduler = createScheduler(deps);
        scheduler.setSchedule({ name: "ticker", every: "30s", repeat: 5, prompt: "tick" });
        vi.advanceTimersByTime(90000);
        expect(queue.length).toBe(1);
      });

      it("the surviving item is the most recent fire", () => {
        const scheduler = createScheduler(deps);
        scheduler.setSchedule({ name: "ticker", every: "30s", repeat: 5, prompt: "tick" });
        vi.advanceTimersByTime(90000);
        const calls = (deps.enqueueInput as ReturnType<typeof vi.fn>).mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(queue[0].text).toBe(lastCall[0]);
      });

      it("two schedules each keep their own pending item", () => {
        const scheduler = createScheduler(deps);
        scheduler.setSchedule({ name: "alpha", every: "30s", repeat: 5, prompt: "a" });
        scheduler.setSchedule({ name: "beta", every: "30s", repeat: 5, prompt: "b" });
        vi.advanceTimersByTime(90000);
        expect(queue.length).toBe(2);
        expect(queue.map((q) => q.source?.name).sort()).toEqual(["alpha", "beta"]);
      });

      it("a user message survives a schedule's coalesce", () => {
        const scheduler = createScheduler(deps);
        queue.push({ text: "typed by hand" });
        scheduler.setSchedule({ name: "ticker", every: "30s", repeat: 5, prompt: "tick" });
        vi.advanceTimersByTime(90000);
        expect(queue.length).toBe(2);
        expect(queue.some((q) => q.text === "typed by hand" && q.source === undefined)).toBe(true);
      });

      it("repeat still terminates when every fire was coalesced", () => {
        const scheduler = createScheduler(deps);
        scheduler.setSchedule({ name: "ticker", every: "30s", repeat: 3, prompt: "tick" });
        vi.advanceTimersByTime(120000);
        expect(deps.enqueueInput).toHaveBeenCalledTimes(3);
        expect(queue.length).toBe(1);
        const list = scheduler.listSchedules();
        expect(list.content).toContain("3 of 3 | spent");
      });

      it("a command schedule coalesces the same way", () => {
        const scheduler = createScheduler(deps);
        scheduler.setSchedule({ name: "compactor", every: "30s", repeat: 3, command: "compact" });
        vi.advanceTimersByTime(90000);
        expect(queue.length).toBe(1);
        expect(queue[0].source?.name).toBe("compactor");
      });

      it("dropQueuedFromSchedule runs before the enqueue", () => {
        const scheduler = createScheduler(deps);
        scheduler.setSchedule({ name: "ticker", every: "30s", repeat: 1, prompt: "tick" });
        vi.advanceTimersByTime(30000);
        const dropOrder = (deps.dropQueuedFromSchedule as ReturnType<typeof vi.fn>).mock
          .invocationCallOrder[0];
        const enqueueOrder = (deps.enqueueInput as ReturnType<typeof vi.fn>).mock
          .invocationCallOrder[0];
        expect(dropOrder).toBeLessThan(enqueueOrder);
      });
    });
  });
});
