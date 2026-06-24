import { beforeEach, describe, expect, it, vi } from "vitest";

type AppEventHandler = (...args: unknown[]) => unknown;
type BeforeQuitHandler = (event: { preventDefault: () => void }) => void;

const mocks = vi.hoisted(() => {
  const appEventHandlers = new Map<string, AppEventHandler>();
  const app = {
    getAppPath: vi.fn(() => "/Users/patryk/Desktop/Alfred/apps/desktop"),
    getPath: vi.fn(() => "/tmp/alfred-user-data"),
    on: vi.fn(),
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
        loadFile: vi.fn(async () => {}),
        loadURL: vi.fn(async () => {}),
        on: vi.fn(),
        once: vi.fn(),
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
    registerSessionIndexIpc: vi.fn(),
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

vi.mock("./session-index-ipc.js", () => ({
  registerSessionIndexIpc: mocks.registerSessionIndexIpc,
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
