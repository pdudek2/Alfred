import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app";
import { TerminalDesk } from "./components/TerminalDesk";
import type { SessionTile } from "./session-state";
import { alfredGraphiteTerminalProfile } from "./terminal-visual-profile";
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
  TerminalForgetResult,
  TerminalReconcileResult,
  TerminalSessionSnapshot,
} from "../shared/terminal-ipc";
import type { WorkspaceApi, WorkspaceStateSnapshot } from "../shared/workspace-ipc";
import type { ExternalSessionSummary, SessionsApi } from "../shared/sessions-ipc";
import type { DesktopPrivacySettings, DesktopSaveStatus, DesktopStateApi } from "../shared/desktop-state-ipc";
import { appendActivityEvent, type SessionActivityEvent } from "../shared/session-activity";

const { terminalConstructorOptions, terminalDisposeCalls, terminalFocusSessionIds } = vi.hoisted(() => ({
  terminalConstructorOptions: [] as unknown[],
  terminalDisposeCalls: [] as unknown[],
  terminalFocusSessionIds: [] as string[],
}));

const rendererStyles = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    element: HTMLElement | null = null;
    options: unknown;
    dispose = vi.fn(() => {
      terminalDisposeCalls.push(this.options);
      if (this.element) {
        this.element.textContent = "";
      }
    });
    focus = vi.fn(() => {
      const sessionId = this.element?.dataset.sessionId;
      if (sessionId) terminalFocusSessionIds.push(sessionId);
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
    write = vi.fn((data: string, callback?: () => void) => {
      this.element?.append(data);
      callback?.();
    });
    writeln = vi.fn((data = "") => {
      this.element?.append(`${data}\n`);
    });

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
  sessions?: SessionsApi;
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
  externalCodexSessions: ExternalSessionSummary[] = [],
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
  listExternalSessions: ReturnType<typeof vi.fn>;
  releaseListSnapshot: ReturnType<typeof vi.fn>;
  resolveExternalSession: ReturnType<typeof vi.fn>;
  readTranscriptPage: ReturnType<typeof vi.fn>;
  getSessionsDiagnostics: ReturnType<typeof vi.fn>;
  clearSessionsCaches: ReturnType<typeof vi.fn>;
  clearSavedTerminalData: ReturnType<typeof vi.fn>;
  getPrivacySettings: ReturnType<typeof vi.fn>;
  revealStateFile: ReturnType<typeof vi.fn>;
  retrySave: ReturnType<typeof vi.fn>;
  reconcileTerminal: ReturnType<typeof vi.fn>;
  snapshotTerminal: ReturnType<typeof vi.fn>;
  updatePrivacySettings: ReturnType<typeof vi.fn>;
  setTerminalSnapshots: (next: TerminalSessionSnapshot[]) => void;
  emitData: (event: TerminalDataEvent) => Promise<void>;
  emitExit: (event: TerminalExitEvent) => Promise<void>;
  emitSaveStatus: (status: DesktopSaveStatus) => Promise<void>;
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
          ? {
              ...workspace,
              rootPath: "/Users/patryk/TrustedWorkspace",
              rootStatus: undefined,
            }
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
  const listExternalSessions = vi.fn().mockImplementation((request: Parameters<SessionsApi["listExternalSessions"]>[0]) => {
    const limit = Math.min(Math.max(request.limit ?? 80, 1), 100);
    const cursorPrefix = "test-external-cursor:";
    const offset = request.cursor?.startsWith(cursorPrefix)
      ? Number.parseInt(request.cursor.slice(cursorPrefix.length), 10)
      : 0;
    const sessions = externalCodexSessions.slice(offset, offset + limit);
    const nextOffset = offset + sessions.length;
    return Promise.resolve({
      sessions,
      nextCursor: nextOffset < externalCodexSessions.length ? `${cursorPrefix}${nextOffset}` : null,
      total: externalCodexSessions.length,
    });
  });
  const readTranscriptPage = vi.fn().mockResolvedValue({ sessionKey: "test", blocks: [], nextCursor: null, revision: "", partial: false });
  const getSessionsDiagnostics = vi.fn().mockResolvedValue({ cachedSessionCount: 0, decodedTranscriptBytes: 0, summaryCount: 0, summaryBytes: 0 });
  const clearSessionsCaches = vi.fn().mockResolvedValue(undefined);
  const releaseListSnapshot = vi.fn().mockResolvedValue(undefined);
  const resolveExternalSession = vi.fn().mockImplementation(({ sessionKey }: { sessionKey: string }) => {
    const session = externalCodexSessions.find((candidate) => candidate.sessionKey === sessionKey);
    if (!session?.project.id) return Promise.resolve({ kind: "add-project" as const });
    return Promise.resolve({
      kind: "resume" as const,
      projectId: session.project.id,
      cwd: session.project.id === "A" ? "/Users/patryk/Desktop/Alfred" : "/Users/patryk/Desktop/IronLog",
      sessionId: session.contentSessionKey.replace("external-codex:", ""),
    });
  });
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
  const forgetTerminal = vi.fn(async () => ({ ok: true as const }));
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
  let terminalSnapshots = [...terminalSessions];
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
  const snapshotTerminal = vi.fn(async (request: { id: string }) => {
    const session = terminalSnapshots.find((candidate) => candidate.id === request.id);
    return session ?? null;
  });
  const reconcileTerminal = vi.fn(async (request: { id: string }): Promise<TerminalReconcileResult> => {
    const session = terminalSnapshots.find((candidate) => candidate.id === request.id);
    return session ? { state: "running", snapshot: session } : { state: "missing" };
  });
  const terminal: TerminalApi = {
    create: createTerminal,
    forget: forgetTerminal,
    kill: killTerminal,
    list: vi.fn().mockResolvedValue({ sessions: terminalSessions, restoredSessions: restoredTerminalSessions }),
    prepareLaunch,
    reconcile: reconcileTerminal,
    rename: renameTerminal,
    snapshot: snapshotTerminal,
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
    sessions: {
      listExternalSessions,
      releaseListSnapshot,
      resolveExternalSession,
      readTranscriptPage,
      getDiagnostics: getSessionsDiagnostics,
      clearCaches: clearSessionsCaches,
    },
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
    listExternalSessions,
    releaseListSnapshot,
    resolveExternalSession,
    readTranscriptPage,
    getSessionsDiagnostics,
    clearSessionsCaches,
    clearSavedTerminalData,
    getPrivacySettings,
    revealStateFile,
    retrySave,
    reconcileTerminal,
    snapshotTerminal,
    updatePrivacySettings,
    setTerminalSnapshots: (next: TerminalSessionSnapshot[]) => {
      terminalSnapshots = next;
    },
    emitData: async (event: TerminalDataEvent) => {
      await act(async () => {
        for (const listener of dataListeners) listener(event);
      });
    },
    emitExit: async (event: TerminalExitEvent) => {
      await act(async () => {
        for (const listener of exitListeners) listener(event);
      });
    },
    emitSaveStatus: async (status: DesktopSaveStatus) => {
      await act(async () => {
        for (const listener of saveStatusListeners) listener(status);
      });
    },
  };
}

function liveSnapshot(
  suffix: string,
  overrides: Partial<TerminalSessionSnapshot> = {},
): TerminalSessionSnapshot {
  return {
    id: `runtime-${suffix}`,
    clientId: suffix,
    title: `Codex · ${suffix}`,
    source: "manual",
    agentKind: "codex",
    workspaceId: "A",
    cwd: "/Users/patryk/Desktop/Alfred",
    createdAt: Date.now(),
    shell: "/bin/zsh",
    command: "codex",
    args: [],
    buffer: "",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  terminalConstructorOptions.length = 0;
  terminalDisposeCalls.length = 0;
  terminalFocusSessionIds.length = 0;
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.alfredDesktop;
});

function renderTerminalDeskForSessions(
  sessions: SessionTile[],
) {
  const callbacks = {
    onBindWorkspace: vi.fn(),
    onAddAgentSession: vi.fn(),
    onAddManualSession: vi.fn(),
    onApplyWorktree: vi.fn(),
    onCloseSession: vi.fn(),
    onContinueRestoredSession: vi.fn(),
    onOpenInbox: vi.fn(),
    onRestartSession: vi.fn(),
    onApplyWorkMode: vi.fn(),
    onMoveTile: vi.fn(),
    onRuntimeSessionFailed: vi.fn(),
    onRuntimeSessionExited: vi.fn(),
    onRuntimeSessionOutput: vi.fn(),
    onRuntimeSessionReplayBuffer: vi.fn(),
    onRuntimeSessionSnapshot: vi.fn(),
    onRuntimeSessionReady: vi.fn(),
    onRuntimeSessionStarting: vi.fn(() => true),
    onRuntimeSessionUnavailable: vi.fn(),
    onRenameSession: vi.fn(),
    onFocusSession: vi.fn(),
    onSelectSession: vi.fn(),
    onApproveTile: vi.fn(),
    onRejectTile: vi.fn(),
    onResizeTile: vi.fn(),
    onReviewWorktree: vi.fn(),
    onToggleCollapseSession: vi.fn(),
  };
  const renderDesk = (nextSessions: SessionTile[], arrangeMode = false) => (
    <TerminalDesk
      activeWorkspaceId="A"
      arrangeMode={arrangeMode}
      armedRecoverySessionIds={new Set()}
      collapsedSessionIds={new Set()}
      layouts={{}}
      recoverableSessions={[]}
      selectedSessionId={nextSessions[0]?.id ?? null}
      sessions={nextSessions}
      surfaceActive
      workMode="desk"
      worktreeActionPending={{}}
      workspaceGitBranch="main"
      workspaceLabel="Alfred"
      workspaceRootPath="/Users/patryk/Desktop/Alfred"
      {...callbacks}
    />
  );

  return {
    ...render(renderDesk(sessions)),
    callbacks,
    renderDesk,
  };
}

async function openInboxFromCommandPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Open command palette" }));
  await submitCommandPalette(user, "open inbox");
  await waitFor(() => {
    expect(screen.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
  });
}

async function openPrepareWork(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Open launch menu" }));
  await user.click(screen.getByRole("menuitem", { name: "Prepare Work" }));
  return screen.getByTestId("dispatch-bar");
}

async function selectSurface(user: ReturnType<typeof userEvent.setup>, label: "Work" | "Sessions" | "Context" | "Local Data & Privacy") {
  await user.click(screen.getByRole("button", { name: "Open Surfaces menu" }));
  await user.click(screen.getByRole("menuitem", { name: label }));
}

async function chooseWorkLayout(
  user: ReturnType<typeof userEvent.setup>,
  item: "Focus" | "Split" | "Grid" | "Arrange",
): Promise<void> {
  await user.click(screen.getByRole("button", { name: /Open layout menu/ }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

async function submitCommandPalette(user: ReturnType<typeof userEvent.setup>, query: string) {
  const search = screen.getByRole("textbox", { name: "Search commands" });
  await user.type(search, query);
  await pressCommandPaletteEnter(search);
}

async function pressCommandPaletteEnter(search: HTMLElement) {
  await act(async () => {
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  });
}

async function waitForTerminalStartsToSettle() {
  await waitFor(() => {
    expect(document.querySelectorAll('[aria-label="status starting"]')).toHaveLength(0);
  });
}

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
    expect(screen.getByRole("button", { name: "Open launch menu" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /terminals/i })).toBeInTheDocument();
    expect(screen.getByTestId("context-column")).toHaveClass("closed");
  });

  it("renders Prepare Work only on demand and restores focus to its launch trigger", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("region", { name: /terminals/i })).toBeInTheDocument();
    expect(screen.getByTestId("context-column")).toHaveClass("closed");
    expect(screen.queryByTestId("primary-nav-rail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dispatch-bar")).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "Open launch menu" });
    const dispatch = await openPrepareWork(user);
    expect(dispatch).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Dispatch instruction" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("dispatch-bar")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps Focus active when Prepare Work handles Escape", async () => {
    const user = userEvent.setup();
    installDesktopBridge(undefined, null, [liveSnapshot("one"), liveSnapshot("two")]);

    render(<App />);

    await screen.findByRole("button", { name: /Open layout menu/ });
    await chooseWorkLayout(user, "Focus");
    const focus = screen.getByRole("button", { name: "Open layout menu, Focus selected" });
    expect(focus).toBeInTheDocument();

    const launchTrigger = screen.getByRole("button", { name: "Open launch menu" });
    launchTrigger.focus();
    await user.keyboard("{Enter}");
    const prepareWorkItem = screen.getByRole("menuitem", { name: "Prepare Work" });
    await waitFor(() => expect(prepareWorkItem).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(screen.getByRole("textbox", { name: "Dispatch instruction" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Prepare Work" })).not.toBeInTheDocument();
    expect(launchTrigger).toHaveFocus();
    expect(focus).toBeInTheDocument();
    const visibleTiles = screen.getAllByTestId("terminal-tile").filter(
      (tile) => tile.getAttribute("aria-hidden") !== "true",
    );
    expect(visibleTiles).toHaveLength(1);
  });

  it("renders the clean depth shell regions around the live terminal workbench", async () => {
    installDesktopBridge();
    render(<App />);

    expect(await screen.findByTestId("project-navigator")).toBeInTheDocument();
    expect(screen.queryByTestId("primary-nav-rail")).not.toBeInTheDocument();
    const workbenchSurface = screen.getByTestId("workbench-surface");
    const workbenchHeader = screen.getByTestId("workbench-header");
    expect(workbenchSurface).toBeInTheDocument();
    expect(workbenchHeader).toBeInTheDocument();
    expect(document.querySelector(".mission-bar")).toContainElement(workbenchHeader);
    expect(workbenchSurface).not.toContainElement(workbenchHeader);
    expect(screen.getByTestId("context-column")).toBeInTheDocument();
    expect(screen.getByTestId("desk-runtime-surface")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-grid")).toBeInTheDocument();
  });

  it("rehomes all primary destinations in the frozen top bar", async () => {
    const user = userEvent.setup();
    installDesktopBridge();
    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Open Inbox surface/i }));
    expect(screen.getByRole("region", { name: "Inbox workspace" })).toBeVisible();

    await selectSurface(user, "Work");
    expect(screen.getByTestId("workbench-shell")).toHaveClass("surface-work");

    await selectSurface(user, "Sessions");
    expect(screen.getByRole("region", { name: "Sessions workspace" })).toBeVisible();

    await selectSurface(user, "Context");
    expect(screen.getByTestId("context-drawer")).toHaveClass("open");

    await selectSurface(user, "Local Data & Privacy");
    expect(screen.getByRole("dialog", { name: "Local Data & Privacy" })).toBeInTheDocument();
  });

  it("places projects and active sessions inside the project navigator", async () => {
    installDesktopBridge();
    render(<App />);

    const panel = await screen.findByTestId("project-navigator");
    expect(within(panel).getByText("Projects")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    expect(within(panel).getByRole("tablist", { name: /workspaces/i })).toBeInTheDocument();
    expect(within(panel).queryByText("Inbox")).not.toBeInTheDocument();
  });

  it("keeps Recovery out of the project signal and blocking Inbox count", async () => {
    installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "codex-restored",
          title: "Codex · restored",
          cwd: "/Users/patryk/Desktop/Alfred",
          source: "alfred",
          agentKind: "codex",
          command: "codex",
          shell: "codex",
          buffer: "saved output\n",
        },
      ],
    );
    render(<App />);

    const panel = await screen.findByTestId("project-navigator");
    expect(within(panel).getByRole("tab", { name: "Alfred workspace" })).not.toHaveAttribute("data-attention");
    expect(screen.getByRole("button", { name: "Open Inbox surface" })).not.toHaveTextContent("1");
  });

  it("keeps the project heading free of count badges", async () => {
    installDesktopBridge();
    render(<App />);

    const panel = await screen.findByTestId("project-navigator");
    expect(within(panel).getByText("Projects")).toHaveTextContent("Projects");
    expect(within(panel).queryByText(/Projects \d/)).not.toBeInTheDocument();
  });

  it("keeps project rows free of attention markers when the review queue is clear", async () => {
    installDesktopBridge();
    render(<App />);

    const panel = await screen.findByTestId("project-navigator");
    expect(within(panel).getByRole("tab", { name: /Alfred workspace/i })).not.toHaveAttribute("data-attention");
    expect(panel.querySelector(".project-attention-signal")).toBeNull();
  });

  it("does not render an empty Free Chats section when there are no scratch chats", async () => {
    installDesktopBridge();
    render(<App />);

    expect(await screen.findByRole("navigation", { name: "Projects and Free Chats" })).toBeInTheDocument();
    expect(screen.queryByText("Free Chats")).not.toBeInTheDocument();
    expect(screen.queryByText("No scratch chats yet.")).not.toBeInTheDocument();
  });

  it("opens a free chat in its own workspace from the workspace navigation panel", async () => {
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
          id: "runtime-scratch",
          clientId: "scratch-client",
          title: "Scratch API worker",
          source: "manual",
          workspaceId: "CLIENT",
          cwd: "/Users/patryk/Documents/Codex/scratch-api-worker",
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

    const panel = await screen.findByTestId("project-navigator");
    expect(within(panel).getByRole("group", { name: "Free Chats" })).toBeInTheDocument();
    expect(within(panel).queryByText(/~\/Documents\/Codex\//)).not.toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: /Scratch API worker/i }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /ClientApp workspace/i })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Scratch API worker");
    expect(setWorkspaceViewState).toHaveBeenLastCalledWith({
      workspaceId: "CLIENT",
      viewState: { workMode: "focus", selectedSessionId: "scratch-client" },
    });
    expect(setWorkspaceLayout).toHaveBeenLastCalledWith({
      workspaceId: "CLIENT",
      layouts: expect.objectContaining({
        "scratch-client": expect.objectContaining({ col: 1, colSpan: 12 }),
      }),
    });
  });

  it("collapses long empty workspace lists behind an explicit expansion", async () => {
    const user = userEvent.setup();
    installDesktopBridge(undefined, null, [], undefined, undefined, {
      workspaces: Array.from({ length: 14 }, (_, index) => ({
        id: `W${index + 1}`,
        label: `Workspace ${index + 1}`,
        shortLabel: `W${index + 1}`,
      })),
      activeWorkspaceId: "W1",
    });

    render(<App />);

    expect(screen.queryByRole("tab", { name: /Workspace 14 workspace/i })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Show 9 more projects" }));
    expect(screen.getByRole("tab", { name: /Workspace 14 workspace/i })).toBeInTheDocument();
  });

  it("keeps five deterministic project destinations while preserving long accessible names", async () => {
    const longSessionTitle = "Manual session with a deliberately descriptive title exceeding sixty characters 1";
    const sixthLongSessionTitle = "Manual session with a deliberately descriptive title exceeding sixty characters 6";
    const workspaces = Array.from({ length: 7 }, (_, index) => ({
      id: `W${index + 1}`,
      label: `Workspace ${index + 1} with a deliberately descriptive label exceeding sixty characters`,
      shortLabel: `W${index + 1}`,
    }));
    installDesktopBridge(
      undefined,
      null,
      Array.from({ length: 6 }, (_, index) => liveSnapshot(`session-${index + 1}`, {
        title: index === 0
          ? longSessionTitle
          : `Manual session with a deliberately descriptive title exceeding sixty characters ${index + 1}`,
        workspaceId: "W1",
      })),
      undefined,
      undefined,
      { workspaces, activeWorkspaceId: "W1" },
    );

    render(<App />);

    const navigator = await screen.findByRole("navigation", { name: "Projects and Free Chats" });
    expect(within(navigator).getByRole("button", { name: longSessionTitle })).toHaveAccessibleName(longSessionTitle);
    expect(within(navigator).getByRole("button", { name: sixthLongSessionTitle })).toHaveAccessibleName(sixthLongSessionTitle);
    expect(within(navigator).getByRole("button", { name: "Show 2 more projects" })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-project-destination]")).toHaveLength(5);
    expect(screen.queryByText("Search sessions, chats, files")).not.toBeInTheDocument();
  });

  it("removes the Work project navigator from global Inbox and Sessions", async () => {
    const user = userEvent.setup();
    installDesktopBridge();
    render(<App />);

    expect(await screen.findByRole("navigation", {
      name: "Projects and Free Chats",
    })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /open inbox surface/i }));
    expect(screen.getByTestId("workbench-shell")).toHaveClass("surface-inbox");
    expect(screen.queryByRole("navigation", {
      name: "Projects and Free Chats",
    })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to Work" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Back to Work" }));
    expect(screen.getByRole("navigation", {
      name: "Projects and Free Chats",
    })).toBeInTheDocument();

    await selectSurface(user, "Sessions");
    expect(screen.getByTestId("workbench-shell")).toHaveClass("surface-sessions");
    expect(screen.queryByRole("navigation", { name: "Projects and Free Chats" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sessions workspace" })).toBeVisible();
  });

  it("unmounts Sessions on Escape and restores the previously focused Work target", async () => {
    const user = userEvent.setup();
    installDesktopBridge();
    render(<App />);

    const workTarget = await screen.findByRole("button", { name: "Manual · zsh 1" });
    workTarget.focus();
    expect(workTarget).toHaveFocus();

    await selectSurface(user, "Sessions");
    expect(screen.getByRole("searchbox", { name: "Search sessions" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("region", { name: "Sessions workspace" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Manual · zsh 1" })).toHaveFocus());
  });

  it("round-trips Sessions state without retaining its transcript DOM or remounting xterm", async () => {
    const user = userEvent.setup();
    installDesktopBridge(undefined, null, [liveSnapshot("round-trip", {
      title: "Round trip session",
      buffer: "round trip transcript\n",
    })]);
    render(<App />);

    const xtermHost = await screen.findByTestId("xterm-host");
    await selectSurface(user, "Sessions");
    const search = screen.getByRole("searchbox", { name: "Search sessions" });
    await user.type(search, "round trip");
    await user.click(await screen.findByRole("option", { name: /Round trip session/i }));
    const transcript = await screen.findByRole("article", { name: /Round trip session/i });
    const navigator = screen.getByRole("listbox", { name: "Conversation results" });
    const reader = document.querySelector<HTMLElement>(".sessions-reader__scroll");
    expect(reader).not.toBeNull();
    fireEvent.scroll(navigator, { target: { scrollTop: 37 } });
    fireEvent.scroll(reader!, { target: { scrollTop: 53 } });

    await user.keyboard("{Escape}");
    expect(transcript.isConnected).toBe(false);
    expect(screen.getByTestId("xterm-host")).toBe(xtermHost);

    await selectSurface(user, "Sessions");
    expect(screen.getByRole("searchbox", { name: "Search sessions" })).toHaveValue("round trip");
    const restoredTranscript = screen.getByRole("article", { name: /Round trip session/i });
    expect(restoredTranscript).not.toBe(transcript);
    expect(screen.getByRole("listbox", { name: "Conversation results" })).toHaveProperty("scrollTop", 37);
    expect(document.querySelector(".sessions-reader__scroll")).toHaveProperty("scrollTop", 53);
    expect(screen.getByTestId("xterm-host")).toBe(xtermHost);
  });

  it("opens Local Data & Privacy controls from the command palette", async () => {
    const user = userEvent.setup();
    const { clearSavedTerminalData, revealStateFile, updatePrivacySettings } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.click(screen.getByRole("option", { name: /Local Data & Privacy/i }));

    const dialog = screen.getByRole("dialog", { name: "Local Data & Privacy" });
    expect(within(dialog).queryByText("Local controls")).not.toBeInTheDocument();
    expect(within(dialog).getByText(
      "Control what Alfred keeps on this Mac and which local Codex sessions appear in Sessions.",
    )).toBeVisible();
    expect(within(dialog).getByRole("switch", {
      name: "External Codex indexing",
    })).toBeChecked();
    expect(within(dialog).getByRole("button", {
      name: "Close privacy controls",
    })).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "Off" }));
    await waitFor(() => {
      expect(updatePrivacySettings).toHaveBeenCalledWith({
        terminalScrollbackRetention: "off",
        externalSessionIndexingEnabled: true,
      });
    });

    await user.click(within(dialog).getByRole("switch", { name: "External Codex indexing" }));
    await waitFor(() => {
      expect(updatePrivacySettings).toHaveBeenCalledWith({
        terminalScrollbackRetention: "off",
        externalSessionIndexingEnabled: false,
      });
    });

    expect(within(dialog).getByText(/This can't be undone\./)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Clear saved transcripts…" }));
    expect(within(dialog).getByRole("button", { name: "Keep data" })).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Clear saved transcripts" }));
    await waitFor(() => {
      expect(clearSavedTerminalData).toHaveBeenCalledTimes(1);
    });

    await user.click(within(dialog).getByRole("button", { name: "Reveal in Finder" }));
    expect(revealStateFile).toHaveBeenCalledTimes(1);
  });

  it("traps Privacy focus and restores its surviving trigger", async () => {
    const user = userEvent.setup();
    installDesktopBridge();
    render(<App />);

    const surfaces = screen.getByRole("button", { name: "Open Surfaces menu" });
    await user.click(surfaces);
    await user.click(screen.getByRole("menuitem", {
      name: "Local Data & Privacy",
    }));

    const dialog = screen.getByRole("dialog", { name: "Local Data & Privacy" });
    const close = within(dialog).getByRole("button", {
      name: "Close privacy controls",
    });
    await waitFor(() => expect(close).toHaveFocus());

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    expect(dialog).not.toBeInTheDocument();
    expect(surfaces).toHaveFocus();
  });

  it("keeps focus in Privacy while changing the clear confirmation", async () => {
    const user = userEvent.setup();
    installDesktopBridge();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.click(screen.getByRole("option", { name: /Local Data & Privacy/i }));

    const dialog = screen.getByRole("dialog", { name: "Local Data & Privacy" });
    const clear = within(dialog).getByRole("button", { name: "Clear saved transcripts…" });
    await user.click(clear);

    const keepData = within(dialog).getByRole("button", { name: "Keep data" });
    expect(keepData).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.click(keepData);
    const restoredClear = within(dialog).getByRole("button", { name: "Clear saved transcripts…" });
    await waitFor(() => expect(restoredClear).toHaveFocus());
  });

  it("keeps Privacy focus after clearing saved transcripts", async () => {
    const user = userEvent.setup();
    const { clearSavedTerminalData } = installDesktopBridge();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.click(screen.getByRole("option", { name: /Local Data & Privacy/i }));

    const dialog = screen.getByRole("dialog", { name: "Local Data & Privacy" });
    await user.click(within(dialog).getByRole("button", { name: "Clear saved transcripts…" }));
    await user.click(within(dialog).getByRole("button", { name: "Clear saved transcripts" }));

    await waitFor(() => expect(clearSavedTerminalData).toHaveBeenCalledOnce());
    expect(within(dialog).getByRole("status")).toHaveTextContent("Cleared saved data");
    const clear = within(dialog).getByRole("button", { name: "Clear saved transcripts…" });
    await waitFor(() => expect(clear).toHaveFocus());
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("does not refresh external Codex sessions when indexing is disabled", async () => {
    const user = userEvent.setup();
    const { listExternalSessions } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [],
      [
        {
          sessionKey: "external-codex:019edc4b-0000-7000-9000-disabled:200",
          lineageKey: "external-codex:019edc4b-0000-7000-9000-disabled",
          contentSessionKey: "external-codex:019edc4b-0000-7000-9000-disabled",
          source: "external-codex",
          kind: "codex",
          title: "Hidden external session",
          project: { id: "A", label: "Alfred" },
          locationLabel: "Alfred",
          updatedAt: 200,
          lifecycle: "resumable",
        },
      ],
      {
        terminalScrollbackRetention: "redactedTail",
        externalSessionIndexingEnabled: false,
      },
    );

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await selectSurface(user, "Sessions");

    expect(await screen.findByText("External Codex indexing is off.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh external sessions" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Open Local Data & Privacy" }));
    expect(screen.getByRole("dialog", { name: "Local Data & Privacy" })).toBeInTheDocument();
    expect(listExternalSessions).not.toHaveBeenCalled();
  });

  it("clears main sessions caches when external indexing is disabled without a refresh in flight", async () => {
    const user = userEvent.setup();
    const { clearSessionsCaches } = installDesktopBridge();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.click(screen.getByRole("option", { name: /Local Data & Privacy/i }));
    await user.click(screen.getByRole("switch", { name: "External Codex indexing" }));

    await waitFor(() => expect(clearSessionsCaches).toHaveBeenCalledOnce());
  });

  it("discards a late external sessions page after indexing is disabled", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ sessions: ExternalSessionSummary[]; nextCursor: null; total: number }>();
    const { listExternalSessions } = installDesktopBridge();
    listExternalSessions
      .mockResolvedValueOnce({
        sessions: [{
          sessionKey: "external-codex:first-page",
          lineageKey: "external-codex:first-page",
          contentSessionKey: "external-codex:first-page",
          source: "external-codex",
          kind: "codex",
          title: "First external page",
          project: { id: "A", label: "Alfred" },
          locationLabel: "Alfred",
          updatedAt: 300,
          lifecycle: "resumable",
        }],
        nextCursor: "opaque-next-page",
        total: 2,
      })
      .mockImplementationOnce(() => pending.promise);

    render(<App />);
    await selectSurface(user, "Sessions");
    await waitFor(() => expect(listExternalSessions).toHaveBeenCalledTimes(2));
    expect(listExternalSessions).toHaveBeenLastCalledWith({
      projects: expect.any(Array),
      limit: 80,
      cursor: "opaque-next-page",
    });
    expect(await screen.findByRole("option", { name: /First external page/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.click(screen.getByRole("option", { name: /Local Data & Privacy/i }));
    await user.click(screen.getByRole("switch", { name: "External Codex indexing" }));

    await act(async () => {
      pending.resolve({
        sessions: [{
          sessionKey: "external-codex:stale",
          lineageKey: "external-codex:stale",
          contentSessionKey: "external-codex:stale",
          source: "external-codex",
          kind: "codex",
          title: "Stale external session",
          project: { id: "A", label: "Alfred" },
          locationLabel: "Alfred",
          updatedAt: 200,
          lifecycle: "resumable",
        }],
        nextCursor: null,
        total: 1,
      });
    });

    expect(await screen.findByText("External Codex indexing is off.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /First external page/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Stale external session/i })).not.toBeInTheDocument();
    expect(listExternalSessions).toHaveBeenCalledTimes(2);
  });

  it("shows a state-not-saved warning and retries the failed save", async () => {
    const user = userEvent.setup();
    const bridge = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await bridge.emitSaveStatus({ status: "saveFailed", message: "Failed to persist desktop state.", failedAt: 123 });

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("State not saved")).toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(bridge.retrySave).toHaveBeenCalledTimes(1);
  });

  it("keeps an open composer draft isolated while the command palette is open", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledTimes(1);
    });
    await screen.findByRole("tab", { name: "Alfred workspace" });

    const launchTrigger = screen.getByRole("button", { name: "Open launch menu" });
    const dispatch = await openPrepareWork(user);
    const composer = within(dispatch).getByRole("textbox", { name: "Dispatch instruction" });
    await user.type(composer, "keep this draft");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true }));
    });

    const palette = screen.getByRole("dialog", { name: "Command palette" });
    const search = within(palette).getByRole("textbox", { name: "Search commands" });
    expect(search).toHaveFocus();
    await waitFor(() => {
      expect(
        within(palette).getAllByRole("option").some((option) => option.getAttribute("aria-selected") === "true"),
      ).toBe(true);
    });
    await user.click(search);
    expect(search).toHaveFocus();
    expect(dispatch).toBeInTheDocument();
    expect(launchTrigger).not.toHaveFocus();
    expect(composer).toBeDisabled();
    expect(composer).toHaveValue("keep this draft");
    expect(createTerminal).toHaveBeenCalledTimes(1);

    await user.keyboard("{Control>}t{/Control}");
    await user.keyboard("{Meta>}t{/Meta}");
    expect(createTerminal).toHaveBeenCalledTimes(1);

    const enabledOptions = within(palette)
      .getAllByRole("option")
      .filter((option) => !(option as HTMLButtonElement).disabled);
    const lastEnabledOption = enabledOptions.at(-1);
    expect(lastEnabledOption).toBeInstanceOf(HTMLButtonElement);

    await user.tab({ shift: true });
    expect(lastEnabledOption).toHaveFocus();
    await user.tab();
    expect(search).toHaveFocus();

    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
      expect(screen.getByTestId("dispatch-bar")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Dispatch instruction" })).toBeEnabled();
    });
    const connectedComposer = screen.getByRole("textbox", { name: "Dispatch instruction" });
    expect(connectedComposer).toHaveFocus();
    expect(connectedComposer).toHaveValue("keep this draft");
    expect(launchTrigger).not.toHaveFocus();
  });

  it("keeps the xterm renderer mounted while moving from Work to Inbox and Sessions and back", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    const runtimeSurface = screen.getByTestId("desk-runtime-surface");
    const xtermHost = screen.getByTestId("xterm-host");
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledTimes(1);
    });
    await act(async () => {});
    const constructorCountBeforeSurfaceSwitch = terminalConstructorOptions.length;
    const disposeCountBeforeSurfaceSwitch = terminalDisposeCalls.length;

    await user.click(screen.getByRole("button", { name: /Open Inbox surface/i }));

    expect(await screen.findByRole("region", { name: "Inbox workspace" })).toBeInTheDocument();
    expect(runtimeSurface).toHaveAttribute("aria-hidden", "true");
    expect(xtermHost.isConnected).toBe(true);
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeSurfaceSwitch);

    await selectSurface(user, "Sessions");

    expect(await screen.findByRole("region", { name: "Sessions workspace" })).toBeInTheDocument();
    expect(xtermHost.isConnected).toBe(true);
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeSurfaceSwitch);

    await selectSurface(user, "Work");

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    expect(runtimeSurface).not.toHaveAttribute("aria-hidden");
    expect(xtermHost.isConnected).toBe(true);
    expect(terminalConstructorOptions).toHaveLength(constructorCountBeforeSurfaceSwitch);
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeSurfaceSwitch);
  });

  it("uses Context as a floating inspector and restores focus to Surfaces when it closes", async () => {
    const user = userEvent.setup();
    installDesktopBridge();
    render(<App />);

    const workbench = await screen.findByTestId("workbench-surface");
    expect(screen.getByTestId("context-column")).toHaveClass("closed");

    const surfacesTrigger = screen.getByRole("button", { name: "Open Surfaces menu" });
    await selectSurface(user, "Context");
    expect(screen.getByTestId("context-column")).toHaveClass("open");
    expect(workbench).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close context panel/i }));
    expect(screen.getByTestId("context-column")).toHaveClass("closed");
    await waitFor(() => expect(surfacesTrigger).toHaveFocus());
    expect(workbench).toBeInTheDocument();
  });

  it("lets the Command palette consume Escape before Context", async () => {
    const user = userEvent.setup();
    installDesktopBridge();
    render(<App />);

    await screen.findByTestId("project-navigator");
    await selectSurface(user, "Context");
    await user.click(screen.getByRole("button", { name: "Open command palette" }));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    expect(screen.getByTestId("context-column")).toHaveClass("open");
  });

  it("lets Prepare Work consume Escape before Context", async () => {
    const user = userEvent.setup();
    installDesktopBridge();
    render(<App />);

    await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await selectSurface(user, "Context");
    await openPrepareWork(user);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Prepare Work" })).not.toBeInTheDocument();
    expect(screen.getByTestId("context-column")).toHaveClass("open");
  });

  it("lets Privacy consume Escape before Context", async () => {
    const user = userEvent.setup();
    installDesktopBridge();
    render(<App />);

    await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await selectSurface(user, "Context");
    await selectSurface(user, "Local Data & Privacy");
    screen.getByRole("button", { name: "Close privacy controls" }).focus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Local Data & Privacy" })).not.toBeInTheDocument();
    expect(screen.getByTestId("context-column")).toHaveClass("open");
  });

  it("lets workspace actions consume Escape before Context", async () => {
    const user = userEvent.setup();
    installDesktopBridge();
    render(<App />);

    await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await selectSurface(user, "Context");
    await user.click(screen.getByRole("button", { name: "Workspace menu for Alfred" }));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Workspace actions" })).not.toBeInTheDocument();
    expect(screen.getByTestId("context-column")).toHaveClass("open");
  });

  it("keeps workspace navigation focus across a round trip to a workspace with open Context", async () => {
    const user = userEvent.setup();
    installDesktopBridge(undefined, null, [], undefined, undefined, {
      workspaces: [
        { id: "A", label: "Alfred", shortLabel: "A" },
        { id: "W2", label: "ClientApp", shortLabel: "CLI" },
      ],
      activeWorkspaceId: "A",
    });
    render(<App />);

    await screen.findByTestId("project-navigator");
    await selectSurface(user, "Context");
    const alfredWorkspace = screen.getByRole("tab", { name: "Alfred workspace" });
    const clientWorkspace = screen.getByRole("tab", { name: "ClientApp workspace" });

    await user.click(clientWorkspace);

    expect(screen.getByTestId("context-column")).toHaveClass("closed");
    await waitFor(() => expect(clientWorkspace).toHaveFocus());
    expect(screen.getByRole("button", { name: "Open Surfaces menu" })).not.toHaveFocus();

    await user.click(alfredWorkspace);

    expect(screen.getByTestId("context-column")).toHaveClass("open");
    await waitFor(() => expect(alfredWorkspace).toHaveFocus());
    expect(screen.getByRole("button", { name: "Close Context panel" })).not.toHaveFocus();
  });

  it("keeps every xterm host mounted when Focus hides non-selected terminal tiles", async () => {
    installDesktopBridge(
      undefined,
      null,
      [
        {
          id: "runtime-codex",
          clientId: "codex-a",
          title: "Codex · session A",
          source: "alfred",
          agentKind: "codex",
          workspaceId: "A",
          cwd: "/Users/patryk/Desktop/Alfred",
          shell: "codex",
          command: "codex",
          args: [],
          buffer: "codex output",
        },
        {
          id: "runtime-claude",
          clientId: "claude-a",
          title: "Claude · session A",
          source: "alfred",
          agentKind: "claude",
          workspaceId: "A",
          cwd: "/Users/patryk/Desktop/Alfred",
          shell: "claude",
          command: "claude",
          args: [],
          buffer: "claude output",
        },
      ],
      undefined,
      {
        layoutsByWorkspace: {},
        viewStateByWorkspace: {
          A: { workMode: "focus", selectedSessionId: "codex-a" },
        },
      },
    );

    render(<App />);

    expect(await screen.findByRole("button", { name: "Open layout menu, Focus selected" })).toBeInTheDocument();
    expect(screen.getByTestId("terminal-grid")).toBeInTheDocument();
    expect(screen.getAllByTestId("xterm-host")).toHaveLength(2);
    expect(screen.getAllByTestId("terminal-tile")).toHaveLength(2);
    expect(document.querySelectorAll(".terminal-tile.focus-hidden [data-testid='xterm-host']")).toHaveLength(1);
  });

  it("keeps xterm hosts mounted across Work, Inbox, Sessions, Context, and Focus", async () => {
    const user = userEvent.setup();
    const bridge = installDesktopBridge();
    render(<App />);

    const tile = await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await user.click(screen.getByRole("button", { name: "Open launch menu" }));
    await user.click(screen.getByRole("menuitem", { name: "New manual terminal" }));
    await screen.findByRole("article", { name: /Manual · zsh 2/i });
    const initialHosts = within(screen.getByTestId("desk-runtime-surface")).getAllByTestId("xterm-host");
    expect(initialHosts.length).toBeGreaterThan(0);
    const initialHost = initialHosts[0];
    expect(initialHost).toBeDefined();
    if (!initialHost) {
      throw new Error("Expected at least one xterm host in the desk runtime surface.");
    }
    const disposeCountBeforeTransitions = terminalDisposeCalls.length;

    await user.click(screen.getByRole("button", { name: /open inbox surface/i }));
    expect(initialHost.isConnected).toBe(true);
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeTransitions);
    await selectSurface(user, "Sessions");
    expect(initialHost.isConnected).toBe(true);
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeTransitions);
    await selectSurface(user, "Work");
    expect(initialHost.isConnected).toBe(true);
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeTransitions);

    await selectSurface(user, "Context");
    expect(screen.getByTestId("context-drawer")).toHaveAttribute("aria-hidden", "false");
    expect(initialHost.isConnected).toBe(true);
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeTransitions);
    await user.click(screen.getByRole("button", { name: "Close Context panel" }));
    expect(screen.getByTestId("context-drawer")).toHaveAttribute("aria-hidden", "true");
    expect(initialHost.isConnected).toBe(true);
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeTransitions);

    await chooseWorkLayout(user, "Focus");
    expect(screen.getByRole("button", { name: "Open layout menu, Focus selected" })).toBeInTheDocument();
    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
    expect(initialHost.isConnected).toBe(true);
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeTransitions);
    await chooseWorkLayout(user, "Split");
    expect(screen.getByRole("button", { name: "Open layout menu, Split selected" })).toBeInTheDocument();
    expect(initialHost.isConnected).toBe(true);
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeTransitions);
    await chooseWorkLayout(user, "Grid");
    expect(screen.getByRole("button", { name: "Open layout menu, Grid selected" })).toBeInTheDocument();
    expect(initialHost.isConnected).toBe(true);
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeTransitions);

    await bridge.emitData({ id: "runtime-1", data: "keep-alive output\n", activities: [] });
    expect(tile).toHaveTextContent("keep-alive output");

    const finalHosts = within(screen.getByTestId("desk-runtime-surface")).getAllByTestId("xterm-host");
    expect(finalHosts).toHaveLength(initialHosts.length);
    expect(finalHosts[0]).toBe(initialHost);
    expect(finalHosts[0]?.isConnected).toBe(true);
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeTransitions);
  });

  it("keeps session counts in the Work toolbar instead of the fixed header", async () => {
    installDesktopBridge(undefined, null, [liveSnapshot("one"), liveSnapshot("two")]);

    render(<App />);

    await screen.findByRole("article", { name: /Codex · two/i });
    const workbenchHeader = screen.getByTestId("workbench-header");

    expect(screen.getByRole("button", { name: /Workspace menu for Alfred/i })).not.toHaveTextContent(/2 tiles/);
    expect(workbenchHeader).toHaveAttribute("data-chrome-height", "44");
    expect(within(workbenchHeader).queryByRole("toolbar")).not.toBeInTheDocument();
    expect(workbenchHeader).not.toHaveTextContent("2 sessions");
    expect(screen.getByRole("toolbar", { name: "Work layout controls" })).toHaveTextContent("2 visible sessions");
    expect(screen.queryByLabelText("Terminal grid controls")).not.toBeInTheDocument();
    expect(screen.queryByText(/2 tiles · 0 staged/i)).not.toBeInTheDocument();
  });

  it("counts staged and restored sessions with the same mode semantics as TerminalDesk", async () => {
    const user = userEvent.setup();
    const stagedPlan: AlfredStagedPlanSnapshot = {
      id: "plan-visible-count",
      prompt: "prepare visible work",
      sessions: [
        { id: "alfred-staged-1", kind: "shell", title: "Staged one", command: "echo", args: ["one"] },
        { id: "alfred-staged-2", kind: "shell", title: "Staged two", command: "echo", args: ["two"] },
      ],
    };
    const restoredSessions: PersistedTerminalSessionSnapshot[] = [
      {
        clientId: "restored-visible",
        title: "Codex · restored visible",
        source: "alfred",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "codex",
        command: "codex",
        buffer: "saved output\n",
      },
    ];
    installDesktopBridge(undefined, stagedPlan, [], undefined, undefined, undefined, restoredSessions);

    render(<App />);

    const toolbar = await screen.findByRole("toolbar", { name: "Work layout controls" });
    await waitFor(() => expect(toolbar).toHaveTextContent("3 visible sessions"));
    expect(screen.getAllByTestId("terminal-tile").filter((tile) => tile.getAttribute("aria-hidden") !== "true")).toHaveLength(3);

    await chooseWorkLayout(user, "Focus");
    expect(screen.getByRole("button", { name: "Open layout menu, Focus selected" })).toBeInTheDocument();
    expect(toolbar).toHaveTextContent("1 visible session");

    await chooseWorkLayout(user, "Split");
    expect(screen.getByRole("button", { name: "Open layout menu, Split selected" })).toBeInTheDocument();
    expect(toolbar).toHaveTextContent("2 visible sessions");

    await chooseWorkLayout(user, "Arrange");
    expect(screen.getByRole("button", { name: "Open layout menu, Arrange selected" })).toBeInTheDocument();
    expect(toolbar).toHaveTextContent("3 visible sessions");
  });

  it("keeps one-session Focus compact with the primary row as its only session chrome", async () => {
    installDesktopBridge(
      undefined,
      null,
      [liveSnapshot("solo", { title: "Codex · solo" })],
      undefined,
      {
        layoutsByWorkspace: {},
        viewStateByWorkspace: {
          A: { workMode: "focus", selectedSessionId: "solo" },
        },
      },
    );

    render(<App />);

    const workbenchHeader = await screen.findByTestId("workbench-header");
    expect(workbenchHeader).toHaveAttribute("data-chrome-height", "44");
    expect(within(workbenchHeader).queryByRole("toolbar", { name: "Session and layout controls" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Sessions" })).not.toBeInTheDocument();
    const primarySessionContext = workbenchHeader.querySelector(".workbench-primary-row .workbench-session-context");
    expect(primarySessionContext).toHaveTextContent("Codex · solo");
    expect(primarySessionContext).toHaveTextContent("…/Desktop/Alfred · main");

    const visibleTiles = screen.getAllByTestId("terminal-tile").filter(
      (tile) => tile.getAttribute("aria-hidden") !== "true",
    );
    expect(visibleTiles).toHaveLength(1);
    expect(visibleTiles[0]?.querySelector(".terminal-tile-header")).toBeNull();
  });

  it("uses the project navigator to change Focus sessions without replacing xterm", async () => {
    const user = userEvent.setup();
    installDesktopBridge(undefined, null, [liveSnapshot("one"), liveSnapshot("two")]);

    render(<App />);

    await screen.findByRole("button", { name: /Open layout menu/ });
    const firstHost = screen.getAllByTestId("xterm-host")[0];
    expect(firstHost).toBeInstanceOf(HTMLElement);

    await chooseWorkLayout(user, "Focus");
    expect(screen.getByRole("button", { name: "Open layout menu, Focus selected" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Codex · two/i }));

    const visibleTiles = screen.getAllByTestId("terminal-tile").filter(
      (tile) => tile.getAttribute("aria-hidden") !== "true",
    );
    expect(visibleTiles).toHaveLength(1);
    expect(visibleTiles[0]?.querySelector(".terminal-tile-header")).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Sessions" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Codex · two");
    expect(screen.getAllByTestId("xterm-host")[0]).toBe(firstHost);
    expect(terminalDisposeCalls).toHaveLength(0);
  });

  it("omits live session tabs when a staged tile owns Focus", async () => {
    const user = userEvent.setup();
    installDesktopBridge(
      undefined,
      {
        id: "plan-staged-focus",
        name: "Staged focus",
        prompt: "review staged work",
        sessions: [
          { id: "staged-focus", kind: "shell", title: "Review me", command: "echo", args: ["ok"] },
        ],
      },
      [liveSnapshot("one"), liveSnapshot("two")],
    );

    render(<App />);

    const stagedTile = await screen.findByRole("article", { name: /Staged Review me/i });
    await user.dblClick(stagedTile.querySelector(".tile-header")!);

    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
    expect(screen.queryByRole("tablist", { name: "Sessions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename Codex · one" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close Codex · one" })).not.toBeInTheDocument();
    expect(stagedTile.querySelector(".tile-header")).not.toBeNull();
  });

  it.each(["Split", "Grid"] as const)("%s keeps tile headers and omits session tabs", async (name) => {
    const user = userEvent.setup();
    installDesktopBridge(undefined, null, [liveSnapshot("one"), liveSnapshot("two")]);

    render(<App />);

    await screen.findByRole("button", { name: /Open layout menu/ });
    await chooseWorkLayout(user, name);
    expect(screen.getByRole("button", { name: `Open layout menu, ${name} selected` })).toBeInTheDocument();

    const visibleTiles = screen.getAllByTestId("terminal-tile").filter(
      (tile) => tile.getAttribute("aria-hidden") !== "true",
    );
    expect(visibleTiles).toHaveLength(2);
    expect(screen.queryByRole("tablist", { name: "Sessions" })).not.toBeInTheDocument();
    visibleTiles.forEach((tile) => {
      expect(tile.querySelector(".terminal-tile-header")).not.toBeNull();
    });
  });

  it("uses tile headers only while arranging from Focus without replacing xterms", async () => {
    const user = userEvent.setup();
    installDesktopBridge(undefined, null, [liveSnapshot("one"), liveSnapshot("two")]);

    render(<App />);

    await screen.findByRole("button", { name: /Open layout menu/ });
    await chooseWorkLayout(user, "Focus");
    expect(screen.getByRole("button", { name: "Open layout menu, Focus selected" })).toBeInTheDocument();
    const initialHosts = screen.getAllByTestId("xterm-host");
    expect(initialHosts).toHaveLength(2);
    const disposeCountBeforeArrange = terminalDisposeCalls.length;

    await chooseWorkLayout(user, "Arrange");
    expect(screen.getByRole("button", { name: "Open layout menu, Arrange selected" })).toBeInTheDocument();

    const visibleTiles = screen.getAllByTestId("terminal-tile").filter(
      (tile) => tile.getAttribute("aria-hidden") !== "true",
    );
    expect(visibleTiles).toHaveLength(2);
    expect(screen.queryByRole("tablist", { name: "Sessions" })).not.toBeInTheDocument();
    visibleTiles.forEach((tile) => {
      expect(tile.querySelector(".terminal-tile-header")).not.toBeNull();
    });
    const arrangedHosts = screen.getAllByTestId("xterm-host");
    expect(arrangedHosts).toHaveLength(initialHosts.length);
    arrangedHosts.forEach((host, index) => {
      expect(host).toBe(initialHosts[index]);
      expect(host.isConnected).toBe(true);
    });
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeArrange);
  });

  it("renders the normal terminal stage without a local header", async () => {
    installDesktopBridge();

    render(<App />);

    const stage = await screen.findByLabelText("terminals");
    expect(stage).toHaveClass("headerless");
    expect(stage.querySelector(".terminal-stage-header")).not.toBeInTheDocument();
  });

  it("never renders a second Focus Split Grid control set inside TerminalDesk", () => {
    const session: SessionTile = {
      id: "one",
      runtimeId: "runtime-one",
      title: "Codex · one",
      source: "manual",
      workspaceId: "A",
      cwd: "/Users/patryk/Desktop/Alfred",
      stage: "live",
      runtimeStatus: "live",
      initialBuffer: "",
    };
    renderTerminalDeskForSessions([session]);

    expect(screen.queryByRole("button", { name: /Open layout menu/ })).not.toBeInTheDocument();
  });

  it("routes secondary terminal actions through one accessible overflow menu", async () => {
    const user = userEvent.setup();
    const { openExternalTerminal } = installDesktopBridge();
    const session: SessionTile = {
      id: "manual-menu",
      runtimeId: "runtime-manual-menu",
      title: "Manual · menu",
      source: "manual",
      workspaceId: "A",
      cwd: "/Users/patryk/Desktop/Alfred",
      stage: "live",
      runtimeStatus: "live",
      initialBuffer: "",
    };
    const { callbacks } = renderTerminalDeskForSessions([session]);
    const tile = screen.getByRole("article", { name: /Manual · menu/i });
    const trigger = within(tile).getByRole("button", {
      name: "More actions for Manual · menu",
    });

    await user.click(trigger);
    const menu = screen.getByRole("menu", { name: "Manual · menu actions" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Collapse terminal body",
      expect.stringContaining("Open in external terminal"),
      "Rename session",
      expect.stringContaining("Close"),
    ]);

    await user.click(within(menu).getByRole("menuitem", { name: "Collapse terminal body" }));
    expect(callbacks.onToggleCollapseSession).toHaveBeenCalledWith("manual-menu");

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: /Open in external terminal/ }));
    expect(openExternalTerminal).toHaveBeenCalledWith({ cwd: "/Users/patryk/Desktop/Alfred" });

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Rename session" }));
    expect(within(tile).getByRole("textbox", { name: "Rename Manual · menu" }))
      .toHaveValue("Manual · menu");

    await user.keyboard("{Escape}");
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: /Close/ }));
    expect(callbacks.onCloseSession).toHaveBeenCalledWith("manual-menu");
  });

  it("closes terminal overflow actions on Escape and restores trigger focus", async () => {
    const user = userEvent.setup();
    const session: SessionTile = {
      id: "manual-menu",
      runtimeId: "runtime-manual-menu",
      title: "Manual · menu",
      source: "manual",
      workspaceId: "A",
      cwd: "/Users/patryk/Desktop/Alfred",
      stage: "live",
      runtimeStatus: "live",
      initialBuffer: "",
    };
    renderTerminalDeskForSessions([session]);
    const trigger = screen.getByRole("button", { name: "More actions for Manual · menu" });

    await user.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Collapse terminal body" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu", { name: "Manual · menu actions" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps non-visible Split terminals mounted and replayable when returning to Grid", async () => {
    const user = userEvent.setup();
    const bridge = installDesktopBridge(undefined, null, [
      liveSnapshot("one", { id: "runtime-one", title: "Codex · one" }),
      liveSnapshot("two", { id: "runtime-two", title: "Codex · two" }),
      liveSnapshot("three", { id: "runtime-three", title: "Codex · three" }),
    ]);

    render(<App />);

    expect(await screen.findByRole("article", { name: /Codex · one/i })).toBeInTheDocument();
    const disposeCount = terminalDisposeCalls.length;

    await chooseWorkLayout(user, "Split");
    expect(screen.getByRole("button", { name: "Open layout menu, Split selected" })).toBeInTheDocument();

    expect(screen.getAllByTestId("xterm-host")).toHaveLength(3);
    const hiddenSplitTile = document.querySelector("article[aria-label='Codex · three']");
    expect(hiddenSplitTile).toHaveClass("focus-hidden");
    expect(hiddenSplitTile).toHaveAttribute("aria-hidden", "true");
    if (!(hiddenSplitTile instanceof HTMLElement)) {
      throw new Error("Expected hidden split tile to be present.");
    }
    expect(rendererStyles).toMatch(
      /\.terminal-stage\.mode-focus \.terminal-tile\.focus-hidden,\s*\.terminal-stage\.mode-split \.terminal-tile\.focus-hidden\s*\{[^}]*display:\s*none;[^}]*\}/s,
    );
    expect(within(hiddenSplitTile).getByTestId("xterm-host").isConnected).toBe(true);
    expect(terminalDisposeCalls).toHaveLength(disposeCount);

    await bridge.emitData({ id: "runtime-three", data: "hidden split output\n", activities: [] });

    await chooseWorkLayout(user, "Grid");
    expect(screen.getByRole("button", { name: "Open layout menu, Grid selected" })).toBeInTheDocument();
    expect(document.querySelector("article[aria-label='Codex · three']")).toHaveTextContent("hidden split output");
    expect(terminalDisposeCalls).toHaveLength(disposeCount);
  });

  it("lets terminal-grid wheel gestures reach lower tiles after xterm history reaches an edge", async () => {
    const sessions: SessionTile[] = [
      {
        id: "codex-one",
        runtimeId: "runtime-one",
        title: "Codex · session 1",
        source: "manual",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        command: "codex",
        args: [],
        stage: "live",
        runtimeStatus: "live",
        initialBuffer: "",
      },
      {
        id: "codex-two",
        runtimeId: "runtime-two",
        title: "Codex · session 2",
        source: "manual",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        command: "codex",
        args: [],
        stage: "live",
        runtimeStatus: "live",
        initialBuffer: "",
      },
      {
        id: "codex-three",
        runtimeId: "runtime-three",
        title: "Codex · session 3",
        source: "manual",
        agentKind: "codex",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        command: "codex",
        args: [],
        stage: "live",
        runtimeStatus: "live",
        initialBuffer: "",
      },
    ];
    renderTerminalDeskForSessions(sessions);

    const column = document.querySelector(".terminal-grid-column");
    const host = within(await screen.findByRole("article", { name: /Codex · session 1/i })).getByTestId("xterm-host");
    if (!(column instanceof HTMLElement)) {
      throw new Error("Expected terminal grid column to be mounted.");
    }
    if (!(host instanceof HTMLElement)) {
      throw new Error("Expected xterm host to be mounted.");
    }

    host.innerHTML = '<div class="xterm"><div class="xterm-viewport"></div><div class="xterm-screen"></div></div>';
    const viewport = host.querySelector(".xterm-viewport");
    const screenElement = host.querySelector(".xterm-screen");
    if (!(viewport instanceof HTMLElement) || !(screenElement instanceof HTMLElement)) {
      throw new Error("Expected synthetic xterm viewport and screen.");
    }

    Object.defineProperty(column, "clientHeight", { configurable: true, value: 500 });
    Object.defineProperty(column, "scrollHeight", { configurable: true, value: 1200 });
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 300 });
    Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 900 });

    column.scrollTop = 0;
    viewport.scrollTop = 100;
    fireEvent.wheel(screenElement, { deltaY: 120 });
    expect(column.scrollTop).toBe(0);

    viewport.scrollTop = 600;
    const edgeWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 120,
    });
    screenElement.dispatchEvent(edgeWheel);
    expect(edgeWheel.defaultPrevented).toBe(true);
    expect(column.scrollTop).toBe(120);
  });

  it("separates collapse from destructive close and only shows resize handles in Arrange", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);

    const tile = await screen.findByTestId("terminal-tile");
    const host = within(tile).getByTestId("xterm-host");
    const disposeCountBeforeCollapse = terminalDisposeCalls.length;

    expect(document.querySelector(".arrange-handle")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resize /i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "arrange tiles");
    expect(document.querySelector(".arrange-handle")).toBeInTheDocument();

    await user.click(within(tile).getByRole("button", { name: "Collapse Manual · zsh 1" }));

    expect(tile).toHaveClass("collapsed");
    expect(host.isConnected).toBe(true);
    expect(within(tile).getByTestId("xterm-host")).toBe(host);
    expect(within(tile).getByRole("button", { name: "Expand Manual · zsh 1" })).toBeInTheDocument();
    expect(within(tile).getByRole("button", { name: "Close Manual · zsh 1" })).toBeInTheDocument();
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeCollapse);
  });

  it("keeps quiet terminal utility actions reachable by keyboard focus", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);

    const tile = await screen.findByTestId("terminal-tile");
    const collapseButton = within(tile).getByRole("button", { name: "Collapse Manual · zsh 1" });
    await screen.findByRole("tab", { name: "Alfred workspace" });

    await act(async () => {
      tile.focus();
    });
    expect(tile).toHaveFocus();

    await user.tab();

    expect(collapseButton).toHaveFocus();
    expect(tile).toContainElement(document.activeElement as HTMLElement);
  });

  it("uses a Dispatch bar with explicit workspace planning instead of a workspace chat composer", async () => {
    const user = userEvent.setup();
    const { requestPlan } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    const dispatch = await openPrepareWork(user);
    expect(dispatch).toHaveAccessibleName("Alfred dispatch");
    expect(screen.queryByRole("form", { name: /alfred composer/i })).not.toBeInTheDocument();

    expect(within(dispatch).getByRole("button", { name: "Change planning scope" })).toBeInTheDocument();
    expect(within(dispatch).getByText("workspace")).toBeInTheDocument();
    expect(within(dispatch).getByText("Alfred")).toBeInTheDocument();
    const input = within(dispatch).getByRole("textbox", { name: "Dispatch instruction" });
    await user.type(input, "prepare a review plan");
    await user.click(within(dispatch).getByRole("button", { name: "Prepare work in Alfred" }));

    expect(requestPlan).toHaveBeenCalledTimes(1);
    expect(requestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchTarget: expect.objectContaining({
          kind: "workspace",
          label: "Alfred",
        }),
        workspace: expect.objectContaining({
          sessions: expect.arrayContaining([expect.objectContaining({ title: "Manual · zsh 1" })]),
        }),
      }),
    );
    expect(screen.queryByTestId("dispatch-bar")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  });

  it("can narrow Dispatch requests to the selected session", async () => {
    const user = userEvent.setup();
    const { requestPlan } = installDesktopBridge();

    render(<App />);

    const dispatch = await openPrepareWork(user);
    await user.click(within(dispatch).getByRole("button", { name: "Change planning scope" }));
    expect(within(dispatch).getByText("session")).toBeInTheDocument();
    expect(within(dispatch).getByText("Manual · zsh 1")).toBeInTheDocument();

    await user.type(within(dispatch).getByRole("textbox", { name: "Dispatch instruction" }), "prepare session plan");
    await user.click(within(dispatch).getByRole("button", { name: "Prepare work with Manual · zsh 1" }));

    expect(requestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchTarget: expect.objectContaining({ kind: "session", label: "Manual · zsh 1" }),
        prompt: "prepare session plan",
        workspace: expect.objectContaining({
          id: "A",
          sessions: [expect.objectContaining({ title: "Manual · zsh 1" })],
        }),
      }),
    );
  });

  it("keeps the Context drawer mounted and closed by default with an important-session signal", async () => {
    const user = userEvent.setup();
    installDesktopBridge(undefined, null, [
      {
        id: "runtime-a",
        clientId: "manual-a",
        title: "Manual · failed",
        source: "manual",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        shell: "/bin/zsh",
        buffer: "failed",
        activityEvents: [
          {
            id: "manual-a-error",
            kind: "error",
            title: "Process failed",
            detail: "Exited with code 1.",
            at: 123,
          },
        ],
      },
    ]);

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · failed/i })).toBeInTheDocument();
    const drawer = screen.getByTestId("context-drawer");
    expect(drawer).toHaveAttribute("aria-hidden", "true");

    await selectSurface(user, "Context");

    expect(drawer).toHaveAttribute("aria-hidden", "false");
    expect(within(drawer).getByLabelText("Agent activity")).toHaveTextContent("Manual · failed");

    await user.click(within(drawer).getByRole("button", { name: "Close Context panel" }));
    expect(drawer).toHaveAttribute("aria-hidden", "true");
    expect(drawer.querySelector('[aria-label="Agent activity"]')).toBeInstanceOf(HTMLElement);
  });

  it("preserves staged command edits across closing and reopening the context column", async () => {
    const user = userEvent.setup();
    installDesktopBridge({
      ok: true,
      plan: {
        name: "Editable plan",
        sessions: [{ kind: "shell", title: "Run old command", command: "echo", args: ["old"] }],
      },
    });

    render(<App />);

    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "stage editable shell");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));
    const stagedTile = await screen.findByRole("article", { name: /Staged Run old command/i });

    await user.dblClick(stagedTile.querySelector(".tile-header")!);
    await selectSurface(user, "Context");
    await user.click(screen.getByRole("button", { name: "Edit command" }));

    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "pnpm" } });
    fireEvent.change(screen.getByLabelText("Arguments"), { target: { value: "test\n--watch" } });
    fireEvent.change(screen.getByLabelText("Working directory"), { target: { value: "apps/desktop" } });

    await user.click(screen.getByRole("button", { name: "Close Context panel" }));
    expect(screen.getByTestId("context-column")).toHaveClass("closed");

    await selectSurface(user, "Context");
    expect(screen.getByTestId("context-column")).toHaveClass("open");
    expect(screen.getByLabelText("Command")).toHaveValue("pnpm");
    expect(screen.getByLabelText("Arguments")).toHaveValue("test\n--watch");
    expect(screen.getByLabelText("Working directory")).toHaveValue("apps/desktop");
  });

  it("preserves live xterm output and instance when terminal title metadata changes", async () => {
    const bridge = installDesktopBridge();
    const session: SessionTile = {
      id: "codex-a",
      runtimeId: "runtime-a",
      title: "Codex · session 1",
      source: "manual",
      agentKind: "codex",
      workspaceId: "A",
      cwd: "/Users/patryk/Desktop/Alfred",
      command: "codex",
      args: [],
      stage: "live",
      runtimeStatus: "live",
      initialBuffer: "",
    };
    const { rerender, renderDesk } = renderTerminalDeskForSessions([session]);

    const tile = await screen.findByRole("article", { name: /Codex · session 1/i });
    await waitFor(() => {
      expect(window.alfredDesktop?.terminal.onData).toHaveBeenCalledTimes(1);
    });

    await bridge.emitData({ id: "runtime-a", data: "metadata-safe output\n", activities: [] });

    expect(tile).toHaveTextContent("metadata-safe output");
    const disposeCountBeforeRename = terminalDisposeCalls.length;

    rerender(renderDesk([{ ...session, title: "Spec reviewer" }]));

    const renamedTile = await screen.findByRole("article", { name: /Spec reviewer/i });
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeRename);
    expect(renamedTile).toHaveTextContent("metadata-safe output");
  });

  it("keeps the same xterm host connected and processing output across A to B to A", async () => {
    const user = userEvent.setup();
    const alpha = liveSnapshot("alpha", { id: "runtime-alpha", workspaceId: "A", buffer: "alpha before\n" });
    const beta = liveSnapshot("beta", { id: "runtime-beta", workspaceId: "CLIENT", buffer: "beta before\n" });
    const bridge = installDesktopBridge(
      undefined,
      null,
      [alpha, beta],
      undefined,
      { layoutsByWorkspace: {}, viewStateByWorkspace: {} },
      {
        workspaces: [
          { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/patryk/Desktop/Alfred" },
          { id: "CLIENT", label: "ClientApp", shortLabel: "CLI", rootPath: "/Users/patryk/Desktop/ClientApp" },
        ],
        activeWorkspaceId: "A",
      },
    );

    render(<App />);
    const alphaTile = await screen.findByTestId("terminal-tile");
    expect(alphaTile).toHaveAttribute("data-session-id", "alpha");
    const alphaHost = within(alphaTile).getByTestId("xterm-host");
    const disposeCount = terminalDisposeCalls.length;

    await user.click(screen.getByRole("tab", { name: /ClientApp workspace/i }));
    expect(alphaTile).toHaveAttribute("data-testid", "background-terminal-tile");
    expect(alphaTile).toHaveAttribute("aria-hidden", "true");
    expect(alphaHost.isConnected).toBe(true);

    await bridge.emitData({ id: "runtime-alpha", data: "alpha while hidden\n", activities: [] });
    await waitFor(() => expect(alphaHost).toHaveTextContent("alpha while hidden"));

    await user.click(screen.getByRole("tab", { name: /Alfred workspace/i }));
    expect(screen.getByTestId("terminal-tile")).toBe(alphaTile);
    expect(screen.getByTestId("xterm-host")).toBe(alphaHost);
    expect(terminalDisposeCalls).toHaveLength(disposeCount);
  });

  it.each(["null", "reject"] as const)(
    "replays the fallback buffer once when initial reconciliation resolves as %s",
    async (outcome) => {
      const alfredSession = liveSnapshot("alfred", {
        id: "runtime-alfred",
        workspaceId: "A",
        buffer: "before switch\n",
      });
      const delayedReconcile = deferred<TerminalReconcileResult>();
      const bridge = installDesktopBridge(undefined, null, [alfredSession]);
      bridge.reconcileTerminal.mockImplementation(() => delayedReconcile.promise);

      render(<App />);
      await waitFor(() => {
        expect(bridge.reconcileTerminal).toHaveBeenCalledWith({
          id: "runtime-alfred",
          clientId: "alfred",
        });
      });
      await bridge.emitData({
        id: "runtime-alfred",
        data: "ran pnpm test\n",
        activities: [],
      });

      await act(async () => {
        if (outcome === "null") {
          delayedReconcile.resolve({ state: "missing" });
          await delayedReconcile.promise;
          return;
        }

        delayedReconcile.reject(new Error("reconciliation failed"));
        try {
          await delayedReconcile.promise;
        } catch {
          // expected in this regression path
        }
      });

      const tile = await screen.findByRole("article", { name: /Codex · alfred/i });
      await waitFor(() => {
        const hostText = within(tile).getByTestId("xterm-host").textContent ?? "";
        expect(hostText).toContain("before switch\nran pnpm test\n");
        expect(hostText.match(/ran pnpm test/g)).toHaveLength(1);
      });
    },
  );

  it("replays the final snapshot and exit when reconciliation finds an early terminal exit", async () => {
    const initial = liveSnapshot("fast-exit", {
      id: "runtime-fast-exit",
      buffer: "",
    });
    const exitEvent: TerminalExitEvent = {
      id: initial.id,
      clientId: "fast-exit",
      exitCode: 7,
    };
    const finalSnapshot: TerminalSessionSnapshot = {
      ...initial,
      buffer: "failed before attach\n",
      activityEvents: [{
        id: "fast-exit-lifecycle",
        at: 5_000,
        kind: "lifecycle",
        title: "Process exited",
        detail: "The terminal process exited with code 7.",
      }],
      lastActivityAt: 5_000,
    };
    const bridge = installDesktopBridge(undefined, null, [initial]);
    bridge.reconcileTerminal.mockResolvedValue({
      state: "exited",
      snapshot: finalSnapshot,
      event: exitEvent,
    });
    const session: SessionTile = {
      id: "fast-exit",
      runtimeId: initial.id,
      title: "Manual · fast exit",
      source: "manual",
      workspaceId: "A",
      cwd: initial.cwd,
      stage: "live",
      runtimeStatus: "live",
      initialBuffer: "",
    };

    const { callbacks } = renderTerminalDeskForSessions([session]);

    await waitFor(() => {
      expect(callbacks.onRuntimeSessionExited).toHaveBeenCalledOnce();
    });
    expect(callbacks.onRuntimeSessionExited).toHaveBeenCalledWith(exitEvent);
    expect(callbacks.onRuntimeSessionSnapshot).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        buffer: "failed before attach\n",
        activityEvents: finalSnapshot.activityEvents,
      }),
    );
    const output = screen.getByTestId("xterm-host").textContent ?? "";
    expect(output).toContain("failed before attach");
    expect(output.match(/\[process exited with code 7\]/g)).toHaveLength(1);
  });

  it("does not report an exit twice when the live event wins the reconciliation race", async () => {
    const initial = liveSnapshot("race", {
      id: "runtime-race",
      buffer: "",
    });
    const exitEvent: TerminalExitEvent = {
      id: initial.id,
      clientId: "race",
      exitCode: 3,
    };
    const delayedReconcile = deferred<TerminalReconcileResult>();
    const bridge = installDesktopBridge(undefined, null, [initial]);
    bridge.reconcileTerminal.mockImplementation(() => delayedReconcile.promise);
    const session: SessionTile = {
      id: "race",
      runtimeId: initial.id,
      title: "Manual · race",
      source: "manual",
      workspaceId: "A",
      cwd: initial.cwd,
      stage: "live",
      runtimeStatus: "live",
      initialBuffer: "",
    };
    const { callbacks } = renderTerminalDeskForSessions([session]);
    await waitFor(() => {
      expect(bridge.reconcileTerminal).toHaveBeenCalledWith({
        id: initial.id,
        clientId: initial.clientId,
      });
    });

    await bridge.emitExit(exitEvent);
    await act(async () => {
      delayedReconcile.resolve({
        state: "exited",
        snapshot: { ...initial, buffer: "final output\n" },
        event: exitEvent,
      });
      await delayedReconcile.promise;
    });

    expect(callbacks.onRuntimeSessionExited).toHaveBeenCalledOnce();
    const output = screen.getByTestId("xterm-host").textContent ?? "";
    expect(output.match(/\[process exited with code 3\]/g)).toHaveLength(1);
  });

  it("keeps one producer activity after live delivery and snapshot reconciliation", async () => {
    const user = userEvent.setup();
    const initial = liveSnapshot("activity", {
      id: "runtime-activity",
      activityEvents: [],
    });
    const producerEvent = {
      id: "activity-approval-1",
      kind: "approval" as const,
      title: "Waiting for approval",
      detail: "Allow the release?",
      payload: { type: "approval" as const, prompt: "Allow the release?" },
      at: 1_234,
    };
    const delayedReconcile = deferred<TerminalReconcileResult>();
    const bridge = installDesktopBridge(undefined, null, [initial]);
    bridge.reconcileTerminal.mockImplementation(() => delayedReconcile.promise);

    render(<App />);
    await waitFor(() => {
      expect(bridge.reconcileTerminal).toHaveBeenCalledWith({
        id: "runtime-activity",
        clientId: "activity",
      });
    });
    await bridge.emitData({
      id: "runtime-activity",
      data: "Allow the release?",
      activities: [producerEvent],
    });

    await act(async () => {
      delayedReconcile.resolve({
        state: "running",
        snapshot: {
          ...initial,
          activityEvents: [producerEvent],
          lastActivityAt: producerEvent.at,
        },
      });
      await delayedReconcile.promise;
    });

    await selectSurface(user, "Context");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Activity (1)" })).toBeInTheDocument();
    });
  });

  it("keeps both capped same-timestamp activities after live and snapshot reconciliation", async () => {
    const user = userEvent.setup();
    let retainedEvents: SessionActivityEvent[] = [];
    for (let index = 0; index < 40; index += 1) {
      retainedEvents = appendActivityEvent(retainedEvents, "activity", {
        kind: "command",
        title: "Ran command",
        detail: `seed-${index}`,
      }, 1_000 + index, 40).events;
    }
    const initialEvents = retainedEvents;
    retainedEvents = appendActivityEvent(retainedEvents, "activity", {
      kind: "command",
      title: "Ran command",
      detail: "overflow-a",
    }, 5_000, 40).events;
    retainedEvents = appendActivityEvent(retainedEvents, "activity", {
      kind: "command",
      title: "Ran command",
      detail: "overflow-b",
    }, 5_000, 40).events;
    const overflowEvents = retainedEvents.slice(-2);
    const initial = liveSnapshot("activity", {
      id: "runtime-activity",
      activityEvents: initialEvents,
      lastActivityAt: 1_039,
    });
    const delayedReconcile = deferred<TerminalReconcileResult>();
    const bridge = installDesktopBridge(undefined, null, [initial]);
    bridge.reconcileTerminal.mockImplementation(() => delayedReconcile.promise);

    render(<App />);
    await waitFor(() => {
      expect(bridge.reconcileTerminal).toHaveBeenCalledWith({
        id: "runtime-activity",
        clientId: "activity",
      });
    });
    await bridge.emitData({
      id: "runtime-activity",
      data: 'Bash("overflow-a")\nBash("overflow-b")\n',
      activities: overflowEvents,
    });

    await act(async () => {
      delayedReconcile.resolve({
        state: "running",
        snapshot: {
          ...initial,
          activityEvents: retainedEvents,
          lastActivityAt: 5_000,
        },
      });
      await delayedReconcile.promise;
    });

    await selectSurface(user, "Context");
    const activity = await screen.findByRole("region", { name: "Recent activity" });
    await user.click(within(activity).getByRole("button", { name: /^Activity \(/ }));

    expect(within(activity).getByText("overflow-a")).toBeInTheDocument();
    expect(within(activity).getByText("overflow-b")).toBeInTheDocument();
  });

  it("preserves live xterm output and instance when args and resume target metadata change", async () => {
    const bridge = installDesktopBridge();
    const session: SessionTile = {
      id: "codex-resume",
      runtimeId: "runtime-resume",
      title: "Codex · resume",
      source: "manual",
      agentKind: "codex",
      workspaceId: "A",
      cwd: "/Users/patryk/Desktop/Alfred",
      command: "codex",
      args: ["resume", "old-session"],
      resumeTarget: {
        agentKind: "codex",
        sessionId: "old-session",
        source: "external-session-index",
      },
      stage: "live",
      runtimeStatus: "live",
      initialBuffer: "",
    };
    const { rerender, renderDesk } = renderTerminalDeskForSessions([session]);

    const tile = await screen.findByRole("article", { name: /Codex · resume/i });
    await waitFor(() => {
      expect(window.alfredDesktop?.terminal.onData).toHaveBeenCalledTimes(1);
    });

    await bridge.emitData({ id: "runtime-resume", data: "resume output stays\n", activities: [] });

    expect(tile).toHaveTextContent("resume output stays");
    const disposeCountBeforeMetadataUpdate = terminalDisposeCalls.length;

    rerender(renderDesk([
      {
        ...session,
        args: ["resume", "new-session"],
        resumeTarget: {
          agentKind: "codex",
          sessionId: "new-session",
          source: "external-session-index",
        },
      },
    ]));

    const updatedTile = await screen.findByRole("article", { name: /Codex · resume/i });
    expect(terminalDisposeCalls).toHaveLength(disposeCountBeforeMetadataUpdate);
    expect(updatedTile).toHaveTextContent("resume output stays");
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

  it("resumes an external Codex Sessions row exactly once through its opaque summary key without PTY writes", async () => {
    const user = userEvent.setup();
    const externalSessionId = "019edc4b-0000-7000-9000-sessions";
    const { createTerminal, resolveExternalSession, writeTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [],
      [
        {
          sessionKey: `external-codex:${externalSessionId}:200`,
          lineageKey: `external-codex:${externalSessionId}`,
          contentSessionKey: `external-codex:${externalSessionId}`,
          source: "external-codex",
          kind: "codex",
          title: "Load Alfred memory",
          project: { id: "A", label: "Alfred" },
          locationLabel: "Alfred",
          updatedAt: 200,
          lifecycle: "resumable",
          model: "gpt-5",
          originator: "codex",
        },
      ],
    );

    render(<App />);

    await waitFor(() => expect(createTerminal).toHaveBeenCalledTimes(1));
    createTerminal.mockClear();

    await selectSurface(user, "Sessions");
    await user.click(await screen.findByRole("option", { name: /Load Alfred memory/i }));
    const resume = screen.getByRole("button", { name: "Resume in Work" });
    fireEvent.click(resume);
    fireEvent.click(resume);

    await waitFor(() => {
      expect(createTerminal.mock.calls.filter(([request]) => (
        request.command === "codex" && request.args?.[0] === "resume"
      ))).toEqual([[expect.objectContaining({
          agentKind: "codex",
          command: "codex",
          args: ["resume", externalSessionId],
          resumeTarget: { agentKind: "codex", sessionId: externalSessionId, source: "external-session-index" },
          isolation: "shared",
          cwd: "/Users/patryk/Desktop/Alfred",
          workspaceId: "A",
      })]]);
      expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
    });
    expect(resolveExternalSession).toHaveBeenCalledWith({
      sessionKey: `external-codex:${externalSessionId}:200`,
    });
    expect(resolveExternalSession).toHaveBeenCalledTimes(1);
    expect(resolveExternalSession).not.toHaveBeenCalledWith({
      sessionKey: `external-codex:${externalSessionId}`,
    });
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("atomically resumes one Codex lineage from two opaque keys that resolve concurrently", async () => {
    const user = userEvent.setup();
    const sharedSessionId = "019edc4b-0000-7000-9000-shared";
    const firstResolution = deferred<Awaited<ReturnType<SessionsApi["resolveExternalSession"]>>>();
    const secondResolution = deferred<Awaited<ReturnType<SessionsApi["resolveExternalSession"]>>>();
    const firstKey = "opaque-concurrent-first";
    const secondKey = "opaque-concurrent-second";
    const {
      createTerminal,
      resolveExternalSession,
      setWorkspaceLayout,
      setWorkspaceViewState,
      writeTerminal,
    } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [],
      [
        {
          sessionKey: firstKey,
          lineageKey: "external-codex:concurrent-first",
          contentSessionKey: "external-codex:concurrent-first",
          source: "external-codex",
          kind: "codex",
          title: "Concurrent first",
          project: { id: "A", label: "Alfred" },
          locationLabel: "Alfred",
          updatedAt: 201,
          lifecycle: "resumable",
        },
        {
          sessionKey: secondKey,
          lineageKey: "external-codex:concurrent-second",
          contentSessionKey: "external-codex:concurrent-second",
          source: "external-codex",
          kind: "codex",
          title: "Concurrent second",
          project: { id: "A", label: "Alfred" },
          locationLabel: "Alfred",
          updatedAt: 200,
          lifecycle: "resumable",
        },
      ],
    );
    resolveExternalSession.mockImplementation(({ sessionKey }: { sessionKey: string }) => (
      sessionKey === firstKey ? firstResolution.promise : secondResolution.promise
    ));

    render(<App />);

    await waitFor(() => expect(createTerminal).toHaveBeenCalledTimes(1));
    createTerminal.mockClear();
    setWorkspaceLayout.mockClear();
    setWorkspaceViewState.mockClear();
    await selectSurface(user, "Sessions");

    await user.click(await screen.findByRole("option", { name: /Concurrent first/i }));
    fireEvent.click(screen.getByRole("button", { name: "Resume in Work" }));
    await user.click(screen.getByRole("option", { name: /Concurrent second/i }));
    fireEvent.click(screen.getByRole("button", { name: "Resume in Work" }));
    await waitFor(() => expect(resolveExternalSession).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondResolution.resolve({
        kind: "resume",
        projectId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        sessionId: sharedSessionId,
      });
      firstResolution.resolve({
        kind: "resume",
        projectId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        sessionId: sharedSessionId,
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(createTerminal.mock.calls.filter(([request]) => request.args?.[1] === sharedSessionId)).toHaveLength(1);
    });
    const resumeRequest = createTerminal.mock.calls.find(([request]) => request.args?.[1] === sharedSessionId)?.[0];
    expect(resumeRequest).toBeDefined();
    const actualTileId = resumeRequest.clientId;
    const persistedView = setWorkspaceViewState.mock.calls.at(-1)?.[0];
    const persistedLayout = setWorkspaceLayout.mock.calls.at(-1)?.[0];
    const renderedTileIds = screen.getAllByTestId("terminal-tile").map((tile) => tile.dataset.sessionId);

    expect(persistedView).toEqual({
      workspaceId: "A",
      viewState: { workMode: "focus", selectedSessionId: actualTileId },
    });
    expect(Object.keys(persistedLayout.layouts)).toContain(actualTileId);
    expect(Object.keys(persistedLayout.layouts).every((tileId) => renderedTileIds.includes(tileId))).toBe(true);
    expect(renderedTileIds.filter((tileId) => tileId?.startsWith("external-codex-"))).toEqual([actualTileId]);
    expect(terminalFocusSessionIds.at(-1)).toBe(actualTileId);
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("reveals a live managed session in Work without creating a terminal or writing to its PTY", async () => {
    const user = userEvent.setup();
    const { createTerminal, writeTerminal } = installDesktopBridge(
      undefined,
      null,
      [liveSnapshot("reveal", { title: "Reveal target" })],
    );

    render(<App />);

    const xtermHost = await screen.findByTestId("xterm-host");
    await selectSurface(user, "Sessions");
    await user.click(await screen.findByRole("option", { name: /Reveal target/i }));
    await user.click(screen.getByRole("button", { name: "Reveal in Work" }));

    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
    expect(screen.getByRole("article", { name: /Reveal target/i })).toBeInTheDocument();
    expect(screen.getByTestId("xterm-host")).toBe(xtermHost);
    await waitFor(() => expect(terminalFocusSessionIds.at(-1)).toBe("reveal"));
    expect(createTerminal).not.toHaveBeenCalled();
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("recovers a restored managed session through the existing safe lifecycle path and preserves its tile", async () => {
    const user = userEvent.setup();
    const { createTerminal, writeTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [{
        clientId: "restored-sessions-action",
        title: "Restored Sessions action",
        cwd: "/Users/patryk/Desktop/Alfred",
        source: "manual",
        agentKind: "codex",
        isolation: "shared",
        shell: "/bin/zsh",
        command: "codex",
        args: [],
        buffer: "saved output\n",
      }],
    );

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Restored Sessions action/i });
    const xtermHost = within(tile).getByTestId("xterm-host");
    await selectSurface(user, "Sessions");
    await user.click(await screen.findByRole("option", { name: /Restored Sessions action/i }));
    await user.click(screen.getByRole("button", { name: "Resume in Work" }));

    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
    });
    expect(screen.getByRole("article", { name: /Restored Sessions action/i })).toBe(tile);
    expect(within(tile).getByTestId("xterm-host")).toBe(xtermHost);
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("keeps unsafe Sessions recovery in a visible review state until explicit confirmation", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [{
        clientId: "unsafe-sessions-action",
        title: "Unsafe Sessions action",
        cwd: "/Users/patryk/Desktop/Alfred",
        source: "manual",
        isolation: "shared",
        shell: "/bin/zsh",
        command: "/bin/sh",
        args: ["-c", "rm -rf dist"],
        buffer: "saved output\n",
      }],
    );

    render(<App />);
    await screen.findByRole("article", { name: /Unsafe Sessions action/i });
    await selectSurface(user, "Sessions");
    await user.click(await screen.findByRole("option", { name: /Unsafe Sessions action/i }));

    await user.click(screen.getByRole("button", { name: "Review relaunch" }));
    expect(createTerminal).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirm relaunch" })).toBeInTheDocument();
    const review = screen.getByRole("region", { name: "Relaunch review" });
    expect(review).toHaveTextContent("/bin/sh -c rm -rf dist");
    expect(review).toHaveTextContent("/Users/patryk/Desktop/Alfred");

    fireEvent.keyDown(screen.getByRole("region", { name: "Sessions workspace" }), { key: "Escape" });
    expect(screen.getByRole("region", { name: "Sessions workspace" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Review relaunch" })).toBeInTheDocument();
    expect(createTerminal).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Review relaunch" }));
    await user.click(screen.getByRole("button", { name: "Confirm relaunch" }));
    await waitFor(() => expect(createTerminal).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("region", { name: "Sessions workspace" })).not.toBeInTheDocument();
  });

  it("opens a mapped read-only external session project without creating or writing to a terminal", async () => {
    const user = userEvent.setup();
    const externalSessionId = "019edc4b-0000-7000-9000-ended";
    const { createTerminal, resolveExternalSession, writeTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [],
      [{
        sessionKey: `external-codex:${externalSessionId}:200`,
        lineageKey: `external-codex:${externalSessionId}`,
        contentSessionKey: `external-codex:${externalSessionId}`,
        source: "external-codex",
        kind: "codex",
        title: "Ended mapped session",
        project: { id: "A", label: "Alfred" },
        locationLabel: "Alfred",
        updatedAt: 200,
        lifecycle: "read-only",
      }],
    );

    render(<App />);

    await waitFor(() => expect(createTerminal).toHaveBeenCalledTimes(1));
    createTerminal.mockClear();

    await selectSurface(user, "Sessions");
    await user.click(await screen.findByRole("option", { name: /Ended mapped session/i }));
    await user.click(screen.getByRole("button", { name: "Open Project" }));

    expect(screen.queryByRole("region", { name: "Sessions workspace" })).not.toBeInTheDocument();
    expect(screen.getByTestId("desk-runtime-surface")).not.toHaveAttribute("aria-hidden");
    await waitFor(() => expect(terminalFocusSessionIds.at(-1)).toBe("manual-1"));
    expect(resolveExternalSession).not.toHaveBeenCalled();
    expect(createTerminal).not.toHaveBeenCalled();
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("falls back from a stale inactive-workspace selection to a real tile for Open Project", async () => {
    const user = userEvent.setup();
    const externalSessionId = "019edc4b-0000-7000-9000-stale-project";
    const {
      createTerminal,
      resolveExternalSession,
      setWorkspaceLayout,
      setWorkspaceViewState,
      writeTerminal,
    } = installDesktopBridge(
      undefined,
      null,
      [
        liveSnapshot("active-a", { title: "Active Alfred", workspaceId: "A" }),
        liveSnapshot("real-b", {
          title: "Real IronLog tile",
          workspaceId: "B",
          cwd: "/Users/patryk/Desktop/IronLog",
        }),
      ],
      undefined,
      {
        layoutsByWorkspace: {},
        viewStateByWorkspace: {
          A: { workMode: "desk", selectedSessionId: "active-a" },
          B: { workMode: "focus", selectedSessionId: "stale-b" },
        },
      },
      {
        workspaces: [
          { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/patryk/Desktop/Alfred" },
          { id: "B", label: "IronLog", shortLabel: "I", rootPath: "/Users/patryk/Desktop/IronLog" },
        ],
        activeWorkspaceId: "A",
      },
      [],
      [{
        sessionKey: `external-codex:${externalSessionId}:200`,
        lineageKey: `external-codex:${externalSessionId}`,
        contentSessionKey: `external-codex:${externalSessionId}`,
        source: "external-codex",
        kind: "codex",
        title: "Mapped IronLog history",
        project: { id: "B", label: "IronLog" },
        locationLabel: "IronLog",
        updatedAt: 200,
        lifecycle: "read-only",
      }],
    );

    render(<App />);

    const backgroundHost = await screen.findByTestId("background-xterm-host");
    expect(backgroundHost).toHaveAttribute("data-session-id", "real-b");
    setWorkspaceLayout.mockClear();
    setWorkspaceViewState.mockClear();
    terminalFocusSessionIds.length = 0;
    await selectSurface(user, "Sessions");
    await user.click(await screen.findByRole("option", { name: /Mapped IronLog history/i }));
    await user.click(screen.getByRole("button", { name: "Open Project" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "IronLog workspace" })).toHaveAttribute("aria-selected", "true");
      expect(terminalFocusSessionIds.at(-1)).toBe("real-b");
    });
    const realTile = screen.getByRole("article", { name: /Real IronLog tile/i });
    expect(within(realTile).getByTestId("xterm-host")).toBe(backgroundHost);
    expect(setWorkspaceViewState).toHaveBeenLastCalledWith({
      workspaceId: "B",
      viewState: { workMode: "focus", selectedSessionId: "real-b" },
    });
    expect(setWorkspaceLayout).toHaveBeenLastCalledWith({
      workspaceId: "B",
      layouts: expect.objectContaining({ "real-b": expect.objectContaining({ tileId: "real-b" }) }),
    });
    expect(createTerminal).not.toHaveBeenCalled();
    expect(resolveExternalSession).not.toHaveBeenCalled();
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("opens an empty mapped project without persisting its stale session selection", async () => {
    const user = userEvent.setup();
    const externalSessionId = "019edc4b-0000-7000-9000-empty-project";
    const {
      createTerminal,
      resolveExternalSession,
      setWorkspaceViewState,
      writeTerminal,
    } = installDesktopBridge(
      undefined,
      null,
      [liveSnapshot("active-a", { title: "Active Alfred", workspaceId: "A" })],
      undefined,
      {
        layoutsByWorkspace: {},
        viewStateByWorkspace: {
          A: { workMode: "desk", selectedSessionId: "active-a" },
          B: { workMode: "focus", selectedSessionId: "stale-empty-b" },
        },
      },
      {
        workspaces: [
          { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/patryk/Desktop/Alfred" },
          { id: "B", label: "Empty", shortLabel: "E", rootPath: "/Users/patryk/Desktop/Empty" },
        ],
        activeWorkspaceId: "A",
      },
      [],
      [{
        sessionKey: `external-codex:${externalSessionId}:200`,
        lineageKey: `external-codex:${externalSessionId}`,
        contentSessionKey: `external-codex:${externalSessionId}`,
        source: "external-codex",
        kind: "codex",
        title: "Mapped empty history",
        project: { id: "B", label: "Empty" },
        locationLabel: "Empty",
        updatedAt: 200,
        lifecycle: "read-only",
      }],
    );

    render(<App />);

    setWorkspaceViewState.mockClear();
    terminalFocusSessionIds.length = 0;
    await selectSurface(user, "Sessions");
    await user.click(await screen.findByRole("option", { name: /Mapped empty history/i }));
    await user.click(screen.getByRole("button", { name: "Open Project" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Empty workspace" })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.queryByRole("region", { name: "Sessions workspace" })).not.toBeInTheDocument();
    expect(setWorkspaceViewState).not.toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "B",
      viewState: expect.objectContaining({ selectedSessionId: "stale-empty-b" }),
    }));
    expect(terminalFocusSessionIds).not.toContain("stale-empty-b");
    expect(createTerminal).not.toHaveBeenCalled();
    expect(resolveExternalSession).not.toHaveBeenCalled();
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("adds an unknown external Codex project through the folder picker and refreshes summaries", async () => {
    const user = userEvent.setup();
    const externalSessionId = "019edc4b-0000-7000-9000-untrusted";
    const {
      bindFolderToWorkspace,
      createTerminal,
      createWorkspaceFromFolder,
      listExternalSessions,
      setWorkspaceState,
      writeTerminal,
    } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [],
      [
        {
          sessionKey: `external-codex:${externalSessionId}:200`,
          lineageKey: `external-codex:${externalSessionId}`,
          contentSessionKey: `external-codex:${externalSessionId}`,
          source: "external-codex",
          kind: "codex",
          title: "Unknown external workspace",
          project: { id: null, label: "External Codex" },
          locationLabel: "Unknown workspace",
          updatedAt: 200,
          lifecycle: "read-only",
        },
      ],
    );

    render(<App />);

    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledTimes(1);
    });
    setWorkspaceState.mockClear();

    await selectSurface(user, "Sessions");
    await user.click(await screen.findByRole("option", { name: /Unknown external workspace/i }));

    const resume = screen.getByRole("button", { name: "Add Project…" });
    expect(resume).toBeEnabled();

    await user.click(resume);
    expect(createTerminal).toHaveBeenCalledTimes(1);
    expect(createWorkspaceFromFolder).toHaveBeenCalledOnce();
    expect(bindFolderToWorkspace).not.toHaveBeenCalled();
    await waitFor(() => expect(listExternalSessions).toHaveBeenCalledTimes(2));
    expect(listExternalSessions).toHaveBeenLastCalledWith({
      projects: expect.arrayContaining([expect.objectContaining({ id: "CLIENTAPP" })]),
      limit: 80,
    });
    expect(writeTerminal).not.toHaveBeenCalled();
    expect(setWorkspaceState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        workspaces: expect.arrayContaining([
          expect.objectContaining({ rootPath: "/Users/patryk/Downloads/UnknownProject" }),
        ]),
      }),
    );
    expect(screen.queryByRole("tab", { name: /UnknownProject workspace/i })).not.toBeInTheDocument();
  });

  it("keeps stale external Codex rows when Sessions refresh fails", async () => {
    const user = userEvent.setup();
    const externalSession: ExternalSessionSummary = {
      sessionKey: "external-codex:019edc4b-0000-7000-9000-stale:200",
      lineageKey: "external-codex:019edc4b-0000-7000-9000-stale",
      contentSessionKey: "external-codex:019edc4b-0000-7000-9000-stale",
      source: "external-codex",
      kind: "codex",
      title: "Previously indexed Codex",
      project: { id: "A", label: "Alfred" },
      locationLabel: "Alfred",
      updatedAt: 200,
      lifecycle: "resumable",
    };
    const { listExternalSessions } = installDesktopBridge(
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

    await selectSurface(user, "Sessions");
    expect(await screen.findByRole("option", { name: /Previously indexed Codex/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(listExternalSessions).toHaveBeenCalledTimes(1);
    });

    listExternalSessions.mockRejectedValueOnce(new Error("index unavailable"));
    await user.click(screen.getByRole("button", { name: "Refresh external sessions" }));

    expect(await screen.findByText("External sessions may be incomplete.")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Previously indexed Codex/i })).toBeInTheDocument();
  });

  it("marks incrementally published external rows as incomplete when a later page fails", async () => {
    const user = userEvent.setup();
    const firstPageSession: ExternalSessionSummary = {
      sessionKey: "external-codex:partial-page",
      lineageKey: "external-codex:partial-page",
      contentSessionKey: "external-codex:partial-page",
      source: "external-codex",
      kind: "codex",
      title: "Published before page failure",
      project: { id: "A", label: "Alfred" },
      locationLabel: "Alfred",
      updatedAt: 300,
      lifecycle: "resumable",
    };
    const { listExternalSessions, releaseListSnapshot } = installDesktopBridge();
    listExternalSessions
      .mockResolvedValueOnce({
        sessions: [firstPageSession],
        nextCursor: "partial-next-page",
        total: 120,
      })
      .mockRejectedValueOnce(new Error("second page unavailable"));

    render(<App />);
    await selectSurface(user, "Sessions");

    expect(await screen.findByRole("option", { name: /Published before page failure/i })).toBeInTheDocument();
    expect(await screen.findByText("External sessions may be incomplete.")).toBeInTheDocument();
    expect(screen.getByText("Refresh failed. Retry when the local session index is available.")).toBeInTheDocument();
    expect(listExternalSessions).toHaveBeenCalledTimes(2);
    expect(releaseListSnapshot).toHaveBeenCalledWith({ cursor: "partial-next-page" });
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

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "local data & privacy");
    expect(screen.getByRole("dialog", { name: "Local Data & Privacy" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", code: "KeyK", metaKey: true });

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Local Data & Privacy" })).not.toBeInTheDocument();
  });

  it("opens Inbox from the command palette when there are no queued decisions", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);

    await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await openInboxFromCommandPalette(user);

    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Inbox workspace" })).toHaveTextContent("Nothing needs you");
  });

  it("treats Sessions as the bounded session navigator and reader", async () => {
    const user = userEvent.setup();
    installDesktopBridge(undefined, null, [liveSnapshot("one"), liveSnapshot("two")]);

    render(<App />);

    await selectSurface(user, "Sessions");
    const sessions = await screen.findByRole("region", { name: "Sessions workspace" });
    expect(sessions).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Projects and Free Chats" })).not.toBeInTheDocument();
    expect(within(sessions).getByRole("searchbox", { name: "Search sessions" })).toHaveFocus();
    expect(within(within(sessions).getByRole("listbox", { name: "Conversation results" })).getAllByRole("option")).toHaveLength(2);
  });

  it("drains external summary pages while keeping each Sessions result page capped at 80", async () => {
    const user = userEvent.setup();
    const externalSessions = Array.from({ length: 120 }, (_, index): ExternalSessionSummary => {
      const suffix = String(index + 1).padStart(3, "0");
      return {
        sessionKey: `opaque-session-${suffix}`,
        lineageKey: `external-codex:fixture-${suffix}`,
        contentSessionKey: `external-codex:fixture-${suffix}`,
        source: "external-codex",
        kind: "codex",
        title: `Bounded external session ${suffix}`,
        project: { id: "A", label: "Alfred" },
        locationLabel: "Alfred",
        updatedAt: 1_720_000_000_000 - index,
        lifecycle: "resumable",
      };
    });
    const { listExternalSessions } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [],
      externalSessions,
    );

    render(<App />);
    await selectSurface(user, "Sessions");
    const sessions = await screen.findByRole("region", { name: "Sessions workspace" });
    const search = within(sessions).getByRole("searchbox", { name: "Search sessions" });
    expect(search).toHaveFocus();
    await user.selectOptions(
      within(sessions).getByRole("combobox", { name: "Session source" }),
      "external-codex",
    );
    await waitFor(() => expect(listExternalSessions).toHaveBeenCalledTimes(2));
    expect(listExternalSessions).toHaveBeenNthCalledWith(1, {
      projects: expect.any(Array),
      limit: 80,
    });
    expect(listExternalSessions).toHaveBeenNthCalledWith(2, {
      projects: expect.any(Array),
      limit: 80,
      cursor: "test-external-cursor:80",
    });
    const results = within(sessions).getByRole("listbox", { name: "Conversation results" });
    expect(within(sessions).getByRole("status", { name: "Conversation count" })).toHaveTextContent("120");
    expect(within(results).getAllByRole("option")).toHaveLength(80);

    await user.click(within(sessions).getByRole("button", { name: "Next" }));
    expect(within(results).getAllByRole("option")).toHaveLength(40);
    expect(within(results).getByRole("option", { name: /Bounded external session 120/i })).toBeVisible();

    await user.type(search, "081");
    expect(search).toHaveFocus();
    expect(within(results).getAllByRole("option")).toHaveLength(1);
    expect(within(results).getByRole("option", { name: /Bounded external session 081/i })).toBeVisible();
  });

  it("debounces non-empty Sessions queries to main and refreshes immediately when cleared", async () => {
    const user = userEvent.setup();
    const lateSession: ExternalSessionSummary = {
      sessionKey: "opaque-late-session",
      lineageKey: "external-codex:late-session",
      contentSessionKey: "external-codex:late-session",
      source: "external-codex",
      kind: "codex",
      title: "Late unique query target",
      project: { id: "A", label: "Alfred" },
      locationLabel: "Alfred",
      updatedAt: 1_720_000_000_000,
      lifecycle: "resumable",
    };
    const { listExternalSessions } = installDesktopBridge();
    listExternalSessions.mockImplementation((request: Parameters<SessionsApi["listExternalSessions"]>[0]) => Promise.resolve({
      sessions: request.query === "late unique" ? [lateSession] : [],
      nextCursor: null,
      total: request.query === "late unique" ? 1 : 0,
    }));

    render(<App />);
    await selectSurface(user, "Sessions");
    const search = screen.getByRole("searchbox", { name: "Search sessions" });
    await waitFor(() => expect(listExternalSessions).toHaveBeenCalledTimes(1));

    await user.type(search, "late unique");
    expect(listExternalSessions).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(listExternalSessions).toHaveBeenLastCalledWith({
      projects: expect.any(Array),
      query: "late unique",
      limit: 80,
    }));
    expect(await screen.findByRole("option", { name: /Late unique query target/i })).toBeVisible();

    await user.clear(search);
    await waitFor(() => expect(listExternalSessions).toHaveBeenLastCalledWith({
      projects: expect.any(Array),
      limit: 80,
    }));
  });

  it("cancels a pending Sessions query reload when refreshed manually", async () => {
    const user = userEvent.setup();
    const { listExternalSessions } = installDesktopBridge();

    render(<App />);
    await selectSurface(user, "Sessions");
    const search = screen.getByRole("searchbox", { name: "Search sessions" });
    await waitFor(() => expect(listExternalSessions).toHaveBeenCalledOnce());
    listExternalSessions.mockClear();

    fireEvent.change(search, { target: { value: "pending query" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh external sessions" }));
    await waitFor(() => expect(listExternalSessions).toHaveBeenCalledOnce());

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    });
    expect(listExternalSessions).toHaveBeenCalledOnce();
  });

  it("releases the unfinished main snapshot when the renderer stops before exhausting its cursor", async () => {
    const user = userEvent.setup();
    const { listExternalSessions, releaseListSnapshot } = installDesktopBridge();
    listExternalSessions.mockResolvedValue({
      sessions: [],
      nextCursor: "unfinished-snapshot",
      total: 5_001,
    });

    render(<App />);
    await selectSurface(user, "Sessions");

    await waitFor(() => expect(releaseListSnapshot).toHaveBeenCalledWith({ cursor: "unfinished-snapshot" }));
    expect(listExternalSessions).toHaveBeenCalledOnce();
  });

  it("surfaces detected localhost URLs in the workspace preview dock", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("connection refused"));
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

    const previewToggle = await screen.findByRole("button", { name: "Preview" });
    expect(previewToggle).toBeEnabled();
    expect(previewToggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByLabelText("Workspace preview")).not.toBeInTheDocument();

    await user.click(previewToggle);
    const preview = await screen.findByLabelText("Workspace preview");
    expect(within(preview).getByText("localhost:5173")).toBeInTheDocument();
    expect(within(preview).queryByText("example.com")).not.toBeInTheDocument();
    expect(await within(preview).findByText("Preview is offline")).toBeInTheDocument();
    expect(within(preview).queryByTitle("Preview of http://localhost:5173/")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(preview).getByRole("button", { name: "Open preview externally" }));

    expect(openExternalUrl).toHaveBeenCalledWith({ url: "http://localhost:5173/" });

    await user.click(screen.getByRole("button", { name: "Close Manual · dev server" }));

    expect(screen.queryByLabelText("Workspace preview")).not.toBeInTheDocument();
  });

  it("surfaces preview launch failures at the shell action site", async () => {
    const user = userEvent.setup();
    const { openExternalUrl } = installDesktopBridge(undefined, null, [
      liveSnapshot("preview", { buffer: "Ready at http://localhost:5173/\n" }),
    ]);
    openExternalUrl.mockResolvedValue({ ok: false, error: "Browser could not open this preview." });

    render(<App />);

    const previewToggle = await screen.findByRole("button", { name: "Preview" });
    await user.click(previewToggle);
    const preview = await screen.findByLabelText("Workspace preview");
    await user.click(within(preview).getByRole("button", { name: "Open preview externally" }));

    expect(await screen.findByRole("alert", { name: "Shell action failed" })).toHaveTextContent(
      "Browser could not open this preview.",
    );
  });

  it("reports an unavailable Preview clipboard through the shell alert", async () => {
    const user = userEvent.setup();
    const optionalClipboardNavigator: { readonly clipboard?: Clipboard } = navigator;
    const clipboardGetter = vi.spyOn(optionalClipboardNavigator, "clipboard", "get").mockReturnValue(undefined);
    try {
      installDesktopBridge(undefined, null, [
        liveSnapshot("preview-copy", { buffer: "Ready at http://localhost:5173/\n" }),
      ]);

      render(<App />);
      await user.click(await screen.findByRole("button", { name: "Preview" }));
      await user.click(screen.getByRole("button", { name: "More Preview actions" }));
      await user.click(screen.getByRole("menuitem", { name: "Copy URL" }));

      expect(await screen.findByRole("alert", { name: "Shell action failed" })).toHaveTextContent(
        "Clipboard is unavailable.",
      );
    } finally {
      clipboardGetter.mockRestore();
    }
  });

  it("adds preview URLs from live terminal output", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("connection refused"));
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
    await emitData({
      id: "runtime-dev",
      data: "ready on http://127.0.0.1:3000/app\n",
      activities: [{
        id: "manual-dev-activity-1",
        kind: "output",
        title: "Progress reported",
        detail: "ready on http://127.0.0.1:3000/app",
        at: 100,
      }],
    });

    const previewToggle = await screen.findByRole("button", { name: "Preview" });
    await user.click(previewToggle);
    const preview = await screen.findByLabelText("Workspace preview");
    expect(within(preview).getByText("127.0.0.1:3000/app")).toBeInTheDocument();
    expect(within(preview).getByText("Preview is offline")).toBeInTheDocument();
    expect(within(preview).queryByTitle("Preview of http://127.0.0.1:3000/app")).not.toBeInTheDocument();
  });

  it("closes and reopens Preview without remounting the terminal work surface", async () => {
    const user = userEvent.setup();
    installDesktopBridge(undefined, null, [
      liveSnapshot("preview-toggle", { buffer: "Ready at http://localhost:5173/\n" }),
    ]);

    render(<App />);

    const terminalHost = await screen.findByTestId("xterm-host");
    const previewToggle = await screen.findByRole("button", { name: "Preview" });
    await user.click(previewToggle);
    const preview = await screen.findByLabelText("Workspace preview");
    await user.click(within(preview).getByRole("button", { name: "Close Preview" }));

    expect(screen.queryByLabelText("Workspace preview")).not.toBeInTheDocument();
    expect(screen.getByTestId("xterm-host")).toBe(terminalHost);
    expect(screen.getByRole("button", { name: "Preview" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByLabelText("Workspace preview")).toBeInTheDocument();
  });

  it("keeps Preview and Context mutually exclusive without replacing xterm", async () => {
    const user = userEvent.setup();
    installDesktopBridge(undefined, null, [
      liveSnapshot("context-preview", {
        buffer: "Ready at http://localhost:5173/\n",
      }),
    ]);
    render(<App />);

    const xtermHost = await screen.findByTestId("xterm-host");
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByLabelText("Workspace preview")).toBeVisible();

    await selectSurface(user, "Context");
    expect(screen.queryByLabelText("Workspace preview")).not.toBeInTheDocument();
    expect(screen.getByTestId("workbench-shell")).toHaveClass("context-visible");
    expect(screen.getByRole("complementary", { name: "Session context" })).toBeVisible();
    expect(screen.getByTestId("xterm-host")).toBe(xtermHost);

    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByLabelText("Workspace preview")).toBeVisible();
    expect(screen.getByTestId("workbench-shell")).not.toHaveClass("context-visible");
    expect(screen.getByTestId("xterm-host")).toBe(xtermHost);
  });

  it("hydrates Preview open state and width independently per workspace", async () => {
    const user = userEvent.setup();
    installDesktopBridge(
      undefined,
      null,
      [
        liveSnapshot("preview-a", {
          workspaceId: "A",
          buffer: "Ready at http://localhost:5173/a\n",
        }),
        liveSnapshot("preview-b", {
          workspaceId: "B",
          cwd: "/Users/patryk/Desktop/IronLog",
          buffer: "Ready at http://localhost:4173/b\n",
        }),
      ],
      undefined,
      {
        layoutsByWorkspace: {},
        viewStateByWorkspace: {
          A: { previewDockOpen: false, previewDockWidth: 460 },
          B: { previewDockOpen: true, previewDockWidth: 580 },
        },
      },
      {
        workspaces: [
          { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/patryk/Desktop/Alfred" },
          { id: "B", label: "IronLog", shortLabel: "I", rootPath: "/Users/patryk/Desktop/IronLog" },
        ],
        activeWorkspaceId: "A",
      },
    );

    render(<App />);

    expect(await screen.findByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByLabelText("Workspace preview")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "IronLog workspace" }));

    expect(await screen.findByLabelText("Workspace preview")).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize Preview" })).toHaveAttribute("aria-valuenow", "580");

    await user.click(screen.getByRole("tab", { name: "Alfred workspace" }));
    expect(screen.queryByLabelText("Workspace preview")).not.toBeInTheDocument();
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

    await act(async () => {
      primaryAction.click();
    });
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({ source: "manual", workspaceId: "A" }));
    });
    expect(createTerminal.mock.calls[0]?.[0]).not.toHaveProperty("cwd");

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "manual terminal");
    const palette = screen.getByRole("dialog", { name: "Command palette" });
    expect(within(palette).getByText("New manual terminal")).toBeInTheDocument();
    expect(within(palette).getByText(/(?:Cmd|Ctrl) T · start a shell in the scratch desk/)).toBeInTheDocument();
    await pressCommandPaletteEnter(screen.getByRole("textbox", { name: "Search commands" }));
    await waitFor(() => expect(createTerminal).toHaveBeenCalledTimes(2));

    await openPrepareWork(user);
    await user.type(screen.getByRole("textbox", { name: "Dispatch instruction" }), "prepare codex");
    await act(async () => {
      screen.getByRole("button", { name: /Prepare work (?:in|with) / }).click();
    });
    await waitFor(() => expect(requestPlan).toHaveBeenCalledOnce());
    expect(requestPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "prepare codex",
        workspace: expect.not.objectContaining({ rootPath: expect.any(String) }),
      }),
    );

    expect(createWorkspaceFromFolder).not.toHaveBeenCalled();
    await waitForTerminalStartsToSettle();
  });

  it("recovers a workspace whose saved folder is unavailable", async () => {
    const user = userEvent.setup();
    const { bindFolderToWorkspace, createTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      {
        workspaces: [
          {
            id: "A",
            label: "Missing project",
            shortLabel: "MP",
            rootPath: "/Users/patryk/Desktop/MissingProject",
            rootStatus: "missing",
          },
        ],
        activeWorkspaceId: "A",
      },
    );
    bindFolderToWorkspace.mockResolvedValueOnce({
      workspaces: [
        {
          id: "A",
          label: "Missing project",
          shortLabel: "MP",
          rootPath: "/Users/patryk/Desktop/MissingProject",
          rootStatus: "missing",
        },
      ],
      activeWorkspaceId: "A",
    });

    render(<App />);

    const emptyState = await screen.findByRole("status", { name: "Unavailable workspace folder" });
    expect(emptyState).toHaveTextContent("Folder unavailable");
    expect(emptyState).toHaveTextContent("…/Desktop/MissingProject");
    expect(within(emptyState).queryByRole("button", { name: "New terminal" })).not.toBeInTheDocument();
    expect(within(emptyState).queryByRole("button", { name: "Start Codex" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New terminal" })).toBeDisabled();
    expect(createTerminal).not.toHaveBeenCalled();

    await user.click(within(emptyState).getByRole("button", { name: "Choose folder" }));
    expect(bindFolderToWorkspace).toHaveBeenCalledWith({ workspaceId: "A" });
    expect(createTerminal).not.toHaveBeenCalled();

    await user.click(
      within(await screen.findByRole("status", { name: "Unavailable workspace folder" }))
        .getByRole("button", { name: "Choose folder" }),
    );
    expect(bindFolderToWorkspace).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: "/Users/patryk/TrustedWorkspace",
          source: "manual",
          workspaceId: "A",
        }),
      );
    });
  });

  it("keeps browser fallback terminal status consistent across tile and workspace", async () => {
    const user = userEvent.setup();

    render(<App />);

    const emptyState = await screen.findByRole("status", { name: "Empty workspace" });
    await user.click(within(emptyState).getByRole("button", { name: "New terminal" }));

    const tile = await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await waitFor(() => {
      expect(within(tile).getByText("unavailable")).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Alfred workspace" })).toBeInTheDocument();
      const navigatorSession = screen.getByRole("button", { name: "Manual · zsh 1" });
      expect(navigatorSession).toHaveAttribute("title", "Manual · zsh 1 · unavailable");
    });
  });

  it("creates scratch workspaces and scopes terminals to the active workspace", async () => {
    const user = userEvent.setup();
    const { createTerminal, createWorkspaceFromFolder, setWorkspaceState } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("tab", { name: "Alfred workspace" })).toBeInTheDocument();
    expect(within(screen.getByTestId("workbench-header")).queryByText("Alfred")).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add workspace" }));

    expect(createWorkspaceFromFolder).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Workspace 2 workspace" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Workspace 2 workspace" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("status", { name: "Empty workspace" })).toHaveTextContent("Scratch workspace ready");
    expect(screen.queryByRole("article", { name: /Manual · zsh 1/i })).not.toBeInTheDocument();

    await user.click(within(screen.getByRole("status", { name: "Empty workspace" })).getByRole("button", { name: "New terminal" }));
    expect(screen.getByRole("article", { name: /Manual · zsh 2/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenLastCalledWith(
        expect.objectContaining({ workspaceId: "W2" }),
      );
    });

    await user.click(screen.getByRole("tab", { name: "Alfred workspace" }));

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

  it("shows and dismisses workspace action failures without leaking them into Prepare Work", async () => {
    const user = userEvent.setup();
    const { revealPath } = installDesktopBridge();
    revealPath.mockResolvedValue({ ok: false, error: "Finder could not reveal this workspace." });

    render(<App />);

    await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await user.click(screen.getByRole("button", { name: "Workspace menu for Alfred" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Workspace actions" })).getByRole("button", { name: /Reveal/ }),
    );

    const alert = await screen.findByRole("alert", { name: "Shell action failed" });
    expect(alert).toHaveTextContent("Finder could not reveal this workspace.");

    const composer = await openPrepareWork(user);
    expect(composer).toHaveAttribute("data-state", "ready");
    expect(within(composer).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(composer).getByRole("status")).toBeEmptyDOMElement();

    await user.click(within(alert).getByRole("button", { name: "Dismiss action error" }));
    expect(screen.queryByRole("alert", { name: "Shell action failed" })).not.toBeInTheDocument();
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

    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "prepare the next slice");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));

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

    await screen.findByRole("button", { name: "Workspace menu for Alfred" });
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
    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "prepare cleanly");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));

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
    expect(await screen.findByRole("tab", { name: "Workspace 2 workspace" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("status", { name: "Empty workspace" })).toHaveTextContent("Workspace 2");

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "close current");

    expect(screen.queryByRole("tab", { name: "Workspace 2 workspace" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Alfred workspace" })).toHaveAttribute("aria-selected", "true");
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

    expect(await screen.findByRole("tab", { name: "Workspace 2 workspace" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(screen.getByTestId("workbench-header")).queryByText("Workspace 2")).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: "/tmp/workspace-2" }));
    });
  });

  it("retries renderer hydration without invoking save retry and gates workspace autosave until success", async () => {
    const user = userEvent.setup();
    const { createTerminal, retrySave, setWorkspaceState } = installDesktopBridge();
    let rejectHydration!: (error: Error) => void;
    const hydrationFailure = new Promise<Awaited<ReturnType<TerminalApi["list"]>>>((_, reject) => {
      rejectHydration = reject;
    });
    const terminalList = vi.fn()
      .mockReturnValueOnce(hydrationFailure)
      .mockResolvedValueOnce({ sessions: [], restoredSessions: [] });
    window.alfredDesktop!.terminal.list = terminalList;

    render(<App />);

    await waitFor(() => {
      expect(terminalList).toHaveBeenCalledTimes(1);
    });
    await user.click(screen.getByRole("button", { name: "Open launch menu" }));
    await user.click(screen.getByRole("menuitem", { name: "New manual terminal" }));
    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({ clientId: "manual-1" }));
    });

    await act(async () => {
      rejectHydration(new Error("transient terminal hydration failure"));
      await hydrationFailure.catch(() => undefined);
    });

    const hydrationAlert = screen.getByRole("alert");
    expect(hydrationAlert).toHaveTextContent("Workspace not loaded");
    expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Empty workspace" })).not.toBeInTheDocument();
    expect(setWorkspaceState).not.toHaveBeenCalled();

    await user.click(within(hydrationAlert).getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(terminalList).toHaveBeenCalledTimes(2);
    });
    expect(retrySave).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByText("Workspace not loaded")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(setWorkspaceState).toHaveBeenCalledWith({
        workspaces: [
          { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/patryk/Desktop/Alfred", gitBranch: "main" },
        ],
        activeWorkspaceId: "A",
      });
    });
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

    await user.click(screen.getByRole("tab", { name: "Alfred workspace" }));

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    expect(createTerminal).toHaveBeenCalledTimes(1);
  });

  it("enables arrange mode without duplicating the Work layout controls", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "arrange tiles");

    const stage = screen.getByLabelText("terminals");
    expect(stage).not.toHaveClass("headerless");
    expect(stage.querySelector(".terminal-stage-header")).toBeInTheDocument();
    expect(screen.getByText("Arrange mode")).toBeInTheDocument();
    expect(screen.getByText("drag header · resize corner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply Full preset" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply Split preset" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply Grid preset" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move right" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Widen" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resize Manual · zsh 1" })).toBeInTheDocument();
  });

  it("switches desk work modes without entering arrange mode", async () => {
    const user = userEvent.setup();
    const { setWorkspaceLayout } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open launch menu" }));
    await user.click(screen.getByRole("menuitem", { name: "New manual terminal" }));
    await screen.findByRole("article", { name: /Manual · zsh 2/i });
    expect(screen.getByRole("button", { name: "Open layout menu, Grid selected" })).toBeInTheDocument();
    await chooseWorkLayout(user, "Split");

    expect(screen.getByRole("button", { name: "Open layout menu, Split selected" })).toBeInTheDocument();
    expect(setWorkspaceLayout).toHaveBeenLastCalledWith({
      workspaceId: "A",
      layouts: expect.objectContaining({
        "manual-1": expect.objectContaining({ col: 1, colSpan: 6, rowSpan: 8 }),
        "manual-2": expect.objectContaining({ col: 7, colSpan: 6, rowSpan: 8 }),
      }),
    });

    await chooseWorkLayout(user, "Grid");

    expect(screen.getByRole("button", { name: "Open layout menu, Grid selected" })).toBeInTheDocument();
  });

  it("applies layout presets to the current workspace sessions after a session is added", async () => {
    const user = userEvent.setup();
    const { setWorkspaceLayout } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open launch menu" }));
    await user.click(screen.getByRole("menuitem", { name: "New manual terminal" }));
    expect(await screen.findByRole("article", { name: /Manual · zsh 2/i })).toBeInTheDocument();

    await chooseWorkLayout(user, "Focus");
    expect(screen.getByRole("button", { name: "Open layout menu, Focus selected" })).toBeInTheDocument();

    await waitFor(() => {
      expect(setWorkspaceLayout).toHaveBeenLastCalledWith(
        expect.objectContaining({
          layouts: expect.objectContaining({
            "manual-1": expect.any(Object),
            "manual-2": expect.any(Object),
          }),
        }),
      );
    });
  });

  it("shows a useful second pane prompt when split mode has one session", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "split mode");

    const splitPrompt = screen.getByLabelText("Split mode needs another session");
    expect(splitPrompt).toHaveTextContent("Create another terminal to fill this split");

    await user.click(within(splitPrompt).getByRole("button", { name: "Back to grid" }));

    expect(screen.queryByLabelText("Split mode needs another session")).not.toBeInTheDocument();
    expect(screen.getByLabelText("terminals")).toHaveClass("mode-desk");
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

    expect(await screen.findByLabelText("terminals")).toHaveClass("mode-split");
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

    expect(await screen.findByRole("button", { name: "Open layout menu, Focus selected" })).toBeInTheDocument();
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

    expect(await screen.findByRole("button", { name: "Open layout menu, Focus selected" })).toBeInTheDocument();
    const focusedTile = await screen.findByRole("article", { name: /Claude - UI\/UX Deep Analysis/i });
    expect(focusedTile).toHaveClass("selected");

    setWorkspaceViewState.mockClear();
    await chooseWorkLayout(user, "Split");

    expect(screen.getByRole("button", { name: "Open layout menu, Split selected" })).toBeInTheDocument();
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
          cursorBlink: alfredGraphiteTerminalProfile.cursorBlink,
          cursorStyle: alfredGraphiteTerminalProfile.cursorStyle,
          fontFamily: alfredGraphiteTerminalProfile.fontFamily,
          fontSize: alfredGraphiteTerminalProfile.fontSize,
          lineHeight: alfredGraphiteTerminalProfile.lineHeight,
          theme: expect.objectContaining({
            background: alfredGraphiteTerminalProfile.theme.background,
            cursor: alfredGraphiteTerminalProfile.theme.cursor,
            selectionBackground: alfredGraphiteTerminalProfile.theme.selectionBackground,
            selectionForeground: alfredGraphiteTerminalProfile.theme.selectionForeground,
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
    await user.click(screen.getByRole("button", { name: "Open launch menu" }));
    await user.click(screen.getByRole("menuitem", { name: "New Codex session" }));

    await waitFor(() => {
      const codexCalls = createTerminal.mock.calls.filter(([request]) => request.clientId === "codex-1");
      expect(codexCalls).toHaveLength(1);
    });
    expect(await screen.findByRole("article", { name: /Codex · session 1/i })).toHaveTextContent("spawn failed");

    await chooseWorkLayout(user, "Focus");
    expect(screen.getByRole("button", { name: "Open layout menu, Focus selected" })).toBeInTheDocument();
    await chooseWorkLayout(user, "Split");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open layout menu, Split selected" })).toBeInTheDocument();
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

    expect(tile).toHaveClass("selected");
    await selectSurface(user, "Context");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Manual · zsh 1");

    await user.dblClick(header);

    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Manual · zsh 1");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Session attached");
    });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
    expect(screen.getByTestId("context-column")).toHaveClass("closed");
    await waitFor(() => expect(screen.getByRole("button", { name: "Open Surfaces menu" })).toHaveFocus());
  });

  it("lets Context consume Escape before a previously entered Focus mode", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);

    await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await chooseWorkLayout(user, "Focus");
    expect(screen.getByRole("button", { name: "Open layout menu, Focus selected" })).toBeInTheDocument();
    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");

    await selectSurface(user, "Context");
    expect(screen.getByTestId("context-column")).toHaveClass("open");

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
    expect(screen.getByTestId("context-column")).toHaveClass("closed");
    await waitFor(() => expect(screen.getByRole("button", { name: "Open Surfaces menu" })).toHaveFocus());
  });

  it("opens Context from the command palette and returns focus to its surviving trigger", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);

    await screen.findByRole("article", { name: /Manual · zsh 1/i });
    const paletteTrigger = screen.getByRole("button", { name: "Open command palette" });
    await user.click(paletteTrigger);
    await submitCommandPalette(user, "open context");

    expect(screen.getByTestId("context-column")).toHaveClass("open");
    const closeContext = screen.getByRole("button", { name: "Close Context panel" });
    await waitFor(() => expect(closeContext).toHaveFocus());

    await user.click(closeContext);

    expect(screen.getByTestId("context-column")).toHaveClass("closed");
    await waitFor(() => expect(paletteTrigger).toHaveFocus());
  });

  it("focus mode isolates the selected session and keeps navigator selection available", async () => {
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

    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Manual · zsh 2");
    expect(screen.queryByRole("article", { name: /Manual · zsh 1/i })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Manual · zsh 2/i })).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Sessions" })).not.toBeInTheDocument();
    expect(setWorkspaceLayout).toHaveBeenLastCalledWith({
      workspaceId: "A",
      layouts: expect.objectContaining({
        "manual-2": expect.objectContaining({ col: 1, colSpan: 12 }),
      }),
    });

    await userEvent.click(screen.getByRole("button", { name: /Manual · zsh 1/i }));

    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Manual · zsh 1");
    expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /Manual · zsh 2/i })).not.toBeInTheDocument();
  });

  it("selects a new terminal immediately while Focus mode is active", async () => {
    const user = userEvent.setup();
    const { setWorkspaceViewState } = installDesktopBridge(
      undefined,
      null,
      [
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
      ],
      undefined,
      {
        layoutsByWorkspace: {},
        viewStateByWorkspace: {
          A: { workMode: "focus", selectedSessionId: "manual-1" },
        },
      },
    );

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New terminal" }));

    expect(await screen.findByRole("article", { name: /Manual · zsh 2/i })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /Manual · zsh 1/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Manual · zsh 2");
    expect(setWorkspaceViewState).toHaveBeenLastCalledWith({
      workspaceId: "A",
      viewState: { workMode: "focus", selectedSessionId: "manual-2" },
    });
  });

  it("announces an empty command palette result", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    const palette = screen.getByRole("dialog", { name: "Command palette" });
    await user.type(within(palette).getByRole("textbox", { name: "Search commands" }), "no such alfred command");

    expect(within(palette).getByRole("status")).toHaveTextContent("No matching command.");
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
    await pressCommandPaletteEnter(screen.getByRole("textbox", { name: "Search commands" }));

    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    expect(await screen.findByRole("article", { name: /Manual · zsh 2/i })).toBeInTheDocument();
    await waitForTerminalStartsToSettle();

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "split");

    expect(screen.getByRole("button", { name: "Open layout menu, Split selected" })).toBeInTheDocument();
    expect(setWorkspaceLayout).toHaveBeenLastCalledWith({
      workspaceId: "A",
      layouts: expect.objectContaining({
        "manual-1": expect.objectContaining({ colSpan: 6 }),
        "manual-2": expect.objectContaining({ colSpan: 6 }),
      }),
    });

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "scratch");

    expect(createWorkspaceFromFolder).not.toHaveBeenCalled();
    expect(await screen.findByRole("tab", { name: "Workspace 2 workspace" })).toHaveAttribute("aria-selected", "true");
    expect(setWorkspaceState).toHaveBeenLastCalledWith({
      workspaces: [
        { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/patryk/Desktop/Alfred", gitBranch: "main" },
        { id: "W2", label: "Workspace 2", shortLabel: "W2" },
      ],
      activeWorkspaceId: "W2",
    });

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "alfred");

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Alfred workspace" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "zsh 2");

    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
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
    await pressCommandPaletteEnter(within(palette).getByRole("textbox", { name: "Search commands" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /ClientApp workspace/i })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
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
    await submitCommandPalette(user, "close focused session");

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
    await submitCommandPalette(user, "codex");

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
    await submitCommandPalette(user, "codex isolated");

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
    await selectSurface(user, "Context");

    const checkoutActions = screen.getByRole("toolbar", { name: "checkout actions for Codex · isolated review" });
    await user.click(within(checkoutActions).getByRole("button", { name: "Review diff" }));

    expect(worktreeDiff).toHaveBeenCalledWith({ clientId: "codex-1" });
    await user.click(screen.getByRole("button", { name: /^Activity \(/ }));
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

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "arrange tiles");
    const arrangingCheckoutActions = screen.getByRole("toolbar", {
      name: "checkout actions for Codex · isolated review",
    });
    expect(within(arrangingCheckoutActions).getByRole("button", { name: "Applying..." })).toBeDisabled();
    const arrangedTile = screen.getByRole("article", { name: /Codex · isolated review/i });
    await user.click(within(arrangedTile).getByRole("button", { name: "Rename Codex · isolated review" }));
    const input = within(arrangedTile).getByRole("textbox", { name: "Rename Codex · isolated review" });
    await user.clear(input);
    await user.type(input, "Spec reviewer{Enter}");

    expect(renameTerminal).toHaveBeenCalledWith({ clientId: "codex-1", title: "Spec reviewer" });
    await chooseWorkLayout(user, "Arrange");
    expect(screen.getByRole("button", { name: "Open layout menu, Focus selected" })).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "close focused session");
    await waitFor(() => expect(screen.queryByRole("article", { name: /Codex · isolated review/i })).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "codex isolated");
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: "codex-1",
          isolation: "worktree",
        }),
      );
    });
    const newTile = await screen.findByRole("article", { name: /Codex · session 1/i });

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

    await user.click(screen.getByRole("button", { name: "Open launch menu" }));
    await user.click(screen.getByRole("menuitem", { name: "New Codex session" }));

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

    await user.click(screen.getByRole("button", { name: "Open launch menu" }));
    await user.click(screen.getByRole("menuitem", { name: "New Claude session" }));

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

  it("opens the global Inbox and focuses attention in another workspace", async () => {
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

    await openInboxFromCommandPalette(user);

    const inbox = screen.getByRole("region", { name: "Inbox workspace" });
    expect(inbox).toHaveTextContent("ClientApp");
    expect(inbox).toHaveTextContent("Codex · review");
    expect(inbox).toHaveTextContent("Alfred");
    expect(inbox).toHaveTextContent("Local Codex · review");

    await user.click(within(inbox).getByTestId("inbox-decision-select-W2:codex-w2"));
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("region", { name: "Inbox workspace" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /ClientApp workspace/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Codex · review");

    await user.click(screen.getByRole("tab", { name: /Alfred workspace/i }));
    await openInboxFromCommandPalette(user);

    expect(screen.getByRole("region", { name: "Inbox workspace" })).toBeInTheDocument();
  });

  it("uses the command palette Inbox as the decision entry point for current workspace items", async () => {
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
    expect(screen.getByRole("button", { name: "Open Inbox surface, 1 item" })).toBeInTheDocument();

    await openInboxFromCommandPalette(user);
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    const inbox = screen.getByRole("region", { name: "Inbox workspace" });
    await user.click(inbox.querySelector<HTMLButtonElement>(".inbox-docket__primary")!);

    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Codex · review");
  });

  it("opens inferred waiting work on Enter without writing approval text to the PTY", async () => {
    const user = userEvent.setup();
    const { createTerminal, writeTerminal } = installDesktopBridge(
      undefined,
      null,
      [
        {
          id: "runtime-waiting",
          clientId: "WAITING",
          title: "Waiting agent",
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
              id: "approval-1",
              kind: "approval",
              title: "Waiting for approval",
              detail: "Allow edit in app.tsx?",
              payload: { type: "approval", prompt: "Allow edit in app.tsx?" },
              at: 100,
            },
          ],
          lastActivityAt: 100,
        },
      ],
    );

    render(<App />);
    await openInboxFromCommandPalette(user);
    const terminalHost = screen.getByTestId("xterm-host");
    const terminalFocus = vi.fn();
    terminalHost.addEventListener("focusin", terminalFocus);

    expect(screen.getByRole("button", { name: "Open in Work Waiting agent in Alfred" })).toBeVisible();
    expect(screen.getByTestId("inbox-decision-select-A:WAITING")).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("region", { name: "Inbox workspace" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
    expect(screen.getByTestId("desk-runtime-surface")).not.toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("xterm-host")).toBe(terminalHost);
    expect(terminalFocus).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Waiting agent");
    expect(createTerminal).not.toHaveBeenCalled();
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("launches staged work from the global Inbox in its workspace", async () => {
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

    await openInboxFromCommandPalette(user);
    const inbox = screen.getByRole("region", { name: "Inbox workspace" });
    await user.click(within(inbox).getByRole("button", { name: "Launch Client task in ClientApp" }));

    expect(screen.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
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

  it("keeps an immediate approval prompt newer than the session attachment event", async () => {
    const user = userEvent.setup();
    const bridge = installDesktopBridge(
      undefined,
      {
        id: "plan-immediate-approval",
        prompt: "wait for approval",
        sessions: [
          {
            id: "alfred-waiting",
            kind: "shell",
            title: "Immediate approval",
            command: "/bin/cat",
            args: [],
            workspaceId: "A",
          },
        ],
      },
    );
    bridge.createTerminal.mockImplementation(async (request) => {
      const snapshot: TerminalSessionSnapshot = {
        id: "runtime-immediate-approval",
        clientId: request.clientId ?? "alfred-waiting",
        title: request.title ?? "Immediate approval",
        source: request.source ?? "alfred",
        agentKind: request.agentKind,
        workspaceId: request.workspaceId ?? "A",
        cwd: request.cwd ?? "/Users/patryk/Desktop/Alfred",
        createdAt: 100,
        shell: "/bin/sh",
        command: request.command,
        args: request.args,
        buffer: "Approval required: continue?\n",
        activityEvents: [
          {
            id: "alfred-waiting-activity-101-1",
            kind: "approval",
            title: "Approval required",
            detail: "Approval required: continue?",
            payload: { type: "approval", prompt: "Approval required: continue?" },
            at: 101,
          },
        ],
        lastActivityAt: 101,
        lastOutputAt: 101,
      };
      bridge.setTerminalSnapshots([snapshot]);
      const { buffer: _buffer, activityEvents: _activityEvents, lastActivityAt: _lastActivityAt,
        lastOutputAt: _lastOutputAt, ...runtime } = snapshot;
      return runtime;
    });

    render(<App />);
    await openInboxFromCommandPalette(user);
    await user.click(screen.getByRole("button", { name: "Launch Immediate approval in Alfred" }));

    const waiting = await screen.findByTestId("inbox-decision-A:alfred-waiting");
    expect(waiting).toHaveTextContent("Needs response · inferred");
    expect(within(waiting).getByRole("button", {
      name: "Open in Work Immediate approval in Alfred",
    })).toBeEnabled();
  });

  it("routes approval output by client id before terminal creation resolves", async () => {
    const user = userEvent.setup();
    const bridge = installDesktopBridge(
      undefined,
      {
        id: "plan-early-approval",
        prompt: "wait for early approval",
        sessions: [
          {
            id: "alfred-early-waiting",
            kind: "shell",
            title: "Early approval",
            command: "/bin/cat",
            args: [],
            workspaceId: "A",
          },
        ],
      },
    );
    const creation = deferred<Awaited<ReturnType<TerminalApi["create"]>>>();
    bridge.createTerminal.mockImplementation(() => creation.promise);

    render(<App />);
    await openInboxFromCommandPalette(user);
    await user.click(screen.getByRole("button", { name: "Launch Early approval in Alfred" }));
    await waitFor(() => expect(bridge.createTerminal).toHaveBeenCalledOnce());

    const earlyEvent: TerminalDataEvent & { clientId: string } = {
      id: "runtime-early-approval",
      clientId: "alfred-early-waiting",
      data: "Approval required: continue?\n",
      activities: [
        {
          id: "alfred-early-waiting-activity-101-1",
          kind: "approval",
          title: "Approval required",
          detail: "Approval required: continue?",
          payload: { type: "approval", prompt: "Approval required: continue?" },
          at: 101,
        },
      ],
    };
    await bridge.emitData(earlyEvent);
    expect(document.querySelector('[data-session-id="alfred-early-waiting"]')).toHaveAttribute(
      "aria-label",
      "Early approval, Approval required: Approval required: continue?",
    );
    creation.resolve({
      id: "runtime-early-approval",
      clientId: "alfred-early-waiting",
      title: "Early approval",
      source: "alfred",
      agentKind: "shell",
      workspaceId: "A",
      cwd: "/Users/patryk/Desktop/Alfred",
      createdAt: 100,
      shell: "/bin/sh",
      command: "/bin/cat",
      args: [],
    });
    await creation.promise;

    const waiting = await screen.findByTestId("inbox-decision-A:alfred-early-waiting");
    expect(waiting).toHaveTextContent("Needs response · inferred");
  });

  it("routes an early exit by client id without reviving the finished runtime when create resolves", async () => {
    const user = userEvent.setup();
    const bridge = installDesktopBridge(
      undefined,
      {
        id: "plan-early-exit",
        prompt: "exit before create resolves",
        sessions: [{
          id: "alfred-early-exit",
          kind: "shell",
          title: "Early exit",
          command: "/usr/bin/printf",
          args: ["done\\n"],
          workspaceId: "A",
        }],
      },
    );
    const creation = deferred<Awaited<ReturnType<TerminalApi["create"]>>>();
    bridge.createTerminal.mockImplementation(() => creation.promise);

    render(<App />);
    await openInboxFromCommandPalette(user);
    await user.click(screen.getByRole("button", { name: "Launch Early exit in Alfred" }));
    await waitFor(() => expect(bridge.createTerminal).toHaveBeenCalledOnce());

    await bridge.emitExit({
      id: "runtime-early-exit",
      clientId: "alfred-early-exit",
      exitCode: 0,
    });
    await openInboxFromCommandPalette(user);
    expect(screen.getByRole("button", { name: "Recovery · 1 saved session" })).toBeInTheDocument();

    await act(async () => {
      creation.resolve({
        id: "runtime-early-exit",
        clientId: "alfred-early-exit",
        title: "Early exit",
        source: "alfred",
        agentKind: "shell",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        createdAt: 100,
        shell: "/usr/bin/printf",
        command: "/usr/bin/printf",
        args: ["done\\n"],
      });
      await creation.promise;
    });

    expect(screen.getByRole("button", { name: "Recovery · 1 saved session" })).toBeInTheDocument();
  });

  it("shows unsafe commands as blocked in the global Inbox", async () => {
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

    await openInboxFromCommandPalette(user);

    const inbox = screen.getByRole("region", { name: "Inbox workspace" });
    expect(inbox).toHaveTextContent("ClientApp");
    expect(inbox).toHaveTextContent("rm -rf dist");
    expect(inbox).toHaveTextContent("rm -rf detected");

    expect(within(inbox).getByRole("button", { name: "Review / Edit Risky cleanup in ClientApp" })).toBeEnabled();
    expect(resolveStagedPlan).not.toHaveBeenCalled();
    expect(createTerminal).not.toHaveBeenCalled();
  });

  it("moves and resizes a tile with pointer gestures in arrange mode", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "arrange tiles");

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
    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "arrange tiles");

    const grid = screen.getByLabelText("terminals").querySelector(".terminal-grid");
    expect(grid).toHaveClass("arranging");

    await chooseWorkLayout(user, "Arrange");
    expect(screen.getByRole("button", { name: "Open layout menu, Grid selected" })).toBeInTheDocument();

    expect(grid).toHaveClass("laid-out");
    expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toHaveStyle({ gridColumn: "1 / span 12" });
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

    await waitFor(() => {
      expect(screen.queryByRole("article", { name: /Manual · zsh 9/i })).not.toBeInTheDocument();
      expect(killTerminal).toHaveBeenCalledWith({ id: "runtime-a" });
    });
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
        command: "zsh",
        args: [],
        buffer: "",
      },
    ]);

    render(<App />);

    await screen.findByRole("article", { name: /Manual · zsh 9/i });
    expect(createTerminal).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(window.alfredDesktop?.terminal.onExit).toHaveBeenCalled();
    });
    await emitExit({ id: "runtime-a", exitCode: 0 });

    await openInboxFromCommandPalette(user);
    const inbox = screen.getByRole("region", { name: "Inbox workspace" });
    await user.click(within(inbox).getByRole("button", { name: "Recovery · 1 saved session" }));
    await user.click(within(inbox).getByRole("button", { name: "Relaunch Manual · zsh 9 in Alfred" }));

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

  it("announces terminal status changes through one central live region", async () => {
    const { emitExit } = installDesktopBridge(undefined, null, [
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
    expect(screen.getAllByTestId("session-status-announcer")).toHaveLength(1);
    expect(screen.getByTestId("session-status-announcer")).toHaveTextContent("");

    await waitFor(() => {
      expect(window.alfredDesktop?.terminal.onExit).toHaveBeenCalled();
    });
    await emitExit({ id: "runtime-a", exitCode: 1 });

    await waitFor(() => {
      expect(screen.getByTestId("session-status-announcer")).toHaveTextContent("Manual · zsh 9 is now error.");
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
    await selectSurface(user, "Context");

    const pulse = screen.getByRole("region", { name: "Current state" });
    expect(pulse).toHaveTextContent("Current state");
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
    await selectSurface(user, "Context");
    await user.click(screen.getByRole("button", { name: /^Activity \(/ }));
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
    await selectSurface(userEvent.setup(), "Context");
    const inspector = screen.getByRole("complementary", { name: "Agent activity" });
    expect(within(inspector).getByText("Manual · alpha")).toBeInTheDocument();
    expect(
      within(inspector).getByRole("group", { name: "Handoff actions for Manual · alpha" }),
    ).toBeInTheDocument();
    const essentials = within(inspector).getByRole("region", { name: "Session essentials" });
    expect(essentials).toHaveTextContent("Manual");
    expect(essentials).toHaveTextContent("…/Desktop/Alfred");
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
    await selectSurface(user, "Context");
    await user.click(screen.getByRole("button", { name: "Open external terminal for Codex · session 1" }));

    expect(openExternalTerminal).toHaveBeenCalledWith({ cwd: "/Users/patryk/Desktop/Alfred" });
  });

  it("surfaces Context reveal failures without contaminating Prepare Work", async () => {
    const user = userEvent.setup();
    const { revealPath } = installDesktopBridge(undefined, null, [liveSnapshot("context-reveal")]);
    revealPath.mockResolvedValue({ ok: false, error: "Finder could not reveal the Context folder." });

    render(<App />);

    await screen.findByRole("article", { name: /Codex · context-reveal/i });
    await selectSurface(user, "Context");
    const revealButton = screen.getByRole("button", { name: "Reveal folder for Codex · context-reveal" });
    await user.click(revealButton);

    expect(revealPath).toHaveBeenCalledWith({ cwd: "/Users/patryk/Desktop/Alfred", path: "." });
    const alert = await screen.findByRole("alert", { name: "Shell action failed" });
    expect(alert).toHaveTextContent("Finder could not reveal the Context folder.");
    expect(screen.getAllByRole("alert", { name: "Shell action failed" })).toHaveLength(1);
    await waitFor(() => expect(revealButton).toHaveTextContent("missing"));
    expect(revealButton).not.toHaveTextContent("revealed");

    const composer = await openPrepareWork(user);
    expect(within(composer).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(composer).getByRole("status")).toBeEmptyDOMElement();

    await user.click(within(alert).getByRole("button", { name: "Dismiss action error" }));
    expect(screen.queryByRole("alert", { name: "Shell action failed" })).not.toBeInTheDocument();
  });

  it("surfaces Context terminal failures without contaminating Prepare Work", async () => {
    const user = userEvent.setup();
    const { openExternalTerminal } = installDesktopBridge(undefined, null, [liveSnapshot("context-terminal")]);
    openExternalTerminal.mockResolvedValue({ ok: false, error: "Ghostty could not open the Context cwd." });

    render(<App />);

    await screen.findByRole("article", { name: /Codex · context-terminal/i });
    await selectSurface(user, "Context");
    const terminalButton = screen.getByRole(
      "button",
      { name: "Open external terminal for Codex · context-terminal" },
    );
    await user.click(terminalButton);

    expect(openExternalTerminal).toHaveBeenCalledWith({ cwd: "/Users/patryk/Desktop/Alfred" });
    const alert = await screen.findByRole("alert", { name: "Shell action failed" });
    expect(alert).toHaveTextContent("Ghostty could not open the Context cwd.");
    expect(screen.getAllByRole("alert", { name: "Shell action failed" })).toHaveLength(1);
    await waitFor(() => expect(terminalButton).toHaveTextContent("missing"));
    expect(terminalButton).not.toHaveTextContent("opened");

    const composer = await openPrepareWork(user);
    expect(within(composer).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(composer).getByRole("status")).toBeEmptyDOMElement();

    await user.click(within(alert).getByRole("button", { name: "Dismiss action error" }));
    expect(screen.queryByRole("alert", { name: "Shell action failed" })).not.toBeInTheDocument();
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

  it("surfaces session terminal launch failures in shell chrome", async () => {
    const user = userEvent.setup();
    const { openExternalTerminal } = installDesktopBridge(undefined, null, [
      liveSnapshot("handoff", { title: "Codex · handoff" }),
    ]);
    openExternalTerminal.mockResolvedValue({ ok: false, error: "Ghostty could not open this session." });

    render(<App />);

    await screen.findByRole("article", { name: /Codex · handoff/i });
    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "open focused session");

    expect(await screen.findByRole("alert", { name: "Shell action failed" })).toHaveTextContent(
      "Ghostty could not open this session.",
    );
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
    await submitCommandPalette(user, "open focused session");

    expect(openExternalTerminal).toHaveBeenCalledWith({ cwd: "/Users/patryk/Desktop/Alfred" });

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "reveal focused session");

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
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "arrange tiles");

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
    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
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

    await openPrepareWork(user);
    await screen.findByText("Set OPENROUTER_API_KEY in repo .env to use Alfred.");
    await user.type(screen.getByLabelText("Dispatch instruction"), "prepare agents");

    expect(screen.getByRole("button", { name: /Prepare work (?:in|with) / })).toBeDisabled();
    expect(requestPlan).not.toHaveBeenCalled();
  });

  it("keeps Alfred prompts available while runtime status is unknown", async () => {
    const user = userEvent.setup();
    const { requestPlan } = installDesktopBridge(undefined, null, [], null);

    render(<App />);

    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "prepare agents");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));

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

    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "launch first plan");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));

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
    await user.click(screen.getByRole("button", { name: "Open Inbox surface, 2 items" }));
    expect(screen.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
    await selectSurface(user, "Work");
    expect(await screen.findByRole("article", { name: /Staged Task A/i })).toBeInTheDocument();
    const stagedTaskB = await screen.findByRole("article", { name: /Staged Task B/i });
    const stagedTaskBHeader = stagedTaskB.querySelector(".tile-header")!;

    await user.click(stagedTaskBHeader);

    expect(screen.getByLabelText("terminals")).toHaveClass("mode-desk");
    expect(stagedTaskB).toHaveClass("selected");
    await selectSurface(user, "Context");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Task B");

    await user.dblClick(stagedTaskBHeader);

    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
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

    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "stage isolated codex");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));

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

    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "stage editable shell");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));
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
    await selectSurface(user, "Context");
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
    const user = userEvent.setup();
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
    await openPrepareWork(user);
    expect(screen.getByRole("status")).toHaveTextContent("Resolve the current Alfred plan");
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

    await openPrepareWork(user);
    const composer = screen.getByRole("form", { name: "Alfred dispatch" });
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
    const kindMark = restored.querySelector(".tile-kind-mark");
    expect(kindMark).toHaveAccessibleName("Codex");
    expect(kindMark).not.toHaveTextContent("Cx");
    await waitFor(() => {
      expect(restored).toHaveTextContent("restored");
    });
    const resumeButton = within(restored).getByRole("button", {
      name: "Resume latest Codex conversation Codex · session 9",
    });
    expect(resumeButton).toBeVisible();
    expect(within(restored).getByTestId("xterm-host")).toBeInTheDocument();
    expect(createTerminal).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /Open Inbox surface/i }));
    await userEvent.click(screen.getByRole("button", { name: "Recovery · 1 saved session" }));
    expect(screen.getByRole("button", { name: "Resume Codex · session 9 in Alfred" })).toBeInTheDocument();
    await selectSurface(userEvent.setup(), "Work");

    await userEvent.click(resumeButton);

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
          cwd: "/Users/patryk/Desktop/Very Long Workspace",
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

    await openInboxFromCommandPalette(user);
    const inbox = screen.getByRole("region", { name: "Inbox workspace" });
    await user.click(within(inbox).getByRole("button", { name: "Recovery · 1 saved session" }));
    expect(inbox).not.toHaveTextContent("/Users/patryk/Desktop/Very Long Workspace");

    await user.click(within(inbox).getByRole("button", { name: "Review relaunch Clean Desktop in Alfred" }));

    expect(createTerminal).not.toHaveBeenCalled();
    expect(inbox).toHaveTextContent("find -exec mutates files when replayed");
    expect(inbox).toHaveTextContent("/Users/patryk/Desktop/Very Long Workspace");
    expect(inbox).toHaveTextContent("find /Users/patryk/Desktop -maxdepth 1 -exec mv {} /Users/patryk/Desktop/Alfred ;");
    expect(within(inbox).getByRole("button", { name: "Confirm relaunch Clean Desktop in Alfred" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(createTerminal).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
    expect(within(inbox).queryByRole("button", { name: "Confirm relaunch Clean Desktop in Alfred" })).not.toBeInTheDocument();
    expect(within(inbox).getByRole("button", { name: "Review relaunch Clean Desktop in Alfred" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Inbox workspace" })).not.toBeInTheDocument();

    await openInboxFromCommandPalette(user);
    const reopenedInbox = screen.getByRole("region", { name: "Inbox workspace" });
    await user.click(within(reopenedInbox).getByRole("button", { name: "Recovery · 1 saved session" }));
    await user.click(within(reopenedInbox).getByRole("button", { name: "Review relaunch Clean Desktop in Alfred" }));
    await user.click(within(reopenedInbox).getByRole("button", { name: "Confirm relaunch Clean Desktop in Alfred" }));

    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({ clientId: "clean-desktop" }));
    });
    expect(screen.queryByRole("region", { name: "Inbox workspace" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("terminals")).toHaveClass("mode-focus");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Clean Desktop");
  });

  it.each(["Work", "Sessions"] as const)(
    "disarms unsafe Recovery before global navigation can open %s",
    async (surfaceLabel) => {
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
            clientId: `unsafe-switch-${surfaceLabel.toLowerCase()}`,
            title: `Unsafe ${surfaceLabel} switch`,
            cwd: "/repo",
            source: "manual",
            isolation: "shared",
            shell: "/bin/sh",
            command: "/bin/sh",
            args: ["-c", "/usr/bin/printf 'confirmed restore\\n'"],
            buffer: "saved output\n",
          },
        ],
      );

      render(<App />);
      await openInboxFromCommandPalette(user);
      const inbox = screen.getByRole("region", { name: "Inbox workspace" });
      await user.click(within(inbox).getByRole("button", { name: "Recovery · 1 saved session" }));
      await user.click(within(inbox).getByRole("button", {
        name: `Review relaunch Unsafe ${surfaceLabel} switch in Alfred`,
      }));
      expect(within(inbox).getByRole("button", {
        name: `Confirm relaunch Unsafe ${surfaceLabel} switch in Alfred`,
      })).toBeInTheDocument();

      const leaveInbox = async () => {
        if (surfaceLabel === "Work") {
          await user.click(within(inbox).getByRole("button", { name: "Back to Work" }));
        } else {
          await selectSurface(user, "Sessions");
        }
      };
      await leaveInbox();

      expect(screen.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
      expect(within(inbox).getByRole("button", {
        name: `Review relaunch Unsafe ${surfaceLabel} switch in Alfred`,
      })).toBeInTheDocument();
      expect(createTerminal).not.toHaveBeenCalled();

      await leaveInbox();

      if (surfaceLabel === "Work") {
        expect(screen.getByTestId("desk-runtime-surface")).not.toHaveAttribute("aria-hidden");
      } else {
        expect(screen.getByRole("region", { name: "Sessions workspace" })).toBeVisible();
      }
      expect(screen.queryByRole("region", { name: "Inbox workspace" })).not.toBeInTheDocument();
      expect(createTerminal).not.toHaveBeenCalled();
    },
  );

  it("disarms unsafe Recovery before Context can consume Escape", async () => {
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
          clientId: "unsafe-context",
          title: "Unsafe context recovery",
          cwd: "/repo",
          source: "manual",
          isolation: "shared",
          shell: "/bin/sh",
          command: "/bin/sh",
          args: ["-c", "/usr/bin/printf 'confirmed restore\\n'"],
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);
    await openInboxFromCommandPalette(user);
    const inbox = screen.getByRole("region", { name: "Inbox workspace" });
    await user.click(within(inbox).getByRole("button", { name: "Recovery · 1 saved session" }));
    await user.click(within(inbox).getByRole("button", { name: "Review relaunch Unsafe context recovery in Alfred" }));
    expect(within(inbox).getByRole("button", { name: "Confirm relaunch Unsafe context recovery in Alfred" })).toBeInTheDocument();

    await selectSurface(user, "Context");
    expect(screen.getByTestId("context-column")).toHaveClass("open");
    const closeContext = screen.getByRole("button", { name: "Close Context panel" });
    closeContext.focus();
    expect(closeContext).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.getByTestId("context-column")).toHaveClass("open");
    expect(screen.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
    expect(within(inbox).queryByRole("button", { name: "Confirm relaunch Unsafe context recovery in Alfred" })).not.toBeInTheDocument();
    expect(within(inbox).getByRole("button", { name: "Review relaunch Unsafe context recovery in Alfred" })).toBeInTheDocument();
    expect(createTerminal).not.toHaveBeenCalled();

    expect(closeContext).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("region", { name: "Inbox workspace" })).not.toBeInTheDocument();
    expect(screen.getByTestId("desk-runtime-surface")).not.toHaveAttribute("aria-hidden");
    expect(screen.getByTestId("context-column")).toHaveClass("open");
    expect(createTerminal).not.toHaveBeenCalled();
  });

  it("lets the command-palette shortcut bubble from a focused Recovery control", async () => {
    const user = userEvent.setup();
    installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "shortcut-recovery",
          title: "Shortcut recovery",
          cwd: "/repo",
          source: "manual",
          isolation: "shared",
          shell: "zsh",
          command: "zsh",
          args: [],
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);
    await openInboxFromCommandPalette(user);
    const recoveryToggle = screen.getByRole("button", { name: "Recovery · 1 saved session" });
    recoveryToggle.focus();

    await user.keyboard("{Control>}k{/Control}");

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Inbox workspace" })).toBeVisible();

    recoveryToggle.focus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("region", { name: "Inbox workspace" })).not.toBeInTheDocument();
  });

  it("lets Privacy consume Escape over Inbox and restore the surviving trigger", async () => {
    const user = userEvent.setup();
    installDesktopBridge();

    render(<App />);
    await openInboxFromCommandPalette(user);
    const inbox = screen.getByRole("region", { name: "Inbox workspace" });

    await selectSurface(user, "Local Data & Privacy");
    const dialog = screen.getByRole("dialog", { name: "Local Data & Privacy" });
    const surfaces = screen.getByRole("button", { name: "Open Surfaces menu" });
    expect(within(dialog).getByRole("button", { name: "Close privacy controls" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Local Data & Privacy" })).not.toBeInTheDocument();
    expect(inbox).toBeVisible();
    expect(surfaces).toHaveFocus();
  });

  it("keeps Recovery non-blocking and exposes Discard only after expansion", async () => {
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
          command: "zsh",
          args: [],
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    expect(await screen.findByRole("button", { name: "Open Inbox surface" })).not.toHaveTextContent("1");

    await openInboxFromCommandPalette(userEvent.setup());
    const inbox = screen.getByRole("region", { name: "Inbox workspace" });

    expect(inbox).toHaveTextContent("Recovery · 1 saved session");
    expect(inbox).not.toHaveTextContent("Manual · zsh 9");
    expect(within(inbox).queryByRole("button", { name: /Discard/i })).not.toBeInTheDocument();
    await userEvent.click(within(inbox).getByRole("button", { name: "Recovery · 1 saved session" }));
    expect(inbox).toHaveTextContent("Manual · zsh 9");
    expect(within(inbox).getByRole("button", { name: "Discard Manual · zsh 9" })).toBeInTheDocument();
    expect(forgetTerminal).not.toHaveBeenCalled();
  });

  it("routes Recovery Discard through the existing worktree inspection guard", async () => {
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
          clientId: "codex-recovery",
          title: "Codex · guarded recovery",
          cwd: "/repo/.alfred-worktrees/codex-recovery",
          baseCwd: "/repo",
          branchName: "alfred-codex-recovery",
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
    await openInboxFromCommandPalette(user);
    const inbox = screen.getByRole("region", { name: "Inbox workspace" });
    await user.click(within(inbox).getByRole("button", { name: "Recovery · 1 saved session" }));
    await user.click(within(inbox).getByRole("button", { name: "Discard Codex · guarded recovery" }));

    expect(worktreeDiff).toHaveBeenCalledWith({ clientId: "codex-recovery" });
    expect(screen.getByRole("dialog", { name: "Discard isolated checkout" })).toBeInTheDocument();
    expect(forgetTerminal).not.toHaveBeenCalled();
  });

  it("traps discard confirmation focus and restores its trigger without changing armed Recovery", async () => {
    const user = userEvent.setup();
    const { createTerminal, forgetTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "guarded-armed-recovery",
          title: "Guarded armed recovery",
          cwd: "/repo/.alfred-worktrees/guarded-armed-recovery",
          baseCwd: "/repo",
          branchName: "alfred-guarded-armed-recovery",
          source: "manual",
          shell: "/bin/sh",
          command: "/bin/sh",
          args: ["-c", "/usr/bin/printf 'confirmed restore\\n'"],
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);
    await openInboxFromCommandPalette(user);
    const inbox = screen.getByRole("region", { name: "Inbox workspace" });
    await user.click(within(inbox).getByRole("button", { name: "Recovery · 1 saved session" }));
    await user.click(within(inbox).getByRole("button", { name: "Review relaunch Guarded armed recovery in Alfred" }));
    expect(within(inbox).getByRole("button", { name: "Confirm relaunch Guarded armed recovery in Alfred" })).toBeInTheDocument();

    const discardTrigger = within(inbox).getByRole("button", { name: "Discard Guarded armed recovery" });
    await user.click(discardTrigger);
    const dialog = await screen.findByRole("dialog", { name: "Discard isolated checkout" });
    const firstControl = within(dialog).getByRole("button", { name: "Close discard dialog" });
    const lastControl = within(dialog).getByRole("button", { name: "Discard checkout permanently" });
    expect(forgetTerminal).not.toHaveBeenCalled();

    lastControl.focus();
    await user.tab();
    expect(firstControl).toHaveFocus();

    firstControl.focus();
    await user.tab({ shift: true });
    expect(lastControl).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Discard isolated checkout" })).not.toBeInTheDocument();
    expect(discardTrigger).toHaveFocus();
    expect(screen.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
    expect(within(inbox).getByRole("button", { name: "Confirm relaunch Guarded armed recovery in Alfred" })).toBeInTheDocument();
    expect(within(inbox).getByText("Guarded armed recovery")).toBeVisible();
    expect(forgetTerminal).not.toHaveBeenCalled();
    expect(createTerminal).not.toHaveBeenCalled();
  });

  it("clears armed Recovery state on immediate Discard so Escape exits Inbox", async () => {
    const user = userEvent.setup();
    const { createTerminal, forgetTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "armed-shared",
          title: "Armed shared recovery",
          cwd: "/repo",
          source: "manual",
          isolation: "shared",
          shell: "/bin/sh",
          command: "/bin/sh",
          args: ["-c", "/usr/bin/printf 'confirmed restore\\n'"],
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);
    await openInboxFromCommandPalette(user);
    const inbox = screen.getByRole("region", { name: "Inbox workspace" });
    await user.click(within(inbox).getByRole("button", { name: "Recovery · 1 saved session" }));
    await user.click(within(inbox).getByRole("button", { name: "Review relaunch Armed shared recovery in Alfred" }));
    await user.click(within(inbox).getByRole("button", { name: "Discard Armed shared recovery" }));

    expect(forgetTerminal).toHaveBeenCalledWith({ clientId: "armed-shared", cleanupWorktree: true });
    expect(createTerminal).not.toHaveBeenCalled();
    inbox.focus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("region", { name: "Inbox workspace" })).not.toBeInTheDocument();
  });

  it("clears armed Recovery state after confirmed worktree Discard before reusing the session ID", async () => {
    const user = userEvent.setup();
    const bridge = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [
        {
          clientId: "manual-1",
          title: "Original risky recovery",
          cwd: "/repo/.alfred-worktrees/manual-1",
          baseCwd: "/repo",
          branchName: "alfred-manual-1",
          source: "manual",
          shell: "/bin/sh",
          command: "/bin/sh",
          args: ["-c", "/usr/bin/printf 'confirmed restore\\n'"],
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);
    await openInboxFromCommandPalette(user);
    const inbox = screen.getByRole("region", { name: "Inbox workspace" });
    await user.click(within(inbox).getByRole("button", { name: "Recovery · 1 saved session" }));
    await user.click(within(inbox).getByRole("button", { name: "Review relaunch Original risky recovery in Alfred" }));
    await user.click(within(inbox).getByRole("button", { name: "Discard Original risky recovery" }));
    await user.click(await screen.findByRole("button", { name: "Discard checkout permanently" }));
    expect(bridge.forgetTerminal).toHaveBeenCalledWith({ clientId: "manual-1", cleanupWorktree: true });

    bridge.createTerminal.mockResolvedValueOnce({
      id: "runtime-reused-recovery",
      clientId: "manual-1",
      title: "Reused risky recovery",
      source: "manual",
      workspaceId: "A",
      cwd: "/repo",
      shell: "/bin/sh",
      command: "/bin/sh",
      args: ["-c", "/usr/bin/printf 'reused restore\\n'"],
    });
    await user.click(screen.getByRole("button", { name: "Open launch menu" }));
    await user.click(screen.getByRole("menuitem", { name: "New manual terminal" }));
    await waitFor(() => expect(bridge.createTerminal).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("session-status-announcer")).toHaveTextContent("Reused risky recovery is now running.");
    await bridge.emitExit({ id: "runtime-reused-recovery", exitCode: 1 });

    const recoveryToggle = screen.getByRole("button", { name: "Recovery · 1 saved session" });
    if (recoveryToggle.getAttribute("aria-expanded") !== "true") await user.click(recoveryToggle);
    await user.click(within(inbox).getByRole("button", { name: "Review relaunch Reused risky recovery in Alfred" }));

    expect(within(inbox).getByRole("button", { name: "Confirm relaunch Reused risky recovery in Alfred" })).toBeInTheDocument();
    expect(bridge.createTerminal).toHaveBeenCalledTimes(1);
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
    await selectSurface(user, "Context");

    await user.click(screen.getByRole("button", { name: "Discard checkout Codex · session 9" }));

    expect(worktreeDiff).toHaveBeenCalledWith({ clientId: "codex-9" });
    const discardDialog = screen.getByRole("dialog", { name: "Discard isolated checkout" });
    expect(discardDialog).toHaveTextContent("2 changed files");
    expect(forgetTerminal).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Discard isolated checkout" })).not.toBeInTheDocument();
    expect(screen.getByTestId("context-column")).toHaveClass("open");
    expect(screen.getByRole("article", { name: /Codex · session 9/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard checkout Codex · session 9" }));
    await user.click(await screen.findByRole("button", { name: "Discard checkout permanently" }));

    expect(screen.queryByRole("article", { name: /Codex · session 9/i })).not.toBeInTheDocument();
    expect(forgetTerminal).toHaveBeenCalledWith({ clientId: "codex-9", cleanupWorktree: true });
  });

  it("retains the recovery tile and warns when checkout Discard is rejected", async () => {
    const user = userEvent.setup();
    const { forgetTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [{
        clientId: "codex-9",
        title: "Codex · session 9",
        source: "alfred",
        agentKind: "codex",
        workspaceId: "A",
        workspaceRootFingerprint: "0123456789abcdef",
        isolation: "worktree",
        branchName: "alfred-codex-9",
      }],
    );
    forgetTerminal.mockResolvedValueOnce({
      ok: false,
      error: "Unable to remove isolated Git worktree.",
    });

    render(<App />);
    expect(await screen.findByRole("article", { name: /Codex · session 9/i })).toBeInTheDocument();
    await selectSurface(user, "Context");
    await user.click(screen.getByRole("button", { name: "Discard checkout Codex · session 9" }));
    await user.click(await screen.findByRole("button", { name: "Discard checkout permanently" }));

    expect(await screen.findByRole("article", { name: /Codex · session 9/i })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Codex · session 9/i })).toHaveTextContent(
      "Unable to remove isolated Git worktree.",
    );
  });

  it("shows privacy-safe recovery without a launch action and keeps checkout actions available", async () => {
    const user = userEvent.setup();
    const { createTerminal, worktreeApply, worktreeDiff } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [{
        clientId: "codex-private",
        title: "Codex recovery",
        source: "alfred",
        agentKind: "codex",
        workspaceId: "A",
        workspaceRootFingerprint: "0123456789abcdef",
        isolation: "worktree",
        branchName: "alfred-codex-private-20260729120000-abcd1234",
        createdAt: 1,
      }],
    );

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Codex recovery/i });
    const privacyNote = screen.getByRole("note");
    expect(privacyNote).toHaveTextContent(
      "Launch details were cleared for privacy. Your isolated checkout is still available.",
    );
    expect(within(tile).queryByRole("button", { name: /Resume|Continue|Relaunch/i })).not.toBeInTheDocument();
    expect(createTerminal).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Discard checkout Codex recovery" })).toBeInTheDocument();

    await user.dblClick(tile.querySelector(".tile-header")!);
    const checkoutActions = screen.getByRole("toolbar", { name: "checkout actions for Codex recovery" });
    await user.click(within(checkoutActions).getByRole("button", { name: "Review diff" }));
    expect(worktreeDiff).toHaveBeenCalledWith({ clientId: "codex-private" });
    await user.click(within(checkoutActions).getByRole("button", { name: "Apply to project" }));
    expect(worktreeApply).toHaveBeenCalledWith({ clientId: "codex-private" });
  });

  it("keeps recovery-only checkout visible when its rebound workspace rejects review", async () => {
    const user = userEvent.setup();
    const { worktreeDiff } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      {
        workspaces: [{ id: "A", label: "Alfred", shortLabel: "A", rootPath: "/rebound" }],
        activeWorkspaceId: "A",
      },
      [{
        clientId: "codex-private",
        title: "Codex recovery",
        source: "alfred",
        agentKind: "codex",
        workspaceId: "A",
        workspaceRootFingerprint: "0123456789abcdef",
        isolation: "worktree",
        branchName: "alfred-codex-private-20260729120000-abcd1234",
        createdAt: 1,
      }],
    );
    worktreeDiff.mockResolvedValueOnce({
      ok: false,
      error: "Workspace root no longer matches this checkout.",
    });

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Codex recovery/i });
    await user.dblClick(tile.querySelector(".tile-header")!);
    await user.click(screen.getByRole("button", { name: "Review diff" }));
    expect(worktreeDiff).toHaveBeenCalledWith({ clientId: "codex-private" });
    await selectSurface(user, "Context");
    await user.click(screen.getByRole("button", { name: /^Activity \(/ }));

    await waitFor(() => {
      expect(screen.getByLabelText("Agent activity")).toHaveTextContent(
        "Workspace root no longer matches this checkout.",
      );
    });
    expect(screen.getByRole("article", { name: /Codex recovery/i })).toBeInTheDocument();
  });

  it("coalesces duplicate Discard requests while Forget is pending", async () => {
    const pendingForget = deferred<TerminalForgetResult>();
    const { forgetTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [{
        clientId: "codex-9",
        title: "Codex · session 9",
        source: "alfred",
        agentKind: "codex",
        isolation: "shared",
      }],
    );
    forgetTerminal.mockReturnValue(pendingForget.promise);

    render(<App />);
    const discard = await screen.findByRole("button", { name: "Discard Codex · session 9" });
    fireEvent.click(discard);
    fireEvent.click(discard);

    expect(forgetTerminal).toHaveBeenCalledTimes(1);
    await act(async () => pendingForget.resolve({ ok: true }));
    await waitFor(() => {
      expect(screen.queryByRole("article", { name: /Codex · session 9/i })).not.toBeInTheDocument();
    });
  });

  it.each([
    {
      name: "successful",
      result: { ok: true } as TerminalForgetResult,
    },
    {
      name: "rejected",
      result: { ok: false, error: "stale discard warning" } as TerminalForgetResult,
    },
  ])("does not apply a $name stale Forget result to a replacement tile with the same id", async ({ result }) => {
    const user = userEvent.setup();
    const pendingForget = deferred<TerminalForgetResult>();
    const bridge = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      {
        workspaces: [
          { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/repo" },
          { id: "B", label: "Other", shortLabel: "B", rootPath: "/other" },
        ],
        activeWorkspaceId: "A",
      },
      [{
        clientId: "codex-9",
        title: "Original recovery",
        source: "alfred",
        agentKind: "codex",
        cwd: "/repo",
        isolation: "shared",
        command: "codex",
        args: [],
      }],
    );
    bridge.forgetTerminal.mockReturnValueOnce(pendingForget.promise);

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Discard Original recovery" }));
    await user.click(screen.getByRole("button", { name: "Resume latest Codex conversation Original recovery" }));
    await waitFor(() => {
      expect(bridge.killTerminal).toHaveBeenCalledWith({ id: "runtime-1" });
    });

    vi.mocked(window.alfredDesktop!.terminal.list).mockResolvedValue({
      sessions: [{
        id: "replacement-runtime",
        clientId: "codex-9",
        title: "Replacement session",
        source: "manual",
        workspaceId: "A",
        cwd: "/repo",
        createdAt: 999,
        shell: "/bin/sh",
        buffer: "replacement output",
      }],
      restoredSessions: [],
    });
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(await screen.findByRole("article", { name: /Replacement session/i })).toBeInTheDocument();

    await act(async () => pendingForget.resolve(result));

    expect(await screen.findByRole("article", { name: /Replacement session/i })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Replacement session/i })).not.toHaveTextContent(
      "stale discard warning",
    );
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

  it("routes aggregate recovery commands through the canonical Inbox", async () => {
    const user = userEvent.setup();
    const { createTerminal, forgetTerminal } = installDesktopBridge(
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      [{
        clientId: "manual-9",
        title: "Manual · zsh 9",
        cwd: "/repo",
        source: "manual",
        shell: "/bin/zsh",
        buffer: "saved output\n",
      }],
    );

    render(<App />);
    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await submitCommandPalette(user, "open inbox");

    expect(screen.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
    expect(createTerminal).not.toHaveBeenCalled();
    expect(forgetTerminal).not.toHaveBeenCalled();
  });

  it("keeps the workspace recovery strip contextual and routes it to Inbox", async () => {
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
          command: "zsh",
          args: [],
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
        {
          clientId: "hard-blocked-9",
          title: "Destructive restored shell",
          cwd: "/repo",
          source: "manual",
          command: "rm",
          args: ["-rf", "dist"],
          shell: "/bin/zsh",
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    const recovery = await screen.findByRole("region", { name: "Session recovery" });
    expect(recovery).toHaveTextContent("2 saved sessions ready");
    expect(recovery.textContent).not.toMatch(/ready\s*·\s*2 saved/);
    const user = userEvent.setup();
    await user.click(within(recovery).getByRole("button", { name: "Review in Inbox" }));
    const inbox = await screen.findByRole("region", { name: "Inbox workspace" });
    expect(screen.getByRole("button", { name: "Recovery · 2 saved sessions" })).toHaveFocus();
    expect(recovery).toHaveTextContent("2 saved");

    expect(inbox).not.toHaveTextContent("Manual · zsh 9");
    expect(inbox).not.toHaveTextContent("Codex · session 9");
    await user.click(within(inbox).getByRole("button", { name: "Recovery · 2 saved sessions" }));
    expect(inbox).toHaveTextContent("Manual · zsh 9");
    expect(inbox).toHaveTextContent("Codex · session 9");
    await user.click(within(inbox).getByRole("button", { name: "Resume Codex · session 9 in Alfred" }));

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
          command: "zsh",
          args: [],
          buffer: "saved output\n",
        },
      ],
    );

    render(<App />);

    expect(await screen.findByLabelText("Session recovery")).toHaveTextContent("saved session");
    expect(screen.getByRole("button", { name: "Open Inbox surface" })).not.toHaveTextContent("1");
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
          command: "zsh",
          args: [],
          buffer: "saved output\n",
        },
        {
          clientId: "manual-10",
          title: "Manual · zsh 10",
          cwd: "/repo",
          source: "manual",
          shell: "/bin/zsh",
          command: "zsh",
          args: [],
          buffer: "second output\n",
        },
      ],
    );
    createTerminal.mockRejectedValue(new Error("spawn failed"));

    render(<App />);

    await openInboxFromCommandPalette(userEvent.setup());
    await userEvent.click(screen.getByRole("button", { name: "Recovery · 2 saved sessions" }));
    await userEvent.click(screen.getByRole("button", { name: "Relaunch Manual · zsh 9 in Alfred" }));

    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({ clientId: "manual-9" }));
    });
    await openInboxFromCommandPalette(userEvent.setup());
    const reopenedInbox = screen.getByRole("region", { name: "Inbox workspace" });
    await userEvent.click(within(reopenedInbox).getByRole("button", { name: "Recovery · 2 saved sessions" }));
    expect(reopenedInbox).toHaveTextContent("Manual · zsh 9");
    expect(reopenedInbox).toHaveTextContent("Manual · zsh 10");
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

  it("keeps one restored runtime and resolves a stale staged plan with the same client identity", async () => {
    const stagedPlan: AlfredStagedPlanSnapshot = {
      id: "plan-collision",
      prompt: "review the actionable staged plan",
      sessions: [
        { id: "shared-client", kind: "shell", title: "Actionable staged command", command: "echo", args: ["new"] },
      ],
    };
    const restored: PersistedTerminalSessionSnapshot = {
      clientId: "shared-client",
      title: "Persisted launched runtime",
      source: "alfred",
      agentKind: "shell",
      workspaceId: "A",
      cwd: "/Users/patryk/Desktop/Alfred",
      shell: "/bin/zsh",
      command: "echo",
      args: ["old"],
      buffer: "stale restored output",
    };
    const { resolveStagedPlan } = installDesktopBridge(
      undefined,
      stagedPlan,
      [],
      undefined,
      undefined,
      undefined,
      [restored],
    );

    render(<App />);

    expect(await screen.findByRole("article", { name: /Persisted launched runtime/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(resolveStagedPlan).toHaveBeenCalledWith({ sessionIds: ["shared-client"] });
    });
    expect(screen.getAllByTestId("terminal-tile")).toHaveLength(1);
    expect(screen.getByText("stale restored output")).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /Staged Actionable staged command/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Launch Actionable staged command/i })).not.toBeInTheDocument();
  });

  it("blocks a second Alfred prompt while staged tiles exist", async () => {
    const user = userEvent.setup();
    const { requestPlan } = installDesktopBridge();

    render(<App />);

    await openPrepareWork(user);
    const composer = screen.getByLabelText("Dispatch instruction");
    const send = screen.getByRole("button", { name: /Prepare work (?:in|with) / });

    await user.type(composer, "first");
    await user.click(send);
    await screen.findByRole("article", { name: /Staged Task A/i });

    await openPrepareWork(user);
    const blockedComposer = screen.getByLabelText("Dispatch instruction");
    const blockedSend = screen.getByRole("button", { name: /Prepare work (?:in|with) / });
    await user.type(blockedComposer, "second");
    await user.click(blockedSend);

    expect(requestPlan).toHaveBeenCalledOnce();
    expect(blockedSend).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Resolve the current Alfred plan");
  });

  it("does not send whitespace-only Alfred prompts", async () => {
    const user = userEvent.setup();
    const { requestPlan } = installDesktopBridge();

    render(<App />);

    await openPrepareWork(user);
    const composer = screen.getByLabelText("Dispatch instruction");
    const send = screen.getByRole("button", { name: /Prepare work (?:in|with) / });

    expect(send).toBeDisabled();
    await user.type(composer, "   ");

    expect(send).toBeDisabled();
    await user.keyboard("{Control>}{Enter}{/Control}");
    await user.click(send);

    expect(requestPlan).not.toHaveBeenCalled();
  });

  it("unlocks Alfred after rejecting the staged plan", async () => {
    const user = userEvent.setup();
    const { requestPlan } = installDesktopBridge();

    render(<App />);

    await openPrepareWork(user);
    const composer = screen.getByLabelText("Dispatch instruction");
    const send = screen.getByRole("button", { name: /Prepare work (?:in|with) / });

    await user.type(composer, "first");
    await user.click(send);
    await screen.findByRole("article", { name: /Staged Task A/i });

    await user.click(within(screen.getByRole("article", { name: /Staged Task A/i })).getByRole("button", { name: "Reject Task A" }));
    await user.click(within(screen.getByRole("article", { name: /Staged Task B/i })).getByRole("button", { name: "Reject Task B" }));
    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "second after reject");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));

    expect(requestPlan).toHaveBeenCalledTimes(2);
  });

  it("resolves a staged tile after approval starts its terminal", async () => {
    const user = userEvent.setup();
    const { resolveStagedPlan } = installDesktopBridge();

    render(<App />);

    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "start one");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));
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

    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "stage mixed launch");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));

    expect(await screen.findByRole("article", { name: /Staged Safe task/i })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Staged Risky task/i })).toBeInTheDocument();

    await openInboxFromCommandPalette(user);
    await user.click(screen.getByTestId("inbox-decision-select-A:alfred-1"));
    await user.click(screen.getByRole("button", { name: "Launch Safe task in Alfred" }));

    await waitFor(() => {
      expect(resolveStagedPlan).toHaveBeenCalledWith({ sessionIds: ["alfred-1"] });
    });
    await selectSurface(user, "Work");
    expect(screen.queryByRole("article", { name: /Staged Safe task/i })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Safe task/i })).toBeInTheDocument();
    await openInboxFromCommandPalette(user);
    expect(screen.getByRole("region", { name: "Inbox workspace" })).toHaveTextContent("Risky task");
    expect(clearStagedPlan).not.toHaveBeenCalled();
  });

  it("explains blocked staged launches with an actionable review control", async () => {
    const user = userEvent.setup();
    installDesktopBridge({
      ok: true,
      plan: {
        name: "Blocked launch plan",
        sessions: [
          {
            kind: "shell",
            title: "Safe build",
            command: "pnpm",
            args: ["test"],
          },
          {
            kind: "shell",
            title: "Risky cleanup",
            command: "rm",
            args: ["-rf", "dist"],
            safetyNote: "rm -rf detected",
          },
        ],
      },
    });

    render(<App />);

    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "stage risky cleanup");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));
    await screen.findByRole("article", { name: /Staged Safe build/i });
    await screen.findByRole("article", { name: /Staged Risky cleanup/i });

    await openInboxFromCommandPalette(user);
    const blockedItem = screen.getByTestId("inbox-decision-select-A:alfred-2").closest("li");
    if (!blockedItem) throw new Error("Expected blocked Inbox item");

    expect(blockedItem).toHaveTextContent("Review / Edit");
    expect(blockedItem).toHaveTextContent("rm -rf detected");
    expect(within(blockedItem).queryByText(/^Blocked$/)).not.toBeInTheDocument();

    const reviewDetails = within(blockedItem).getByRole("button", { name: "Review / Edit Risky cleanup in Alfred" });
    expect(reviewDetails).toBeEnabled();
    expect(screen.queryByRole("note", { name: "Blocked launch details for Risky cleanup" })).not.toBeInTheDocument();

    await user.click(reviewDetails);

    const deskDetails = await screen.findByRole("note", {
      name: "Blocked launch details for Risky cleanup",
    });
    expect(deskDetails).toHaveTextContent("Cannot launch yet");
    expect(deskDetails).toHaveTextContent("rm -rf detected");
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

    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "stage preflight");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));

    expect(await screen.findByRole("article", { name: /Staged Safe task/i })).toHaveTextContent("normal workspace");
    const blocked = screen.getByRole("article", { name: /Staged Blocked Codex/i });
    expect(blocked).toHaveTextContent("Launch blocked: Workspace has uncommitted or untracked changes.");
    await openInboxFromCommandPalette(user);
    expect(screen.getByRole("region", { name: "Inbox workspace" })).toHaveTextContent("Blocked Codex");
    const reviewDetails = screen.getByRole("button", {
      name: "Review / Edit Blocked Codex in Alfred",
    });
    expect(reviewDetails).toBeEnabled();

    await user.click(reviewDetails);

    expect(screen.getByTestId("desk-runtime-surface")).not.toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("context-drawer")).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByRole("complementary", { name: "Agent activity" })).toHaveTextContent("Blocked Codex");
    expect(screen.getByRole("note", { name: "Blocked launch details for Blocked Codex" })).toHaveTextContent(
      "Workspace has uncommitted or untracked changes.",
    );
    expect(createTerminal).not.toHaveBeenCalledWith(expect.objectContaining({ clientId: "alfred-2" }));

    await openInboxFromCommandPalette(user);

    await user.click(screen.getByTestId("inbox-decision-select-A:alfred-1"));
    await user.click(screen.getByRole("button", { name: "Launch Safe task in Alfred" }));

    await waitFor(() => {
      expect(resolveStagedPlan).toHaveBeenCalledWith({ sessionIds: ["alfred-1"] });
    });
    expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({ clientId: "alfred-1" }));
    expect(createTerminal).not.toHaveBeenCalledWith(expect.objectContaining({ clientId: "alfred-2" }));
    expect(screen.queryByRole("article", { name: /Staged Safe task/i })).not.toBeInTheDocument();
    await openInboxFromCommandPalette(user);
    expect(screen.getByRole("region", { name: "Inbox workspace" })).toHaveTextContent("Blocked Codex");
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

    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "stage codex");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));
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

    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "stage codex");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));
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

    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "stage mixed launch");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));
    await screen.findByRole("article", { name: /Staged Safe task/i });

    await openInboxFromCommandPalette(user);
    await user.click(screen.getByTestId("inbox-decision-select-A:alfred-1"));
    await user.click(screen.getByRole("button", { name: "Launch Safe task in Alfred" }));

    await selectSurface(user, "Work");
    await waitFor(() => {
      expect(screen.getByRole("article", { name: /Staged Safe task/i })).toBeInTheDocument();
    });
    await openInboxFromCommandPalette(user);
    expect(screen.getByRole("region", { name: "Inbox workspace" })).toHaveTextContent("Risky task");
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

    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "stage risky cleanup");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));
    await screen.findByRole("article", { name: /Staged Risky task/i });

    expect(screen.getByRole("button", { name: "Launch blocked: Risky task" })).toBeDisabled();
    expect(screen.getByRole("article", { name: /Staged Risky task/i })).toHaveTextContent("rm -rf detected");
    expect(resolveStagedPlan).not.toHaveBeenCalled();
  });

  it("opens the selected blocked staged command in Context for editing", async () => {
    const user = userEvent.setup();
    const { createTerminal, setWorkspaceViewState } = installDesktopBridge({
      ok: true,
      plan: {
        name: "Unsafe plan",
        sessions: [{
          kind: "shell",
          title: "Risky cleanup",
          command: "rm",
          args: ["-rf", "dist"],
          safetyNote: "rm -rf detected",
        }],
      },
    }, null, [liveSnapshot("context-review-preview", {
      buffer: "Ready at http://localhost:5173/\n",
    })]);

    render(<App />);
    const xtermHost = await screen.findByTestId("xterm-host");
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByLabelText("Workspace preview")).toBeVisible();
    await openPrepareWork(user);
    await user.type(screen.getByLabelText("Dispatch instruction"), "stage risky cleanup");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));
    await openInboxFromCommandPalette(user);
    await user.click(screen.getByRole("button", {
      name: "Review / Edit Risky cleanup in Alfred",
    }));

    expect(screen.getByTestId("desk-runtime-surface")).toBeVisible();
    expect(screen.getByTestId("context-drawer")).toHaveAttribute("aria-hidden", "false");
    expect(screen.queryByLabelText("Workspace preview")).not.toBeInTheDocument();
    expect(setWorkspaceViewState).toHaveBeenCalledWith({
      workspaceId: "A",
      viewState: { previewDockOpen: false },
    });
    expect(screen.getByTestId("xterm-host")).toBe(xtermHost);
    await waitFor(() => expect(screen.getByRole("button", { name: "Close Context panel" })).toHaveFocus());
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Risky cleanup");
    expect(screen.getByRole("button", { name: "Edit command" })).toBeInTheDocument();
    expect(createTerminal).not.toHaveBeenCalledWith(expect.objectContaining({ clientId: "alfred-1" }));
  });

  it("keeps the draft when Alfred plan creation fails", async () => {
    const user = userEvent.setup();
    installDesktopBridge({
      ok: false,
      error: { code: "network", message: "OpenRouter is unreachable." },
    });

    render(<App />);

    await openPrepareWork(user);
    const composer = screen.getByLabelText("Dispatch instruction");
    await user.type(composer, "retry this plan");
    await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));

    expect(composer).toHaveValue("retry this plan");
    expect(await screen.findByRole("alert")).toHaveTextContent("OpenRouter is unreachable.");
  });
});
