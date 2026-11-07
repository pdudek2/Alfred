import { describe, expect, it } from "vitest";
import { initialDetailsColumnState, isDetailsOpen, withDetailsOpen, withNarrowWindow } from "./details-column";

describe("Details column in a narrow window", () => {
  it("starts hidden, still toggles, and gives the wide-window choice back untouched", () => {
    let state = withDetailsOpen(initialDetailsColumnState(false), "A", false);
    expect(isDetailsOpen(state, "A")).toBe(false);
    expect(isDetailsOpen(state, "B")).toBe(true);

    state = withNarrowWindow(state, true);
    expect(isDetailsOpen(state, "B")).toBe(false);
    state = withDetailsOpen(state, "A", true);
    state = withDetailsOpen(state, "B", true);
    state = withDetailsOpen(state, "B", false);
    expect(isDetailsOpen(state, "A")).toBe(true);
    expect(isDetailsOpen(state, "B")).toBe(false);

    state = withNarrowWindow(state, false);
    expect(isDetailsOpen(state, "A")).toBe(false);
    expect(isDetailsOpen(state, "B")).toBe(true);

    state = withNarrowWindow(state, true);
    expect(isDetailsOpen(state, "A")).toBe(false);
  });
});
