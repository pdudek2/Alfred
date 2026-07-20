import { beforeEach, describe, expect, it, vi } from "vitest";

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
      vi.fn(() => ({
        focus: vi.fn(),
        isMinimized: vi.fn(() => false),
        loadFile: vi.fn(async () => {}),
        loadURL: vi.fn(async () => {}),
        on: vi.fn(),
        once: vi.fn(),
        restore: vi.fn(),
        show: vi.fn(),
        webContents: { openDevTools: vi.fn() },
      })),
      { getAllWindows: vi.fn(() => []) },
    ),
    configureLayoutPersistence: vi.fn(),
    configureStagedPlanPersistence: vi.fn(),
    configureTerminalPersistence: vi.fn(),
    createPersistedDesktopStateStore: vi.fn(() => ({
      getState: vi.fn(async () => ({ windowState: null })),
    })),
    createWorkspaceStore: vi.fn(() => ({})),
    dialog: { showMessageBoxSync: vi.fn(() => 0) },
    flushTerminalPersistence: vi.fn(async () => {}),
    getTerminalSessionCount: vi.fn(() => 0),
    isStagedSessionLaunchAllowed: vi.fn(() => true),
    killAllTerminalSessions: vi.fn(),
    loadDotenv: vi.fn(),
    registerAlfredIpc: vi.fn(),
    registerDesktopStateIpc: vi.fn(),
    registerLayoutIpc: vi.fn(),
    registerSessionsIpc: vi.fn(),
    registerTerminalIpc: vi.fn(),
    registerWorkspaceIpc: vi.fn(),
    resolveDefaultWorkspaceRootPath: vi.fn(() => "/Users/patryk/Desktop/Alfred"),
    restoreWindowPresentation: vi.fn(),
    shouldConfirmTerminalQuit: vi.fn(() => false),
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
  didCancelTerminalQuit: vi.fn(() => false),
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
      expect(mocks.app.quit.mock.invocationCallOrder[0]).toBeGreaterThan(consoleError.mock.invocationCallOrder[0]);
    } finally {
      consoleError.mockRestore();
    }
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
      existingWindow as unknown as InstanceType<typeof mocks.BrowserWindow>,
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
