import type {
  PendingCounts,
  ScheduleEntry,
  SchedulerDependencies,
  SchedulerRegistry,
  SetScheduleInput,
} from "./scheduler.types.js";
export type {
  PendingCounts,
  ScheduleEntry,
  SchedulerDependencies,
  SchedulerRegistry,
  SetScheduleInput,
} from "./scheduler.types.js";

export function parseEvery(spec: unknown): { ms: number } | { error: string } {
  if (typeof spec !== "string") {
    return { error: "every must look like 30s, 10m or 2h" };
  }
  const match = spec.trim().match(/^([0-9]+)(s|m|h)$/);
  if (!match) {
    return { error: "every must look like 30s, 10m or 2h" };
  }
  const n = parseInt(match[1], 10);
  const unit = match[2];
  let ms = 0;
  if (unit === "s") ms = n * 1000;
  else if (unit === "m") ms = n * 60000;
  else if (unit === "h") ms = n * 3600000;

  if (ms < 1000) {
    return { error: "the shortest interval is 1s" };
  }
  return { ms };
}

export function formatMs(ms: number): string {
  if (ms >= 3600000 && ms % 3600000 === 0) return `${ms / 3600000}h`;
  if (ms >= 60000 && ms % 60000 === 0) return `${ms / 60000}m`;
  return `${Math.round(ms / 1000)}s`;
}

