import { describe, expect, it } from "vitest";
import {
  historyDayGroup,
  sessionAgeLabel,
  sessionAgeShort,
  sessionAgeWords,
  sessionDateTimeLabel,
  sessionStartedLabel,
} from "./session-time";

describe("session time", () => {
  it("formats short, hourly, daily, and weekly session ages", () => {
    const now = new Date("2026-05-09T12:00:00Z").getTime();

    expect(sessionAgeLabel(undefined, now)).toBeNull();
    expect(sessionAgeLabel(now - 20_000, now)).toBe("now");
    expect(sessionAgeLabel(now - 12 * 60_000, now)).toBe("12m");
    expect(sessionAgeLabel(now - 2 * 60 * 60_000 - 8 * 60_000, now)).toBe("2h");
    expect(sessionAgeLabel(now - 2 * 60 * 60_000 - 16 * 60_000, now)).toBe("2h 16m");
    expect(sessionAgeLabel(now - 3 * 24 * 60 * 60_000 - 4 * 60 * 60_000, now)).toBe("3d 4h");
    expect(sessionAgeLabel(now - 15 * 24 * 60 * 60_000, now)).toBe("2w");
    // From a week on, the same one-unit age History shows.
    expect(sessionAgeLabel(now - 10 * 24 * 60 * 60_000, now)).toBe("10d");
    expect(sessionAgeLabel(now - 800 * 24 * 60 * 60_000, now)).toBe("2y");
  });

  it("spells out when the focused session started", () => {
    const now = new Date("2026-05-09T12:00:00Z").getTime();

    expect(sessionStartedLabel(undefined, now)).toBeNull();
    expect(sessionStartedLabel(now - 20_000, now)).toBe("Started just now");
    expect(sessionStartedLabel(now - 18 * 60_000, now)).toBe("Started 18 min ago");
    expect(sessionStartedLabel(now - 2 * 60 * 60_000 - 16 * 60_000, now)).toBe("Started 2h 16m ago");
    expect(sessionStartedLabel(now - 15 * 24 * 60 * 60_000, now)).toBe("Started 2w ago");
  });

  it("gives History rows one unit and sentences the same age in words", () => {
    const now = new Date("2026-05-09T12:00:00Z").getTime();
    const minute = 60_000;
    const day = 24 * 60 * minute;

    expect(sessionAgeShort(undefined, now)).toBeNull();
    expect(sessionAgeShort(now - 20_000, now)).toBe("now");
    expect(sessionAgeShort(now - 12 * minute, now)).toBe("12m");
    expect(sessionAgeShort(now - 136 * minute, now)).toBe("2h");
    expect(sessionAgeShort(now - 9 * day - 4 * 60 * minute, now)).toBe("9d");
    expect(sessionAgeShort(now - 13 * day, now)).toBe("13d");
    expect(sessionAgeShort(now - 21 * day, now)).toBe("3w");
    expect(sessionAgeShort(now - 800 * day, now)).toBe("2y");

    expect(sessionAgeWords(undefined, now)).toBeNull();
    expect(sessionAgeWords(now - 20_000, now)).toBeNull();
    expect(sessionAgeWords(now - 1 * minute, now)).toBe("1 minute");
    expect(sessionAgeWords(now - 136 * minute, now)).toBe("2 hours");
    expect(sessionAgeWords(now - 9 * day, now)).toBe("9 days");
    expect(sessionAgeWords(now - 21 * day, now)).toBe("3 weeks");
  });

  it("groups History by local day: today, the last seven days, earlier", () => {
    const now = new Date(2026, 4, 9, 15, 30).getTime();

    expect(historyDayGroup(new Date(2026, 4, 9, 0, 0).getTime(), now)).toBe("Today");
    expect(historyDayGroup(now + 60_000, now)).toBe("Today");
    expect(historyDayGroup(new Date(2026, 4, 8, 23, 59).getTime(), now)).toBe("This week");
    expect(historyDayGroup(new Date(2026, 4, 3, 0, 0).getTime(), now)).toBe("This week");
    expect(historyDayGroup(new Date(2026, 4, 2, 23, 59).getTime(), now)).toBe("Earlier");
  });

  it("formats a stable absolute timestamp for session history", () => {
    expect(sessionDateTimeLabel(undefined)).toBeNull();
    const localTimestamp = new Date(2026, 6, 20, 12, 15).getTime();
    expect(sessionDateTimeLabel(localTimestamp)).toBe("20 Jul 2026, 12:15");
  });
});
