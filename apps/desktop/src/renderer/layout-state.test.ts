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
  it("keeps existing layouts, adds new tiles, and removes missing tiles", () => {
    const existing: Record<string, TileLayout> = {
      one: { tileId: "one", col: 2, row: 3, colSpan: 5, rowSpan: 4 },
      stale: { tileId: "stale", col: 1, row: 1, colSpan: 6, rowSpan: 4 },
    };

    expect(ensureTileLayouts([{ id: "one" }, { id: "two" }], existing)).toEqual({
      one: { tileId: "one", col: 2, row: 3, colSpan: 5, rowSpan: 4 },
      two: { tileId: "two", col: 7, row: 1, colSpan: 6, rowSpan: 4 },
    });
  });

  it("clamps moves inside the 12-column grid", () => {
    const layouts = { one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 } };

    expect(moveTileLayout(layouts, "one", -5, -5).one).toEqual({ tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 });
    expect(moveTileLayout(layouts, "one", 20, 2).one).toEqual({ tileId: "one", col: 7, row: 3, colSpan: 6, rowSpan: 4 });
  });

  it("clamps resize spans", () => {
    const layouts = { one: { tileId: "one", col: 9, row: 1, colSpan: 4, rowSpan: 3 } };

    expect(resizeTileLayout(layouts, "one", -10, -10).one).toEqual({ tileId: "one", col: 9, row: 1, colSpan: 3, rowSpan: 2 });
    expect(resizeTileLayout(layouts, "one", 50, 2).one).toEqual({ tileId: "one", col: 1, row: 1, colSpan: GRID_COLUMNS, rowSpan: 5 });
  });

  it("returns the same layout object when moving an unknown tile", () => {
    const layouts = { one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 } };

    expect(moveTileLayout(layouts, "missing", 1, 1)).toBe(layouts);
  });

  it("builds focus, two-up, and grid presets", () => {
    const sessions = [{ id: "one" }, { id: "two" }, { id: "three" }];

    expect(applyLayoutPreset(sessions, "focus").one).toEqual({ tileId: "one", col: 1, row: 1, colSpan: 12, rowSpan: 5 });
    expect(applyLayoutPreset(sessions, "two-up").two).toEqual({ tileId: "two", col: 7, row: 1, colSpan: 6, rowSpan: 4 });
    expect(applyLayoutPreset(sessions, "grid").three).toEqual({ tileId: "three", col: 1, row: 5, colSpan: 6, rowSpan: 4 });
  });
});
