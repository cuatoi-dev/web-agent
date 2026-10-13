// The session-owned scheduler seam and its rows.
import type { ImageAttachment } from "./utils/types.js";

export interface ScheduleEntry {
  name: string;
  everyMs: number;
  repeat: number;
  runs: number;
  command?: string;
  prompt?: string;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface PendingCounts {
  schedules: number;
  reminders: number;
  total: number;
}

export interface SetScheduleInput {
  name?: unknown;
  every?: unknown;
  repeat?: unknown;
  command?: unknown;
  prompt?: unknown;
}

export interface SchedulerRegistry {
  setSchedule(input: SetScheduleInput): { content: string; isError?: boolean };
  listSchedules(): { content: string; isError?: boolean };
  cancelSchedule(name?: unknown): { content: string; isError?: boolean };
  clearAll(): void;
  pendingCounts(): PendingCounts;
}

export interface SchedulerDependencies {
  isEnabled: () => boolean;
  enqueueCommand: (
    name: string,
    argument: string,
    text: string,
    source?: { kind: "schedule"; name: string },
  ) => void;
  enqueueInput: (
    text: string,
    images: ImageAttachment[],
    source?: { kind: "schedule"; name: string },
  ) => void;
  isRunning: () => boolean;
  /** 110/005 P2. Removes this schedule's own undelivered message, matched on
   *  `source.name`. Other schedules' items and every user-typed item are left
   *  alone, so one schedule can hold at most one pending message. */
  dropQueuedFromSchedule: (name: string) => void;
  /** 110/005 P1. `clearStaleError` marks a fresh, time-separated trigger — a
   *  scheduler tick — which may clear a stale error and retry. The turn's own
   *  `finally` calls this with no options and still stops on an error, which
   *  is what prevents a tight retry loop. */
  maybeDrainQueue: (opts?: { clearStaleError?: boolean }) => Promise<void>;
  notifyListeners: () => void;
}
