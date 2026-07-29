import { BrowserWindow, ipcMain, shell } from "electron";
import {
  desktopStateChannels,
  type DesktopPrivacySettings,
  type DesktopSaveStatus,
  type DesktopStateClearSavedTerminalDataResult,
  type DesktopStateRevealFileResult,
} from "../shared/desktop-state-ipc.js";
import {
  applyTerminalPrivacyPolicyInMemory,
} from "./terminal-manager.js";
import {
  normalizeDesktopPrivacySettings,
  sanitizePersistedTerminalSession,
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
      applyTerminalPrivacyPolicyInMemory(privacySettings);
      const state = await store.updateState((current) => ({
        ...current,
        privacySettings,
        restoredTerminalSessions: current.restoredTerminalSessions.flatMap((session) => {
          const sanitized = sanitizePersistedTerminalSession(session, privacySettings);
          return sanitized ? [sanitized] : [];
        }),
      }));
      return state.privacySettings;
    },
  );

  ipcMain.handle(
    desktopStateChannels.clearSavedTerminalData,
    async (): Promise<DesktopStateClearSavedTerminalDataResult> => {
      try {
        const current = await store.getState();
        const affectedClientIds = new Set(current.restoredTerminalSessions.map((session) => session.clientId));
        const clearedSessions = applyTerminalPrivacyPolicyInMemory(
          current.privacySettings,
          true,
          affectedClientIds,
        );
        const state = await store.updateState((latest) => ({
          ...latest,
          restoredTerminalSessions: latest.restoredTerminalSessions.flatMap((session) => {
            const sanitized = sanitizePersistedTerminalSession(session, latest.privacySettings, true);
            return sanitized ? [sanitized] : [];
          }),
        }));
        return {
          ok: true,
          clearedSessions,
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
