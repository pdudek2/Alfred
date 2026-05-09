import { app, BrowserWindow, dialog, type MessageBoxSyncOptions } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import {
  configureTerminalPersistence,
  getTerminalSessionCount,
  killAllTerminalSessions,
  registerTerminalIpc,
} from "./terminal-manager.js";
import { registerAlfredIpc } from "./alfred-orchestrator.js";
import { registerLayoutIpc } from "./layout-ipc.js";
import { configureLayoutPersistence } from "./layout-store.js";
import { createPersistedDesktopStateStore } from "./persisted-desktop-state.js";
import { configureStagedPlanPersistence } from "./staged-plan-store.js";
import { registerWorkspaceIpc } from "./workspace-ipc.js";
import { createWorkspaceStore } from "./workspace-store.js";
import {
  QUIT_GUARD_CANCEL_BUTTON,
  QUIT_GUARD_CONFIRM_BUTTON,
  didCancelTerminalQuit,
  shouldConfirmTerminalQuit,
} from "./quit-guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
let terminalQuitConfirmed = false;

// Load repo-root .env before any IPC registration so OPENROUTER_API_KEY is visible.
// Repo root is two levels up from app.getAppPath() (apps/desktop) — same logic as
// terminal-manager.ts:defaultTerminalCwd().
loadDotenv({ path: path.resolve(app.getAppPath(), "../..", ".env") });

registerTerminalIpc();
registerAlfredIpc();
registerLayoutIpc();

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
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

  window.once("ready-to-show", () => {
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
    window.webContents.openDevTools({ mode: "detach" });
    return;
  }

  await window.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(async () => {
  const persistedDesktopStateStore = createPersistedDesktopStateStore({ userDataPath: app.getPath("userData") });

  configureLayoutPersistence(persistedDesktopStateStore);
  configureStagedPlanPersistence(persistedDesktopStateStore);
  configureTerminalPersistence(persistedDesktopStateStore);
  registerWorkspaceIpc(createWorkspaceStore({ persistedStateStore: persistedDesktopStateStore }));
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
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
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      }
      return;
    }
    terminalQuitConfirmed = true;
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
