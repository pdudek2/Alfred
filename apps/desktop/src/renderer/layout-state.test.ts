import { describe, expect, it } from "vitest";
import {
  applyLayoutPreset,
  ensureTileLayouts,
  GRID_COLUMNS,
  moveTileLayout,
  resizeTileLayout,
  type TileLayout,
} from "./layout-state";

describe("layout-state", () => {
  it("refits the desk when tile membership changes", () => {
    const existing: Record<string, TileLayout> = {
      one: { tileId: "one", col: 2, row: 3, colSpan: 5, rowSpan: 4 },
      stale: { tileId: "stale", col: 1, row: 1, colSpan: 6, rowSpan: 4 },
    };

    expect(ensureTileLayouts([{ id: "one" }, { id: "two" }], existing)).toEqual({
      one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 8 },
      two: { tileId: "two", col: 7, row: 1, colSpan: 6, rowSpan: 8 },
    });
  });

  it("keeps existing layouts while the same tiles remain on the desk", () => {
    const existing: Record<string, TileLayout> = {
      one: { tileId: "one", col: 2, row: 3, colSpan: 5, rowSpan: 4 },
      two: { tileId: "two", col: 7, row: 3, colSpan: 5, rowSpan: 4 },
    };

    expect(ensureTileLayouts([{ id: "one" }, { id: "two" }], existing)).toEqual(existing);
  });

  it("defaults one tile to a full-width composed panel", () => {
    expect(ensureTileLayouts([{ id: "one" }], {})).toEqual({
      one: { tileId: "one", col: 1, row: 1, colSpan: 12, rowSpan: 8 },
    });
  });

  it("defaults two tiles to a clean split view", () => {
    expect(ensureTileLayouts([{ id: "one" }, { id: "two" }], {})).toEqual({
      one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 8 },
      two: { tileId: "two", col: 7, row: 1, colSpan: 6, rowSpan: 8 },
    });
  });

  it("defaults three or more tiles to a stable two-column layout", () => {
    const sessions = [{ id: "one" }, { id: "two" }, { id: "three" }, { id: "four" }];

    expect(ensureTileLayouts(sessions, {})).toEqual({
      one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 6 },
      two: { tileId: "two", col: 7, row: 1, colSpan: 6, rowSpan: 6 },
      three: { tileId: "three", col: 1, row: 7, colSpan: 6, rowSpan: 6 },
      four: { tileId: "four", col: 7, row: 7, colSpan: 6, rowSpan: 6 },
    });
  });

  it("clamps moves inside the 12-column grid", () => {
    const layouts = { one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 } };

    expect(moveTileLayout(layouts, "one", -5, -5).one).toEqual({
      tileId: "one",
      col: 1,
      row: 1,
      colSpan: 6,
      rowSpan: 4,
    });
    expect(moveTileLayout(layouts, "one", 20, 2).one).toEqual({
      tileId: "one",
      col: 7,
      row: 3,
      colSpan: 6,
      rowSpan: 4,
    });
  });

  it("clamps resize spans", () => {
    const layouts = { one: { tileId: "one", col: 9, row: 1, colSpan: 4, rowSpan: 3 } };

    expect(resizeTileLayout(layouts, "one", -10, -10).one).toEqual({
      tileId: "one",
      col: 9,
      row: 1,
      colSpan: 3,
      rowSpan: 2,
    });
    expect(resizeTileLayout(layouts, "one", 50, 2).one).toEqual({
      tileId: "one",
      col: 1,
      row: 1,
      colSpan: GRID_COLUMNS,
      rowSpan: 5,
    });
  });

  it("returns the same layout object when moving an unknown tile", () => {
    const layouts = { one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 } };

    expect(moveTileLayout(layouts, "missing", 1, 1)).toBe(layouts);
  });

  it("builds focus, two-up, and grid presets", () => {
    const sessions = [{ id: "one" }, { id: "two" }, { id: "three" }];

    expect(applyLayoutPreset(sessions, "focus").one).toEqual({
      tileId: "one",
      col: 1,
      row: 1,
      colSpan: 12,
      rowSpan: 8,
    });
    expect(applyLayoutPreset(sessions, "two-up").two).toEqual({
      tileId: "two",
      col: 7,
      row: 1,
      colSpan: 6,
      rowSpan: 8,
    });
    expect(applyLayoutPreset(sessions, "grid").three).toEqual({
      tileId: "three",
      col: 1,
      row: 7,
      colSpan: 6,
      rowSpan: 6,
    });
  });

  it("puts the selected session first in focus layouts", () => {
    const sessions = [{ id: "one" }, { id: "two" }, { id: "three" }];
    const layout = applyLayoutPreset(sessions, "focus", "three");

    expect(layout.three).toEqual({
      tileId: "three",
      col: 1,
      row: 1,
      colSpan: 12,
      rowSpan: 8,
    });
    expect(layout.one).toEqual({
      tileId: "one",
      col: 1,
      row: 9,
      colSpan: 12,
      rowSpan: 8,
    });
  });
});
