import { describe, expect, it } from "vitest";
import { sessionAgeLabel } from "./session-time";

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
  });
});
