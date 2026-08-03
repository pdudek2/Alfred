import {
  app,
  BrowserWindow,
  dialog,
  type BrowserWindowConstructorOptions,
  type MessageBoxSyncOptions,
} from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { resolveDesktopAppIconPath } from "./app-icon.js";
import {
  configureTerminalPersistence,
  flushTerminalPersistence,
  getTerminalSessionCount,
  killAllTerminalSessions,
  registerTerminalIpc,
} from "./terminal-manager.js";
import { registerAlfredIpc } from "./alfred-orchestrator.js";
import { registerLayoutIpc } from "./layout-ipc.js";
import { registerSessionsIpc } from "./sessions-ipc.js";
import { codexScratchRootPath } from "./codex-scratch.js";
import { registerDesktopStateIpc } from "./desktop-state-ipc.js";
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
  didCancelTerminalQuit,
  shouldConfirmTerminalQuit,
} from "./quit-guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
const openDevToolsInDev = process.env.ALFRED_DESKTOP_OPEN_DEVTOOLS === "1";
const keepE2eWindowHidden = process.env.ALFRED_E2E_HIDDEN === "1";
const WINDOW_MATERIAL_QUERY_KEY = "alfred-window-material";
let terminalQuitConfirmed = false;
let terminalPersistenceFlushedForQuit = false;
let desktopStateStore: PersistedDesktopStateStore | null = null;
let activeWindowStatePersistence: WindowStatePersistenceHandle | null = null;

// Load repo-root .env before any IPC registration so OPENROUTER_API_KEY is visible.
// Repo root is two levels up from app.getAppPath() (apps/desktop) — same logic as
// terminal-manager.ts:defaultTerminalCwd().
loadDotenv({ path: path.resolve(app.getAppPath(), "../..", ".env") });

async function createWindow(persistedDesktopStateStore: PersistedDesktopStateStore): Promise<void> {
  const persistedWindowState = (await persistedDesktopStateStore.getState()).windowState;
  const appIconPath = resolveDesktopAppIconPath(app.getAppPath());
  const windowMaterial = windowMaterialConfiguration();
  const window = new BrowserWindow({
    ...windowOptionsFromState(persistedWindowState),
    minWidth: 1120,
    minHeight: 720,
    title: "Alfred Agent Space",
    ...windowMaterial.windowOptions,
    ...(appIconPath ? { icon: appIconPath } : {}),
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
    if (!keepE2eWindowHidden) window.show();
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
    const rendererUrl = new URL(process.env.VITE_DEV_SERVER_URL!);
    if (windowMaterial.enabled) {
      rendererUrl.searchParams.set(WINDOW_MATERIAL_QUERY_KEY, "native");
    }
    await window.loadURL(rendererUrl.toString());
    if (openDevToolsInDev) {
      window.webContents.openDevTools({ mode: "detach" });
    }
    return;
  }

  const rendererPath = path.join(__dirname, "../renderer/index.html");
  if (windowMaterial.enabled) {
    await window.loadFile(rendererPath, { query: { [WINDOW_MATERIAL_QUERY_KEY]: "native" } });
    return;
  }
  await window.loadFile(rendererPath);
}

export function windowMaterialConfiguration(
  platform: NodeJS.Platform = process.platform,
): { enabled: boolean; windowOptions: BrowserWindowConstructorOptions } {
  if (platform !== "darwin") {
    return { enabled: false, windowOptions: { backgroundColor: "#050607" } };
  }

  return {
    enabled: true,
    windowOptions: {
      backgroundColor: "#00000000",
      transparent: true,
      vibrancy: "under-window",
      visualEffectState: "active",
    },
  };
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.exit(0);
} else {
  registerAlfredIpc();
  registerLayoutIpc();

  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) {
      return;
    }

    if (window.isMinimized()) {
      window.restore();
    }

    window.focus();
  });

  app.whenReady().then(async () => {
    const appIconPath = resolveDesktopAppIconPath(app.getAppPath());
    if (process.platform === "darwin" && appIconPath) {
      app.dock?.setIcon(appIconPath);
    }

    const persistedDesktopStateStore = createPersistedDesktopStateStore({
      userDataPath: app.getPath("userData"),
      onWarning: (message, error) => console.warn(message, error),
    });
    desktopStateStore = persistedDesktopStateStore;

    configureLayoutPersistence(persistedDesktopStateStore);
    configureStagedPlanPersistence(persistedDesktopStateStore);
    configureTerminalPersistence(persistedDesktopStateStore);
    registerDesktopStateIpc(persistedDesktopStateStore);
    const defaultWorkspaceRootPath = resolveDefaultWorkspaceRootPath(app.getAppPath());
    const managedWorktreeRootPath = path.join(app.getPath("userData"), "worktrees");
    const scratchRootPath = codexScratchRootPath(app.getPath("documents"));
    const workspaceStore = createWorkspaceStore({
      persistedStateStore: persistedDesktopStateStore,
      defaultRootPath: defaultWorkspaceRootPath,
    });
    registerSessionsIpc({
      isExternalSessionIndexingEnabled: async () =>
        (await persistedDesktopStateStore.getState()).privacySettings.externalSessionIndexingEnabled,
      workspaceStore,
    });
    registerTerminalIpc({
      allowedCwdRoots: async () => allowedWorkspaceRoots(workspaceStore, { managedWorktreeRootPath, scratchRootPath }),
      isStagedCommandAllowed: isStagedSessionLaunchAllowed,
      managedWorktreeRootPath,
      resolveWorkspaceRoot: async (workspaceId) => {
        const state = await workspaceStore.getWorkspaceState();
        return state.workspaces.find((workspace) => workspace.id === workspaceId)?.rootPath;
      },
      requireLaunchTickets: true,
      scratchRootPath,
    });
    registerWorkspaceIpc(workspaceStore, { managedWorktreeRootPath, scratchRootPath });
    await createWindow(persistedDesktopStateStore);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow(persistedDesktopStateStore);
      }
    });
  }).catch((error: unknown) => {
    console.error("Failed to start Alfred desktop.", error);
    app.quit();
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
      void Promise.all([flushTerminalPersistence(), activeWindowStatePersistence?.flush() ?? Promise.resolve()])
        .then(() => {
          terminalPersistenceFlushedForQuit = true;
          app.quit();
        })
        .catch((error: unknown) => {
          console.error("Failed to flush desktop state before quit.", error);
          terminalPersistenceFlushedForQuit = true;
          app.quit();
        });
      return;
    }

    killAllTerminalSessions();
  });
}

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
