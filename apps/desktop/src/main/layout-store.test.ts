import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLayoutSnapshots,
  getLayoutsSnapshot,
  setWorkspaceLayoutSnapshot,
} from "./layout-store.js";

describe("layout-store", () => {
  beforeEach(() => {
    clearLayoutSnapshots();
  });

  it("stores and clones layouts per workspace", () => {
    const layouts = {
      one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 },
    };

    const response = setWorkspaceLayoutSnapshot({ workspaceId: "A", layouts });
    layouts.one.col = 9;

    expect(response.layoutsByWorkspace.A?.one).toEqual({ tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 });
    expect(getLayoutsSnapshot().layoutsByWorkspace.A?.one).toEqual({ tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 });
  });

  it("keeps workspace layouts separate", () => {
    setWorkspaceLayoutSnapshot({
      workspaceId: "A",
      layouts: { one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 } },
    });
    setWorkspaceLayoutSnapshot({
      workspaceId: "W2",
      layouts: { two: { tileId: "two", col: 7, row: 1, colSpan: 6, rowSpan: 4 } },
    });

    expect(Object.keys(getLayoutsSnapshot().layoutsByWorkspace)).toEqual(["A", "W2"]);
  });
});
