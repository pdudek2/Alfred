import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DESKTOP_STATE,
  type DesktopSaveStatus,
} from "./persisted-desktop-state.js";
import { registerDesktopStateIpc } from "./desktop-state-ipc.js";
import { desktopStateChannels } from "../shared/desktop-state-ipc.js";

const mocks = vi.hoisted(() => ({
  applyTerminalPrivacyPolicyInMemory: vi.fn((
    _privacySettings?: unknown,
    _clearLaunchData?: boolean,
    affectedClientIds?: Set<string>,
  ) => affectedClientIds?.size ?? 2),
  handlers: new Map<string, (_event?: unknown, request?: unknown) => unknown>(),
  sentMessages: [] as Array<{ channel: string; payload: unknown }>,
  showItemInFolder: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => {
            mocks.sentMessages.push({ channel, payload });
          },
        },
      },
    ],
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event?: unknown, request?: unknown) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
  },
  shell: {
    showItemInFolder: mocks.showItemInFolder,
  },
}));

vi.mock("./terminal-manager.js", () => ({
  applyTerminalPrivacyPolicyInMemory: mocks.applyTerminalPrivacyPolicyInMemory,
}));

describe("desktop-state IPC", () => {
  it("updates privacy settings through the persisted state store", async () => {
    mocks.handlers.clear();
    mocks.applyTerminalPrivacyPolicyInMemory.mockClear();
    const store = createMemoryStore({
      ...DEFAULT_DESKTOP_STATE,
      restoredTerminalSessions: [sensitiveIsolatedSession("settings-session")],
    });
    registerDesktopStateIpc(store);

    const handler = mocks.handlers.get(desktopStateChannels.updatePrivacySettings);
    await expect(
      handler?.(undefined, {
        terminalScrollbackRetention: "off",
        externalSessionIndexingEnabled: false,
      }),
    ).resolves.toEqual({
      terminalScrollbackRetention: "off",
      externalSessionIndexingEnabled: false,
    });
    await expect(store.getState()).resolves.toMatchObject({
      privacySettings: {
        terminalScrollbackRetention: "off",
        externalSessionIndexingEnabled: false,
      },
    });
    expect(mocks.applyTerminalPrivacyPolicyInMemory).toHaveBeenCalledWith({
      terminalScrollbackRetention: "off",
      externalSessionIndexingEnabled: false,
    });
    expect((await store.getState()).restoredTerminalSessions).toEqual([
      {
        clientId: "settings-session",
        title: "Isolated settings-session",
        source: "alfred",
        agentKind: "codex",
        workspaceId: "workspace-a",
        workspaceRootFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
        isolation: "worktree",
        branchName: "alfred-codex-settings-session",
        createdAt: 123,
      },
    ]);
  });

  it("clears all persisted terminal launch, transcript, and activity data", async () => {
    mocks.handlers.clear();
    mocks.applyTerminalPrivacyPolicyInMemory.mockClear();
    mocks.applyTerminalPrivacyPolicyInMemory.mockImplementationOnce((
      _privacySettings,
      _clearLaunchData,
      affectedClientIds,
    ) => {
      affectedClientIds?.add("live-session");
      return affectedClientIds?.size ?? 1;
    });
    const store = createMemoryStore({
      ...DEFAULT_DESKTOP_STATE,
      restoredTerminalSessions: [sensitiveIsolatedSession("clear-session")],
    });
    registerDesktopStateIpc(store);

    const handler = mocks.handlers.get(desktopStateChannels.clearSavedTerminalData);
    await expect(handler?.()).resolves.toEqual({ ok: true, clearedSessions: 2 });
    expect(mocks.applyTerminalPrivacyPolicyInMemory.mock.calls[0]?.slice(0, 2)).toEqual([
      DEFAULT_DESKTOP_STATE.privacySettings,
      true,
    ]);
    expect((await store.getState()).restoredTerminalSessions).toEqual([
      {
        clientId: "clear-session",
        title: "Isolated clear-session",
        source: "alfred",
        agentKind: "codex",
        workspaceId: "workspace-a",
        workspaceRootFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
        isolation: "worktree",
        branchName: "alfred-codex-clear-session",
        createdAt: 123,
      },
    ]);
  });

  it("reveals the main-owned desktop state file path", async () => {
    mocks.handlers.clear();
    mocks.showItemInFolder.mockClear();
    const store = createMemoryStore();
    registerDesktopStateIpc(store);

    const handler = mocks.handlers.get(desktopStateChannels.revealStateFile);
    expect(handler?.()).toEqual({ ok: true, resolvedPath: "/tmp/alfred-desktop-state.json" });
    expect(mocks.showItemInFolder).toHaveBeenCalledWith("/tmp/alfred-desktop-state.json");
  });

  it("forwards save status changes to renderer windows", () => {
    mocks.handlers.clear();
    mocks.sentMessages.length = 0;
    const store = createMemoryStore();
    registerDesktopStateIpc(store);

    store.emitSaveStatus({ status: "saveFailed", message: "Failed to persist desktop state.", failedAt: 123 });

    expect(mocks.sentMessages).toEqual([
      {
        channel: desktopStateChannels.saveStatus,
        payload: { status: "saveFailed", message: "Failed to persist desktop state.", failedAt: 123 },
      },
    ]);
  });
});

function sensitiveIsolatedSession(clientId: string) {
  return {
    clientId,
    title: `Isolated ${clientId}`,
    source: "alfred" as const,
    agentKind: "codex" as const,
    workspaceId: "workspace-a",
    isolation: "worktree" as const,
    branchName: `alfred-codex-${clientId}`,
    createdAt: 123,
    cwd: `/alfred/userData/worktrees/${clientId}`,
    baseCwd: "/repo",
    shell: "codex",
    command: "codex",
    args: ["resume", "secret"],
    resumeTarget: {
      agentKind: "codex" as const,
      sessionId: "secret-session",
      source: "codex-session-index" as const,
    },
    buffer: "secret transcript",
    activityEvents: [
      {
        id: "activity-1",
        kind: "warning" as const,
        title: "Warning",
        detail: "secret",
        payload: { type: "warning" as const, message: "secret" },
        at: 123,
      },
    ],
    lastActivityAt: 123,
    lastOutputAt: 124,
  };
}

function createMemoryStore(initialState = DEFAULT_DESKTOP_STATE) {
  const listeners = new Set<(status: DesktopSaveStatus) => void>();
  let state = initialState;
  let saveStatus: DesktopSaveStatus = { status: "saved" };

  return {
    emitSaveStatus(status: DesktopSaveStatus): void {
      saveStatus = status;
      for (const listener of listeners) listener(status);
    },
    getFilePath: vi.fn(() => "/tmp/alfred-desktop-state.json"),
    getSaveStatus: vi.fn(() => saveStatus),
    getState: vi.fn(async () => state),
    onSaveStatus: vi.fn((listener: (status: DesktopSaveStatus) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    retrySave: vi.fn(async () => state),
    setState: vi.fn(async (next) => {
      state = next;
      return state;
    }),
    updateState: vi.fn(async (updater) => {
      state = await updater(state);
      return state;
    }),
  };
}
