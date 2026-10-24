import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearLayoutSnapshots,
  configureLayoutPersistence,
  getLayoutsSnapshot,
  resetLayoutPersistence,
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

  it("stores view state per workspace", async () => {
    const response = await setWorkspaceViewStateSnapshot({
      workspaceId: "A",
      viewState: { selectedSessionId: "manual-1", previewDockOpen: true },
    });
    await setWorkspaceViewStateSnapshot({ workspaceId: "W2", viewState: { selectedSessionId: "codex-1" } });

    expect(response.viewStateByWorkspace.A).toEqual({ selectedSessionId: "manual-1", previewDockOpen: true });
    await expect(getLayoutsSnapshot()).resolves.toEqual({
      viewStateByWorkspace: {
        A: { selectedSessionId: "manual-1", previewDockOpen: true },
        W2: { selectedSessionId: "codex-1" },
      },
    });
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

    await expect(getLayoutsSnapshot()).resolves.toEqual({ viewStateByWorkspace: {} });
  });

  it("reads a file saved with the retired tile grid and drops its layouts and work modes on the next save", async () => {
    const filePath = await temporaryStateFile();
    await writeFile(
      filePath,
      JSON.stringify({
        version: DESKTOP_STATE_VERSION,
        workspaces: [{ id: "A", label: "Alfred", shortLabel: "A" }, { id: "B", label: "Beta", shortLabel: "B" }],
        activeWorkspaceId: "A",
        layoutsByWorkspace: { A: { one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 } } },
        viewStateByWorkspace: {
          A: { workMode: "focus", selectedSessionId: "one", previewDockOpen: true, collapsedSessionIds: ["two"] },
          B: { workMode: "desk" },
        },
      }),
      "utf8",
    );
    configureLayoutPersistence(createPersistedDesktopStateStore({ filePath }));

    // The selected session and Preview survive; the grid's layouts, work modes and collapsed stack do not.
    await expect(getLayoutsSnapshot()).resolves.toEqual({
      viewStateByWorkspace: { A: { selectedSessionId: "one", previewDockOpen: true } },
    });

    await setWorkspaceViewStateSnapshot({ workspaceId: "A", viewState: { selectedSessionId: "two" } });
    const saved = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    expect(saved).not.toHaveProperty("layoutsByWorkspace");
    expect(saved.viewStateByWorkspace).toEqual({ A: { selectedSessionId: "two", previewDockOpen: true } });
  });

  it("keeps concurrent persisted view-state updates", async () => {
    const filePath = await temporaryStateFile();
    configureLayoutPersistence(createPersistedDesktopStateStore({ filePath }));

    await Promise.all([
      setWorkspaceViewStateSnapshot({ workspaceId: "A", viewState: { selectedSessionId: "one" } }),
      setWorkspaceViewStateSnapshot({ workspaceId: "A", viewState: { previewDockOpen: true } }),
    ]);

    await expect(getLayoutsSnapshot()).resolves.toEqual({
      viewStateByWorkspace: { A: { selectedSessionId: "one", previewDockOpen: true } },
    });
  });
});
