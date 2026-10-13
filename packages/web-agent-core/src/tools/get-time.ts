import { z } from "zod";
import type { CustomToolDef, ToolOutcome } from "./types.js";

export const getTimeInputSchema = z
  .object({
    timezone: z
      .string()
      .optional()
      .describe(
        "Optional IANA timezone name, for example 'Asia/Singapore', 'Europe/London' or 'UTC'. Omit it to answer in the system timezone.",
      ),
  })
  .strict();

/** Format one instant as "YYYY-MM-DD HH:mm:ss" in `zone`.
 *  formatToParts is used rather than format() so the separators are ours, not
 *  the locale's. hourCycle "h23" keeps midnight as 00, not 24.
 *  Throws RangeError when `zone` is not a known IANA name — the constructor is
 *  the validator, which is why the caller wraps this in a try. */
function formatStamp(now: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const p: Record<string, string> = {};
  for (const { type, value } of parts) p[type] = value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** Name the bad value and show a good one, the way calc.ts:26-33 does when the
 *  expression is missing — an error is a chance to make the next call work. */
export function unknownTimezoneMessage(requested: string): string {
  return (
    `Unknown timezone "${requested}". Use an IANA timezone name such as ` +
    `"Asia/Singapore", "Europe/London" or "UTC", or omit the timezone to use ` +
    `the system timezone.`
  );
}

export function runGetTime(input: Record<string, unknown>): ToolOutcome {
  const requested =
    typeof input.timezone === "string" ? input.timezone.trim() : "";
  const zoneWasDefaulted = requested === "";
  const now = new Date();

  if (zoneWasDefaulted) {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return { content: `${formatStamp(now, zone)} (${zone}, system timezone)` };
  }

  try {
    // The Intl constructor inside formatStamp IS the validator: an unknown IANA
    // name throws RangeError. No dependency, and no zone list of our own.
    return { content: `${formatStamp(now, requested)} (${requested})` };
  } catch {
    // Never fall back to the system timezone here. Silently answering in the
    // wrong zone is worse than saying no.
    return { content: unknownTimezoneMessage(requested), isError: true };
  }
}

export const getTimeTool: CustomToolDef = {
  name: "get_time",
  description:
    "Read the current date and time. Call this before answering any question " +
    "about what time or date it is — do not answer from memory or from the " +
    "conversation. Pass an IANA timezone name to get the time there; omit it " +
    "to get the system timezone.",
  inputSchema: getTimeInputSchema,
  renderer: (input, result) => {
    const { timezone } = input as { timezone?: string };
    // Host sanitizes to inline tags (<i>, <b>, <em>, <strong>)
    return timezone
      ? `Read the time in <b>${timezone}</b> → <b>${result}</b>`
      : `Read the time → <b>${result}</b>`;
  },
  summarize: (input) => {
    const { timezone } = input as { timezone?: string };
    return timezone ? `Get the time in ${timezone}` : "Get the time";
  },
  execute: (input) => Promise.resolve(runGetTime(input)),
};
