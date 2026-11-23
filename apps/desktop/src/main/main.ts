import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  type BrowserWindowConstructorOptions,
  type MessageBoxSyncOptions,
  type WebFrameMain,
} from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { applicationMenuTemplate } from "./app-menu.js";
import { resolveDesktopAppIconPath } from "./app-icon.js";
import {
  configureTerminalPersistence,
  flushTerminalPersistence,
  getTerminalSessionCount,
  killAllTerminalSessions,
  liveAgentClientIds,
  restartBlockers,
  registerTerminalIpc,
  savesTerminalData,
  waitForTerminalExits,
} from "./terminal-manager.js";
import { createAgentEventLog } from "./agent-events.js";
import { createAgentSignalBridge } from "./agent-signals.js";
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
import { blocksPrivateRequest, configureTrustedIpc, isPageFrameEscape, isTrustedDocumentOrigin, isTrustedEntry, trustedEntries } from "./trusted-ipc.js";
import { PREVIEW_DEPLOY_ENV_KEYS, startPreviewDeploy, type PreviewDeploy } from "./preview-deploy.js";
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
// Quit waits for killed PTYs to report exit so node-pty's exit callback never runs during Node teardown.
// ponytail: a process ignoring SIGHUP only delays quit by this bound; add SIGKILL escalation if one shows up.
const QUIT_TERMINAL_EXIT_TIMEOUT_MS = 2_000;
const QUIT_SAVE_PROMPT_DELAY_MS = 5_000;
let terminalQuitConfirmed = false;
let terminalPersistenceFlushedForQuit = false;
let quitFlushInProgress = false;
let desktopStateStore: PersistedDesktopStateStore | null = null;
let activeWindowStatePersistence: WindowStatePersistenceHandle | null = null;
let previewDeploy: PreviewDeploy | null = null;

// Load repo-root .env before any IPC registration so OPENROUTER_API_KEY is visible.
// Repo root is two levels up from app.getAppPath() (apps/desktop) — same logic as
// terminal-manager.ts:defaultTerminalCwd().
// Keys the .env adds are app-only config: terminals must not inherit them. Keys already in the
// launch environment are the user's own and stay (dotenv does not override them).
const launchEnvKeys = new Set(Object.keys(process.env));
const appOnlyEnvKeys: ReadonlySet<string> = new Set(
  Object.keys(loadDotenv({ path: path.resolve(app.getAppPath(), "../..", ".env") }).parsed ?? {})
    .filter((key) => !launchEnvKeys.has(key)),
);

