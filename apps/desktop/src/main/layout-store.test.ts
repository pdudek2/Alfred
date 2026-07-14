import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearLayoutSnapshots,
  configureLayoutPersistence,
  getLayoutsSnapshot,
  resetLayoutPersistence,
  setWorkspaceLayoutSnapshot,
  setWorkspaceViewStateSnapshot,
} from "./layout-store.js";
import { DESKTOP_STATE_VERSION, createPersistedDesktopStateStore } from "./persisted-desktop-state.js";

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
      viewStateByWorkspace: {},
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

  it("stores view state per workspace", async () => {
    const response = await setWorkspaceViewStateSnapshot({
      workspaceId: "A",
      viewState: { workMode: "focus", selectedSessionId: "manual-1" },
    });

    expect(response.viewStateByWorkspace.A).toEqual({ workMode: "focus", selectedSessionId: "manual-1" });
    await expect(getLayoutsSnapshot()).resolves.toEqual({
      layoutsByWorkspace: {},
      viewStateByWorkspace: {
        A: { workMode: "focus", selectedSessionId: "manual-1" },
      },
    });
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
      viewStateByWorkspace: {},
    });
    await expect(createPersistedDesktopStateStore({ filePath }).getState()).resolves.toEqual(
      expect.objectContaining({
        layoutsByWorkspace: {
          A: { one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 } },
        },
      }),
    );
  });

  it("does not expose a retired context drawer value from persisted layout state", async () => {
    const filePath = await temporaryStateFile();
    await writeFile(
      filePath,
      JSON.stringify({
        version: DESKTOP_STATE_VERSION,
        viewStateByWorkspace: {
          A: { contextDrawerOpen: true },
        },
      }),
      "utf8",
    );
    configureLayoutPersistence(createPersistedDesktopStateStore({ filePath }));

    await expect(getLayoutsSnapshot()).resolves.toEqual({
      layoutsByWorkspace: {},
      viewStateByWorkspace: {},
    });
  });

  it("keeps concurrent persisted layout and view-state updates", async () => {
    const filePath = await temporaryStateFile();
    const persistedStateStore = createPersistedDesktopStateStore({ filePath });
    configureLayoutPersistence(persistedStateStore);

    await Promise.all([
      setWorkspaceLayoutSnapshot({
        workspaceId: "A",
        layouts: { one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 } },
      }),
      setWorkspaceViewStateSnapshot({
        workspaceId: "A",
        viewState: { workMode: "focus", selectedSessionId: "one" },
      }),
    ]);

    await expect(getLayoutsSnapshot()).resolves.toEqual({
      layoutsByWorkspace: {
        A: { one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 } },
      },
      viewStateByWorkspace: {
        A: { workMode: "focus", selectedSessionId: "one" },
      },
    });
  });
});
