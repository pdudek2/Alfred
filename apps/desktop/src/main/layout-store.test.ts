import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearLayoutSnapshots,
  configureLayoutPersistence,
  getLayoutsSnapshot,
  resetLayoutPersistence,
  setWorkspaceLayoutSnapshot,
} from "./layout-store.js";
import { createPersistedDesktopStateStore } from "./persisted-desktop-state.js";

let temporaryDirectory: string | null = null;

async function temporaryStateFile(): Promise<string> {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "alfred-layout-store-"));
  return path.join(temporaryDirectory, "desktop-state.json");
}

describe("layout-store", () => {
  beforeEach(async () => {
    resetLayoutPersistence();
    await clearLayoutSnapshots();
  });

  afterEach(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = null;
    }
  });

  it("stores and clones layouts per workspace", async () => {
    const layouts = {
      one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 },
    };

    const response = await setWorkspaceLayoutSnapshot({ workspaceId: "A", layouts });
    layouts.one.col = 9;

    expect(response.layoutsByWorkspace.A?.one).toEqual({ tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 });
    await expect(getLayoutsSnapshot()).resolves.toEqual({
      layoutsByWorkspace: {
        A: { one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 } },
      },
    });
  });

  it("keeps workspace layouts separate", async () => {
    await setWorkspaceLayoutSnapshot({
      workspaceId: "A",
      layouts: { one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 } },
    });
    await setWorkspaceLayoutSnapshot({
      workspaceId: "W2",
      layouts: { two: { tileId: "two", col: 7, row: 1, colSpan: 6, rowSpan: 4 } },
    });

    expect(Object.keys((await getLayoutsSnapshot()).layoutsByWorkspace)).toEqual(["A", "W2"]);
  });

  it("persists layouts when configured with desktop state storage", async () => {
    const filePath = await temporaryStateFile();
    const persistedStateStore = createPersistedDesktopStateStore({ filePath });
    configureLayoutPersistence(persistedStateStore);

    await setWorkspaceLayoutSnapshot({
      workspaceId: "A",
      layouts: { one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 } },
    });

    await expect(getLayoutsSnapshot()).resolves.toEqual({
      layoutsByWorkspace: {
        A: { one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 } },
      },
    });
    await expect(createPersistedDesktopStateStore({ filePath }).getState()).resolves.toEqual(
      expect.objectContaining({
        layoutsByWorkspace: {
          A: { one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 } },
        },
      }),
    );
  });
});