async function createWindow(persistedDesktopStateStore: PersistedDesktopStateStore): Promise<void> {
  const persistedWindowState = (await persistedDesktopStateStore.getState()).windowState;
  const appIconPath = resolveDesktopAppIconPath(app.getAppPath());
  const windowMaterial = windowMaterialConfiguration();
  // After a window reload into a newer release, a window made again (macOS activate) opens that release's renderer.
  const rendererPath = previewDeploy?.rendererFile(path.join(__dirname, "../renderer/index.html"))
    ?? path.join(__dirname, "../renderer/index.html");
  const rendererUrl = isDev
    ? new URL(process.env.VITE_DEV_SERVER_URL!)
    : pathToFileURL(rendererPath);
  if (windowMaterial.enabled) rendererUrl.searchParams.set(WINDOW_MATERIAL_QUERY_KEY, "native");
  const window = new BrowserWindow({
    ...windowOptionsFromState(persistedWindowState),
    minWidth: 1120,
    minHeight: 720,
    title: "Alfred Agent Space",
    ...windowMaterial.windowOptions,
    ...(appIconPath ? { icon: appIconPath } : {}),
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // Centers the window buttons in the rail's 52px top strip, as on the v4 canvas.
    trafficLightPosition: { x: 18, y: 20 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  configureTrustedIpc(window.webContents, rendererUrl.toString());
  const blockForeignNavigation = (details: { url: string; isMainFrame: boolean; frame: WebFrameMain | null; preventDefault(): void }) => {
    if (details.isMainFrame && !isTrustedEntry(details.url)) details.preventDefault();
    const pageFrame = { url: details.url, frameOrigin: details.frame?.origin, parentIsMainFrame: details.frame?.parent === window.webContents.mainFrame };
    if (!details.isMainFrame && isPageFrameEscape(pageFrame)) details.preventDefault();
  };
  window.webContents.on("will-frame-navigate", blockForeignNavigation);
  window.webContents.on("will-redirect", blockForeignNavigation);
  // The page panel runs pages an agent wrote: their WebRTC stays off the LAN, and no frame is granted a permission.
  window.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback, details) => callback(details.isMainFrame));
  const trustedContentsId = window.webContents.id;
  // A frame Electron has already let go of counts as unknown.
  const frameOf = (frame: WebFrameMain | null | undefined): { isMain: boolean; origin: string } | null => {
    try {
      return frame ? { isMain: frame === window.webContents.mainFrame, origin: frame.origin } : null;
    } catch {
      return null;
    }
  };
  window.webContents.session.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    const trusted = details.webContentsId === trustedContentsId;
    // A page's worker can make requests Electron ties to no window; Alfred's main process makes none through Chromium.
    const fromWindowOrUnknown = trusted || details.webContentsId === undefined;
    callback({
      cancel: (trusted && details.resourceType === "subFrame" && trustedEntries().some((entry) => isTrustedDocumentOrigin(details.url, entry)))
        || (fromWindowOrUnknown
          && blocksPrivateRequest({ url: details.url, resourceType: details.resourceType, frame: frameOf(details.frame), trustedEntryUrls: trustedEntries() })),
    });
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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
    await window.loadURL(rendererUrl.toString());
    if (openDevToolsInDev) {
      window.webContents.openDevTools({ mode: "detach" });
    }
    return;
  }

  if (windowMaterial.enabled) {
    await window.loadFile(rendererPath, { query: { [WINDOW_MATERIAL_QUERY_KEY]: "native" } });
    return;
  }
  await window.loadFile(rendererPath);
}

