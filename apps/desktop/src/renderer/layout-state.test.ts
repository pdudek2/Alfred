import { describe, expect, it } from "vitest";
import {
  applyLayoutPreset,
  ensureTileLayouts,
  moveTileLayout,
  resizeTileLayout,
  type TileLayout,
} from "./layout-state";

describe("layout-state", () => {
  it("preserves existing tile geometry and places only a newly added tile", () => {
    const existing: Record<string, TileLayout> = {
      one: { tileId: "one", col: 1, row: 1, colSpan: 4, rowSpan: 4 },
      two: { tileId: "two", col: 5, row: 1, colSpan: 8, rowSpan: 4 },
    };

    const result = ensureTileLayouts(
      [{ id: "one" }, { id: "two" }, { id: "three" }],
      existing,
    );

    expect(result.one).toEqual(existing.one);
    expect(result.two).toEqual(existing.two);
    expect(result.three).toEqual({
      tileId: "three",
      col: 1,
      row: 5,
      colSpan: 12,
      rowSpan: 3,
    });
  });

  it("drops removed tiles without moving survivors", () => {
    const existing: Record<string, TileLayout> = {
      one: { tileId: "one", col: 2, row: 3, colSpan: 5, rowSpan: 4 },
      two: { tileId: "two", col: 7, row: 1, colSpan: 6, rowSpan: 8 },
    };

    expect(ensureTileLayouts([{ id: "one" }], existing)).toEqual({
      one: existing.one,
    });
  });

  it("uses single-tile defaults when every saved tile is stale", () => {
    const existing: Record<string, TileLayout> = {
      stale: { tileId: "stale", col: 2, row: 3, colSpan: 5, rowSpan: 4 },
    };

    expect(ensureTileLayouts([{ id: "one" }], existing)).toEqual({
      one: { tileId: "one", col: 1, row: 1, colSpan: 12, rowSpan: 8 },
    });
  });

  it("skips occupied default slots when placing a new tile", () => {
    const existing: Record<string, TileLayout> = {
      one: { tileId: "one", col: 1, row: 1, colSpan: 12, rowSpan: 8 },
    };

    expect(ensureTileLayouts([{ id: "one" }, { id: "two" }], existing).two).toEqual({
      tileId: "two",
      col: 1,
      row: 9,
      colSpan: 6,
      rowSpan: 8,
    });
  });

  it("uses the first free row when adding below two tall tiles", () => {
    const existing: Record<string, TileLayout> = {
      one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 8 },
      two: { tileId: "two", col: 7, row: 1, colSpan: 6, rowSpan: 8 },
    };

    expect(ensureTileLayouts([{ id: "one" }, { id: "two" }, { id: "three" }], existing).three).toEqual({
      tileId: "three",
      col: 1,
      row: 9,
      colSpan: 12,
      rowSpan: 3,
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
      one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 3 },
      two: { tileId: "two", col: 7, row: 1, colSpan: 6, rowSpan: 3 },
      three: { tileId: "three", col: 1, row: 4, colSpan: 6, rowSpan: 3 },
      four: { tileId: "four", col: 7, row: 4, colSpan: 6, rowSpan: 3 },
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

  it("clamps resize spans while keeping the top-left origin fixed", () => {
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
      col: 9,
      row: 1,
      colSpan: 4,
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
      row: 4,
      colSpan: 12,
      rowSpan: 3,
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

  it("keeps the selected session and its split companion in the first row", () => {
    const sessions = [{ id: "one" }, { id: "two" }, { id: "three" }, { id: "four" }];
    const layout = applyLayoutPreset(sessions, "two-up", "four");

    expect(layout.four).toEqual({
      tileId: "four",
      col: 1,
      row: 1,
      colSpan: 6,
      rowSpan: 8,
    });
    expect(layout.one).toEqual({
      tileId: "one",
      col: 7,
      row: 1,
      colSpan: 6,
      rowSpan: 8,
    });
  });
});
