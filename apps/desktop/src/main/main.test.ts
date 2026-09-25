import { beforeEach, describe, expect, it, vi } from "vitest";
import { pathToFileURL } from "node:url";
import type { BrowserWindow as ElectronBrowserWindow } from "electron";

type AppEventHandler = (...args: unknown[]) => unknown;
type BeforeQuitHandler = (event: { preventDefault: () => void }) => void;

const mocks = vi.hoisted(() => {
  const appEventHandlers = new Map<string, AppEventHandler>();
  const app = {
    getAppPath: vi.fn(() => "/Users/patryk/Desktop/Alfred/apps/desktop"),
    getPath: vi.fn(() => "/tmp/alfred-user-data"),
    on: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    exit: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(() => new Promise<void>(() => {})),
  };
  app.on.mockImplementation((eventName: string, handler: AppEventHandler) => {
    appEventHandlers.set(eventName, handler);
    return app;
  });

  return {
    allowedWorkspaceRoots: vi.fn(async () => []),
    app,
    appEventHandlers,
    attachWindowStatePersistence: vi.fn(() => ({ flush: vi.fn(async () => {}) })),
    BrowserWindow: Object.assign(
      vi.fn(function MockBrowserWindow() {
        return {
          focus: vi.fn(),
          isMinimized: vi.fn(() => false),
          loadFile: vi.fn(async () => {}),
          loadURL: vi.fn(async () => {}),
          on: vi.fn(),
          once: vi.fn(),
          restore: vi.fn(),
          show: vi.fn(),
          webContents: {
            id: 1,
            on: vi.fn(),
            once: vi.fn(),
            openDevTools: vi.fn(),
            session: { webRequest: { onBeforeRequest: vi.fn() } },
            setWindowOpenHandler: vi.fn(),
          },
        };
      }),
      { getAllWindows: vi.fn((): ElectronBrowserWindow[] => []) },
    ),
    configureLayoutPersistence: vi.fn(),
    configureStagedPlanPersistence: vi.fn(),
    configureTerminalPersistence: vi.fn(),
    createPersistedDesktopStateStore: vi.fn((_options: { userDataPath?: string; onWarning?: (message: string, error: unknown) => void }) => ({
      getState: vi.fn(async () => ({ windowState: null })),
    })),
    createWorkspaceStore: vi.fn(() => ({
      getWorkspaceState: vi.fn(async () => ({
        activeWorkspaceId: "A",
        workspaces: [{ id: "A", name: "Repo", rootPath: "/repo" }],
      })),
    })),
    didCancelTerminalQuit: vi.fn(() => false),
    dialog: { showMessageBoxSync: vi.fn(() => 0) },
    flushTerminalPersistence: vi.fn(async () => {}),
    getTerminalSessionCount: vi.fn(() => 0),
    isStagedSessionLaunchAllowed: vi.fn(() => true),
    killAllTerminalSessions: vi.fn(),
    loadDotenv: vi.fn(() => ({ parsed: {} })),
    registerAlfredIpc: vi.fn(),
    registerDesktopStateIpc: vi.fn(),
    registerLayoutIpc: vi.fn(),
    registerSessionsIpc: vi.fn(),
    registerTerminalIpc: vi.fn(),
    registerWorkspaceIpc: vi.fn(),
    resolveDefaultWorkspaceRootPath: vi.fn(() => "/Users/patryk/Desktop/Alfred"),
    restoreWindowPresentation: vi.fn(),
    shouldConfirmTerminalQuit: vi.fn(() => false),
    waitForTerminalExits: vi.fn(async () => {}),
    windowOptionsFromState: vi.fn(() => ({})),
  };
});

vi.mock("dotenv", () => ({
  config: mocks.loadDotenv,
}));

vi.mock("electron", () => ({
  app: mocks.app,
  BrowserWindow: mocks.BrowserWindow,
  dialog: mocks.dialog,
}));

vi.mock("./alfred-orchestrator.js", () => ({
  registerAlfredIpc: mocks.registerAlfredIpc,
}));

vi.mock("./desktop-state-ipc.js", () => ({
  registerDesktopStateIpc: mocks.registerDesktopStateIpc,
}));

