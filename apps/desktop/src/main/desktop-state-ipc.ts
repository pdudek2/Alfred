import { BrowserWindow, ipcMain, shell } from "electron";
import {
  desktopStateChannels,
  type DesktopPrivacySettings,
  type DesktopSaveStatus,
  type DesktopStateClearSavedTerminalDataResult,
  type DesktopStateRevealFileResult,
} from "../shared/desktop-state-ipc.js";
import {
  clearTerminalSavedDataInMemory,
} from "./terminal-manager.js";
import {
  normalizeDesktopPrivacySettings,
  type PersistedDesktopStateStore,
} from "./persisted-desktop-state.js";

export function registerDesktopStateIpc(store: PersistedDesktopStateStore): void {
  store.onSaveStatus((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(desktopStateChannels.saveStatus, status);
      }
    }
  });

  ipcMain.handle(desktopStateChannels.getPrivacySettings, async (): Promise<DesktopPrivacySettings> => {
    return (await store.getState()).privacySettings;
  });

  ipcMain.handle(
    desktopStateChannels.updatePrivacySettings,
    async (_event, request: DesktopPrivacySettings): Promise<DesktopPrivacySettings> => {
      const privacySettings = normalizeDesktopPrivacySettings(request);
      const state = await store.updateState((current) => ({ ...current, privacySettings }));
      return state.privacySettings;
    },
  );

  ipcMain.handle(
    desktopStateChannels.clearSavedTerminalData,
    async (): Promise<DesktopStateClearSavedTerminalDataResult> => {
      try {
        const clearedInMemory = clearTerminalSavedDataInMemory();
        const state = await store.updateState((current) => ({
          ...current,
          restoredTerminalSessions: current.restoredTerminalSessions.map((session) => {
            const { activityEvents: _activityEvents, lastActivityAt: _lastActivityAt, lastOutputAt: _lastOutputAt, ...rest } = session;
            return { ...rest, buffer: "" };
          }),
        }));
        return {
          ok: true,
          clearedSessions: Math.max(clearedInMemory, state.restoredTerminalSessions.length),
        };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Failed to clear saved terminal data." };
      }
    },
  );

  ipcMain.handle(desktopStateChannels.revealStateFile, (): DesktopStateRevealFileResult => {
    const resolvedPath = store.getFilePath();
    try {
      shell.showItemInFolder(resolvedPath);
      return { ok: true, resolvedPath };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to reveal local state file.",
        resolvedPath,
      };
    }
  });

  ipcMain.handle(desktopStateChannels.retrySave, async (): Promise<DesktopSaveStatus> => {
    try {
      await store.retrySave();
    } catch {
      return store.getSaveStatus();
    }
    return store.getSaveStatus();
  });
}
