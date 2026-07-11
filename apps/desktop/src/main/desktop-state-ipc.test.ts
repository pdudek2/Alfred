import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DESKTOP_STATE,
  type DesktopSaveStatus,
} from "./persisted-desktop-state.js";
import { registerDesktopStateIpc } from "./desktop-state-ipc.js";
import { desktopStateChannels } from "../shared/desktop-state-ipc.js";

const mocks = vi.hoisted(() => ({
  clearTerminalSavedDataInMemory: vi.fn(() => 2),
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
  clearTerminalSavedDataInMemory: mocks.clearTerminalSavedDataInMemory,
}));

describe("desktop-state IPC", () => {
  it("updates privacy settings through the persisted state store", async () => {
    mocks.handlers.clear();
    const store = createMemoryStore();
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
  });

  it("clears persisted terminal buffers and activity previews", async () => {
    mocks.handlers.clear();
    mocks.clearTerminalSavedDataInMemory.mockClear();
    const store = createMemoryStore({
      ...DEFAULT_DESKTOP_STATE,
      restoredTerminalSessions: [
        {
          clientId: "manual-1",
          title: "Manual",
          source: "manual",
          cwd: "/repo",
          shell: "/bin/zsh",
          buffer: "secret",
          activityEvents: [
            {
              id: "activity-1",
              kind: "warning",
              title: "Warning",
              detail: "secret",
              payload: { type: "warning", message: "secret" },
              at: 123,
            },
          ],
        },
      ],
    });
    registerDesktopStateIpc(store);

    const handler = mocks.handlers.get(desktopStateChannels.clearSavedTerminalData);
    await expect(handler?.()).resolves.toEqual({ ok: true, clearedSessions: 2 });
    expect(mocks.clearTerminalSavedDataInMemory).toHaveBeenCalledTimes(1);
    await expect(store.getState()).resolves.toMatchObject({
      restoredTerminalSessions: [
        expect.objectContaining({
          clientId: "manual-1",
          buffer: "",
        }),
      ],
    });
    expect((await store.getState()).restoredTerminalSessions[0]).not.toHaveProperty("activityEvents");
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