vi.mock("./default-workspace-root.js", () => ({
  resolveDefaultWorkspaceRootPath: mocks.resolveDefaultWorkspaceRootPath,
}));

vi.mock("./layout-ipc.js", () => ({
  registerLayoutIpc: mocks.registerLayoutIpc,
}));

vi.mock("./layout-store.js", () => ({
  configureLayoutPersistence: mocks.configureLayoutPersistence,
}));

vi.mock("./persisted-desktop-state.js", () => ({
  createPersistedDesktopStateStore: mocks.createPersistedDesktopStateStore,
}));

vi.mock("./quit-guard.js", () => ({
  QUIT_GUARD_CANCEL_BUTTON: 0,
  QUIT_GUARD_CONFIRM_BUTTON: 1,
  didCancelTerminalQuit: mocks.didCancelTerminalQuit,
  shouldConfirmTerminalQuit: mocks.shouldConfirmTerminalQuit,
}));

vi.mock("./sessions-ipc.js", () => ({
  registerSessionsIpc: mocks.registerSessionsIpc,
}));

vi.mock("./staged-plan-store.js", () => ({
  configureStagedPlanPersistence: mocks.configureStagedPlanPersistence,
  isStagedSessionLaunchAllowed: mocks.isStagedSessionLaunchAllowed,
}));

vi.mock("./terminal-manager.js", () => ({
  configureTerminalPersistence: mocks.configureTerminalPersistence,
  flushTerminalPersistence: mocks.flushTerminalPersistence,
  getTerminalSessionCount: mocks.getTerminalSessionCount,
  killAllTerminalSessions: mocks.killAllTerminalSessions,
  registerTerminalIpc: mocks.registerTerminalIpc,
  waitForTerminalExits: mocks.waitForTerminalExits,
}));

vi.mock("./window-state.js", () => ({
  attachWindowStatePersistence: mocks.attachWindowStatePersistence,
  restoreWindowPresentation: mocks.restoreWindowPresentation,
  windowOptionsFromState: mocks.windowOptionsFromState,
}));

vi.mock("./workspace-ipc.js", () => ({
  allowedWorkspaceRoots: mocks.allowedWorkspaceRoots,
  registerWorkspaceIpc: mocks.registerWorkspaceIpc,
}));

vi.mock("./workspace-store.js", () => ({
  createWorkspaceStore: mocks.createWorkspaceStore,
}));

