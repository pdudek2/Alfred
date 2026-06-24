import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app";
import type {
  AlfredApi,
  AlfredPlanResponse,
  AlfredRuntimeStatus,
  AlfredStagedPlanSnapshot,
} from "../shared/alfred-ipc";
import type { LayoutApi, WorkspaceLayoutsSnapshot } from "../shared/layout-ipc";
import type {
  PersistedTerminalSessionSnapshot,
  TerminalApi,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionSnapshot,
} from "../shared/terminal-ipc";
import type { WorkspaceApi, WorkspaceStateSnapshot } from "../shared/workspace-ipc";
import type { ExternalCodexSessionSummary, SessionIndexApi } from "../shared/session-index-ipc";
import type { DesktopPrivacySettings, DesktopSaveStatus, DesktopStateApi } from "../shared/desktop-state-ipc";

const { terminalConstructorOptions, terminalDisposeCalls } = vi.hoisted(() => ({
  terminalConstructorOptions: [] as unknown[],
  terminalDisposeCalls: [] as unknown[],
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    element: HTMLElement | null = null;
    options: unknown;
    dispose = vi.fn(() => {
      terminalDisposeCalls.push(this.options);
    });
    focus = vi.fn(() => {
      this.element?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    loadAddon = vi.fn((addon: { activate?: (terminal: unknown) => void }) => {
      addon.activate?.(this);
    });
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    open = vi.fn((element: HTMLElement) => {
      this.element = element;
    });
    resize = vi.fn((cols: number, rows: number) => {
      this.cols = cols;
      this.rows = rows;
    });
    write = vi.fn();
    writeln = vi.fn();

    constructor(options: unknown) {
      this.options = options;
      terminalConstructorOptions.push(options);
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    terminal: { resize: (cols: number, rows: number) => void } | null = null;
    activate = vi.fn((terminal: { resize: (cols: number, rows: number) => void }) => {
      this.terminal = terminal;
    });
    fit = vi.fn(() => {
      this.terminal?.resize(100, 30);
    });
    proposeDimensions = vi.fn(() => ({ cols: 100, rows: 30 }));
  },
}));

class TestResizeObserver implements ResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

type DesktopBridge = {
  alfred: AlfredApi;
  desktopState?: DesktopStateApi;
  layout: LayoutApi;
  sessionIndex?: SessionIndexApi;
  terminal: TerminalApi;
  workspace: WorkspaceApi;
  version: string;
};

function installDesktopBridge(
  planResponse: AlfredPlanResponse = {
    ok: true,
    plan: {
      name: "Demo plan",
      sessions: [
        { kind: "shell", title: "Task A", command: "echo", args: ["a"] },
        { kind: "dev-server", title: "Task B", command: "pnpm", args: ["dev"] },
      ],
    },
  },
  stagedPlan: AlfredStagedPlanSnapshot | null = null,
  terminalSessions: TerminalSessionSnapshot[] = [],
  runtimeStatus: AlfredRuntimeStatus | null = {
    model: "anthropic/claude-sonnet-4-6",
    openRouterConfigured: true,
  },
  layouts: WorkspaceLayoutsSnapshot = { layoutsByWorkspace: {}, viewStateByWorkspace: {} },
  workspaceState: WorkspaceStateSnapshot = {
    workspaces: [
      { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/patryk/Desktop/Alfred", gitBranch: "main" },
    ],
    activeWorkspaceId: "A",
  },
  restoredTerminalSessions: PersistedTerminalSessionSnapshot[] = [],
  externalCodexSessions: ExternalCodexSessionSummary[] = [],
  desktopPrivacySettings: DesktopPrivacySettings = {
    terminalScrollbackRetention: "redactedTail",
    externalSessionIndexingEnabled: true,
  },
): {
  clearStagedPlan: ReturnType<typeof vi.fn>;
  createTerminal: ReturnType<typeof vi.fn>;
  forgetTerminal: ReturnType<typeof vi.fn>;
  getLayouts: ReturnType<typeof vi.fn>;
  getStagedPlan: ReturnType<typeof vi.fn>;
  getRuntimeStatus: ReturnType<typeof vi.fn>;
  killTerminal: ReturnType<typeof vi.fn>;
  renameTerminal: ReturnType<typeof vi.fn>;
  openExternalTerminal: ReturnType<typeof vi.fn>;
  revealPath: ReturnType<typeof vi.fn>;
  requestPlan: ReturnType<typeof vi.fn>;
  resolveStagedPlan: ReturnType<typeof vi.fn>;
  setWorkspaceLayout: ReturnType<typeof vi.fn>;
  setWorkspaceViewState: ReturnType<typeof vi.fn>;
  getWorkspaceState: ReturnType<typeof vi.fn>;
  bindFolderToWorkspace: ReturnType<typeof vi.fn>;
  createWorkspaceFromFolder: ReturnType<typeof vi.fn>;
  setWorkspaceState: ReturnType<typeof vi.fn>;
  setStagedPlan: ReturnType<typeof vi.fn>;
  prepareLaunch: ReturnType<typeof vi.fn>;
  resizeTerminal: ReturnType<typeof vi.fn>;
  updateStagedSession: ReturnType<typeof vi.fn>;
  writeTerminal: ReturnType<typeof vi.fn>;
  worktreeApply: ReturnType<typeof vi.fn>;
  worktreeDiff: ReturnType<typeof vi.fn>;
  openExternalUrl: ReturnType<typeof vi.fn>;
  listExternalCodexSessions: ReturnType<typeof vi.fn>;
  clearSavedTerminalData: ReturnType<typeof vi.fn>;
  getPrivacySettings: ReturnType<typeof vi.fn>;
  revealStateFile: ReturnType<typeof vi.fn>;
  retrySave: ReturnType<typeof vi.fn>;
  updatePrivacySettings: ReturnType<typeof vi.fn>;
  emitData: (event: TerminalDataEvent) => void;
  emitExit: (event: TerminalExitEvent) => void;
  emitSaveStatus: (status: DesktopSaveStatus) => void;
} {
  const dataListeners = new Set<(event: TerminalDataEvent) => void>();
  const exitListeners = new Set<(event: TerminalExitEvent) => void>();
  const saveStatusListeners = new Set<(status: DesktopSaveStatus) => void>();
  const clearStagedPlan = vi.fn().mockResolvedValue({ plan: null });
  const getStagedPlan = vi.fn().mockResolvedValue({ plan: stagedPlan });
  const getRuntimeStatus = vi.fn().mockResolvedValue(runtimeStatus);
  const requestPlan = vi.fn().mockResolvedValue(planResponse);
  const resolveStagedPlan = vi.fn().mockResolvedValue({ plan: null });
  const setStagedPlan = vi.fn().mockImplementation((request) => Promise.resolve({ plan: request }));
  const updateStagedSession = vi.fn().mockImplementation((request) =>
    Promise.resolve({ ok: false, error: { code: "not_found", message: `No staged session ${request.sessionId}` } }),
  );
  const getLayouts = vi.fn().mockResolvedValue(layouts);
  const setWorkspaceLayout = vi.fn().mockResolvedValue(layouts);
  const setWorkspaceViewState = vi.fn().mockResolvedValue(layouts);
  const getWorkspaceState = vi.fn().mockResolvedValue(workspaceState);
  const setWorkspaceState = vi.fn().mockImplementation((request) => Promise.resolve(request));
  const bindFolderToWorkspace = vi.fn().mockImplementation((request: { workspaceId: string }) =>
    Promise.resolve({
      workspaces: workspaceState.workspaces.map((workspace) =>
        workspace.id === request.workspaceId
          ? { ...workspace, rootPath: workspace.rootPath ?? "/Users/patryk/TrustedWorkspace" }
          : workspace,
      ),
      activeWorkspaceId: request.workspaceId,
    }),
  );
  const openExternalTerminal = vi.fn().mockResolvedValue({ ok: true, resolvedPath: "/Users/patryk/Desktop/Alfred", terminal: "Ghostty" });
  const openExternalUrl = vi
    .fn()
    .mockImplementation((request: Parameters<WorkspaceApi["openExternalUrl"]>[0]) =>
      Promise.resolve({ ok: true, url: request.url }),
    );
  const listExternalCodexSessions = vi.fn().mockResolvedValue({ sessions: externalCodexSessions });
  let currentPrivacySettings = desktopPrivacySettings;
  const getPrivacySettings = vi.fn().mockImplementation(() => Promise.resolve(currentPrivacySettings));
  const updatePrivacySettings = vi.fn().mockImplementation((settings: DesktopPrivacySettings) => {
    currentPrivacySettings = settings;
    return Promise.resolve(settings);
  });
  const clearSavedTerminalData = vi.fn().mockResolvedValue({
    ok: true,
    clearedSessions: terminalSessions.length + restoredTerminalSessions.length,
  });
  const revealStateFile = vi.fn().mockResolvedValue({ ok: true, resolvedPath: "/Users/patryk/Library/Application Support/Alfred/desktop-state.json" });
  const retrySave = vi.fn().mockResolvedValue({ status: "saved" });
  const onSaveStatus = vi.fn((callback: (status: DesktopSaveStatus) => void) => {
    saveStatusListeners.add(callback);
    return () => saveStatusListeners.delete(callback);
  });
  const revealPath = vi.fn().mockResolvedValue({ ok: true, resolvedPath: "/Users/patryk/Desktop/Alfred/app.tsx" });
  const createWorkspaceFromFolder = vi.fn().mockImplementation(() =>
    Promise.resolve({
      workspaces: [
        ...workspaceState.workspaces,
        { id: "CLIENTAPP", label: "ClientApp", shortLabel: "CLI", rootPath: "/Users/patryk/Desktop/ClientApp" },
      ],
      activeWorkspaceId: "CLIENTAPP",
    }),
  );
  const killTerminal = vi.fn();
  const forgetTerminal = vi.fn();
  const renameTerminal = vi.fn().mockResolvedValue(undefined);
  const prepareLaunch = vi.fn().mockResolvedValue({ launchTicketId: "ticket-1", expiresAt: Date.now() + 120_000 });
  const writeTerminal = vi.fn();
  const worktreeApply = vi.fn().mockResolvedValue({ ok: true, appliedFiles: 2 });
  const worktreeDiff = vi.fn().mockResolvedValue({
    ok: true,
    summary: "2 changed files",
    files: [
      { path: "src/app.tsx", status: "M" },
      { path: "notes/review.md", status: "??" },
    ],
  });
  const createTerminal = vi.fn().mockImplementation((request: Parameters<TerminalApi["create"]>[0]) => {
    const baseCwd = request.cwd ?? "/tmp";
    const branchName =
      request.isolation === "worktree"
        ? request.branchName ?? `alfred-${request.agentKind ?? "agent"}-${request.clientId ?? "session"}`
        : undefined;
    const cwd = branchName ? `${baseCwd}/.alfred-worktrees/${branchName}` : baseCwd;

    return Promise.resolve({
      id: "runtime-1",
      clientId: request.clientId ?? "manual-1",
      title: request.title ?? "Manual · zsh 1",
      source: request.source ?? "manual",
      workspaceId: request.workspaceId ?? "A",
      cwd,
      shell: "bash",
      ...(request.agentKind === undefined ? {} : { agentKind: request.agentKind }),
      ...(request.isolation === undefined ? {} : { isolation: request.isolation }),
      ...(branchName === undefined ? {} : { branchName, baseCwd }),
      ...(request.command === undefined ? {} : { command: request.command }),
      ...(request.args === undefined ? {} : { args: request.args }),
    });
  });
  const resizeTerminal = vi.fn();
  const terminal: TerminalApi = {
    create: createTerminal,
    forget: forgetTerminal,
    kill: killTerminal,
    list: vi.fn().mockResolvedValue({ sessions: terminalSessions, restoredSessions: restoredTerminalSessions }),
    prepareLaunch,
    rename: renameTerminal,
    onData: vi.fn((callback: (event: TerminalDataEvent) => void) => {
      dataListeners.add(callback);
      return () => dataListeners.delete(callback);
    }),
    onExit: vi.fn((callback: (event: TerminalExitEvent) => void) => {
      exitListeners.add(callback);
      return () => exitListeners.delete(callback);
    }),
    resize: resizeTerminal,
    write: writeTerminal,
    worktreeApply,
    worktreeDiff,
  };
  const bridge: DesktopBridge = {
    alfred: {
      clearStagedPlan,
      getRuntimeStatus,
      getStagedPlan,
      requestPlan,
      resolveStagedPlan,
      setStagedPlan,
      updateStagedSession,
    },
    desktopState: {
      clearSavedTerminalData,
      getPrivacySettings,
      onSaveStatus,
      retrySave,
      revealStateFile,
      updatePrivacySettings,
    },
    layout: { getLayouts, setWorkspaceLayout, setWorkspaceViewState },
    sessionIndex: { listExternalCodexSessions },
    terminal,
    workspace: {
      bindFolderToWorkspace,
      createWorkspaceFromFolder,
      getWorkspaceState,
      openExternalTerminal,
      openExternalUrl,
      revealPath,
      setWorkspaceState,
    },
    version: "test",
  };

  window.alfredDesktop = bridge;
  return {
    clearStagedPlan,
    createTerminal,
    forgetTerminal,
    getLayouts,
    getRuntimeStatus,
    getStagedPlan,
    killTerminal,
    renameTerminal,
    openExternalTerminal,
    revealPath,
    requestPlan,
    resolveStagedPlan,
    setStagedPlan,
    prepareLaunch,
    resizeTerminal,
    updateStagedSession,
    bindFolderToWorkspace,
    createWorkspaceFromFolder,
    getWorkspaceState,
    setWorkspaceState,
    setWorkspaceLayout,
    setWorkspaceViewState,
    writeTerminal,
    worktreeApply,
    worktreeDiff,
    openExternalUrl,
    listExternalCodexSessions,
    clearSavedTerminalData,
    getPrivacySettings,
    revealStateFile,
    retrySave,
    updatePrivacySettings,
    emitData: (event: TerminalDataEvent) => {
      for (const listener of dataListeners) listener(event);
    },
    emitExit: (event: TerminalExitEvent) => {
      for (const listener of exitListeners) listener(event);
    },
    emitSaveStatus: (status: DesktopSaveStatus) => {
      for (const listener of saveStatusListeners) listener(status);
    },
  };
}

beforeEach(() => {
  terminalConstructorOptions.length = 0;
  terminalDisposeCalls.length = 0;
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.alfredDesktop;
});

describe("App integration", () => {
  it("keeps Alfred shell hierarchy focused on workspace, decisions, and launch actions", async () => {
    installDesktopBridge(undefined, null, [], undefined, undefined, {
      workspaces: [
        {
          id: "A",
          label: "Alfred",
          shortLabel: "A",
          rootPath: "/Users/patryk/Desktop/Alfred",
          gitBranch: "main",
        },
      ],
      activeWorkspaceId: "A",
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Workspace menu for Alfred" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "workspaces" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open command palette" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New terminal" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /terminals/i })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: /alfred status/i })).toBeInTheDocument();
  });

  it("keeps the current shell landmarks and command palette reachable", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("region", { name: /terminals/i })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: /alfred status/i })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: /alfred composer/i })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open command palette" }));

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  });

  it("opens Local Data & Privacy controls from the command palette", async () => {
    const user = userEvent.setup();
    const { clearSavedTerminalData, revealStateFile, updatePrivacySettings } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.click(screen.getByRole("option", { name: /Local Data & Privacy/i }));

    const dialog = screen.getByRole("dialog", { name: "Local Data & Privacy" });
    expect(dialog).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Off" }));
    await waitFor(() => {
      expect(updatePrivacySettings).toHaveBeenCalledWith({
        terminalScrollbackRetention: "off",
        externalSessionIndexingEnabled: true,
      });
    });

    await user.click(within(dialog).getByRole("checkbox", { name: /On/i }));
    await waitFor(() => {
      expect(updatePrivacySettings).toHaveBeenCalledWith({
        terminalScrollbackRetention: "off",
        externalSessionIndexingEnabled: false,
      });
    });

    await user.click(within(dialog).getByRole("button", { name: "Clear saved transcripts" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirm clear" }));
    await waitFor(() => {
      expect(clearSavedTerminalData).toHaveBeenCalledTimes(1);
    });

    await user.click(within(dialog).getByRole("button", { name: "Reveal local state file" }));
    expect(revealStateFile).toHaveBeenCalledTimes(1);
  });

  it("does not refresh external Codex sessions when indexing is disabled", async () => {
    const user = userEvent.setup();
    const { listExternalCodexSessions } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [],
      [
        {
          id: "019edc4b-0000-7000-9000-disabled",
          title: "Hidden external session",
          cwd: "/Users/patryk/Desktop/Alfred",
          createdAt: 100,
          updatedAt: 200,
          transcriptPath: "/Users/patryk/.codex/sessions/hidden.jsonl",
        },
      ],
      {
        terminalScrollbackRetention: "redactedTail",
        externalSessionIndexingEnabled: false,
      },
    );

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Observatory surface" }));

    expect(await screen.findByText("External Codex indexing is off.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Disabled/i })).toBeDisabled();
    expect(listExternalCodexSessions).not.toHaveBeenCalled();
  });

  it("shows a state-not-saved warning and retries the failed save", async () => {
    const user = userEvent.setup();
    const bridge = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    act(() => {
      bridge.emitSaveStatus({ status: "saveFailed", message: "Failed to persist desktop state.", failedAt: 123 });
    });

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("State not saved")).toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(bridge.retrySave).toHaveBeenCalledTimes(1);
  });

  it("keeps command palette input isolated from the composer and global hotkeys", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledTimes(1);
    });
    await screen.findByRole("tab", { name: "Alfred workspace, 1 idle" });

    const trigger = screen.getByRole("button", { name: "Open command palette" });
    await user.click(trigger);

    const palette = screen.getByRole("dialog", { name: "Command palette" });
    const search = within(palette).getByRole("textbox", { name: "Search commands" });
    const composer = screen.getByRole("textbox", { name: "Alfred prompt" });
    expect(search).toHaveFocus();
    expect(composer).toBeDisabled();

    await user.keyboard("review");

    expect(search).toHaveValue("review");
    expect(composer).toHaveValue("");

    await user.keyboard("{Control>}t{/Control}");
    await user.keyboard("{Meta>}t{/Meta}");

    expect(createTerminal).toHaveBeenCalledTimes(1);

    await user.tab();
    await user.tab({ shift: true });
    expect(palette).toContainElement(document.activeElement as HTMLElement | null);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(composer).not.toBeDisabled();
  });

  it("keeps the xterm renderer mounted while moving from Desk to Observatory and back", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledTimes(1);
    });
    await act(async () => {});
    const constructorCountBeforeSurfaceSwitch = terminalConstructorOptions.length;
    const disposeCountBeforeSurfaceSwitch = terminalDisposeCalls.length;

    await user.click(screen.getByRole("button", { name: "Open Observatory surface" }));

    expect(await screen.findByRole("region", { name: "Observatory workspace" })).toBeInTheDocument();
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeSurfaceSwitch);

    await user.click(screen.getByRole("button", { name: "Open Desk surface" }));

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    expect(terminalConstructorOptions).toHaveLength(constructorCountBeforeSurfaceSwitch);
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeSurfaceSwitch);
  });

  it("does not resize the backend while the xterm host has no measurable layout", async () => {
    const { createTerminal, resizeTerminal } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledTimes(1);
    });
    await act(async () => {});

    expect(resizeTerminal).not.toHaveBeenCalled();
  });

  it("resizes the backend once xterm fit has stable host geometry", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(
      this: HTMLElement,
    ) {
      if (this.classList.contains("xterm-host")) {
        return {
          bottom: 360,
          height: 360,
          left: 0,
          right: 640,
          top: 0,
          width: 640,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
    const { createTerminal, resizeTerminal } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(resizeTerminal).toHaveBeenCalledWith({ id: "runtime-1", cols: 100, rows: 30 });
    });
    expect(resizeTerminal).toHaveBeenCalledTimes(1);
  });

  it("resumes an external Codex Observatory row with the selected session id", async () => {
    const user = userEvent.setup();
    const externalSessionId = "019edc4b-0000-7000-9000-observatory";
    const { createTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [],
      [
        {
          id: externalSessionId,
          title: "Load Alfred memory",
          cwd: "/Users/patryk/Desktop/Alfred",
          createdAt: 100,
          updatedAt: 200,
          transcriptPath: "/Users/patryk/.codex/sessions/session.jsonl",
          model: "gpt-5",
          originator: "codex",
        },
      ],
    );

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open Observatory surface" }));
    await user.click(await screen.findByRole("button", { name: /Load Alfred memory/i }));
    await user.click(screen.getByRole("button", { name: "Resume in Alfred" }));

    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          agentKind: "codex",
          command: "codex",
          args: ["resume", externalSessionId],
          cwd: "/Users/patryk/Desktop/Alfred",
          workspaceId: "A",
        }),
      );
    });
  });

  it("opens a bind/trust workspace dialog for an unknown external Codex cwd", async () => {
    const user = userEvent.setup();
    const externalSessionId = "019edc4b-0000-7000-9000-untrusted";
    const { bindFolderToWorkspace, createTerminal, setWorkspaceState } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [],
      [
        {
          id: externalSessionId,
          title: "Unknown external workspace",
          cwd: "/Users/patryk/Downloads/UnknownProject",
          createdAt: 100,
          updatedAt: 200,
          transcriptPath: "/Users/patryk/.codex/sessions/unknown.jsonl",
        },
      ],
    );

    render(<App />);

    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledTimes(1);
    });
    setWorkspaceState.mockClear();

    await user.click(await screen.findByRole("button", { name: "Open Observatory surface" }));
    await user.click(await screen.findByRole("button", { name: /Unknown external workspace/i }));

    const resume = screen.getByRole("button", { name: "Trust workspace first" });
    expect(resume).toBeEnabled();

    await user.click(resume);
    expect(createTerminal).toHaveBeenCalledTimes(1);
    expect(bindFolderToWorkspace).toHaveBeenCalledWith({ workspaceId: "A" });
    expect(setWorkspaceState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        workspaces: expect.arrayContaining([
          expect.objectContaining({ rootPath: "/Users/patryk/Downloads/UnknownProject" }),
        ]),
      }),
    );
    expect(screen.queryByRole("tab", { name: /UnknownProject workspace/i })).not.toBeInTheDocument();
  });

  it("keeps stale external Codex rows when Observatory refresh fails", async () => {
    const user = userEvent.setup();
    const externalSession: ExternalCodexSessionSummary = {
      id: "019edc4b-0000-7000-9000-stale",
      title: "Previously indexed Codex",
      cwd: "/Users/patryk/Desktop/Alfred",
      createdAt: 100,
      updatedAt: 200,
      transcriptPath: "/Users/patryk/.codex/sessions/stale.jsonl",
    };
    const { listExternalCodexSessions } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [],
      [externalSession],
    );

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open Observatory surface" }));
    expect(await screen.findByRole("button", { name: /Previously indexed Codex/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(listExternalCodexSessions).toHaveBeenCalledTimes(1);
    });

    listExternalCodexSessions.mockRejectedValueOnce(new Error("index unavailable"));
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("Showing last successful results.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Previously indexed Codex/i })).toBeInTheDocument();
  });

  it("keeps only one global modal open at a time", async () => {
    const user = userEvent.setup();
    installDesktopBridge(undefined, null, [], undefined, undefined, undefined, [
      {
        clientId: "manual-9",
        title: "Manual · zsh 9",
        cwd: "/repo",
        source: "manual",
        shell: "/bin/zsh",
        buffer: "saved output\n",
      },
    ]);

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open review queue, 1 item" }));
    expect(screen.getByRole("dialog", { name: "Review queue" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", code: "KeyK", metaKey: true });

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Review queue" })).not.toBeInTheDocument();
  });

  it("switches from session observatory to command palette with the global shortcut", async () => {
    const user = userEvent.setup();
    installDesktopBridge(undefined, null, [], undefined, undefined, undefined, [
      {
        clientId: "manual-9",
        title: "Manual · zsh 9",
        cwd: "/repo",
        source: "manual",
        shell: "/bin/zsh",
        buffer: "saved output\n",
      },
    ]);

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open session observatory, 1 session" }));
    expect(screen.getByRole("dialog", { name: "Session observatory" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", code: "KeyK", metaKey: true });

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Session observatory" })).not.toBeInTheDocument();
  });

  it("surfaces detected localhost URLs in the workspace preview dock", async () => {
    const user = userEvent.setup();
    const { openExternalUrl } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-dev",
        clientId: "manual-dev",
        title: "Manual · dev server",
        source: "manual",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "/bin/zsh",
        buffer: "Vite ready at http://localhost:5173/\nExternal: http://example.com\n",
      },
    ]);

    render(<App />);

    const preview = await screen.findByLabelText("Workspace preview");
    expect(within(preview).getAllByText("localhost:5173")).toHaveLength(2);
    expect(within(preview).queryByText("example.com")).not.toBeInTheDocument();
    expect(within(preview).getByTitle("Preview of http://localhost:5173/")).toBeInTheDocument();

    await user.click(within(preview).getByRole("button", { name: "Open preview externally" }));

    expect(openExternalUrl).toHaveBeenCalledWith({ url: "http://localhost:5173/" });

    await user.click(screen.getByRole("button", { name: "Close Manual · dev server" }));

    expect(screen.queryByLabelText("Workspace preview")).not.toBeInTheDocument();
  });

  it("adds preview URLs from live terminal output", async () => {
    const { emitData } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-dev",
        clientId: "manual-dev",
        title: "Manual · dev server",
        source: "manual",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "/bin/zsh",
        buffer: "",
      },
    ]);

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · dev server/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(window.alfredDesktop?.terminal.onData as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    });
    emitData({ id: "runtime-dev", data: "ready on http://127.0.0.1:3000/app\n" });

    const preview = await screen.findByLabelText("Workspace preview");
    expect(within(preview).getAllByText("127.0.0.1:3000")).toHaveLength(2);
    expect(within(preview).getByTitle("Preview of http://127.0.0.1:3000/app")).toBeInTheDocument();
  });

  it("starts sessions in a scratch workspace before a folder is bound", async () => {
    const user = userEvent.setup();
    const { createTerminal, createWorkspaceFromFolder, requestPlan } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      {
        workspaces: [{ id: "A", label: "Alfred", shortLabel: "A" }],
        activeWorkspaceId: "A",
      },
    );

    render(<App />);

    const emptyState = await screen.findByRole("status", { name: "Empty workspace" });
    expect(emptyState).toHaveTextContent("Scratch workspace ready");
    expect(emptyState).toHaveTextContent("Start in the scratch desk");
    expect(screen.queryByRole("article", { name: /Manual · zsh/i })).not.toBeInTheDocument();
    const primaryAction = within(emptyState).getByRole("button", { name: "New terminal" });
    expect(screen.getAllByRole("button", { name: "Start Codex" }).every((button) => !button.hasAttribute("disabled"))).toBe(true);
    const secondaryActions = within(emptyState).getByRole("group", { name: "secondary empty workspace actions" });
    expect(secondaryActions).not.toBeNull();
    expect(within(secondaryActions).getByRole("button", { name: "Start Codex" })).toBeInTheDocument();
    expect(within(secondaryActions).getByRole("button", { name: "Start Claude" })).toBeInTheDocument();
    expect(within(secondaryActions).getByRole("button", { name: "Bind folder" })).toBeInTheDocument();

    await user.click(primaryAction);
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({ source: "manual", workspaceId: "A" }));
    });
    expect(createTerminal.mock.calls[0]?.[0]).not.toHaveProperty("cwd");

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "manual terminal");
    const palette = screen.getByRole("dialog", { name: "Command palette" });
    expect(within(palette).getByText("New manual terminal")).toBeInTheDocument();
    expect(within(palette).getByText(/(?:Cmd|Ctrl) T · start a shell in the scratch desk/)).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(createTerminal).toHaveBeenCalledTimes(2));
    await user.keyboard("{Escape}");

    await user.type(screen.getByRole("textbox", { name: "Alfred prompt" }), "prepare codex");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));
    await waitFor(() => expect(requestPlan).toHaveBeenCalledOnce());
    expect(requestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "prepare codex",
        workspace: expect.not.objectContaining({ rootPath: expect.any(String) }),
      }),
    );

    expect(createWorkspaceFromFolder).not.toHaveBeenCalled();
  });

  it("keeps browser fallback terminal status consistent across tile and workspace", async () => {
    const user = userEvent.setup();

    render(<App />);

    const emptyState = await screen.findByRole("status", { name: "Empty workspace" });
    await user.click(within(emptyState).getByRole("button", { name: "New terminal" }));

    const tile = await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await waitFor(() => {
      expect(within(tile).getByText("unavailable")).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Alfred workspace, 1 unavailable" })).toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: "Alfred workspace, 1 starting" })).not.toBeInTheDocument();
    });
  });

  it("creates scratch workspaces and scopes terminals to the active workspace", async () => {
    const user = userEvent.setup();
    const { createTerminal, createWorkspaceFromFolder, setWorkspaceState } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("tab", { name: "Alfred workspace, 1 idle" })).toBeInTheDocument();
    expect(screen.getByText("Alfred workspace")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add workspace" }));

    expect(createWorkspaceFromFolder).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Workspace 2 workspace, empty" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Workspace 2 workspace")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Empty workspace" })).toHaveTextContent("Scratch workspace ready");
    expect(screen.queryByRole("article", { name: /Manual · zsh 1/i })).not.toBeInTheDocument();

    await user.click(within(screen.getByRole("status", { name: "Empty workspace" })).getByRole("button", { name: "New terminal" }));
    expect(screen.getByRole("article", { name: /Manual · zsh 2/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenLastCalledWith(
        expect.objectContaining({ workspaceId: "W2" }),
      );
    });

    await user.click(screen.getByRole("tab", { name: "Alfred workspace, 1 idle" }));

    expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /Manual · zsh 2/i })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(setWorkspaceState).toHaveBeenLastCalledWith({
        workspaces: [
          { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/patryk/Desktop/Alfred", gitBranch: "main" },
          { id: "W2", label: "Workspace 2", shortLabel: "W2" },
        ],
        activeWorkspaceId: "A",
      });
    });
  });

  it("keeps workspace actions in a compact title menu", async () => {
    const user = userEvent.setup();
    const { openExternalTerminal, revealPath, setWorkspaceState } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      {
        workspaces: [
          {
            id: "A",
            label: "Alfred",
            shortLabel: "A",
            rootPath: "/Users/patryk/Desktop/Alfred",
            gitBranch: "main",
          },
        ],
        activeWorkspaceId: "A",
      },
    );

    render(<App />);

    await screen.findByRole("article", { name: /Manual · zsh 1/i });
    const trigger = screen.getByRole("button", { name: "Workspace menu for Alfred" });

    await user.click(trigger);
    await user.click(within(screen.getByRole("dialog", { name: "Workspace actions" })).getByRole("button", { name: /Open in/ }));

    expect(openExternalTerminal).toHaveBeenCalledWith({ cwd: "/Users/patryk/Desktop/Alfred" });
    expect(screen.queryByRole("dialog", { name: "Workspace actions" })).not.toBeInTheDocument();

    await user.click(trigger);
    await user.click(
      within(screen.getByRole("dialog", { name: "Workspace actions" })).getByRole("button", { name: /Reveal/ }),
    );

    expect(revealPath).toHaveBeenCalledWith({ cwd: "/Users/patryk/Desktop/Alfred", path: "." });

    await user.click(trigger);
    await user.click(
      within(screen.getByRole("dialog", { name: "Workspace actions" })).getByRole("button", {
        name: /Rename workspace/i,
      }),
    );
    expect(screen.queryByRole("dialog", { name: "Workspace actions" })).not.toBeInTheDocument();
    const renameDialog = screen.getByRole("dialog", { name: "Rename workspace" });
    expect(renameDialog).toBeInTheDocument();
    await user.clear(within(renameDialog).getByRole("textbox", { name: "Workspace name" }));
    expect(within(renameDialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(within(renameDialog).getByRole("textbox", { name: "Workspace name" }), "Ops Console{Enter}");

    expect(screen.getByRole("button", { name: "Workspace menu for Ops Console" })).toBeInTheDocument();
    await waitFor(() => {
      expect(setWorkspaceState).toHaveBeenLastCalledWith({
        workspaces: [
          {
            id: "A",
            label: "Ops Console",
            shortLabel: "OC",
            rootPath: "/Users/patryk/Desktop/Alfred",
            gitBranch: "main",
          },
        ],
        activeWorkspaceId: "A",
      });
    });
  });

  it("saves a workspace mission brief and sends it with the next Alfred prompt", async () => {
    const user = userEvent.setup();
    const { requestPlan, setWorkspaceState } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      {
        workspaces: [
          {
            id: "A",
            label: "Alfred",
            shortLabel: "A",
            rootPath: "/Users/patryk/Desktop/Alfred",
            gitBranch: "main",
          },
        ],
        activeWorkspaceId: "A",
      },
    );

    render(<App />);

    await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await user.click(screen.getByRole("button", { name: "Workspace menu for Alfred" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Workspace actions" })).getByRole("button", {
        name: /Add mission brief/i,
      }),
    );

    const missionDialog = screen.getByRole("dialog", { name: "Workspace mission brief" });
    await user.type(within(missionDialog).getByRole("textbox", { name: "Mission goal" }), "Ship launcher v0 calmly");
    await user.type(within(missionDialog).getByRole("textbox", { name: "Done when" }), "Agents are staged{Enter}Manual terminals keep focus");
    await user.type(within(missionDialog).getByRole("textbox", { name: "Guardrails" }), "No force push");
    await user.click(within(missionDialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(setWorkspaceState).toHaveBeenLastCalledWith({
        workspaces: [
          {
            id: "A",
            label: "Alfred",
            shortLabel: "A",
            rootPath: "/Users/patryk/Desktop/Alfred",
            gitBranch: "main",
            missionBrief: {
              goal: "Ship launcher v0 calmly",
              doneWhen: ["Agents are staged", "Manual terminals keep focus"],
              guardrails: ["No force push"],
            },
          },
        ],
        activeWorkspaceId: "A",
      });
    });

    expect(screen.getByRole("region", { name: "Workspace mission brief" })).toHaveTextContent("Ship launcher v0 calmly");

    await user.type(screen.getByLabelText("Alfred prompt"), "prepare the next slice");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));

    expect(requestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "prepare the next slice",
        workspace: expect.objectContaining({
          missionBrief: {
            goal: "Ship launcher v0 calmly",
            doneWhen: ["Agents are staged", "Manual terminals keep focus"],
            guardrails: ["No force push"],
          },
        }),
      }),
    );
  });

  it("clears a workspace mission brief and omits it from later Alfred prompts", async () => {
    const user = userEvent.setup();
    const { requestPlan, setWorkspaceState } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      {
        workspaces: [
          {
            id: "A",
            label: "Alfred",
            shortLabel: "A",
            rootPath: "/Users/patryk/Desktop/Alfred",
            missionBrief: {
              goal: "Ship the launcher.",
              doneWhen: ["Agents staged"],
              guardrails: ["No force push"],
            },
          },
        ],
        activeWorkspaceId: "A",
      },
    );

    render(<App />);

    expect(await screen.findByRole("region", { name: "Workspace mission brief" })).toHaveTextContent("Ship the launcher.");
    await user.click(screen.getByRole("button", { name: "Workspace menu for Alfred" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Workspace actions" })).getByRole("button", {
        name: /Edit mission brief/i,
      }),
    );
    await user.click(within(screen.getByRole("dialog", { name: "Workspace mission brief" })).getByRole("button", { name: "Clear" }));

    await waitFor(() => {
      expect(setWorkspaceState).toHaveBeenLastCalledWith({
        workspaces: [
          {
            id: "A",
            label: "Alfred",
            shortLabel: "A",
            rootPath: "/Users/patryk/Desktop/Alfred",
          },
        ],
        activeWorkspaceId: "A",
      });
    });
    expect(screen.queryByRole("region", { name: "Workspace mission brief" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Alfred prompt"), "prepare cleanly");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));

    const lastRequest = requestPlan.mock.calls.at(-1)?.[0];
    expect(lastRequest?.workspace).not.toHaveProperty("missionBrief");
  });

  it("closes an empty non-default workspace from the command palette", async () => {
    const user = userEvent.setup();
    const { createWorkspaceFromFolder, setWorkspaceState } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add workspace" }));

    expect(createWorkspaceFromFolder).not.toHaveBeenCalled();
    expect(await screen.findByText("Workspace 2 workspace")).toBeInTheDocument();
    expect(await screen.findByRole("status", { name: "Empty workspace" })).toHaveTextContent("Workspace 2");

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "close current{Enter}");

    expect(screen.queryByText("Workspace 2 workspace")).not.toBeInTheDocument();
    expect(screen.getByText("Alfred workspace")).toBeInTheDocument();
    await waitFor(() => {
      expect(setWorkspaceState).toHaveBeenLastCalledWith({
        workspaces: [
          { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/patryk/Desktop/Alfred", gitBranch: "main" },
        ],
        activeWorkspaceId: "A",
      });
    });
  });

  it("hydrates persisted workspaces and opens the last active workspace", async () => {
    const { createTerminal } = installDesktopBridge(undefined, null, [], undefined, { layoutsByWorkspace: {}, viewStateByWorkspace: {} }, {
      workspaces: [
        { id: "A", label: "Alfred", shortLabel: "A" },
        { id: "W2", label: "Workspace 2", shortLabel: "W2", rootPath: "/tmp/workspace-2" },
      ],
      activeWorkspaceId: "W2",
    });

    render(<App />);

    expect(await screen.findByRole("tab", { name: "Workspace 2 workspace, 1 idle" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Workspace 2 workspace")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: "/tmp/workspace-2" }));
    });
  });

  it("preserves live sessions and avoids empty workspace saves when hydration fails", async () => {
    const user = userEvent.setup();
    const { createTerminal, setWorkspaceState } = installDesktopBridge();
    let rejectHydration!: (error: Error) => void;
    const hydrationFailure = new Promise<Awaited<ReturnType<TerminalApi["list"]>>>((_, reject) => {
      rejectHydration = reject;
    });
    window.alfredDesktop!.terminal.list = vi.fn().mockReturnValue(hydrationFailure);

    render(<App />);

    await user.click(
      within(screen.getByRole("group", { name: "terminal actions" })).getByRole("button", { name: "New terminal" }),
    );
    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({ clientId: "manual-1" }));
    });

    await act(async () => {
      rejectHydration(new Error("transient terminal hydration failure"));
      await hydrationFailure.catch(() => undefined);
    });

    expect(screen.getByRole("alert")).toHaveTextContent("State not saved");
    expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Empty workspace" })).not.toBeInTheDocument();
    expect(setWorkspaceState).not.toHaveBeenCalled();
  });

  it("does not create a duplicate PTY when the shell rerenders", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge();

    render(<App />);

    await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "Open command palette" }));

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    expect(createTerminal).toHaveBeenCalledTimes(1);
  });

  it("does not create a duplicate PTY when a starting shell is remounted", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge();
    createTerminal.mockImplementation(() => new Promise(() => undefined));

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "Add workspace" }));

    expect(await screen.findByRole("status", { name: "Empty workspace" })).toHaveTextContent("Workspace 2");
    expect(createTerminal).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("tab", { name: "Alfred workspace, 1 starting" }));

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    expect(createTerminal).toHaveBeenCalledTimes(1);
  });

  it("enables arrange mode with layout presets without per-tile debug controls", async () => {
    const user = userEvent.setup();
    const { setWorkspaceLayout } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Arrange" }));

    expect(screen.getByRole("button", { name: "Full" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tiled" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move right" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Widen" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Full" }));

    const tile = screen.getByRole("article", { name: /Manual · zsh 1/i });
    expect(tile).toHaveStyle({ gridColumn: "1 / span 12" });
    expect(setWorkspaceLayout).toHaveBeenLastCalledWith({
      workspaceId: "A",
      layouts: expect.objectContaining({
        "manual-1": expect.objectContaining({ col: 1, colSpan: 12 }),
      }),
    });
  });

  it("switches desk work modes without entering arrange mode", async () => {
    const user = userEvent.setup();
    const { setWorkspaceLayout } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desk" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "New terminal" }));
    await screen.findByRole("article", { name: /Manual · zsh 2/i });
    await user.click(screen.getByRole("button", { name: "Split" }));

    expect(screen.getByRole("button", { name: "Split" })).toHaveAttribute("aria-pressed", "true");
    expect(setWorkspaceLayout).toHaveBeenLastCalledWith({
      workspaceId: "A",
      layouts: expect.objectContaining({
        "manual-1": expect.objectContaining({ col: 1, colSpan: 6, rowSpan: 8 }),
        "manual-2": expect.objectContaining({ col: 7, colSpan: 6, rowSpan: 8 }),
      }),
    });

    await user.click(screen.getByRole("button", { name: "Desk" }));

    expect(screen.getByRole("button", { name: "Desk" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a useful second pane prompt when split mode has one session", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Split" }));

    const splitPrompt = screen.getByLabelText("Split mode needs another session");
    expect(splitPrompt).toHaveTextContent("Create another terminal to fill this split");

    await user.click(within(splitPrompt).getByRole("button", { name: "Back to desk" }));

    expect(screen.getByRole("button", { name: "Desk" })).toHaveAttribute("aria-pressed", "true");
  });

  it("boots a split workspace with restored Alfred sessions without an update loop", async () => {
    const restoredTerminalSessions: PersistedTerminalSessionSnapshot[] = [
      {
        clientId: "alfred-1",
        title: "Codex - Backend Code Quality Analysis",
        source: "alfred",
        cwd: "/Users/patryk/Desktop/.alfred-worktrees/Alfred/codex-worktree",
        shell: "codex",
        buffer: "Codex ready",
        agentKind: "codex",
        workspaceId: "A",
        command: "codex",
        args: ["review backend"],
        lastOutputAt: 1778709873400,
      },
      {
        clientId: "alfred-2",
        title: "Claude - UI/UX Deep Analysis",
        source: "alfred",
        cwd: "/Users/patryk/Desktop/.alfred-worktrees/Alfred/claude-worktree",
        shell: "claude",
        buffer: "Claude ready\n".repeat(200),
        agentKind: "claude",
        workspaceId: "A",
        command: "claude",
        args: ["review ui"],
        lastOutputAt: 1778709847526,
      },
    ];
    installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      {
        layoutsByWorkspace: {
          A: {
            "alfred-1": { tileId: "alfred-1", col: 1, row: 1, colSpan: 6, rowSpan: 8 },
            "alfred-2": { tileId: "alfred-2", col: 7, row: 1, colSpan: 6, rowSpan: 8 },
          },
        },
        viewStateByWorkspace: {
          A: { workMode: "split", selectedSessionId: "alfred-2" },
        },
      },
      undefined,
      restoredTerminalSessions,
    );

    render(<App />);

    expect(await screen.findByRole("button", { name: "Split" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("article", { name: /Codex - Backend Code Quality Analysis/i })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Claude - UI\/UX Deep Analysis/i })).toBeInTheDocument();
  });

  it("ignores duplicate terminal focus events for the already selected session", async () => {
    const { setWorkspaceViewState } = installDesktopBridge(
      undefined,
      null,
      [
        {
          id: "runtime-codex",
          clientId: "alfred-1",
          title: "Codex - Backend Code Quality Analysis",
          source: "alfred",
          agentKind: "codex",
          workspaceId: "A",
          cwd: "/Users/patryk/Desktop/.alfred-worktrees/Alfred/codex-worktree",
          shell: "codex",
          command: "codex",
          args: ["review backend"],
          buffer: "Codex ready",
        },
        {
          id: "runtime-claude",
          clientId: "alfred-2",
          title: "Claude - UI/UX Deep Analysis",
          source: "alfred",
          agentKind: "claude",
          workspaceId: "A",
          cwd: "/Users/patryk/Desktop/.alfred-worktrees/Alfred/claude-worktree",
          shell: "claude",
          command: "claude",
          args: ["review ui"],
          buffer: "Claude ready",
        },
      ],
      undefined,
      {
        layoutsByWorkspace: {
          A: {
            "alfred-1": { tileId: "alfred-1", col: 1, row: 1, colSpan: 6, rowSpan: 8 },
            "alfred-2": { tileId: "alfred-2", col: 7, row: 1, colSpan: 6, rowSpan: 8 },
          },
        },
        viewStateByWorkspace: {
          A: { workMode: "focus", selectedSessionId: "alfred-2" },
        },
      },
    );

    render(<App />);

    expect(await screen.findByRole("button", { name: "Focus" })).toHaveAttribute("aria-pressed", "true");
    const selectedTile = await screen.findByRole("article", { name: /Claude - UI\/UX Deep Analysis/i });
    const terminalHost = selectedTile.querySelector(".xterm-host");
    expect(terminalHost).toBeInstanceOf(HTMLElement);

    setWorkspaceViewState.mockClear();
    fireEvent.focus(terminalHost!);
    fireEvent.focus(terminalHost!);

    expect(setWorkspaceViewState).not.toHaveBeenCalled();
  });

  it("keeps the selected resumed session stable when switching focus back to split", async () => {
    const user = userEvent.setup();
    const { setWorkspaceViewState } = installDesktopBridge(
      undefined,
      null,
      [
        {
          id: "runtime-codex",
          clientId: "alfred-1",
          title: "Codex - Backend Code Quality Analysis",
          source: "alfred",
          agentKind: "codex",
          workspaceId: "A",
          cwd: "/Users/patryk/Desktop/.alfred-worktrees/Alfred/codex-worktree",
          shell: "codex",
          command: "codex",
          args: ["review backend"],
          buffer: "Codex ready",
        },
        {
          id: "runtime-claude",
          clientId: "alfred-2",
          title: "Claude - UI/UX Deep Analysis",
          source: "alfred",
          agentKind: "claude",
          workspaceId: "A",
          cwd: "/Users/patryk/Desktop/.alfred-worktrees/Alfred/claude-worktree",
          shell: "claude",
          command: "claude",
          args: ["review ui"],
          buffer: "Claude ready",
        },
      ],
      undefined,
      {
        layoutsByWorkspace: {
          A: {
            "alfred-1": { tileId: "alfred-1", col: 1, row: 1, colSpan: 6, rowSpan: 8 },
            "alfred-2": { tileId: "alfred-2", col: 1, row: 1, colSpan: 12, rowSpan: 8 },
          },
        },
        viewStateByWorkspace: {
          A: { workMode: "focus", selectedSessionId: "alfred-2" },
        },
      },
    );

    render(<App />);

    expect(await screen.findByRole("button", { name: "Focus" })).toHaveAttribute("aria-pressed", "true");
    const focusedTile = await screen.findByRole("article", { name: /Claude - UI\/UX Deep Analysis/i });
    expect(focusedTile).toHaveClass("selected");

    setWorkspaceViewState.mockClear();
    await user.click(screen.getByRole("button", { name: "Split" }));

    expect(screen.getByRole("button", { name: "Split" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("article", { name: /Codex - Backend Code Quality Analysis/i })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Claude - UI\/UX Deep Analysis/i })).toHaveClass("selected");
    expect(setWorkspaceViewState).toHaveBeenCalledTimes(1);
    expect(setWorkspaceViewState).toHaveBeenCalledWith({
      workspaceId: "A",
      viewState: { workMode: "split", selectedSessionId: "alfred-2" },
    });
  });

  it("keeps the selected terminal tile inspectable while preserving xterm host", async () => {
    installDesktopBridge(undefined, null, [
      {
        id: "runtime-a",
        clientId: "manual-a",
        title: "Manual · alpha",
        source: "manual",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "/bin/zsh",
        buffer: "alpha output\n",
      },
      {
        id: "runtime-b",
        clientId: "manual-b",
        title: "Manual · beta",
        source: "manual",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "/bin/zsh",
        buffer: "beta output\n",
      },
    ]);

    render(<App />);

    const alpha = await screen.findByRole("article", { name: /Manual · alpha/i });
    const beta = await screen.findByRole("article", { name: /Manual · beta/i });

    await waitFor(() => {
      expect(alpha).toHaveClass("selected");
      expect(beta).not.toHaveClass("selected");
    });

    expect(alpha.querySelector(".xterm-host")).toBeInTheDocument();
    expect(beta.querySelector(".xterm-host")).toBeInTheDocument();

    await act(async () => {
      beta.focus();
    });

    await waitFor(() => {
      expect(beta).toHaveClass("selected");
      expect(alpha).not.toHaveClass("selected");
    });
  });

  it("creates embedded terminals with the Ghostty Vesper visual profile", async () => {
    installDesktopBridge(undefined, null, [
      {
        id: "runtime-a",
        clientId: "manual-a",
        title: "Manual · alpha",
        source: "manual",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "/bin/zsh",
        buffer: "alpha output\n",
      },
    ]);

    render(<App />);

    await screen.findByRole("article", { name: /Manual · alpha/i });

    expect(terminalConstructorOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cursorBlink: true,
          cursorStyle: "bar",
          fontFamily: expect.stringContaining("Geist Mono"),
          fontSize: 13,
          lineHeight: 1.32,
          theme: expect.objectContaining({
            background: "#101010",
            cursor: "#b9aeda",
            selectionBackground: "#3a2a38",
            selectionForeground: "#ffffff",
          }),
        }),
      ]),
    );
  });

  it("does not auto-relaunch a failed live agent when switching work modes", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge();
    createTerminal.mockImplementation((request: Parameters<TerminalApi["create"]>[0]) => {
      if (request.clientId === "codex-1") {
        return Promise.reject(new Error("spawn failed"));
      }

      return Promise.resolve({
        id: `runtime-${request.clientId ?? "manual-1"}`,
        clientId: request.clientId ?? "manual-1",
        title: request.title ?? "Manual · zsh 1",
        source: request.source ?? "manual",
        workspaceId: request.workspaceId ?? "A",
        cwd: request.cwd ?? "/Users/patryk/Desktop/Alfred",
        shell: "bash",
        ...(request.command === undefined ? {} : { command: request.command }),
        ...(request.args === undefined ? {} : { args: request.args }),
        ...(request.agentKind === undefined ? {} : { agentKind: request.agentKind }),
      });
    });

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start Codex" }));

    await waitFor(() => {
      const codexCalls = createTerminal.mock.calls.filter(([request]) => request.clientId === "codex-1");
      expect(codexCalls).toHaveLength(1);
    });
    expect(await screen.findByRole("article", { name: /Codex · session 1/i })).toHaveTextContent("spawn failed");

    await user.click(screen.getByRole("button", { name: "Focus" }));
    await user.click(screen.getByRole("button", { name: "Split" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Split" })).toHaveAttribute("aria-pressed", "true");
    });
    const codexCalls = createTerminal.mock.calls.filter(([request]) => request.clientId === "codex-1");
    expect(codexCalls).toHaveLength(1);
  });

  it("selects a tile on click and opens the inspector on double click", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Manual · zsh 1/i });
    const header = tile.querySelector(".tile-header")!;

    await user.click(header);

    expect(screen.getByRole("button", { name: "Desk" })).toHaveAttribute("aria-pressed", "true");
    expect(tile).toHaveClass("selected");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Manual · zsh 1");

    await user.dblClick(header);

    expect(screen.getByRole("button", { name: "Focus" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Manual · zsh 1");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Session attached");
    });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByRole("button", { name: "Desk" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Manual · zsh 1");
  });

  it("focus mode isolates the selected session and keeps nearby sessions switchable", async () => {
    const { setWorkspaceLayout } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-a",
        clientId: "manual-1",
        title: "Manual · zsh 1",
        source: "manual",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "/bin/zsh",
        buffer: "",
      },
      {
        id: "runtime-b",
        clientId: "manual-2",
        title: "Manual · zsh 2",
        source: "manual",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "/bin/zsh",
        buffer: "",
      },
    ]);

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    const secondTile = screen.getByRole("article", { name: /Manual · zsh 2/i });

    await userEvent.dblClick(secondTile.querySelector(".tile-header")!);

    expect(screen.getByRole("button", { name: "Focus" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Manual · zsh 2");
    expect(screen.queryByRole("article", { name: /Manual · zsh 1/i })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Manual · zsh 2/i })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "focus session switcher" })).toBeInTheDocument();
    expect(setWorkspaceLayout).toHaveBeenLastCalledWith({
      workspaceId: "A",
      layouts: expect.objectContaining({
        "manual-2": expect.objectContaining({ col: 1, colSpan: 12 }),
      }),
    });

    await userEvent.click(screen.getByRole("button", { name: "Focus Manual · zsh 1" }));

    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Manual · zsh 1");
    expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /Manual · zsh 2/i })).not.toBeInTheDocument();
  });

  it("opens the command palette and runs desk commands", async () => {
    const user = userEvent.setup();
    const { createWorkspaceFromFolder, setWorkspaceLayout, setWorkspaceState } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();

    await user.keyboard("{Control>}k{/Control}");

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    expect(screen.getByText("Launch")).toBeInTheDocument();
    expect(screen.getByText("Review and recovery")).toBeInTheDocument();
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    expect(await screen.findByRole("article", { name: /Manual · zsh 2/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.keyboard("split{Enter}");

    expect(screen.getByRole("button", { name: "Split" })).toHaveAttribute("aria-pressed", "true");
    expect(setWorkspaceLayout).toHaveBeenLastCalledWith({
      workspaceId: "A",
      layouts: expect.objectContaining({
        "manual-1": expect.objectContaining({ colSpan: 6 }),
        "manual-2": expect.objectContaining({ colSpan: 6 }),
      }),
    });

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.keyboard("scratch{Enter}");

    expect(createWorkspaceFromFolder).not.toHaveBeenCalled();
    expect(await screen.findByText("Workspace 2 workspace")).toBeInTheDocument();
    expect(setWorkspaceState).toHaveBeenLastCalledWith({
      workspaces: [
        { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/patryk/Desktop/Alfred", gitBranch: "main" },
        { id: "W2", label: "Workspace 2", shortLabel: "W2" },
      ],
      activeWorkspaceId: "W2",
    });

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "alfred{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Alfred workspace, 2 idle" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "zsh 2{Enter}");

    expect(screen.getByRole("button", { name: "Focus" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Manual · zsh 2");

    fireEvent.keyDown(window, { key: "[", code: "BracketLeft", ctrlKey: true, shiftKey: true });

    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Manual · zsh 1");
  });

  it("jumps to sessions in other workspaces from the command palette", async () => {
    const user = userEvent.setup();
    const { setWorkspaceLayout, setWorkspaceViewState } = installDesktopBridge(
      undefined,
      null,
      [
        {
          id: "runtime-manual",
          clientId: "manual-a",
          title: "Manual · zsh 1",
          source: "manual",
          workspaceId: "A",
          cwd: "/Users/patryk/Desktop/Alfred",
          shell: "/bin/zsh",
          buffer: "",
        },
        {
          id: "runtime-client",
          clientId: "client-codex",
          title: "API worker",
          source: "alfred",
          agentKind: "codex",
          workspaceId: "CLIENT",
          cwd: "/Users/patryk/Desktop/ClientApp",
          shell: "/bin/zsh",
          buffer: "",
        },
      ],
      undefined,
      undefined,
      {
        workspaces: [
          { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/patryk/Desktop/Alfred" },
          { id: "CLIENT", label: "ClientApp", shortLabel: "CLI", rootPath: "/Users/patryk/Desktop/ClientApp" },
        ],
        activeWorkspaceId: "A",
      },
    );

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Alfred workspace/i })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    const palette = screen.getByRole("dialog", { name: "Command palette" });
    expect(within(palette).getByText("Open Manual · zsh 1")).toBeInTheDocument();
    expect(within(palette).queryByText("Open API worker")).not.toBeInTheDocument();
    await user.type(within(palette).getByRole("textbox", { name: "Search commands" }), "api worker");

    expect(within(palette).getByRole("option", { name: /ClientApp · idle · .*ClientApp/i })).toHaveTextContent("Open API worker");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /ClientApp workspace/i })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByRole("button", { name: "Focus" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("API worker");
    expect(setWorkspaceViewState).toHaveBeenLastCalledWith({
      workspaceId: "CLIENT",
      viewState: { workMode: "focus", selectedSessionId: "client-codex" },
    });
    expect(setWorkspaceLayout).toHaveBeenLastCalledWith({
      workspaceId: "CLIENT",
      layouts: expect.objectContaining({
        "client-codex": expect.objectContaining({ col: 1, colSpan: 12 }),
      }),
    });
  });

  it("keeps focused-session commands scoped to the active workspace", async () => {
    const user = userEvent.setup();
    installDesktopBridge(
      undefined,
      null,
      [
        {
          id: "runtime-manual",
          clientId: "manual-a",
          title: "Manual · zsh 1",
          source: "manual",
          workspaceId: "A",
          cwd: "/Users/patryk/Desktop/Alfred",
          shell: "/bin/zsh",
          buffer: "",
        },
        {
          id: "runtime-client",
          clientId: "client-codex",
          title: "API worker",
          source: "alfred",
          agentKind: "codex",
          workspaceId: "CLIENT",
          cwd: "/Users/patryk/Desktop/ClientApp",
          shell: "/bin/zsh",
          buffer: "",
        },
      ],
      undefined,
      undefined,
      {
        workspaces: [
          { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/patryk/Desktop/Alfred" },
          { id: "CLIENT", label: "ClientApp", shortLabel: "CLI", rootPath: "/Users/patryk/Desktop/ClientApp" },
        ],
        activeWorkspaceId: "A",
      },
    );

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "close focused session{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("article", { name: /Manual · zsh 1/i })).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("tab", { name: /ClientApp workspace/i }));

    expect(await screen.findByRole("article", { name: /API worker/i })).toBeInTheDocument();
  });

  it("starts agent sessions directly from the command palette", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "codex{Enter}");

    const codexTile = await screen.findByRole("article", { name: /Codex · session 1/i });
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          agentKind: "codex",
          clientId: "codex-1",
          command: "codex",
          isolation: "shared",
          workspaceId: "A",
        }),
      );
    });
    await waitFor(() => {
      expect(codexTile).not.toHaveTextContent("isolated worktree");
      expect(codexTile).not.toHaveTextContent("alfred-codex-codex-1");
    });
  });

  it("starts isolated agent checkouts from explicit command palette actions", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    const palette = screen.getByRole("dialog", { name: "Command palette" });
    expect(within(palette).getByText("New Codex isolated checkout")).toBeInTheDocument();
    expect(within(palette).getByText("New Claude isolated checkout")).toBeInTheDocument();
    expect(within(palette).getAllByText("Create a temporary Git worktree for risky or parallel edits")).toHaveLength(2);
    await user.type(within(palette).getByRole("textbox", { name: "Search commands" }), "codex isolated{Enter}");

    expect(await screen.findByRole("article", { name: /Codex · session 1/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          agentKind: "codex",
          clientId: "codex-1",
          command: "codex",
          isolation: "worktree",
          workspaceId: "A",
        }),
      );
    });
  });

  it("reviews and applies a legacy isolated checkout from focus mode", async () => {
    const user = userEvent.setup();
    const { worktreeApply, worktreeDiff } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-codex",
        clientId: "codex-1",
        title: "Codex · isolated review",
        source: "manual",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Library/Application Support/Alfred/worktrees/alfred-44c8fe0e/alfred-codex-review",
        branchName: "alfred-codex-review",
        baseCwd: "/Users/patryk/Desktop/Alfred",
        shell: "codex",
        command: "codex",
        args: [],
        buffer: "",
      },
    ]);

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Codex · isolated review/i });
    await user.dblClick(tile.querySelector(".tile-header")!);

    const checkoutActions = screen.getByRole("toolbar", { name: "checkout actions for Codex · isolated review" });
    await user.click(within(checkoutActions).getByRole("button", { name: "Review diff" }));

    expect(worktreeDiff).toHaveBeenCalledWith({ clientId: "codex-1" });
    await waitFor(() => {
      expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Checkout diff reviewed");
      expect(screen.getByLabelText("Agent activity")).toHaveTextContent("2 changed files");
      expect(screen.getByLabelText("Agent activity")).toHaveTextContent("src/app.tsx");
    });

    await user.click(within(checkoutActions).getByRole("button", { name: "Apply to project" }));

    expect(worktreeApply).toHaveBeenCalledWith({ clientId: "codex-1" });
    await waitFor(() => {
      expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Applied to project");
      expect(screen.getByLabelText("Agent activity")).toHaveTextContent("2 files applied");
    });
  });

  it("keeps isolated checkout apply actions single-flight", async () => {
    const user = userEvent.setup();
    let resolveApply!: (value: { ok: true; appliedFiles: number }) => void;
    const { worktreeApply } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-codex",
        clientId: "codex-1",
        title: "Codex · isolated review",
        source: "manual",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Library/Application Support/Alfred/worktrees/alfred-44c8fe0e/alfred-codex-review",
        branchName: "alfred-codex-review",
        baseCwd: "/Users/patryk/Desktop/Alfred",
        shell: "codex",
        command: "codex",
        args: [],
        buffer: "",
      },
    ]);
    worktreeApply.mockImplementation(() =>
      new Promise((resolve) => {
        resolveApply = resolve;
      }),
    );

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Codex · isolated review/i });
    await user.dblClick(tile.querySelector(".tile-header")!);
    const checkoutActions = screen.getByRole("toolbar", { name: "checkout actions for Codex · isolated review" });
    const applyButton = within(checkoutActions).getByRole("button", { name: "Apply to project" });

    fireEvent.click(applyButton);
    fireEvent.click(applyButton);

    expect(worktreeApply).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(applyButton).toBeDisabled();
      expect(applyButton).toHaveTextContent("Applying...");
    });

    resolveApply({ ok: true, appliedFiles: 1 });
    await waitFor(() => {
      expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Applied to project");
      expect(screen.getByLabelText("Agent activity")).toHaveTextContent("1 file applied");
      expect(within(checkoutActions).getByRole("button", { name: "Apply to project" })).not.toBeDisabled();
    });
  });

  it("keeps a pending checkout action attached to the same session after rename", async () => {
    const user = userEvent.setup();
    let resolveApply!: (value: { ok: true; appliedFiles: number }) => void;
    const { renameTerminal, worktreeApply } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-codex",
        clientId: "codex-1",
        title: "Codex · isolated review",
        source: "manual",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Library/Application Support/Alfred/worktrees/alfred-44c8fe0e/alfred-codex-review",
        branchName: "alfred-codex-review",
        baseCwd: "/Users/patryk/Desktop/Alfred",
        shell: "codex",
        command: "codex",
        args: [],
        buffer: "",
      },
    ]);
    worktreeApply.mockImplementation(() =>
      new Promise((resolve) => {
        resolveApply = resolve;
      }),
    );

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Codex · isolated review/i });
    await user.dblClick(tile.querySelector(".tile-header")!);
    const checkoutActions = screen.getByRole("toolbar", { name: "checkout actions for Codex · isolated review" });
    fireEvent.click(within(checkoutActions).getByRole("button", { name: "Apply to project" }));
    await waitFor(() => expect(within(checkoutActions).getByRole("button", { name: "Applying..." })).toBeDisabled());

    await user.click(within(tile).getByRole("button", { name: "Rename Codex · isolated review" }));
    const input = within(tile).getByRole("textbox", { name: "Rename Codex · isolated review" });
    await user.clear(input);
    await user.type(input, "Spec reviewer{Enter}");

    expect(renameTerminal).toHaveBeenCalledWith({ clientId: "codex-1", title: "Spec reviewer" });
    expect(screen.getByRole("toolbar", { name: "checkout actions for Spec reviewer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Applying..." })).toBeDisabled();

    resolveApply({ ok: true, appliedFiles: 1 });
    await waitFor(() => {
      expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Applied to project");
      expect(screen.getByLabelText("Agent activity")).toHaveTextContent("1 file applied");
      expect(screen.getByRole("button", { name: "Apply to project" })).not.toBeDisabled();
    });
  });

  it("ignores a pending checkout action result after the session id is reused", async () => {
    const user = userEvent.setup();
    let resolveApply!: (value: { ok: true; appliedFiles: number }) => void;
    let applyPromiseSettled = false;
    const { createTerminal, worktreeApply } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-codex",
        clientId: "codex-1",
        title: "Codex · isolated review",
        source: "manual",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Library/Application Support/Alfred/worktrees/alfred-44c8fe0e/alfred-codex-review",
        branchName: "alfred-codex-review",
        baseCwd: "/Users/patryk/Desktop/Alfred",
        shell: "codex",
        command: "codex",
        args: [],
        buffer: "",
      },
    ]);
    worktreeApply.mockImplementation(async () => {
      const result = await new Promise<{ ok: true; appliedFiles: number }>((resolve) => {
        resolveApply = resolve;
      });
      applyPromiseSettled = true;
      return result;
    });

    render(<App />);

    const oldTile = await screen.findByRole("article", { name: /Codex · isolated review/i });
    await user.dblClick(oldTile.querySelector(".tile-header")!);
    const oldActions = screen.getByRole("toolbar", { name: "checkout actions for Codex · isolated review" });
    fireEvent.click(within(oldActions).getByRole("button", { name: "Apply to project" }));
    await waitFor(() => expect(within(oldActions).getByRole("button", { name: "Applying..." })).toBeDisabled());

    await user.click(within(oldTile).getByRole("button", { name: "Close Codex · isolated review" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: /Codex · isolated review/i })).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    const palette = screen.getByRole("dialog", { name: "Command palette" });
    await user.type(within(palette).getByRole("textbox", { name: "Search commands" }), "codex isolated{Enter}");
    const newTile = await screen.findByRole("article", { name: /Codex · session 1/i });
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: "codex-1",
          isolation: "worktree",
        }),
      );
    });

    resolveApply({ ok: true, appliedFiles: 1 });
    await waitFor(() => expect(applyPromiseSettled).toBe(true));
    await Promise.resolve();

    expect(worktreeApply).toHaveBeenCalledTimes(1);
    expect(newTile).not.toHaveTextContent("Applied to project");
    expect(screen.queryByText("Applied to project")).not.toBeInTheDocument();
  });

  it("keeps explicit shared sessions visually quiet even if stale checkout metadata exists", async () => {
    const user = userEvent.setup();
    const { worktreeApply, worktreeDiff } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-codex",
        clientId: "codex-shared",
        title: "Codex · shared review",
        source: "manual",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        isolation: "shared",
        branchName: "alfred-codex-stale",
        baseCwd: "/Users/patryk/Desktop/Alfred",
        shell: "codex",
        command: "codex",
        args: [],
        buffer: "",
      },
    ]);

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Codex · shared review/i });
    await user.dblClick(tile.querySelector(".tile-header")!);

    expect(screen.queryByRole("toolbar", { name: /checkout actions/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review diff" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply to project" })).not.toBeInTheDocument();
    expect(worktreeDiff).not.toHaveBeenCalled();
    expect(worktreeApply).not.toHaveBeenCalled();
  });

  it("disables isolated checkout commands when no workspace folder is bound", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge(undefined, null, [], undefined, undefined, {
      workspaces: [{ id: "A", label: "Alfred", shortLabel: "A" }],
      activeWorkspaceId: "A",
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    const palette = screen.getByRole("dialog", { name: "Command palette" });
    await user.type(within(palette).getByRole("textbox", { name: "Search commands" }), "isolated");

    expect(within(palette).getByRole("option", { name: /New Codex isolated checkout/i })).toBeDisabled();
    expect(within(palette).getByRole("option", { name: /New Claude isolated checkout/i })).toBeDisabled();
    expect(
      within(palette).getAllByText("Bind a workspace folder to create a temporary Git worktree for risky or parallel edits"),
    ).toHaveLength(2);

    await user.keyboard("{Enter}");
    expect(createTerminal).not.toHaveBeenCalledWith(expect.objectContaining({ isolation: "worktree" }));
  });

  it("starts Codex from the top bar in the shared workspace by default", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start Codex" }));

    expect(await screen.findByRole("article", { name: /Codex · session 1/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          agentKind: "codex",
          clientId: "codex-1",
          command: "codex",
          isolation: "shared",
          workspaceId: "A",
        }),
      );
    });
  });

  it("starts Claude from the top bar in the shared workspace by default", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start Claude" }));

    expect(await screen.findByRole("article", { name: /Claude · session 1/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          agentKind: "claude",
          clientId: "claude-1",
          command: "claude",
          isolation: "shared",
          workspaceId: "A",
        }),
      );
    });
  });

  it("surfaces the next current-workspace decision in Alfred's rail and jumps to it", async () => {
    const user = userEvent.setup();
    installDesktopBridge(undefined, null, [
      {
        id: "runtime-manual",
        clientId: "manual-a",
        title: "Manual · zsh 1",
        source: "manual",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "/bin/zsh",
        buffer: "",
      },
      {
        id: "runtime-codex",
        clientId: "codex-a",
        title: "Codex · review",
        source: "alfred",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "/bin/zsh",
        buffer: "",
        activityEvents: [
          { id: "ask-1", kind: "approval", title: "Waiting for approval", detail: "Allow edit?", at: 100 },
        ],
      },
    ]);

    render(<App />);

    const rail = await screen.findByLabelText("Alfred status");
    expect(rail).toHaveTextContent("needs review");
    const context = within(rail).getByRole("region", { name: "Review and recovery context" });
    expect(context).toHaveTextContent("1 decision");
    expect(context).toHaveTextContent("Allow edit?");

    await user.click(screen.getByRole("button", { name: "Open review queue, 1 item" }));
    await user.click(screen.getByRole("button", { name: "Open Codex · review in Alfred" }));

    expect(screen.getByRole("button", { name: "Focus" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Codex · review");

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "review attention{Enter}");

    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Codex · review");
  });

  it("opens a global review queue and focuses attention in another workspace", async () => {
    const user = userEvent.setup();
    installDesktopBridge(
      undefined,
      null,
      [
        {
          id: "runtime-manual",
          clientId: "manual-a",
          title: "Manual · zsh 1",
          source: "manual",
          workspaceId: "A",
          cwd: "/Users/patryk/Desktop/Alfred",
          shell: "/bin/zsh",
          buffer: "",
        },
        {
          id: "runtime-local-codex",
          clientId: "codex-local",
          title: "Local Codex · review",
          source: "manual",
          agentKind: "codex",
          workspaceId: "A",
          cwd: "/Users/patryk/Desktop/Alfred",
          shell: "codex",
          command: "codex",
          args: [],
          buffer: "",
          activityEvents: [
            { id: "ask-local", kind: "approval", title: "Waiting for approval", detail: "Local edit?", at: 90 },
          ],
          lastActivityAt: 90,
        },
        {
          id: "runtime-codex",
          clientId: "codex-w2",
          title: "Codex · review",
          source: "manual",
          agentKind: "codex",
          workspaceId: "W2",
          cwd: "/repo/client",
          shell: "codex",
          command: "codex",
          args: [],
          buffer: "",
          activityEvents: [
            { id: "ask-1", kind: "approval", title: "Waiting for approval", detail: "Allow edit?", at: 100 },
          ],
          lastActivityAt: 100,
        },
      ],
      undefined,
      undefined,
      {
        workspaces: [
          { id: "A", label: "Alfred", shortLabel: "A" },
          { id: "W2", label: "ClientApp", shortLabel: "CLI", rootPath: "/repo/client" },
        ],
        activeWorkspaceId: "A",
      },
    );

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open review queue, 2 items" }));

    const queue = screen.getByRole("dialog", { name: "Review queue" });
    expect(queue).toHaveTextContent("ClientApp");
    expect(queue).toHaveTextContent("Codex · review");
    expect(queue).toHaveTextContent("Local Codex · review");

    await user.click(within(queue).getByRole("button", { name: "Open Codex · review in ClientApp" }));

    expect(screen.queryByRole("dialog", { name: "Review queue" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /ClientApp workspace, 1 waiting/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Focus" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Codex · review");

    await user.click(screen.getByRole("tab", { name: /Alfred workspace/i }));
    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "open review queue{Enter}");

    expect(screen.getByRole("dialog", { name: "Review queue" })).toBeInTheDocument();
  });

  it("uses the top review button as the decision entry point for current workspace items", async () => {
    const user = userEvent.setup();
    installDesktopBridge(
      undefined,
      null,
      [
        {
          id: "runtime-codex",
          clientId: "codex-a",
          title: "Codex · review",
          source: "manual",
          agentKind: "codex",
          workspaceId: "A",
          cwd: "/Users/patryk/Desktop/Alfred",
          shell: "codex",
          command: "codex",
          args: [],
          buffer: "",
          activityEvents: [
            { id: "ask-1", kind: "approval", title: "Waiting for approval", detail: "Allow edit?", at: 100 },
          ],
          lastActivityAt: 100,
        },
      ],
    );

    render(<App />);

    await screen.findByRole("article", { name: /Codex · review/i });

    expect(screen.getByRole("button", { name: "Open review queue, 1 item" })).toBeInTheDocument();
    expect(document.querySelector(".workspace-layout")).toHaveClass("alfred-expanded");
    const rail = screen.getByLabelText("Alfred status");
    expect(rail).not.toHaveClass("compact");
    expect(rail).toHaveTextContent("needs review");
    expect(rail).toHaveTextContent("Allow edit?");
    expect(within(rail).queryByRole("button", { name: "Focus decision: Codex · review" })).not.toBeInTheDocument();

    const reviewTrigger = screen.getByRole("button", { name: "Open review queue, 1 item" });
    await user.click(reviewTrigger);

    expect(screen.getByRole("button", { name: "Close review queue" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Open Codex · review in Alfred" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Close review queue" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Review queue" })).not.toBeInTheDocument();
    expect(reviewTrigger).toHaveFocus();

    await user.click(reviewTrigger);
    await user.click(screen.getByRole("button", { name: "Open Codex · review in Alfred" }));

    expect(screen.getByRole("button", { name: "Focus" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Codex · review");
  });

  it("keeps current decisions visible when recovery is also available", async () => {
    installDesktopBridge(
      undefined,
      null,
      [
        {
          id: "runtime-codex",
          clientId: "codex-a",
          title: "Codex · review",
          source: "manual",
          agentKind: "codex",
          workspaceId: "A",
          cwd: "/Users/patryk/Desktop/Alfred",
          shell: "codex",
          command: "codex",
          args: [],
          buffer: "",
          activityEvents: [
            { id: "ask-1", kind: "approval", title: "Waiting for approval", detail: "Allow edit?", at: 100 },
          ],
          lastActivityAt: 100,
        },
      ],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "manual-restored",
          title: "Manual · saved",
          workspaceId: "A",
          cwd: "/Users/patryk/Desktop/Alfred",
          source: "manual",
          shell: "/bin/zsh",
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    await screen.findByRole("article", { name: /Codex · review/i });
    const rail = screen.getByLabelText("Alfred status");

    expect(rail).toHaveTextContent("needs review");
    const context = within(rail).getByRole("region", { name: "Review and recovery context" });
    expect(context).toHaveTextContent("Allow edit?");
    expect(context).toHaveTextContent("Manual · saved");
    expect(context).not.toHaveTextContent("1 saved session ready");
    expect(within(rail).queryByRole("button", { name: "Relaunch Manual · saved" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open review queue, 2 items" })).toBeInTheDocument();
  });

  it("launches staged work from the global review queue in its workspace", async () => {
    const user = userEvent.setup();
    const { createTerminal, resolveStagedPlan } = installDesktopBridge(
      undefined,
      {
        id: "plan-w2",
        name: "Client plan",
        prompt: "prepare client work",
        sessions: [
          {
            id: "alfred-w2",
            kind: "shell",
            title: "Client task",
            command: "echo",
            args: ["ok"],
            workspaceId: "W2",
          },
        ],
      },
      [],
      undefined,
      undefined,
      {
        workspaces: [
          { id: "A", label: "Alfred", shortLabel: "A" },
          { id: "W2", label: "ClientApp", shortLabel: "CLI", rootPath: "/repo/client" },
        ],
        activeWorkspaceId: "A",
      },
    );

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open review queue, 1 item" }));
    await user.click(screen.getByRole("button", { name: "Launch Client task in ClientApp" }));

    expect(screen.getByRole("tab", { name: /ClientApp workspace/i })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: "alfred-w2",
          command: "echo",
          workspaceId: "W2",
        }),
      );
    });
    await waitFor(() => {
      expect(resolveStagedPlan).toHaveBeenCalledWith({ sessionIds: ["alfred-w2"] });
    });
  });

  it("shows unsafe commands as blocked in the global review queue", async () => {
    const user = userEvent.setup();
    const { createTerminal, resolveStagedPlan } = installDesktopBridge(
      undefined,
      {
        id: "plan-w2",
        name: "Risky client plan",
        prompt: "prepare cleanup",
        sessions: [
          {
            id: "alfred-risky-w2",
            kind: "shell",
            title: "Risky cleanup",
            cwd: "/repo/client",
            command: "rm",
            args: ["-rf", "dist"],
            safetyNote: "rm -rf detected",
            workspaceId: "W2",
          },
        ],
      },
      [],
      undefined,
      undefined,
      {
        workspaces: [
          { id: "A", label: "Alfred", shortLabel: "A" },
          { id: "W2", label: "ClientApp", shortLabel: "CLI", rootPath: "/repo/client" },
        ],
        activeWorkspaceId: "A",
      },
    );

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open review queue, 1 item" }));

    const queue = screen.getByRole("dialog", { name: "Review queue" });
    expect(queue).toHaveTextContent("/repo/client");
    expect(queue).toHaveTextContent("rm -rf dist");
    expect(queue).toHaveTextContent("rm -rf detected");

    expect(within(queue).getByRole("button", { name: "Blocked Risky cleanup in ClientApp" })).toBeDisabled();
    expect(resolveStagedPlan).not.toHaveBeenCalled();
    expect(createTerminal).not.toHaveBeenCalled();
  });

  it("moves and resizes a tile with pointer gestures in arrange mode", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await user.click(screen.getByRole("button", { name: "Arrange" }));

    fireEvent.pointerDown(tile.querySelector(".tile-header")!, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 160, clientY: 72 });

    expect(tile).toHaveClass("is-dragging");
    expect(tile).toHaveStyle({ transform: "translate3d(160px, 72px, 0)" });
    expect(tile).toHaveStyle({ gridColumn: "1 / span 12", gridRow: "1 / span 8" });

    fireEvent.pointerUp(window);

    expect(tile).toHaveStyle({ gridColumn: "1 / span 12", gridRow: "2 / span 8" });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Resize Manual · zsh 1" }), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 80, clientY: 72 });

    expect(tile).toHaveClass("is-resizing");

    fireEvent.pointerUp(window);

    expect(tile).toHaveStyle({ gridColumn: "1 / span 12", gridRow: "2 / span 9" });
  });

  it("keeps the snapped layout grid after leaving arrange mode", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);

    await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await user.click(screen.getByRole("button", { name: "Arrange" }));
    await user.click(screen.getByRole("button", { name: "Tiled" }));

    const grid = screen.getByLabelText("terminals").querySelector(".terminal-grid");
    expect(grid).toHaveClass("arranging");

    await user.click(screen.getByRole("button", { name: "Arrange" }));

    expect(grid).toHaveClass("laid-out");
    expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toHaveStyle({ gridColumn: "1 / span 12" });
  });

  it("keeps Alfred compact while idle and expands when a plan is staged", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);

    await screen.findByRole("article", { name: /Manual · zsh 1/i });
    expect(document.querySelector(".workspace-layout")).toHaveClass("alfred-compact");
    expect(screen.getByLabelText("Alfred status")).toHaveClass("compact");
    expect(screen.getByLabelText("Alfred status")).toHaveAttribute("title", "Alfred standing by");
    expect(screen.queryByText("standing by")).not.toBeInTheDocument();
    expect(screen.queryByText("no asks")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Alfred prompt"), "prepare agents");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));

    expect(await screen.findByRole("article", { name: /Staged Task A/i })).toBeInTheDocument();
    expect(document.querySelector(".workspace-layout")).toHaveClass("alfred-expanded");
    expect(screen.getByLabelText("Alfred status")).not.toHaveClass("compact");
    expect(screen.getByLabelText("Alfred status")).not.toHaveAttribute("title");
  });

  it("closes a live terminal tile and kills its runtime session", async () => {
    const user = userEvent.setup();
    const { killTerminal } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-a",
        clientId: "manual-a",
        title: "Manual · zsh 9",
        source: "manual",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "/bin/zsh",
        buffer: "",
      },
    ]);

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 9/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close Manual · zsh 9" }));

    expect(screen.queryByRole("article", { name: /Manual · zsh 9/i })).not.toBeInTheDocument();
    expect(killTerminal).toHaveBeenCalledWith({ id: "runtime-a" });
  });

  it("offers concrete launch actions when the active workspace is empty", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge(undefined, null, [], undefined, undefined, {
      workspaces: [
        {
          id: "A",
          label: "Alfred",
          shortLabel: "A",
          rootPath: "/Users/patryk/Desktop/Alfred",
          gitBranch: "main",
        },
      ],
      activeWorkspaceId: "A",
    });

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "Close Manual · zsh 1" }));

    const emptyState = await screen.findByRole("status", { name: "Empty workspace" });
    expect(emptyState).toHaveTextContent("Alfred");
    expect(emptyState).toHaveTextContent("…/Desktop/Alfred");
    expect(emptyState).toHaveTextContent("main");

    await user.click(within(emptyState).getByRole("button", { name: "Start Codex" }));

    expect(await screen.findByRole("article", { name: /Codex · session 1/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenLastCalledWith(
        expect.objectContaining({
          agentKind: "codex",
          clientId: "codex-1",
          command: "codex",
          isolation: "shared",
          workspaceId: "A",
        }),
      );
    });
  });

  it("closes the focused terminal with the desktop close shortcut", async () => {
    const { killTerminal } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-a",
        clientId: "manual-a",
        title: "Manual · zsh 9",
        source: "manual",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "/bin/zsh",
        buffer: "",
      },
    ]);

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 9/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "w", ctrlKey: true });

    expect(screen.queryByRole("article", { name: /Manual · zsh 9/i })).not.toBeInTheDocument();
    expect(killTerminal).toHaveBeenCalledWith({ id: "runtime-a" });
  });

  it("restarts an exited terminal tile in place", async () => {
    const user = userEvent.setup();
    const { createTerminal, emitExit, forgetTerminal } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-a",
        clientId: "manual-a",
        title: "Manual · zsh 9",
        source: "manual",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "/bin/zsh",
        buffer: "",
      },
    ]);

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Manual · zsh 9/i });
    expect(createTerminal).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(window.alfredDesktop?.terminal.onExit).toHaveBeenCalled();
    });
    emitExit({ id: "runtime-a", exitCode: 0 });

    await user.click(await screen.findByRole("button", { name: "Open review queue, 1 item" }));
    await user.click(screen.getByRole("button", { name: "Restart Manual · zsh 9 in Alfred" }));

    expect(forgetTerminal).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: "manual-a",
          cwd: "/Users/patryk/Desktop/Alfred",
          workspaceId: "A",
        }),
      );
    });
  });

  it("surfaces the latest important activity on the terminal tile", async () => {
    installDesktopBridge(undefined, null, [
      {
        id: "runtime-a",
        clientId: "codex-a",
        title: "Codex · session 1",
        source: "manual",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "codex",
        command: "codex",
        args: [],
        buffer: "",
        activityEvents: [
          {
            id: "codex-a-activity-1",
            kind: "approval",
            title: "Waiting for approval",
            detail: "Do you want to proceed? y/N",
            at: 100,
          },
        ],
        lastActivityAt: 100,
      },
    ]);

    render(<App />);

    const tile = await screen.findByRole("article", {
      name: /Codex · session 1, Waiting for approval: Do you want to proceed\? y\/N/i,
    });

    expect(tile).toHaveTextContent("ask");
    expect(tile).toHaveTextContent("Waiting for approval");
  });

  it("keeps approval context informational in the focused activity panel", async () => {
    const user = userEvent.setup();
    const { writeTerminal } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-a",
        clientId: "codex-a",
        title: "Codex · session 1",
        source: "manual",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "codex",
        command: "codex",
        args: [],
        buffer: "",
        activityEvents: [
          {
            id: "codex-a-approval-1",
            kind: "approval",
            title: "Waiting for approval",
            detail: "Do you want to proceed? y/N",
            at: 100,
          },
        ],
      },
    ]);

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Codex · session 1/i });
    await user.dblClick(tile.querySelector(".tile-header")!);

    const pulse = screen.getByRole("region", { name: "Session pulse" });
    expect(pulse).toHaveTextContent("needs you");
    expect(pulse).toHaveTextContent("Waiting for approval");
    expect(screen.queryByRole("group", { name: "Approval actions for Codex · session 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send yes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send no" })).not.toBeInTheDocument();
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("reveals file activity from the focused activity panel", async () => {
    const user = userEvent.setup();
    const { revealPath } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-a",
        clientId: "codex-a",
        title: "Codex · session 1",
        source: "manual",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "codex",
        command: "codex",
        args: [],
        buffer: "",
        activityEvents: [
          {
            id: "codex-a-file-1",
            kind: "file",
            title: "Edit file",
            detail: "apps/desktop/src/renderer/app.tsx",
            at: 100,
            payload: { type: "file", operation: "edited", path: "apps/desktop/src/renderer/app.tsx" },
          },
        ],
      },
    ]);

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Codex · session 1/i });
    await user.dblClick(tile.querySelector(".tile-header")!);
    await user.click(
      screen.getByRole("button", { name: "Reveal edited: apps/desktop/src/renderer/app.tsx" }),
    );

    expect(revealPath).toHaveBeenCalledWith({
      cwd: "/Users/patryk/Desktop/Alfred",
      path: "apps/desktop/src/renderer/app.tsx",
    });
  });

  it("shows selected session evidence in the right dock", async () => {
    installDesktopBridge(undefined, null, [
      {
        id: "runtime-a",
        clientId: "manual-a",
        title: "Manual · alpha",
        source: "manual",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "/bin/zsh",
        buffer: "alpha output\n",
      },
    ]);

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · alpha/i })).toBeInTheDocument();
    const inspector = screen.getByRole("complementary", { name: "Agent activity" });
    expect(within(inspector).getByText("Manual · alpha")).toBeInTheDocument();
    expect(within(inspector).getByText("Continue outside Alfred")).toBeInTheDocument();
  });

  it("opens the focused session cwd in an external terminal", async () => {
    const user = userEvent.setup();
    const { openExternalTerminal } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-a",
        clientId: "codex-a",
        title: "Codex · session 1",
        source: "manual",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "codex",
        command: "codex",
        args: [],
        buffer: "",
      },
    ]);

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Codex · session 1/i });
    await user.dblClick(tile.querySelector(".tile-header")!);
    await user.click(screen.getByRole("button", { name: "Open external terminal for Codex · session 1" }));

    expect(openExternalTerminal).toHaveBeenCalledWith({ cwd: "/Users/patryk/Desktop/Alfred" });
  });

  it("hands off a terminal tile to the external terminal without entering focus mode", async () => {
    const user = userEvent.setup();
    const { openExternalTerminal } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-a",
        clientId: "codex-a",
        title: "Codex · session 1",
        source: "manual",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "codex",
        command: "codex",
        args: [],
        buffer: "",
      },
    ]);

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Codex · session 1/i });
    await user.click(within(tile).getByRole("button", { name: "Open Codex · session 1 in external terminal" }));

    expect(openExternalTerminal).toHaveBeenCalledWith({ cwd: "/Users/patryk/Desktop/Alfred" });
  });

  it("hands off the focused session to the external terminal with a keyboard shortcut", async () => {
    const user = userEvent.setup();
    const { openExternalTerminal } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-a",
        clientId: "manual-a",
        title: "Manual · zsh 1",
        source: "manual",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "/bin/zsh",
        buffer: "",
      },
    ]);

    render(<App />);

    await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await user.keyboard("{Meta>}{Shift>}o{/Shift}{/Meta}");

    expect(openExternalTerminal).toHaveBeenCalledWith({ cwd: "/Users/patryk/Desktop/Alfred" });
  });

  it("renames a terminal tile and persists the runtime title", async () => {
    const user = userEvent.setup();
    const { renameTerminal } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-a",
        clientId: "codex-a",
        title: "Codex · session 1",
        source: "manual",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "codex",
        command: "codex",
        args: [],
        buffer: "",
      },
    ]);

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Codex · session 1/i });
    await user.click(within(tile).getByRole("button", { name: "Rename Codex · session 1" }));
    const input = within(tile).getByRole("textbox", { name: "Rename Codex · session 1" });
    await user.clear(input);
    expect(within(tile).getByRole("button", { name: "Save title for Codex · session 1" })).toBeDisabled();
    await user.type(input, "Spec reviewer{Enter}");

    expect(await within(tile).findByText("Spec reviewer")).toBeInTheDocument();
    expect(renameTerminal).toHaveBeenCalledWith({ clientId: "codex-a", title: "Spec reviewer" });
  });

  it("offers focused session handoff commands from the command palette", async () => {
    const user = userEvent.setup();
    const { openExternalTerminal, revealPath } = installDesktopBridge(undefined, null, [
      {
        id: "runtime-a",
        clientId: "codex-a",
        title: "Codex · session 1",
        source: "manual",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "codex",
        command: "codex",
        args: [],
        buffer: "",
      },
    ]);

    render(<App />);

    await screen.findByRole("article", { name: /Codex · session 1/i });

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "open focused session{Enter}");

    expect(openExternalTerminal).toHaveBeenCalledWith({ cwd: "/Users/patryk/Desktop/Alfred" });

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "reveal focused session{Enter}");

    expect(revealPath).toHaveBeenCalledWith({ cwd: "/Users/patryk/Desktop/Alfred", path: "." });
  });

  it("hydrates saved workspace layouts from the desktop runtime", async () => {
    installDesktopBridge(undefined, null, [], undefined, {
      layoutsByWorkspace: {
        A: {
          "manual-1": { tileId: "manual-1", col: 3, row: 2, colSpan: 6, rowSpan: 4 },
        },
      },
      viewStateByWorkspace: {},
    });

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await userEvent.click(screen.getByRole("button", { name: "Arrange" }));

    expect(tile).toHaveStyle({ gridColumn: "3 / span 6", gridRow: "2 / span 4" });
  });

  it("hydrates saved workspace view mode and selected session", async () => {
    installDesktopBridge(undefined, null, [], undefined, {
      layoutsByWorkspace: {},
      viewStateByWorkspace: {
        A: { workMode: "focus", selectedSessionId: "manual-1" },
      },
    });

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Focus" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Manual · zsh 1");
  });

  it("persists focus mode and selected session as workspace view state", async () => {
    const user = userEvent.setup();
    const { setWorkspaceViewState } = installDesktopBridge();

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await user.dblClick(tile.querySelector(".tile-header")!);

    await waitFor(() => {
      expect(setWorkspaceViewState).toHaveBeenCalledWith({
        workspaceId: "A",
        viewState: { workMode: "focus", selectedSessionId: "manual-1" },
      });
    });
  });

  it("blocks Alfred prompts when OpenRouter is not configured", async () => {
    const user = userEvent.setup();
    const { requestPlan } = installDesktopBridge(undefined, null, [], {
      model: "anthropic/claude-sonnet-4-6",
      openRouterConfigured: false,
    });

    render(<App />);

    await screen.findByText("Set OPENROUTER_API_KEY in repo .env to use Alfred.");
    await user.type(screen.getByLabelText("Alfred prompt"), "prepare agents");

    expect(screen.getByRole("button", { name: "Send prompt to Alfred" })).toBeDisabled();
    expect(requestPlan).not.toHaveBeenCalled();
  });

  it("keeps Alfred prompts available while runtime status is unknown", async () => {
    const user = userEvent.setup();
    const { requestPlan } = installDesktopBridge(undefined, null, [], null);

    render(<App />);

    await user.type(screen.getByLabelText("Alfred prompt"), "prepare agents");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));

    await screen.findByRole("article", { name: /Staged Task A/i });
    expect(requestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "prepare agents",
        workspace: expect.objectContaining({
          id: "A",
          label: "Alfred",
          sessions: expect.arrayContaining([expect.objectContaining({ title: "Manual · zsh 1" })]),
        }),
      }),
    );
  });

  it("turns the first Alfred prompt into staged tiles", async () => {
    const user = userEvent.setup();
    const { requestPlan, setStagedPlan } = installDesktopBridge();

    render(<App />);

    await user.type(screen.getByLabelText("Alfred prompt"), "launch first plan");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));

    expect(requestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "launch first plan",
        workspace: expect.objectContaining({
          id: "A",
          label: "Alfred",
          sessions: expect.arrayContaining([expect.objectContaining({ title: "Manual · zsh 1" })]),
        }),
      }),
    );
    const rail = await screen.findByLabelText("Alfred status");
    const reviewQueue = within(rail).getByRole("region", { name: "Alfred review queue" });
    expect(rail).toHaveTextContent("ready to launch");
    expect(reviewQueue).toHaveTextContent("2 safe · 0 flagged");
    expect(within(rail).getByRole("button", { name: "Launch queue" })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: "Clear staged plan from review queue" })).toBeInTheDocument();
    expect(await screen.findByRole("article", { name: /Staged Task A/i })).toBeInTheDocument();
    const stagedTaskB = await screen.findByRole("article", { name: /Staged Task B/i });
    const stagedTaskBHeader = stagedTaskB.querySelector(".tile-header")!;

    await user.click(stagedTaskBHeader);

    expect(screen.getByRole("button", { name: "Desk" })).toHaveAttribute("aria-pressed", "true");
    expect(stagedTaskB).toHaveClass("selected");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Task B");

    await user.dblClick(stagedTaskBHeader);

    expect(screen.getByRole("button", { name: "Focus" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Task B");

    await waitFor(() => {
      expect(setStagedPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Demo plan",
          prompt: "launch first plan",
          sessions: expect.arrayContaining([
            expect.objectContaining({ id: "alfred-1", title: "Task A" }),
            expect.objectContaining({ id: "alfred-2", title: "Task B" }),
          ]),
        }),
      );
    });
  });

  it("persists staged worktree isolation in the saved Alfred plan", async () => {
    const user = userEvent.setup();
    const { setStagedPlan } = installDesktopBridge({
      ok: true,
      plan: {
        name: "Isolated agents",
        sessions: [
          {
            kind: "codex",
            title: "Codex isolated audit",
            command: "codex",
            args: [],
            isolation: "worktree",
          },
        ],
      },
    });

    render(<App />);

    await user.type(screen.getByLabelText("Alfred prompt"), "stage isolated codex");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));

    await waitFor(() => {
      expect(setStagedPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Isolated agents",
          prompt: "stage isolated codex",
          sessions: [
            expect.objectContaining({
              id: "alfred-1",
              kind: "codex",
              isolation: "worktree",
              title: "Codex isolated audit",
            }),
          ],
        }),
      );
    });
  });

  it("saves staged shell edits through Alfred and replaces the queued tile from the returned plan", async () => {
    const user = userEvent.setup();
    const { setStagedPlan, updateStagedSession } = installDesktopBridge({
      ok: true,
      plan: {
        name: "Editable plan",
        sessions: [{ kind: "shell", title: "Run old command", command: "echo", args: ["old"] }],
      },
    });

    render(<App />);

    await user.type(screen.getByLabelText("Alfred prompt"), "stage editable shell");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));
    const stagedTile = await screen.findByRole("article", { name: /Staged Run old command/i });

    await waitFor(() => {
      expect(setStagedPlan).toHaveBeenCalled();
    });
    const originalPlan = setStagedPlan.mock.calls.at(-1)?.[0] as AlfredStagedPlanSnapshot;
    const originalSession = originalPlan.sessions[0];
    if (!originalSession) throw new Error("Expected staged session");
    updateStagedSession.mockResolvedValueOnce({
      ok: true,
      plan: {
        ...originalPlan,
        sessions: [
          {
            ...originalSession,
            title: "Run tests",
            command: "pnpm",
            args: ["test", "--watch"],
            cwd: "apps/desktop",
          },
        ],
      },
    });

    await user.dblClick(stagedTile.querySelector(".tile-header")!);
    await user.click(screen.getByRole("button", { name: "Edit command" }));
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "pnpm" } });
    fireEvent.change(screen.getByLabelText("Arguments"), { target: { value: "test\n--watch" } });
    fireEvent.change(screen.getByLabelText("Working directory"), { target: { value: "apps/desktop" } });
    await user.click(screen.getByRole("button", { name: "Save and re-check" }));

    await waitFor(() => {
      expect(updateStagedSession).toHaveBeenCalledWith({
        planId: originalPlan.id,
        sessionId: "alfred-1",
        patch: {
          command: "pnpm",
          args: ["test", "--watch"],
          cwd: "apps/desktop",
        },
        workspace: expect.objectContaining({ id: "A", label: "Alfred" }),
      });
    });
    expect(await screen.findByRole("article", { name: /Staged Run tests/i })).toHaveTextContent("edited · rechecked");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("pnpm test --watch");
  });

  it("hydrates staged Alfred tiles from the desktop runtime", async () => {
    installDesktopBridge(undefined, {
      id: "plan-restore",
      name: "Restored squad",
      prompt: "restore this plan",
      sessions: [
        { id: "alfred-7", kind: "shell", title: "Restored shell", command: "echo", args: ["ok"] },
      ],
    });

    render(<App />);

    expect(await screen.findByRole("article", { name: /Staged Restored shell/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Resolve the current Alfred plan");
    expect(screen.getByText('"restore this plan"')).toBeInTheDocument();
  });

  it("jumps from the composer to a workspace with staged Alfred work", async () => {
    const user = userEvent.setup();
    installDesktopBridge(
      undefined,
      {
        id: "plan-w2",
        name: "Workspace 2 plan",
        prompt: "prepare client work",
        sessions: [
          {
            id: "alfred-w2",
            kind: "shell",
            title: "Client task",
            command: "echo",
            args: ["ok"],
            workspaceId: "W2",
          },
        ],
      },
      [],
      undefined,
      undefined,
      {
        workspaces: [
          { id: "A", label: "Alfred", shortLabel: "A" },
          { id: "W2", label: "ClientApp", shortLabel: "CLI", rootPath: "/repo/client" },
        ],
        activeWorkspaceId: "A",
      },
    );

    render(<App />);

    const composer = screen.getByRole("form", { name: "Alfred composer" });
    expect(await within(composer).findByRole("status")).toHaveTextContent(
      "Review staged items in ClientApp workspace first.",
    );
    await user.click(screen.getByRole("button", { name: "Open ClientApp" }));

    expect(screen.getByRole("tab", { name: /ClientApp workspace/ })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("article", { name: /Staged Client task/i })).toBeInTheDocument();
  });

  it("relaunches restored terminal transcripts in place", async () => {
    const { createTerminal, forgetTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "codex-9",
          title: "Codex · session 9",
          cwd: "/repo",
          source: "alfred",
          agentKind: "codex",
          command: "codex",
          args: ["original Alfred prompt"],
          shell: "codex",
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    const restored = await screen.findByRole("article", { name: /Codex · session 9/i });
    await waitFor(() => {
      expect(restored).toHaveTextContent("restored");
    });
    expect(screen.getByRole("button", { name: "Open review queue, 1 item" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Review and recovery context" })).toHaveTextContent("Codex · session 9");
    expect(screen.getByLabelText("Alfred status")).not.toHaveClass("compact");
    expect(createTerminal).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Open Review surface" }));
    expect(screen.getByRole("button", { name: "Resume latest" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open Desk surface" }));

    await userEvent.click(screen.getByRole("button", { name: "Resume latest Codex conversation Codex · session 9" }));

    expect(createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKind: "codex",
        clientId: "codex-9",
        command: "codex",
        args: ["resume", "--last"],
        cwd: "/repo",
        workspaceId: "A",
      }),
    );
    expect(screen.queryByRole("article", { name: /Manual · zsh 10/i })).not.toBeInTheDocument();
    expect(forgetTerminal).not.toHaveBeenCalled();
  });

  it("labels known Codex resume targets as this Codex conversation", async () => {
    installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "codex-exact",
          title: "Codex · exact session",
          cwd: "/repo",
          source: "alfred",
          agentKind: "codex",
          command: "codex",
          args: ["resume", "stale-session-id"],
          resumeTarget: { agentKind: "codex", sessionId: "codex-session-123", source: "codex-session-index" },
          shell: "codex",
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Codex · exact session/i });
    expect(within(tile).getByRole("button", { name: /Resume this Codex conversation/i })).toHaveTextContent(
      "Resume this Codex conversation",
    );
  });

  it("labels restored Codex sessions without resumeTarget as latest fallback", async () => {
    installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "codex-unknown",
          title: "Codex · unknown target",
          cwd: "/repo",
          source: "alfred",
          agentKind: "codex",
          command: "codex",
          args: ["resume", "unknown-session-id"],
          shell: "codex",
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Codex · unknown target/i });
    expect(within(tile).getByRole("button", { name: /Resume latest Codex conversation/i })).toHaveTextContent(
      "Resume latest Codex conversation",
    );
  });

  it("requires explicit review before relaunching a mutating restored command", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "clean-desktop",
          title: "Clean Desktop",
          cwd: "/Users/patryk/Desktop",
          source: "manual",
          shell: "find",
          command: "find",
          args: ["/Users/patryk/Desktop", "-maxdepth", "1", "-exec", "mv", "{}", "/Users/patryk/Desktop/Alfred", ";"],
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Clean Desktop/i });
    await waitFor(() => {
      expect(within(tile).getByRole("button", { name: "Review relaunch Clean Desktop" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "relaunch");
    expect(screen.getByText("Review recovery queue")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Open review queue, 1 item" }));
    const queue = screen.getByRole("dialog", { name: "Review queue" });
    expect(queue).toHaveTextContent("find -exec mutates files when replayed");
    expect(queue).toHaveTextContent("find /Users/patryk/Desktop");

    await user.click(within(queue).getByRole("button", { name: "Review relaunch Clean Desktop in Alfred" }));

    expect(createTerminal).not.toHaveBeenCalled();
    expect(within(queue).getByRole("button", { name: "Confirm relaunch Clean Desktop in Alfred" })).toBeInTheDocument();
    expect(within(tile).getByRole("button", { name: "Confirm relaunch Clean Desktop" })).toBeInTheDocument();
  });

  it("dismisses restored sessions from the recovery queue", async () => {
    const { forgetTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "manual-9",
          title: "Manual · zsh 9",
          cwd: "/repo",
          source: "manual",
          shell: "/bin/zsh",
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    expect(await screen.findByRole("button", { name: "Open review queue, 1 item" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Review and recovery context" })).toHaveTextContent("Manual · zsh 9");

    await userEvent.click(screen.getByRole("button", { name: "Open review queue, 1 item" }));
    const queue = screen.getByRole("dialog", { name: "Review queue" });

    await userEvent.click(within(queue).getByRole("button", { name: "Discard Manual · zsh 9 from Alfred" }));

    expect(screen.queryByRole("article", { name: /Manual · zsh 9/i })).not.toBeInTheDocument();
    expect(forgetTerminal).toHaveBeenCalledWith({ clientId: "manual-9", cleanupWorktree: true });
  });

  it("labels isolated recovery cleanup as discard checkout for legacy worktree snapshots and keeps forget wired", async () => {
    const user = userEvent.setup();
    const { forgetTerminal, worktreeDiff } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "codex-9",
          title: "Codex · session 9",
          cwd: "/repo/.worktrees/codex-9",
          baseCwd: "/repo",
          branchName: "alfred-codex-9",
          source: "alfred",
          agentKind: "codex",
          command: "codex",
          args: [],
          shell: "codex",
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    expect(await screen.findByRole("article", { name: /Codex · session 9/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard checkout Codex · session 9" }));

    expect(worktreeDiff).toHaveBeenCalledWith({ clientId: "codex-9" });
    const discardDialog = screen.getByRole("dialog", { name: "Discard isolated checkout" });
    expect(discardDialog).toHaveTextContent("2 changed files");
    expect(forgetTerminal).not.toHaveBeenCalled();

    await user.click(within(discardDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Discard isolated checkout" })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Codex · session 9/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard checkout Codex · session 9" }));
    await user.click(await screen.findByRole("button", { name: "Discard checkout permanently" }));

    expect(screen.queryByRole("article", { name: /Codex · session 9/i })).not.toBeInTheDocument();
    expect(forgetTerminal).toHaveBeenCalledWith({ clientId: "codex-9", cleanupWorktree: true });
  });

  it("preserves legacy isolated checkout metadata when resuming a restored agent session", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "codex-9",
          title: "Codex · session 9",
          cwd: "/.alfred-worktrees/repo/alfred-codex-9",
          baseCwd: "/repo",
          branchName: "alfred-codex-9",
          source: "alfred",
          agentKind: "codex",
          command: "codex",
          args: [],
          shell: "codex",
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    expect(await screen.findByRole("article", { name: /Codex · session 9/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resume latest Codex conversation Codex · session 9" }));

    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          baseCwd: "/repo",
          branchName: "alfred-codex-9",
          clientId: "codex-9",
          cwd: "/.alfred-worktrees/repo/alfred-codex-9",
          isolation: "worktree",
        }),
      );
    });
  });

  it("keeps explicitly shared restored sessions shared when stale checkout metadata exists", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "codex-shared",
          title: "Codex · shared session",
          cwd: "/repo",
          baseCwd: "/repo",
          branchName: "alfred-codex-stale",
          isolation: "shared",
          source: "alfred",
          agentKind: "codex",
          command: "codex",
          args: [],
          shell: "codex",
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    expect(await screen.findByRole("article", { name: /Codex · shared session/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard checkout Codex · shared session" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resume latest Codex conversation Codex · shared session" }));

    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: "codex-shared",
          cwd: "/repo",
          isolation: "shared",
        }),
      );
    });
    const request = createTerminal.mock.calls.find(([call]) => call.clientId === "codex-shared")?.[0];
    expect(request).not.toMatchObject({ isolation: "worktree" });
    expect(request).not.toHaveProperty("branchName");
    expect(request).not.toHaveProperty("baseCwd");
  });

  it("keeps shared recovery cleanup generic", async () => {
    const user = userEvent.setup();
    const { forgetTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "codex-9",
          title: "Codex · session 9",
          cwd: "/repo",
          source: "alfred",
          agentKind: "codex",
          command: "codex",
          args: [],
          isolation: "shared",
          shell: "codex",
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    expect(await screen.findByRole("article", { name: /Codex · session 9/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard checkout Codex · session 9" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard Codex · session 9" }));

    expect(screen.queryByRole("article", { name: /Codex · session 9/i })).not.toBeInTheDocument();
    expect(forgetTerminal).toHaveBeenCalledWith({ clientId: "codex-9", cleanupWorktree: true });
  });

  it("dismisses all recoverable sessions from the command palette", async () => {
    const user = userEvent.setup();
    const { forgetTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "manual-9",
          title: "Manual · zsh 9",
          cwd: "/repo",
          source: "manual",
          shell: "/bin/zsh",
          buffer: "saved output\n",
        },
        {
          clientId: "codex-9",
          title: "Codex · session 9",
          cwd: "/repo",
          source: "manual",
          agentKind: "codex",
          command: "codex",
          args: [],
          shell: "codex",
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    expect(await screen.findByRole("button", { name: "Open review queue, 2 items" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Session recovery" })).toHaveTextContent("2 saved sessions ready");

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "dismiss saved{Enter}");

    expect(screen.queryByRole("article", { name: /Manual · zsh 9/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /Codex · session 9/i })).not.toBeInTheDocument();
    expect(forgetTerminal).toHaveBeenCalledWith({ clientId: "manual-9", cleanupWorktree: true });
    expect(forgetTerminal).toHaveBeenCalledWith({ clientId: "codex-9", cleanupWorktree: true });
  });

  it("keeps the workspace recovery strip contextual and uses the top review queue for recovery", async () => {
    const { createTerminal, forgetTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "manual-9",
          title: "Manual · zsh 9",
          cwd: "/repo",
          source: "manual",
          shell: "/bin/zsh",
          buffer: "saved output\n",
        },
        {
          clientId: "codex-9",
          title: "Codex · session 9",
          cwd: "/repo",
          source: "manual",
          agentKind: "codex",
          command: "codex",
          args: [],
          shell: "codex",
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    expect(await screen.findByRole("button", { name: "Open review queue, 2 items" })).toBeInTheDocument();
    const recovery = screen.getByRole("region", { name: "Session recovery" });
    expect(recovery).toHaveTextContent("2 saved sessions ready");
    expect(recovery).toHaveTextContent("2 saved");
    expect(within(recovery).queryByRole("button")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open review queue, 2 items" }));
    const queue = screen.getByRole("dialog", { name: "Review queue" });
    expect(queue).toHaveTextContent("Manual · zsh 9");
    expect(queue).toHaveTextContent("Codex · session 9");
    await userEvent.click(within(queue).getByRole("button", { name: "Resume latest Codex · session 9 in Alfred" }));

    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: "codex-9", command: "codex", args: ["resume", "--last"] }),
      );
    });
    expect(forgetTerminal).not.toHaveBeenCalled();
  });

  it("shows recovery as a desk ribbon and keeps Review as the primary global decision entry", async () => {
    installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "manual-9",
          title: "Manual · zsh 9",
          cwd: "/repo",
          source: "manual",
          shell: "/bin/zsh",
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    expect(await screen.findByLabelText("Session recovery")).toHaveTextContent("saved session");
    expect(screen.getByRole("button", { name: "Open review queue, 1 item" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: /alfred status/i })).toBeInTheDocument();
  });

  it("relaunches saved sessions from the command palette", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "manual-9",
          title: "Manual · zsh 9",
          cwd: "/repo",
          source: "manual",
          shell: "/bin/zsh",
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    expect(await screen.findByRole("region", { name: "Session recovery" })).toHaveTextContent("1 saved session ready");

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "relaunch saved{Enter}");

    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({ clientId: "manual-9" }));
    });
  });

  it("keeps restored transcripts recoverable when relaunch all cannot start a process", async () => {
    const { createTerminal, forgetTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "manual-9",
          title: "Manual · zsh 9",
          cwd: "/repo",
          source: "manual",
          shell: "/bin/zsh",
          buffer: "saved output\n",
        },
        {
          clientId: "manual-10",
          title: "Manual · zsh 10",
          cwd: "/repo",
          source: "manual",
          shell: "/bin/zsh",
          buffer: "second output\n",
        },
      ],
    );
    createTerminal.mockRejectedValue(new Error("spawn failed"));

    render(<App />);

    expect(await screen.findByRole("button", { name: "Open review queue, 2 items" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open review queue, 2 items" }));
    await userEvent.click(screen.getByRole("button", { name: "Relaunch Manual · zsh 9 in Alfred" }));

    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({ clientId: "manual-9" }));
    });
    expect(screen.getByRole("button", { name: "Open review queue, 2 items" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open review queue, 2 items" }));
    const reopenedQueue = screen.getByRole("dialog", { name: "Review queue" });
    expect(reopenedQueue).toHaveTextContent("Manual · zsh 9");
    expect(reopenedQueue).toHaveTextContent("Manual · zsh 10");
    expect(forgetTerminal).not.toHaveBeenCalled();
  });

  it("does not duplicate a restored staged tile that is already live", async () => {
    const stagedPlan: AlfredStagedPlanSnapshot = {
      id: "plan-restore",
      prompt: "restore this plan",
      sessions: [
        { id: "alfred-7", kind: "shell", title: "Restored shell", command: "echo", args: ["ok"] },
      ],
    };
    const liveSnapshot: TerminalSessionSnapshot = {
      id: "runtime-7",
      clientId: "alfred-7",
      title: "Restored shell",
      source: "alfred",
      agentKind: "shell",
      cwd: "/tmp",
      shell: "zsh",
      command: "echo",
      args: ["ok"],
      buffer: "already running",
    };
    const { resolveStagedPlan } = installDesktopBridge(undefined, stagedPlan, [liveSnapshot]);

    render(<App />);

    await waitFor(() => {
      expect(resolveStagedPlan).toHaveBeenCalledWith({ sessionIds: ["alfred-7"] });
    });
    expect(screen.queryByRole("article", { name: /Staged Restored shell/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Resolve the current Alfred plan")).not.toBeInTheDocument();
  });

  it("blocks a second Alfred prompt while staged tiles exist", async () => {
    const user = userEvent.setup();
    const { requestPlan } = installDesktopBridge();

    render(<App />);

    const composer = screen.getByLabelText("Alfred prompt");
    const send = screen.getByRole("button", { name: "Send prompt to Alfred" });

    await user.type(composer, "first");
    await user.click(send);
    await screen.findByRole("article", { name: /Staged Task A/i });

    await user.type(composer, "second");
    await user.click(send);

    expect(requestPlan).toHaveBeenCalledOnce();
    expect(send).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Resolve the current Alfred plan");
  });

  it("does not send whitespace-only Alfred prompts", async () => {
    const user = userEvent.setup();
    const { requestPlan } = installDesktopBridge();

    render(<App />);

    const composer = screen.getByLabelText("Alfred prompt");
    const send = screen.getByRole("button", { name: "Send prompt to Alfred" });

    expect(send).toBeDisabled();
    await user.type(composer, "   ");

    expect(send).toBeDisabled();
    await user.keyboard("{Control>}{Enter}{/Control}");
    await user.click(send);

    expect(requestPlan).not.toHaveBeenCalled();
  });

  it("unlocks Alfred after rejecting the staged plan", async () => {
    const user = userEvent.setup();
    const { clearStagedPlan, requestPlan } = installDesktopBridge();

    render(<App />);

    const composer = screen.getByLabelText("Alfred prompt");
    const send = screen.getByRole("button", { name: "Send prompt to Alfred" });

    await user.type(composer, "first");
    await user.click(send);
    await screen.findByRole("article", { name: /Staged Task A/i });

    await user.click(screen.getByRole("button", { name: "Clear staged plan from review queue" }));
    await user.type(composer, "second after reject");
    await user.click(send);

    expect(requestPlan).toHaveBeenCalledTimes(2);
    expect(clearStagedPlan).toHaveBeenCalledOnce();
  });

  it("resolves a staged tile after approval starts its terminal", async () => {
    const user = userEvent.setup();
    const { resolveStagedPlan } = installDesktopBridge();

    render(<App />);

    await user.type(screen.getByLabelText("Alfred prompt"), "start one");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));
    await screen.findByRole("article", { name: /Staged Task A/i });

    await user.click(screen.getByRole("button", { name: "Launch Task A" }));

    await waitFor(() => {
      expect(resolveStagedPlan).toHaveBeenCalledWith({ sessionIds: ["alfred-1"] });
    });
  });

  it("launches safe staged tiles while unsafe tiles remain staged", async () => {
    const user = userEvent.setup();
    const { clearStagedPlan, resolveStagedPlan } = installDesktopBridge({
      ok: true,
      plan: {
        name: "Mixed launch plan",
        sessions: [
          {
            kind: "shell",
            title: "Safe task",
            command: "pnpm",
            args: ["test"],
          },
          {
            kind: "shell",
            title: "Risky task",
            command: "rm",
            args: ["-rf", "dist"],
            safetyNote: "rm -rf detected",
          },
        ],
      },
    });

    render(<App />);

    await user.type(screen.getByLabelText("Alfred prompt"), "stage mixed launch");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));

    expect(await screen.findByRole("article", { name: /Staged Safe task/i })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Staged Risky task/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Launch queue" }));

    await waitFor(() => {
      expect(resolveStagedPlan).toHaveBeenCalledWith({ sessionIds: ["alfred-1"] });
    });
    expect(screen.queryByRole("article", { name: /Staged Safe task/i })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Safe task/i })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Staged Risky task/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Alfred review queue" })).toHaveTextContent("0 safe · 0 flagged · 1 blocked");
    expect(clearStagedPlan).not.toHaveBeenCalled();
  });

  it("keeps preflight-blocked staged tiles queued while launching ready tiles", async () => {
    const user = userEvent.setup();
    const { createTerminal, resolveStagedPlan } = installDesktopBridge({
      ok: true,
      plan: {
        name: "Preflight plan",
        sessions: [
          {
            kind: "shell",
            title: "Safe task",
            command: "pnpm",
            args: ["test"],
            launchPreflight: {
              status: "ready",
              label: "Ready",
              detail: "Will launch in the selected workspace.",
              isolation: "shared",
            },
          },
          {
            kind: "codex",
            title: "Blocked Codex",
            command: "codex",
            args: [],
            launchPreflight: {
              status: "blocked",
              code: "git_not_ready",
              label: "Git not ready",
              reason: "Workspace has uncommitted or untracked changes.",
            },
          },
        ],
      },
    });

    render(<App />);

    await user.type(screen.getByLabelText("Alfred prompt"), "stage preflight");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));

    expect(await screen.findByRole("article", { name: /Staged Safe task/i })).toHaveTextContent("normal workspace");
    const blocked = screen.getByRole("article", { name: /Staged Blocked Codex/i });
    expect(blocked).toHaveTextContent("Launch blocked: Workspace has uncommitted or untracked changes.");
    expect(screen.getByRole("region", { name: "Alfred review queue" })).toHaveTextContent("1 safe · 0 flagged · 1 blocked");
    expect(screen.getByRole("button", { name: "Launch blocked: Blocked Codex" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Launch queue" }));

    await waitFor(() => {
      expect(resolveStagedPlan).toHaveBeenCalledWith({ sessionIds: ["alfred-1"] });
    });
    expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({ clientId: "alfred-1" }));
    expect(createTerminal).not.toHaveBeenCalledWith(expect.objectContaining({ clientId: "alfred-2" }));
    expect(screen.queryByRole("article", { name: /Staged Safe task/i })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Staged Blocked Codex/i })).toBeInTheDocument();
  });

  it("launches a preflighted worktree branch for staged coding agents", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge({
      ok: true,
      plan: {
        name: "Worktree plan",
        sessions: [
          {
            kind: "codex",
            title: "Codex task",
            command: "codex",
            args: [],
            launchPreflight: {
              status: "ready",
              label: "Worktree ready",
              detail: "Will create an isolated Git worktree on launch.",
              isolation: "worktree",
              branchName: "alfred-codex-preflight",
              baseCwd: "/repo",
              cwd: "/.alfred-worktrees/repo/alfred-codex-preflight",
            },
          },
        ],
      },
    });

    render(<App />);

    await user.type(screen.getByLabelText("Alfred prompt"), "stage codex");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));
    await screen.findByText("isolated checkout: alfred-codex-preflight");

    await user.click(screen.getByRole("button", { name: "Launch Codex task" }));

    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          branchName: "alfred-codex-preflight",
          clientId: "alfred-1",
          command: "codex",
          isolation: "worktree",
        }),
      );
    });
  });

  it("does not reuse a one-shot preflight branch after a failed staged start", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge({
      ok: true,
      plan: {
        name: "Worktree retry plan",
        sessions: [
          {
            kind: "codex",
            title: "Codex task",
            command: "codex",
            args: [],
            launchPreflight: {
              status: "ready",
              label: "Worktree ready",
              detail: "Will create an isolated Git worktree on launch.",
              isolation: "worktree",
              branchName: "alfred-codex-preflight",
              baseCwd: "/repo",
              cwd: "/.alfred-worktrees/repo/alfred-codex-preflight",
            },
          },
        ],
      },
    });
    let codexAttempts = 0;
    createTerminal.mockImplementation((request: Parameters<TerminalApi["create"]>[0]) => {
      if (request.clientId === "alfred-1" && codexAttempts === 0) {
        codexAttempts += 1;
        return Promise.reject(new Error("spawn failed after worktree creation"));
      }
      if (request.clientId === "alfred-1") codexAttempts += 1;

      const baseCwd = request.cwd ?? "/tmp";
      const branchName =
        request.isolation === "worktree"
          ? request.branchName ?? `alfred-${request.agentKind ?? "agent"}-${request.clientId ?? "session"}`
          : undefined;
      const cwd = branchName ? `${baseCwd}/.alfred-worktrees/${branchName}` : baseCwd;

      return Promise.resolve({
        id: `runtime-${request.clientId ?? "manual"}`,
        clientId: request.clientId ?? "manual-1",
        title: request.title ?? "Manual · zsh 1",
        source: request.source ?? "manual",
        workspaceId: request.workspaceId ?? "A",
        cwd,
        shell: "bash",
        ...(request.agentKind === undefined ? {} : { agentKind: request.agentKind }),
        ...(request.isolation === undefined ? {} : { isolation: request.isolation }),
        ...(branchName === undefined ? {} : { branchName, baseCwd }),
        ...(request.command === undefined ? {} : { command: request.command }),
        ...(request.args === undefined ? {} : { args: request.args }),
      });
    });

    render(<App />);

    await user.type(screen.getByLabelText("Alfred prompt"), "stage codex");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));
    const tile = await screen.findByRole("article", { name: /Staged Codex task/i });
    await screen.findByText("isolated checkout: alfred-codex-preflight");

    await user.click(within(tile).getByRole("button", { name: "Launch Codex task" }));

    await waitFor(() => {
      const codexCalls = createTerminal.mock.calls.filter(([request]) => request.clientId === "alfred-1");
      expect(codexCalls).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryByText("isolated checkout: alfred-codex-preflight")).not.toBeInTheDocument();
    });

    await user.click(
      within(screen.getByRole("article", { name: /Staged Codex task/i })).getByRole("button", {
        name: "Launch Codex task",
      }),
    );

    await waitFor(() => {
      const codexCalls = createTerminal.mock.calls.filter(([request]) => request.clientId === "alfred-1");
      expect(codexCalls).toHaveLength(2);
    });
    const codexCalls = createTerminal.mock.calls
      .map(([request]) => request)
      .filter((request) => request.clientId === "alfred-1");

    expect(codexCalls[0]).toMatchObject({ branchName: "alfred-codex-preflight", isolation: "worktree" });
    expect(codexCalls[1]).toMatchObject({ isolation: "worktree" });
    expect(codexCalls[1]?.branchName).toBeUndefined();
  });

  it("keeps a safe staged tile queued when its terminal fails to start", async () => {
    const user = userEvent.setup();
    const { createTerminal, resolveStagedPlan } = installDesktopBridge({
      ok: true,
      plan: {
        name: "Mixed launch plan",
        sessions: [
          {
            kind: "shell",
            title: "Safe task",
            command: "pnpm",
            args: ["test"],
          },
          {
            kind: "shell",
            title: "Risky task",
            command: "rm",
            args: ["-rf", "dist"],
            safetyNote: "rm -rf detected",
          },
        ],
      },
    });
    createTerminal.mockImplementation((request: Parameters<TerminalApi["create"]>[0]) => {
      if (request.clientId === "alfred-1") {
        return Promise.reject(new Error("spawn failed"));
      }

      return Promise.resolve({
        id: `runtime-${request.clientId ?? "manual"}`,
        clientId: request.clientId ?? "manual-1",
        title: request.title ?? "Manual · zsh 1",
        source: request.source ?? "manual",
        workspaceId: request.workspaceId ?? "A",
        cwd: request.cwd ?? "/tmp",
        shell: "bash",
        ...(request.agentKind === undefined ? {} : { agentKind: request.agentKind }),
        ...(request.command === undefined ? {} : { command: request.command }),
        ...(request.args === undefined ? {} : { args: request.args }),
      });
    });

    render(<App />);

    await user.type(screen.getByLabelText("Alfred prompt"), "stage mixed launch");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));
    await screen.findByRole("article", { name: /Staged Safe task/i });

    await user.click(screen.getByRole("button", { name: "Launch queue" }));

    await waitFor(() => {
      expect(screen.getByRole("article", { name: /Staged Safe task/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("article", { name: /Staged Risky task/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Alfred review queue" })).toHaveTextContent("1 safe · 0 flagged");
    expect(resolveStagedPlan).not.toHaveBeenCalledWith({ sessionIds: ["alfred-1"] });
  });

  it("blocks unsafe staged tiles until they are edited or discarded", async () => {
    const user = userEvent.setup();
    const { resolveStagedPlan } = installDesktopBridge({
      ok: true,
      plan: {
        name: "Unsafe plan",
        sessions: [
          {
            kind: "shell",
            title: "Risky task",
            command: "rm",
            args: ["-rf", "dist"],
            safetyNote: "rm -rf detected",
          },
        ],
      },
    });

    render(<App />);

    await user.type(screen.getByLabelText("Alfred prompt"), "stage risky cleanup");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));
    await screen.findByRole("article", { name: /Staged Risky task/i });

    expect(screen.getByRole("button", { name: "Launch blocked: Risky task" })).toBeDisabled();
    expect(screen.getByRole("article", { name: /Staged Risky task/i })).toHaveTextContent("rm -rf detected");
    expect(resolveStagedPlan).not.toHaveBeenCalled();
  });

  it("keeps the draft when Alfred plan creation fails", async () => {
    const user = userEvent.setup();
    installDesktopBridge({
      ok: false,
      error: { code: "network", message: "OpenRouter is unreachable." },
    });

    render(<App />);

    const composer = screen.getByLabelText("Alfred prompt");
    await user.type(composer, "retry this plan");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("OpenRouter is unreachable.");
    expect(composer).toHaveValue("retry this plan");
  });
});
