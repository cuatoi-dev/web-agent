import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getTimeTool,
  runGetTime,
  unknownTimezoneMessage,
} from "./get-time.js";

/** A fixed instant. Every expectation below is measured against THIS moment,
 *  never against the wall clock. 2026-09-05 11:12:12 UTC. */
const FROZEN = new Date("2026-09-05T11:12:12Z");

/** Independently measured expectations for FROZEN — written down here, not
 *  recomputed from Intl the way the production code does. Europe/London is on
 *  BST (+01:00) and America/New_York on EDT (-04:00) on this date. */
const EXPECTED: Record<string, string> = {
  UTC: "2026-09-05 11:12:12",
  "Asia/Singapore": "2026-09-05 19:12:12",
  "Europe/London": "2026-09-05 12:12:12",
  "America/New_York": "2026-09-05 07:12:12",
};

/** "+08:00" for a zone at the frozen instant, derived from longOffset — a
 *  different Intl path than the formatToParts assembly under test. */
function zoneOffsetIso(zone: string): string {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(FROZEN)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  return name === "GMT" ? "+00:00" : name.replace(/^GMT/, "");
}

/** "2026-09-05 19:12:12 (Asia/Singapore, system timezone)" →
 *  { date, time, zone, defaulted } */
function parseReply(content: string) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) \((.+?)(, system timezone)?\)$/.exec(content);
  expect(m, `reply does not match the decided shape: ${content}`).not.toBeNull();
  return { date: m![1], time: m![2], zone: m![3], defaulted: m![4] !== undefined };
}

describe("get_time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("explicit timezone", () => {
    for (const [zone, stamp] of Object.entries(EXPECTED)) {
      it(`renders the frozen instant in ${zone} as ${stamp}`, () => {
        const outcome = runGetTime({ timezone: zone });
        expect(outcome.isError).toBeUndefined();
        expect(outcome.content).toBe(`${stamp} (${zone})`);
      });
    }

    it("never marks an explicitly requested zone as the system timezone", () => {
      expect(runGetTime({ timezone: "UTC" }).content).not.toContain("system timezone");
    });

    it("trims surrounding whitespace off a real zone name", () => {
      expect(runGetTime({ timezone: "  Europe/London  " }).content).toBe(
        "2026-09-05 12:12:12 (Europe/London)",
      );
    });

    it("renders midnight as 00, not 24", () => {
      vi.setSystemTime(new Date("2026-09-05T16:00:00Z"));
      expect(runGetTime({ timezone: "Asia/Singapore" }).content).toBe(
        "2026-09-06 00:00:00 (Asia/Singapore)",
      );
    });

    it("prints the zone exactly as the caller wrote it", () => {
      // "utc" is accepted by Intl and canonicalises to "UTC", but the decided
      // contract echoes what was asked for.
      expect(runGetTime({ timezone: "utc" }).content).toBe("2026-09-05 11:12:12 (utc)");
    });
  });

  describe("default (system) timezone", () => {
    it("names the resolved system zone and marks it as the default", () => {
      const { zone, defaulted } = parseReply(runGetTime({}).content);
      expect(defaulted).toBe(true);
      expect(zone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
      expect(zone).not.toBe("");
    });

    it("the printed wall-clock time really is the frozen instant in that zone", () => {
      // Round trip: printed time + that zone's offset must equal FROZEN.
      // The offset is derived through longOffset, not through the code's own
      // formatToParts assembly, so this cannot pass by repeating its mistake.
      const { date, time, zone } = parseReply(runGetTime({}).content);
      expect(Date.parse(`${date}T${time}${zoneOffsetIso(zone)}`)).toBe(FROZEN.getTime());
    });

    it("the same round trip holds for every explicit zone", () => {
      for (const zone of Object.keys(EXPECTED)) {
        const { date, time } = parseReply(runGetTime({ timezone: zone }).content);
        expect(Date.parse(`${date}T${time}${zoneOffsetIso(zone)}`), zone).toBe(FROZEN.getTime());
      }
    });

    it("the default reply and an explicit UTC reply describe the same instant, an offset apart", () => {
      const dflt = parseReply(runGetTime({}).content);
      const utc = parseReply(runGetTime({ timezone: "UTC" }).content);
      expect(Date.parse(`${dflt.date}T${dflt.time}${zoneOffsetIso(dflt.zone)}`)).toBe(
        Date.parse(`${utc.date}T${utc.time}+00:00`),
      );
    });

    for (const omitted of [undefined, "", "  ", "\t\n", 42, null] as unknown[]) {
      it(`treats ${JSON.stringify(omitted)} as omitted, not as an invalid zone`, () => {
        const outcome = runGetTime({ timezone: omitted });
        expect(outcome.isError).toBeUndefined();
        expect(outcome.content).toContain(", system timezone)");
      });
    }

    it("treats a completely absent argument object as omitted", () => {
      expect(runGetTime({}).content).toContain(", system timezone)");
    });
  });

  describe("unknown timezone", () => {
    it("returns an error naming the value that was asked for", () => {
      const outcome = runGetTime({ timezone: "Not/AZone" });
      expect(outcome.isError).toBe(true);
      expect(outcome.content).toContain('"Not/AZone"');
    });

    it("suggests a valid form so the next call can succeed", () => {
      const content = runGetTime({ timezone: "Not/AZone" }).content;
      expect(content).toContain("IANA");
      expect(content).toContain("Asia/Singapore");
      expect(content).toContain("omit the timezone");
    });

    it("does NOT fall back to the system time", () => {
      const content = runGetTime({ timezone: "Not/AZone" }).content;
      expect(content).not.toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
      expect(content).not.toContain("system timezone)");
    });

    it("the exported message builder produces the same text", () => {
      expect(runGetTime({ timezone: "Mars/Olympus" }).content).toBe(
        unknownTimezoneMessage("Mars/Olympus"),
      );
    });

    it("reports the trimmed value the caller asked for", () => {
      expect(runGetTime({ timezone: "  Not/AZone  " }).content).toContain('"Not/AZone"');
    });
  });

  describe("tool definition", () => {
    it("execute returns the same outcome as runGetTime", async () => {
      const outcome = await getTimeTool.execute({ timezone: "UTC" }, {} as never);
      expect(outcome.content).toBe("2026-09-05 11:12:12 (UTC)");
    });

    it("summarize names the zone when one is given, and does not when it is not", () => {
      expect(getTimeTool.summarize!({ timezone: "UTC" })).toBe("Get the time in UTC");
      expect(getTimeTool.summarize!({})).toBe("Get the time");
    });

    it("renderer shows the result, and the zone when one was asked for", () => {
      expect(getTimeTool.renderer!({ timezone: "UTC" }, "2026-09-05 11:12:12 (UTC)")).toContain("UTC");
      expect(getTimeTool.renderer!({}, "x")).toBe("Read the time → <b>x</b>");
    });

    it("accepts an absent timezone and rejects an unknown key", () => {
      const schema = getTimeTool.inputSchema as { safeParse: (v: unknown) => { success: boolean } };
      expect(schema.safeParse({}).success).toBe(true);
      expect(schema.safeParse({ timezone: "UTC" }).success).toBe(true);
      expect(schema.safeParse({ format: "iso" }).success).toBe(false);
    });
  });
});