describe("main quit persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.appEventHandlers.clear();
    mocks.didCancelTerminalQuit.mockReturnValue(false);
    mocks.getTerminalSessionCount.mockReturnValue(0);
    mocks.shouldConfirmTerminalQuit.mockReturnValue(false);
    mocks.flushTerminalPersistence.mockResolvedValue(undefined);
  });

  it("logs rejected quit persistence flushes before allowing a controlled quit", async () => {
    const flushFailure = new Error("disk full");
    const terminalFlush = deferredPromise<void>();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.flushTerminalPersistence.mockReturnValueOnce(terminalFlush.promise);

    try {
      await import("./main.js");
      const beforeQuit = mocks.appEventHandlers.get("before-quit") as BeforeQuitHandler | undefined;
      expect(beforeQuit).toBeDefined();

      const event = { preventDefault: vi.fn() };
      beforeQuit?.(event);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(mocks.killAllTerminalSessions).toHaveBeenCalledTimes(1);
      expect(mocks.flushTerminalPersistence).toHaveBeenCalledTimes(1);
      expect(consoleError).not.toHaveBeenCalled();
      expect(mocks.app.quit).not.toHaveBeenCalled();

      terminalFlush.reject(flushFailure);
      await flushMicrotasks();

      expect(consoleError).toHaveBeenCalledWith("Failed to flush desktop state before quit.", flushFailure);
      expect(mocks.app.quit).toHaveBeenCalledTimes(1);
      expect(mocks.app.quit.mock.invocationCallOrder[0]).toBeGreaterThan(consoleError.mock.invocationCallOrder[0]!);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("waits for killed terminals to report exit before letting Electron tear down Node", async () => {
    const terminalExits = deferredPromise<void>();
    mocks.waitForTerminalExits.mockReturnValueOnce(terminalExits.promise);

    await import("./main.js");
    const beforeQuit = mocks.appEventHandlers.get("before-quit") as BeforeQuitHandler | undefined;
    beforeQuit?.({ preventDefault: vi.fn() });
    await flushMicrotasks();

    expect(mocks.killAllTerminalSessions).toHaveBeenCalledTimes(1);
    expect(mocks.waitForTerminalExits).toHaveBeenCalledTimes(1);
    expect(mocks.waitForTerminalExits.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.killAllTerminalSessions.mock.invocationCallOrder[0]!,
    );
    expect(mocks.app.quit).not.toHaveBeenCalled();

    terminalExits.resolve();
    await flushMicrotasks();

    expect(mocks.app.quit).toHaveBeenCalledTimes(1);
  });

  it("logs startup rejection before closing the desktop app", async () => {
    const startupFailure = new Error("startup failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.app.whenReady.mockRejectedValueOnce(startupFailure);

    try {
      await import("./main.js");
      await flushMicrotasks();

      expect(consoleError).toHaveBeenCalledWith("Failed to start Alfred desktop.", startupFailure);
      expect(mocks.app.quit).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("contains rejected background window reopens", async () => {
    const reopenFailure = new Error("desktop state unavailable");
    const getState = vi.fn()
      .mockResolvedValueOnce({ windowState: null })
      .mockRejectedValueOnce(reopenFailure);
    mocks.createPersistedDesktopStateStore.mockReturnValueOnce({ getState });
    mocks.app.whenReady.mockResolvedValueOnce(undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    try {
      await import("./main.js");
      await flushMicrotasks();
      const activate = mocks.appEventHandlers.get("activate");
      expect(activate).toBeDefined();

      activate?.();
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith("Failed to reopen Alfred desktop.", reopenFailure);
      expect(mocks.app.quit).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      consoleError.mockRestore();
    }
  });

  it("contains rejected window reopens after cancelling terminal quit", async () => {
    const reopenFailure = new Error("desktop state unavailable");
    const getState = vi.fn()
      .mockResolvedValueOnce({ windowState: null })
      .mockRejectedValueOnce(reopenFailure);
    mocks.createPersistedDesktopStateStore.mockReturnValueOnce({ getState });
    mocks.app.whenReady.mockResolvedValueOnce(undefined);
    mocks.shouldConfirmTerminalQuit.mockReturnValueOnce(true);
    mocks.didCancelTerminalQuit.mockReturnValueOnce(true);
    mocks.BrowserWindow.getAllWindows.mockReturnValueOnce([]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    try {
      await import("./main.js");
      await flushMicrotasks();
      await new Promise((resolve) => setImmediate(resolve));
      const beforeQuit = mocks.appEventHandlers.get("before-quit") as BeforeQuitHandler | undefined;
      expect(beforeQuit).toBeDefined();

      const event = { preventDefault: vi.fn() };
      beforeQuit?.(event);
      await new Promise((resolve) => setImmediate(resolve));

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith("Failed to reopen Alfred desktop.", reopenFailure);
      expect(mocks.app.quit).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      consoleError.mockRestore();
    }
  });

  it("routes persisted desktop state warnings to the main-process log", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.app.whenReady.mockResolvedValueOnce(undefined);

    try {
      await import("./main.js");
      await flushMicrotasks();

      expect(mocks.createPersistedDesktopStateStore).toHaveBeenCalledWith({
        userDataPath: "/tmp/alfred-user-data",
        onWarning: expect.any(Function),
      });
      const options = mocks.createPersistedDesktopStateStore.mock.calls[0]?.[0] as
        | { onWarning?: (message: string, error: unknown) => void }
        | undefined;
      const warning = new Error("invalid state");
      options?.onWarning?.("Desktop state warning.", warning);

      expect(consoleWarn).toHaveBeenCalledWith("Desktop state warning.", warning);
    } finally {
      consoleWarn.mockRestore();
      consoleError.mockRestore();
    }
  });

  it("keeps the Electron window hidden when the E2E harness requests it", async () => {
    vi.stubEnv("ALFRED_E2E_HIDDEN", "1");
    mocks.app.whenReady.mockResolvedValueOnce(undefined);

    try {
      await import("./main.js");
      await flushMicrotasks();

      const window = mocks.BrowserWindow.mock.results[0]?.value;
      const readyToShow = window?.once.mock.calls.find(([eventName]: [string]) =>
        eventName === "ready-to-show"
      )?.[1] as (() => void) | undefined;
      expect(readyToShow).toBeTypeOf("function");

      readyToShow?.();

      expect(mocks.restoreWindowPresentation).toHaveBeenCalledTimes(1);
      expect(window?.show).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("shows the Electron window outside the hidden E2E harness", async () => {
    mocks.app.whenReady.mockResolvedValueOnce(undefined);

    await import("./main.js");
    await flushMicrotasks();

    const window = mocks.BrowserWindow.mock.results[0]?.value;
    const readyToShow = window?.once.mock.calls.find(([eventName]: [string]) =>
      eventName === "ready-to-show"
    )?.[1] as (() => void) | undefined;
    expect(readyToShow).toBeTypeOf("function");

    readyToShow?.();

    expect(window?.show).toHaveBeenCalledTimes(1);
  });

  it("blocks foreign main-frame navigation and popup windows while allowing Preview subframes", async () => {
    mocks.app.whenReady.mockResolvedValueOnce(undefined);
    await import("./main.js");
    await flushMicrotasks();

    const window = mocks.BrowserWindow.mock.results[0]?.value;
    const navigation = window.webContents.on.mock.calls.find(([name]: [string]) =>
      name === "will-frame-navigate"
    )?.[1] as ((event: { url: string; isMainFrame: boolean; preventDefault: () => void }) => void) | undefined;
    const redirect = window.webContents.on.mock.calls.find(([name]: [string]) =>
      name === "will-redirect"
    )?.[1] as typeof navigation;
    expect(navigation).toBeTypeOf("function");
    expect(redirect).toBeTypeOf("function");

    const foreign = { url: "http://127.0.0.1:9999/takeover", isMainFrame: true, preventDefault: vi.fn() };
    navigation?.(foreign);
    redirect?.(foreign);
    expect(foreign.preventDefault).toHaveBeenCalledTimes(2);

    const preview = { ...foreign, isMainFrame: false, preventDefault: vi.fn() };
    navigation?.(preview);
    redirect?.(preview);
    expect(preview.preventDefault).not.toHaveBeenCalled();

    const ownPageUrl = pathToFileURL(window.loadFile.mock.calls[0]?.[0] as string);
    const loadQuery = window.loadFile.mock.calls[0]?.[1]?.query as Record<string, string> | undefined;
    for (const [key, value] of Object.entries(loadQuery ?? {})) ownPageUrl.searchParams.set(key, value);
    const ownPage = { ...foreign, url: ownPageUrl.toString(), preventDefault: vi.fn() };
    navigation?.(ownPage);
    expect(ownPage.preventDefault).not.toHaveBeenCalled();
    expect(window.webContents.setWindowOpenHandler.mock.calls[0]?.[0]()).toEqual({ action: "deny" });
  });

  it("blocks Preview from loading Alfred's configured dev origin, including another path", async () => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "http://127.0.0.1:4310/");
    mocks.app.whenReady.mockResolvedValueOnce(undefined);
    try {
      await import("./main.js");
      await flushMicrotasks();

      const window = mocks.BrowserWindow.mock.results[0]?.value;
      expect(window.loadURL).toHaveBeenCalledWith(expect.stringMatching(/^http:\/\/127\.0\.0\.1:4310\//));
      const request = window.webContents.session.webRequest.onBeforeRequest.mock.calls[0]?.[1] as
        ((details: { webContentsId: number; resourceType: string; url: string }, callback: (result: { cancel: boolean }) => void) => void);
      const check = (url: string, resourceType = "subFrame", webContentsId = 1) => {
        const callback = vi.fn();
        request({ url, resourceType, webContentsId }, callback);
        return callback.mock.calls[0]?.[0];
      };
      expect(check("http://127.0.0.1:4310/other")).toEqual({ cancel: true });
      expect(check("http://127.0.0.1:4311/")).toEqual({ cancel: false });
      expect(check("http://127.0.0.1:4310/other", "mainFrame")).toEqual({ cancel: false });
      expect(check("http://127.0.0.1:4310/other", "subFrame", 2)).toEqual({ cancel: false });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("wires authoritative workspace-root resolution into terminal IPC", async () => {
    mocks.app.whenReady.mockResolvedValueOnce(undefined);

    await import("./main.js");
    await flushMicrotasks();

    expect(mocks.registerTerminalIpc).toHaveBeenCalledWith(expect.objectContaining({
      resolveWorkspaceRoot: expect.any(Function),
    }));
    const options = mocks.registerTerminalIpc.mock.calls[0]?.[0] as
      | { resolveWorkspaceRoot?: (workspaceId: string) => Promise<string | undefined> }
      | undefined;
    await expect(options?.resolveWorkspaceRoot?.("A")).resolves.toBe("/repo");
    await expect(options?.resolveWorkspaceRoot?.("missing")).resolves.toBeUndefined();
    expect(mocks.registerSessionsIpc).toHaveBeenCalledWith(expect.objectContaining({
      managedWorktreeRootPath: "/tmp/alfred-user-data/worktrees",
    }));
  });

  it("keeps only keys added by the repo .env out of terminal sessions", async () => {
    vi.stubEnv("ALFRED_TEST_LAUNCH_KEY", "user-value");
    mocks.loadDotenv.mockReturnValueOnce({
      parsed: { ALFRED_TEST_APP_KEY: "app-value", ALFRED_TEST_LAUNCH_KEY: "dotenv-value" },
    });
    mocks.app.whenReady.mockResolvedValueOnce(undefined);

    try {
      await import("./main.js");
      await flushMicrotasks();

      expect(mocks.registerTerminalIpc).toHaveBeenCalledWith(expect.objectContaining({
        appOnlyEnvKeys: new Set(["ALFRED_TEST_APP_KEY"]),
      }));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("exits immediately when another Alfred instance owns the desktop profile", async () => {
    mocks.app.requestSingleInstanceLock.mockReturnValueOnce(false);

    await import("./main.js");

    expect(mocks.app.exit).toHaveBeenCalledWith(0);
    expect(mocks.registerAlfredIpc).not.toHaveBeenCalled();
    expect(mocks.registerLayoutIpc).not.toHaveBeenCalled();
    expect(mocks.app.whenReady).not.toHaveBeenCalled();
    expect(mocks.appEventHandlers.size).toBe(0);
    expect(mocks.appEventHandlers.has("second-instance")).toBe(false);
    expect(mocks.appEventHandlers.has("window-all-closed")).toBe(false);
    expect(mocks.appEventHandlers.has("before-quit")).toBe(false);
  });

  it("focuses the existing window on second instance", async () => {
    const existingWindow = {
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      focus: vi.fn(),
    };
    mocks.BrowserWindow.getAllWindows.mockReturnValueOnce([
      existingWindow as unknown as ElectronBrowserWindow,
    ]);

    await import("./main.js");
    const handler = mocks.appEventHandlers.get("second-instance");
    expect(handler).toBeDefined();

    handler?.();

    expect(existingWindow.restore).toHaveBeenCalledTimes(1);
    expect(existingWindow.focus).toHaveBeenCalledTimes(1);
  });

  it("ignores second instance when no window exists yet", async () => {
    mocks.BrowserWindow.getAllWindows.mockReturnValueOnce([]);

    await import("./main.js");
    const handler = mocks.appEventHandlers.get("second-instance");
    expect(handler).toBeDefined();

    expect(() => handler?.()).not.toThrow();
    expect(mocks.BrowserWindow.getAllWindows).toHaveBeenCalledTimes(1);
  });

  it("enables transparent native material in production on macOS only", async () => {
    const main = await import("./main.js");

    expect(main.windowMaterialConfiguration("linux")).toEqual({
      enabled: false,
      windowOptions: { backgroundColor: "#050607" },
    });
    expect(main.windowMaterialConfiguration("darwin")).toEqual({
      enabled: true,
      windowOptions: {
        backgroundColor: "#00000000",
        transparent: true,
        vibrancy: "under-window",
        visualEffectState: "active",
      },
    });
  });
});

function deferredPromise<T>(): {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