export function formatHumanDuration(ms: number): string {
  if (ms >= 3600000 && ms % 3600000 === 0) {
    const hours = ms / 3600000;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  if (ms >= 60000 && ms % 60000 === 0) {
    const minutes = ms / 60000;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const seconds = Math.round(ms / 1000);
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

/** Formats a schedule interval specifier into human-readable words.
 *  Accepts strict parseEvery strings (30s, 10m, 2h), numeric ms, or regex fallbacks
 *  for raw model inputs like "10 seconds" before execution. */
export function formatHumanEvery(spec: unknown): string | undefined {
  if (typeof spec === "number" && Number.isFinite(spec) && spec >= 1000) {
    return formatHumanDuration(spec);
  }
  if (typeof spec === "string") {
    const trimmed = spec.trim();
    if (!trimmed) return undefined;
    const parsed = parseEvery(trimmed);
    if (!("error" in parsed)) {
      return formatHumanDuration(parsed.ms);
    }
    const match = trimmed.match(/^([0-9]+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?)$/i);
    if (match) {
      const n = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();
      if (unit.startsWith("s")) return `${n} ${n === 1 ? "second" : "seconds"}`;
      if (unit.startsWith("m")) return `${n} ${n === 1 ? "minute" : "minutes"}`;
      if (unit.startsWith("h")) return `${n} ${n === 1 ? "hour" : "hours"}`;
    }
  }
  return undefined;
}

export function createScheduler(deps: SchedulerDependencies): SchedulerRegistry {
  const registry = new Map<string, ScheduleEntry>();

  function arm(entry: ScheduleEntry): void {
    entry.timer = setTimeout(() => {
      fire(entry);
    }, entry.everyMs);
  }

  function fire(entry: ScheduleEntry): void {
    if (registry.get(entry.name) !== entry) return;
    // 110/005 P2. `runs` increments even when this fire replaces its own
    // undelivered message, so `repeat` still terminates the schedule. A
    // broken endpoint can never turn a bounded schedule into an unbounded
    // one.
    entry.runs += 1;

    // 110/005 P2. This schedule's own stale message goes first, so it holds
    // at most one pending item. Matched on the schedule name, so another
    // schedule's item and every user-typed item survive.
    deps.dropQueuedFromSchedule(entry.name);

    const source = { kind: "schedule" as const, name: entry.name };
    if (entry.command) {
      deps.enqueueCommand(entry.command, "", `/${entry.command}`, source);
    } else if (entry.prompt) {
      deps.enqueueInput(entry.prompt, [], source);
    }

    if (!deps.isRunning()) {
      // 110/005 P1. A tick is a fresh, time-separated attempt, so it may
      // clear a stale error and retry. Without this the queue deadlocks
      // forever after the first API error.
      void deps.maybeDrainQueue({ clearStaleError: true });
    }

    if (entry.runs >= entry.repeat) {
      entry.timer = null;
    } else {
      arm(entry);
    }
    deps.notifyListeners();
  }

  return {
    setSchedule(input: SetScheduleInput): { content: string; isError?: boolean } {
      if (!deps.isEnabled()) {
        return { content: "Scheduling is turned off in this app.", isError: true };
      }

      const rawCmd = typeof input.command === "string" && input.command.trim().length > 0 ? input.command.trim() : undefined;
      const rawPrompt = typeof input.prompt === "string" && input.prompt.trim().length > 0 ? input.prompt.trim() : undefined;
      if (rawCmd && rawPrompt) {
        return { content: "Give either a command or a prompt, not both.", isError: true };
      }
      if (!rawCmd && !rawPrompt) {
        return { content: "Give a command or a prompt to send when it fires.", isError: true };
      }

      if (typeof input.repeat !== "number" || !Number.isInteger(input.repeat) || input.repeat < 1 || input.repeat > 36000) {
        return { content: "repeat must be a whole number from 1 to 36000.", isError: true };
      }

      const parsed = parseEvery(input.every);
      if ("error" in parsed) {
        return { content: parsed.error, isError: true };
      }

      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name) {
        return { content: "Give the schedule a name.", isError: true };
      }

      let replaced = false;
      const existing = registry.get(name);
      if (existing) {
        if (existing.timer) clearTimeout(existing.timer);
        registry.delete(name);
        replaced = true;
      }

      const repeat = input.repeat;
      const everySpec = typeof input.every === "string" ? input.every.trim() : "";

      const entry: ScheduleEntry = {
        name,
        everyMs: parsed.ms,
        repeat,
        runs: 0,
        command: rawCmd,
        prompt: rawPrompt,
        timer: null,
      };
      registry.set(name, entry);
      arm(entry);
      deps.notifyListeners();

      return {
        content: `Scheduled ${name}, every ${everySpec}, ${repeat} run(s).${replaced ? " Replaced the previous one." : ""}`,
      };
    },

    cancelSchedule(name?: unknown): { content: string; isError?: boolean } {
      const targetName = typeof name === "string" ? name.trim() : typeof name === "number" ? `${name}` : "";
      const entry = targetName ? registry.get(targetName) : undefined;
      if (!entry) {
        return { content: `No schedule called ${targetName}.`, isError: true };
      }
      if (entry.timer) clearTimeout(entry.timer);
      registry.delete(targetName);
      deps.notifyListeners();
      return { content: `Cancelled ${targetName}.` };
    },

    listSchedules(): { content: string; isError?: boolean } {
      if (registry.size === 0) {
        return { content: "Nothing is scheduled." };
      }
      const rows = Array.from(registry.values()).map((entry) => {
        const kind = entry.repeat === 1 ? "reminder" : "schedule";
        const sends = entry.command ? `command /${entry.command}` : `prompt "${entry.prompt}"`;
        const state = entry.runs >= entry.repeat ? "spent" : "active";
        return `${entry.name} | ${kind} | every ${formatMs(entry.everyMs)} | ${sends} | ${entry.runs} of ${entry.repeat} | ${state}`;
      });
      return {
        content: ["Name | Kind | Fires | Sends | Runs | State", ...rows].join("\n"),
      };
    },

    clearAll(): void {
      for (const entry of registry.values()) {
        if (entry.timer) clearTimeout(entry.timer);
      }
      registry.clear();
      deps.notifyListeners();
    },

    pendingCounts(): PendingCounts {
      let schedules = 0;
      let reminders = 0;
      for (const entry of registry.values()) {
        if (entry.runs < entry.repeat) {
          if (entry.repeat === 1) reminders++;
          else schedules++;
        }
      }
      return { schedules, reminders, total: schedules + reminders };
    },
  };
}
