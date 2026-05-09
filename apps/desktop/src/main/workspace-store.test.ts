import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DESKTOP_STATE, DEFAULT_WORKSPACE, createPersistedDesktopStateStore } from "./persisted-desktop-state.js";
import { createWorkspaceStore } from "./workspace-store.js";
import type { WorkspaceStateSnapshot } from "../shared/workspace-ipc.js";

let temporaryDirectory: string | null = null;

async function temporaryStateFile(): Promise<string> {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "alfred-workspace-store-"));
  return path.join(temporaryDirectory, "desktop-state.json");
}

describe("workspace-store", () => {
  afterEach(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = null;
    }
  });

  it("loads the default workspace state from an empty persisted store", async () => {
    const store = createWorkspaceStore({ filePath: await temporaryStateFile() });

    await expect(store.getWorkspaceState()).resolves.toEqual({
      workspaces: [DEFAULT_WORKSPACE],
      activeWorkspaceId: DEFAULT_WORKSPACE.id,
    });
  });

  it("persists workspace list and active workspace id", async () => {
    const filePath = await temporaryStateFile();
    const state: WorkspaceStateSnapshot = {
      workspaces: [
        { id: "A", label: "Alfred", shortLabel: "A" },
        { id: "API", label: "API", shortLabel: "API" },
      ],
      activeWorkspaceId: "API",
    };
    const store = createWorkspaceStore({ filePath });

    await expect(store.setWorkspaceState(state)).resolves.toEqual(state);
    await expect(createWorkspaceStore({ filePath }).getWorkspaceState()).resolves.toEqual(state);
  });

  it("creates a workspace from a folder and makes it active", async () => {
    const filePath = await temporaryStateFile();
    const store = createWorkspaceStore({ filePath, resolveGitBranch: async () => "main" });

    await expect(store.createWorkspaceFromPath("/Users/patryk/Desktop/Client App")).resolves.toEqual({
      workspaces: [
        { id: "A", label: "Alfred", shortLabel: "A" },
        {
          id: "CLIENT-APP",
          label: "Client App",
          shortLabel: "CA",
          rootPath: "/Users/patryk/Desktop/Client App",
          gitBranch: "main",
        },
      ],
      activeWorkspaceId: "CLIENT-APP",
    });
  });

  it("reuses an existing folder workspace instead of duplicating it", async () => {
    const filePath = await temporaryStateFile();
    const store = createWorkspaceStore({ filePath });

    await store.createWorkspaceFromPath("/Users/patryk/Desktop/Client App");
    await store.createWorkspaceFromPath("/Users/patryk/Desktop/Client App");

    await expect(store.getWorkspaceState()).resolves.toEqual({
      workspaces: [
        { id: "A", label: "Alfred", shortLabel: "A" },
        {
          id: "CLIENT-APP",
          label: "Client App",
          shortLabel: "CA",
          rootPath: "/Users/patryk/Desktop/Client App",
        },
      ],
      activeWorkspaceId: "CLIENT-APP",
    });
  });

  it("refreshes persisted git branches when workspace state is read", async () => {
    const filePath = await temporaryStateFile();
    const persistedStateStore = createPersistedDesktopStateStore({ filePath });
    await persistedStateStore.setState({
      ...DEFAULT_DESKTOP_STATE,
      workspaces: [
        { id: "A", label: "Alfred", shortLabel: "A" },
        {
          id: "CLIENT",
          label: "Client",
          shortLabel: "CLI",
          rootPath: "/repo/client",
          gitBranch: "main",
        },
      ],
      activeWorkspaceId: "CLIENT",
      layoutsByWorkspace: {},
    });
    const store = createWorkspaceStore({ persistedStateStore, resolveGitBranch: async () => "feature/agent-space" });

    await expect(store.getWorkspaceState()).resolves.toEqual({
      workspaces: [
        { id: "A", label: "Alfred", shortLabel: "A" },
        {
          id: "CLIENT",
          label: "Client",
          shortLabel: "CLI",
          rootPath: "/repo/client",
          gitBranch: "feature/agent-space",
        },
      ],
      activeWorkspaceId: "CLIENT",
    });
  });

  it("keeps ids unique when two folders share a basename", async () => {
    const filePath = await temporaryStateFile();
    const store = createWorkspaceStore({ filePath });

    await store.createWorkspaceFromPath("/Users/patryk/Desktop/Client App");
    const snapshot = await store.createWorkspaceFromPath("/tmp/Client App");

    expect(snapshot.workspaces.map((workspace) => workspace.id)).toEqual(["A", "CLIENT-APP", "CLIENT-APP-2"]);
  });

  it("normalizes invalid updates before persisting them", async () => {
    const filePath = await temporaryStateFile();
    const store = createWorkspaceStore({ filePath });

    await expect(
      store.setWorkspaceState({
        workspaces: [
          { id: " A ", label: " Alfred ", shortLabel: " A " },
          { id: "A", label: "Duplicate", shortLabel: "D" },
          { id: "UI", label: "Interface", shortLabel: "UI" },
        ],
        activeWorkspaceId: "missing",
      }),
    ).resolves.toEqual({
      workspaces: [
        { id: "A", label: "Alfred", shortLabel: "A" },
        { id: "UI", label: "Interface", shortLabel: "UI" },
      ],
      activeWorkspaceId: "A",
    });
  });

  it("updates workspace state without dropping layout or staged plan data", async () => {
    const filePath = await temporaryStateFile();
    const persistedStateStore = createPersistedDesktopStateStore({ filePath });
    await persistedStateStore.setState({
      ...DEFAULT_DESKTOP_STATE,
      workspaces: [{ id: "A", label: "Alfred", shortLabel: "A" }],
      activeWorkspaceId: "A",
      layoutsByWorkspace: {
        A: { one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 } },
      },
      stagedPlan: {
        id: "plan-1",
        prompt: "prepare",
        sessions: [{ id: "alfred-1", kind: "shell", title: "A", command: "echo", args: ["a"] }],
      },
      restoredTerminalSessions: [
        {
          clientId: "manual-1",
          title: "Manual · zsh 1",
          source: "manual",
          cwd: "/repo",
          shell: "/bin/zsh",
          buffer: "history\n",
        },
      ],
    });

    const store = createWorkspaceStore({ persistedStateStore });
    await store.setWorkspaceState({
      workspaces: [
        { id: "A", label: "Alfred", shortLabel: "A" },
        { id: "W2", label: "Workspace 2", shortLabel: "W2" },
      ],
      activeWorkspaceId: "W2",
    });

    await expect(persistedStateStore.getState()).resolves.toEqual(
      expect.objectContaining({
        layoutsByWorkspace: {
          A: { one: { tileId: "one", col: 1, row: 1, colSpan: 6, rowSpan: 4 } },
        },
        stagedPlan: expect.objectContaining({ id: "plan-1" }),
        restoredTerminalSessions: [expect.objectContaining({ clientId: "manual-1" })],
      }),
    );
  });
});