function createWindowInBackground(store: PersistedDesktopStateStore): void {
  void createWindow(store).catch((error: unknown) => {
    console.error("Failed to reopen Alfred desktop.", error);
  });
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
    // ponytail: macOS only; Windows and Linux keep Electron's default menu until that build is checked.
    if (process.platform === "darwin") Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate()));

    const persistedDesktopStateStore = createPersistedDesktopStateStore({
      userDataPath: app.getPath("userData"),
      onWarning: (message, error) => console.warn(message, error),
    });
    desktopStateStore = persistedDesktopStateStore;

    configureLayoutPersistence(persistedDesktopStateStore);
    configureStagedPlanPersistence(persistedDesktopStateStore);
    configureTerminalPersistence(persistedDesktopStateStore);
    const agentEvents = await createAgentEventLog({
      dir: path.join(app.getPath("userData"), "agent-events"),
      isRecording: savesTerminalData,
    }).catch((error: unknown) => {
      console.error("Agent events are not recorded.", error);
      return null;
    });
    // will-quit, not before-quit: agents still flush their last events while their terminals close.
    app.on("will-quit", () => void agentEvents?.close());
    registerDesktopStateIpc(persistedDesktopStateStore, { clearAgentEvents: () => agentEvents?.clear() });
    const defaultWorkspaceRootPath = resolveDefaultWorkspaceRootPath(app.getAppPath());
    // Electron's documents path ignores HOME, which the smoke tests point at a temp folder.
    const scratchRootPath = codexScratchRootPath(path.join(homedir(), "Documents"));
    const workspaceStore = createWorkspaceStore({
      persistedStateStore: persistedDesktopStateStore,
      defaultRootPath: defaultWorkspaceRootPath,
    });
    registerSessionsIpc({ workspaceStore });
    const agentSignals = await createAgentSignalBridge({
      dir: path.join(app.getPath("userData"), "agent-signals"),
      execPath: process.execPath,
    }).catch((error: unknown) => {
      console.error("Agent state signals are unavailable; sessions fall back to output timing.", error);
      return null;
    });
    app.on("will-quit", () => void agentSignals?.close());
    registerTerminalIpc({
      agentEvents,
      agentSignals,
      // Terminals get neither keys loaded from .env nor the release settings: a dev Alfred started in one must not
      // take the running Preview's deploy folder for its own.
      appOnlyEnvKeys: new Set([...appOnlyEnvKeys, ...PREVIEW_DEPLOY_ENV_KEYS]),
      allowedCwdRoots: async () => allowedWorkspaceRoots(workspaceStore, { scratchRootPath }),
      isStagedCommandAllowed: isStagedSessionLaunchAllowed,
      requireLaunchTickets: true,
      scratchRootPath,
    });
    registerWorkspaceIpc(workspaceStore, { scratchRootPath });
    previewDeploy = startPreviewDeploy({
      env: process.env,
      appPath: app.getAppPath(),
      windowMaterialQuery: windowMaterialConfiguration().enabled ? { [WINDOW_MATERIAL_QUERY_KEY]: "native" } : undefined,
      window: () => BrowserWindow.getAllWindows()[0] ?? null,
      quit: () => app.quit(),
      userDataPath: app.getPath("userData"),
      restartBlockers,
      liveAgentClientIds,
    });
    await createWindow(persistedDesktopStateStore);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindowInBackground(persistedDesktopStateStore);
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
    if (!terminalQuitConfirmed && !previewDeploy?.restartSkipsQuitDialog() && shouldConfirmTerminalQuit(getTerminalSessionCount())) {
      if (!confirmTerminalQuit()) {
        event.preventDefault();
        previewDeploy?.cancelRestart();
        if (BrowserWindow.getAllWindows().length === 0 && desktopStateStore) {
          createWindowInBackground(desktopStateStore);
        }
        return;
      }
      terminalQuitConfirmed = true;
    }

    if (!terminalPersistenceFlushedForQuit) {
      event.preventDefault();
      // One flush at a time: a second Quit while saving must not start another.
      if (quitFlushInProgress) return;
      quitFlushInProgress = true;
      killAllTerminalSessions();
      const finishQuit = (): void => {
        if (terminalPersistenceFlushedForQuit) return;
        terminalPersistenceFlushedForQuit = true;
        stopSlowSavePrompt();
        try {
          previewDeploy?.relaunchIfArmed((options) => {
            // The new process would take the keys this one loaded from .env for the user's own and pass them on.
            for (const key of appOnlyEnvKeys) delete process.env[key];
            // The e2e harness starts the next Alfred itself, so it can drive and clean up both.
            if (!process.env.ALFRED_E2E_EXTERNAL_RELAUNCH) app.relaunch(options);
          }, app.getPath("userData"));
        } catch (error) {
          // The sessions are already stopped; quitting without the restart beats staying half closed.
          console.error("Alfred could not restart into the new release.", error);
        }
        app.quit();
      };
      const stopSlowSavePrompt = promptWhenQuitSaveIsSlow(() => terminalPersistenceFlushedForQuit, () => {
        console.warn("Quitting before the desktop state finished saving.");
        finishQuit();
      });
      void Promise.all([
        // Each exit schedules a save of its session, so the last save starts once they are in.
        waitForTerminalExits(QUIT_TERMINAL_EXIT_TIMEOUT_MS).then(() => flushTerminalPersistence()),
        activeWindowStatePersistence?.flush() ?? Promise.resolve(),
      ])
        .then(finishQuit)
        .catch((error: unknown) => {
          console.error("Failed to flush desktop state before quit.", error);
          finishQuit();
        });
      return;
    }

    killAllTerminalSessions();
  });
}

// A timeout is not a cancel: the save keeps running while the user chooses.
function promptWhenQuitSaveIsSlow(isDone: () => boolean, quitAnyway: () => void): () => void {
  const prompt = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const arm = (): void => {
    timer = setTimeout(() => {
      void dialog
        .showMessageBox({
          type: "warning",
          buttons: ["Keep waiting", "Quit anyway"],
          cancelId: 0,
          defaultId: 0,
          message: "Alfred hasn't finished saving",
          detail: "Saving is taking longer than usual. Quitting now may lose your latest changes.",
          noLink: true,
          signal: prompt.signal,
        })
        .then(({ response }) => {
          if (isDone()) return;
          if (response === 1) quitAnyway();
          else arm();
        })
        .catch(() => undefined);
    }, QUIT_SAVE_PROMPT_DELAY_MS);
  };
  arm();
  return () => {
    clearTimeout(timer);
    prompt.abort();
  };
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
