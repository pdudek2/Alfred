import { describe, expect, it } from "vitest";
import {
  rendererViewportMatches,
  selectDisplayBounds,
  windowBoundsExpectation,
} from "./display-placement";

type Display = {
  id: number;
  scaleFactor: number;
  workArea: { x: number; y: number; width: number; height: number };
};

describe("CSS evidence display placement", () => {
  it("requires the renderer viewport to match both requested dimensions", () => {
    expect(rendererViewportMatches({ width: 1440, height: 920 }, { width: 1440, height: 920 })).toBe(true);
    expect(rendererViewportMatches({ width: 1439, height: 920 }, { width: 1440, height: 920 })).toBe(false);
    expect(rendererViewportMatches({ width: 1440, height: 919 }, { width: 1440, height: 920 })).toBe(false);
  });

  it("ignores OS-clamped position by default but preserves strict display placement", () => {
    const requested = { x: -1728, y: 30, width: 1120, height: 720 };

    expect(windowBoundsExpectation(requested, false)).toEqual({ width: 1120, height: 720 });
    expect(windowBoundsExpectation(requested, true)).toEqual(requested);
  });

  it("selects the lowest-id exact-scale display and places the whole window in its work area", () => {
    const displays: Display[] = [
      { id: 9, scaleFactor: 2, workArea: { x: 1800, y: 40, width: 1800, height: 1120 } },
      { id: 4, scaleFactor: 1, workArea: { x: 0, y: 24, width: 1440, height: 876 } },
      { id: 2, scaleFactor: 2, workArea: { x: -1728, y: 30, width: 1728, height: 1080 } },
    ];
    const result = selectDisplayBounds(displays, 2, { width: 1440, height: 920 });

    expect(result).toEqual({
      displayId: 2,
      bounds: { x: -1728, y: 30, width: 1440, height: 920 },
    });
  });

  it("fails clearly when no target-scale display can contain the requested window", () => {
    expect(() => selectDisplayBounds([
      { id: 3, scaleFactor: 1, workArea: { x: 0, y: 25, width: 1728, height: 1075 } },
      { id: 8, scaleFactor: 2, workArea: { x: 1728, y: 40, width: 1200, height: 800 } },
    ], 2, { width: 1440, height: 920 })).toThrow(
      "No display with scaleFactor 2 can contain a 1440x920 window",
    );
  });

  it("rejects an invalid target scale factor", () => {
    expect(() => selectDisplayBounds([], Number.NaN, { width: 1440, height: 920 })).toThrow(
      "Invalid target scale factor",
    );
  });
});
