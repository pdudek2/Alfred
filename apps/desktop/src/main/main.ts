import { app, BrowserWindow, dialog, type MessageBoxSyncOptions } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import {
  configureTerminalPersistence,
  flushTerminalPersistence,
  getTerminalSessionCount,
  killAllTerminalSessions,
  registerTerminalIpc,
} from "./terminal-manager.js";
import { registerAlfredIpc } from "./alfred-orchestrator.js";
import { registerLayoutIpc } from "./layout-ipc.js";
import { configureLayoutPersistence } from "./layout-store.js";
import { createPersistedDesktopStateStore, type PersistedDesktopStateStore } from "./persisted-desktop-state.js";
import { configureStagedPlanPersistence, isStagedSessionLaunchAllowed } from "./staged-plan-store.js";
import { allowedWorkspaceRoots, registerWorkspaceIpc } from "./workspace-ipc.js";
import { createWorkspaceStore } from "./workspace-store.js";
import { resolveDefaultWorkspaceRootPath } from "./default-workspace-root.js";
import {
  attachWindowStatePersistence,
  restoreWindowPresentation,
  type WindowStatePersistenceHandle,
  windowOptionsFromState,
} from "./window-state.js";
import {
  QUIT_GUARD_CANCEL_BUTTON,
  QUIT_GUARD_CONFIRM_BUTTON,
  didCancelTerminalQuit,
  shouldConfirmTerminalQuit,
} from "./quit-guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
const openDevToolsInDev = process.env.ALFRED_DESKTOP_OPEN_DEVTOOLS === "1";
let terminalQuitConfirmed = false;
let terminalPersistenceFlushedForQuit = false;
let desktopStateStore: PersistedDesktopStateStore | null = null;
let activeWindowStatePersistence: WindowStatePersistenceHandle | null = null;

// Load repo-root .env before any IPC registration so OPENROUTER_API_KEY is visible.
// Repo root is two levels up from app.getAppPath() (apps/desktop) — same logic as
// terminal-manager.ts:defaultTerminalCwd().
loadDotenv({ path: path.resolve(app.getAppPath(), "../..", ".env") });

registerAlfredIpc();
registerLayoutIpc();

async function createWindow(persistedDesktopStateStore: PersistedDesktopStateStore): Promise<void> {
  const persistedWindowState = (await persistedDesktopStateStore.getState()).windowState;
  const window = new BrowserWindow({
    ...windowOptionsFromState(persistedWindowState),
    minWidth: 1120,
    minHeight: 720,
    title: "Alfred Agent Space",
    backgroundColor: "#050607",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  activeWindowStatePersistence = attachWindowStatePersistence(window, persistedDesktopStateStore);

  window.once("ready-to-show", () => {
    restoreWindowPresentation(window, persistedWindowState);
    window.show();
  });

  window.on("close", (event) => {
    if (
      process.platform !== "darwin" &&
      !terminalQuitConfirmed &&
      BrowserWindow.getAllWindows().length === 1 &&
      shouldConfirmTerminalQuit(getTerminalSessionCount())
    ) {
      if (!confirmTerminalQuit(window)) {
        event.preventDefault();
        return;
      }
      terminalQuitConfirmed = true;
    }
  });

  if (isDev) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL!);
    if (openDevToolsInDev) {
      window.webContents.openDevTools({ mode: "detach" });
    }
    return;
  }

  await window.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(async () => {
  const persistedDesktopStateStore = createPersistedDesktopStateStore({ userDataPath: app.getPath("userData") });
  desktopStateStore = persistedDesktopStateStore;

  configureLayoutPersistence(persistedDesktopStateStore);
  configureStagedPlanPersistence(persistedDesktopStateStore);
  configureTerminalPersistence(persistedDesktopStateStore);
  const defaultWorkspaceRootPath = resolveDefaultWorkspaceRootPath(app.getAppPath());
  const workspaceStore = createWorkspaceStore({
    persistedStateStore: persistedDesktopStateStore,
    defaultRootPath: defaultWorkspaceRootPath,
  });
  registerTerminalIpc({
    allowedCwdRoots: () => allowedWorkspaceRoots(workspaceStore),
    isStagedCommandAllowed: isStagedSessionLaunchAllowed,
  });
  registerWorkspaceIpc(workspaceStore);
  await createWindow(persistedDesktopStateStore);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow(persistedDesktopStateStore);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (!terminalQuitConfirmed && shouldConfirmTerminalQuit(getTerminalSessionCount())) {
    if (!confirmTerminalQuit()) {
      event.preventDefault();
      if (BrowserWindow.getAllWindows().length === 0 && desktopStateStore) {
        void createWindow(desktopStateStore);
      }
      return;
    }
    terminalQuitConfirmed = true;
  }

  if (!terminalPersistenceFlushedForQuit) {
    event.preventDefault();
    killAllTerminalSessions();
    void Promise.all([flushTerminalPersistence(), activeWindowStatePersistence?.flush() ?? Promise.resolve()]).finally(() => {
      terminalPersistenceFlushedForQuit = true;
      app.quit();
    });
    return;
  }

  killAllTerminalSessions();
});

function confirmTerminalQuit(parentWindow?: BrowserWindow): boolean {
  const activeSessionCount = getTerminalSessionCount();
  const options: MessageBoxSyncOptions = {
    type: "warning",
    buttons: ["Keep Alfred open", "Quit and stop sessions"],
    cancelId: QUIT_GUARD_CANCEL_BUTTON,
    defaultId: QUIT_GUARD_CANCEL_BUTTON,
    message: "Quit Alfred and stop active terminal sessions?",
    detail:
      activeSessionCount === 1
        ? "One terminal session is still running. Quitting Alfred will stop it."
        : `${activeSessionCount} terminal sessions are still running. Quitting Alfred will stop them.`,
    noLink: true,
  };
  const choice = parentWindow
    ? dialog.showMessageBoxSync(parentWindow, options)
    : dialog.showMessageBoxSync(options);

  return !didCancelTerminalQuit(choice);
}
