import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  TerminalExitEvent,
  TerminalSessionSnapshot,
} from "../shared/terminal-ipc";
import type { WorkspaceApi, WorkspaceStateSnapshot } from "../shared/workspace-ipc";

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    dispose = vi.fn();
    focus = vi.fn();
    loadAddon = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    open = vi.fn();
    write = vi.fn();
    writeln = vi.fn();
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

class TestResizeObserver implements ResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

type DesktopBridge = {
  alfred: AlfredApi;
  layout: LayoutApi;
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
    workspaces: [{ id: "A", label: "Alfred", shortLabel: "A" }],
    activeWorkspaceId: "A",
  },
  restoredTerminalSessions: PersistedTerminalSessionSnapshot[] = [],
): {
  clearStagedPlan: ReturnType<typeof vi.fn>;
  createTerminal: ReturnType<typeof vi.fn>;
  forgetTerminal: ReturnType<typeof vi.fn>;
  getLayouts: ReturnType<typeof vi.fn>;
  getStagedPlan: ReturnType<typeof vi.fn>;
  getRuntimeStatus: ReturnType<typeof vi.fn>;
  killTerminal: ReturnType<typeof vi.fn>;
  openExternalTerminal: ReturnType<typeof vi.fn>;
  revealPath: ReturnType<typeof vi.fn>;
  requestPlan: ReturnType<typeof vi.fn>;
  resolveStagedPlan: ReturnType<typeof vi.fn>;
  setWorkspaceLayout: ReturnType<typeof vi.fn>;
  setWorkspaceViewState: ReturnType<typeof vi.fn>;
  getWorkspaceState: ReturnType<typeof vi.fn>;
  createWorkspaceFromFolder: ReturnType<typeof vi.fn>;
  setWorkspaceState: ReturnType<typeof vi.fn>;
  setStagedPlan: ReturnType<typeof vi.fn>;
  writeTerminal: ReturnType<typeof vi.fn>;
  emitExit: (event: TerminalExitEvent) => void;
} {
  const exitListeners = new Set<(event: TerminalExitEvent) => void>();
  const clearStagedPlan = vi.fn().mockResolvedValue({ plan: null });
  const getStagedPlan = vi.fn().mockResolvedValue({ plan: stagedPlan });
  const getRuntimeStatus = vi.fn().mockResolvedValue(runtimeStatus);
  const requestPlan = vi.fn().mockResolvedValue(planResponse);
  const resolveStagedPlan = vi.fn().mockResolvedValue({ plan: null });
  const setStagedPlan = vi.fn().mockImplementation((request) => Promise.resolve({ plan: request }));
  const getLayouts = vi.fn().mockResolvedValue(layouts);
  const setWorkspaceLayout = vi.fn().mockResolvedValue(layouts);
  const setWorkspaceViewState = vi.fn().mockResolvedValue(layouts);
  const getWorkspaceState = vi.fn().mockResolvedValue(workspaceState);
  const setWorkspaceState = vi.fn().mockImplementation((request) => Promise.resolve(request));
  const openExternalTerminal = vi.fn().mockResolvedValue({ ok: true, resolvedPath: "/Users/patryk/Desktop/Alfred", terminal: "Ghostty" });
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
  const writeTerminal = vi.fn();
  const createTerminal = vi.fn().mockImplementation((request: Parameters<TerminalApi["create"]>[0]) =>
    Promise.resolve({
      id: "runtime-1",
      clientId: request.clientId ?? "manual-1",
      title: request.title ?? "Manual · zsh 1",
      source: request.source ?? "manual",
      workspaceId: request.workspaceId ?? "A",
      cwd: request.cwd ?? "/tmp",
      shell: "bash",
      ...(request.agentKind === undefined ? {} : { agentKind: request.agentKind }),
      ...(request.command === undefined ? {} : { command: request.command }),
      ...(request.args === undefined ? {} : { args: request.args }),
    }),
  );
  const terminal: TerminalApi = {
    create: createTerminal,
    forget: forgetTerminal,
    kill: killTerminal,
    list: vi.fn().mockResolvedValue({ sessions: terminalSessions, restoredSessions: restoredTerminalSessions }),
    onData: vi.fn(() => vi.fn()),
    onExit: vi.fn((callback: (event: TerminalExitEvent) => void) => {
      exitListeners.add(callback);
      return () => exitListeners.delete(callback);
    }),
    resize: vi.fn(),
    write: writeTerminal,
  };
  const bridge: DesktopBridge = {
    alfred: { clearStagedPlan, getRuntimeStatus, getStagedPlan, requestPlan, resolveStagedPlan, setStagedPlan },
    layout: { getLayouts, setWorkspaceLayout, setWorkspaceViewState },
    terminal,
    workspace: { createWorkspaceFromFolder, getWorkspaceState, openExternalTerminal, revealPath, setWorkspaceState },
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
    openExternalTerminal,
    revealPath,
    requestPlan,
    resolveStagedPlan,
    setStagedPlan,
    createWorkspaceFromFolder,
    getWorkspaceState,
    setWorkspaceState,
    setWorkspaceLayout,
    setWorkspaceViewState,
    writeTerminal,
    emitExit: (event: TerminalExitEvent) => {
      for (const listener of exitListeners) listener(event);
    },
  };
}

beforeEach(() => {
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

  it("creates real workspaces and scopes terminals to the active workspace", async () => {
    const user = userEvent.setup();
    const { createTerminal, createWorkspaceFromFolder, setWorkspaceState } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("tab", { name: "Alfred workspace, 1 idle" })).toBeInTheDocument();
    expect(screen.getByText("Alfred workspace")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add workspace" }));

    expect(createWorkspaceFromFolder).toHaveBeenCalledOnce();
    expect(screen.getByRole("tab", { name: /ClientApp workspace, 1 (starting|idle)/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("ClientApp workspace")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Manual · zsh 2/i })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /Manual · zsh 1/i })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenLastCalledWith(
        expect.objectContaining({ cwd: "/Users/patryk/Desktop/ClientApp", workspaceId: "CLIENTAPP" }),
      );
    });

    await user.click(screen.getByRole("tab", { name: "Alfred workspace, 1 idle" }));

    expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /Manual · zsh 2/i })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(setWorkspaceState).toHaveBeenLastCalledWith({
        workspaces: [
          { id: "A", label: "Alfred", shortLabel: "A" },
          { id: "CLIENTAPP", label: "ClientApp", shortLabel: "CLI", rootPath: "/Users/patryk/Desktop/ClientApp" },
        ],
        activeWorkspaceId: "A",
      });
    });
  });

  it("closes an empty non-default workspace from the command palette", async () => {
    const user = userEvent.setup();
    const { createWorkspaceFromFolder, setWorkspaceState } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add workspace" }));

    expect(createWorkspaceFromFolder).toHaveBeenCalledOnce();
    expect(await screen.findByText("ClientApp workspace")).toBeInTheDocument();
    expect(await screen.findByRole("article", { name: /Manual · zsh 2/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close Manual · zsh 2" }));

    expect(await screen.findByRole("status", { name: "Empty workspace" })).toHaveTextContent("ClientApp");

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "close current{Enter}");

    expect(screen.queryByText("ClientApp workspace")).not.toBeInTheDocument();
    expect(screen.getByText("Alfred workspace")).toBeInTheDocument();
    await waitFor(() => {
      expect(setWorkspaceState).toHaveBeenLastCalledWith({
        workspaces: [{ id: "A", label: "Alfred", shortLabel: "A" }],
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

    expect(await screen.findByRole("article", { name: /Manual · zsh 2/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledTimes(2);
    });

    await user.click(screen.getByRole("tab", { name: "Alfred workspace, 1 starting" }));

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
    expect(createTerminal).toHaveBeenCalledTimes(2);
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

  it("opens a selected session inspector from the tile header and collapses it with Escape", async () => {
    installDesktopBridge();

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Manual · zsh 1/i });
    fireEvent.click(tile.querySelector(".tile-header")!);

    expect(screen.getByRole("button", { name: "Focus" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Manual · zsh 1");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent activity")).toHaveTextContent("Session attached");
    });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByRole("button", { name: "Desk" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Agent activity")).not.toBeInTheDocument();
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

    fireEvent.click(secondTile.querySelector(".tile-header")!);

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
    const { createWorkspaceFromFolder, setWorkspaceLayout } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();

    await user.keyboard("{Control>}k{/Control}");

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
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
    await user.keyboard("folder{Enter}");

    expect(createWorkspaceFromFolder).toHaveBeenCalledOnce();
    expect(await screen.findByText("ClientApp workspace")).toBeInTheDocument();

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

  it("starts agent sessions directly from the command palette", async () => {
    const user = userEvent.setup();
    const { createTerminal } = installDesktopBridge();

    render(<App />);

    expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "codex{Enter}");

    expect(await screen.findByRole("article", { name: /Codex · session 1/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          agentKind: "codex",
          clientId: "codex-1",
          command: "codex",
          workspaceId: "A",
        }),
      );
    });
  });

  it("starts agent sessions from the top bar", async () => {
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
    expect(within(rail).getByText("Needs review")).toBeInTheDocument();
    const attentionButton = within(rail).getByRole("button", { name: "Focus decision: Codex · review" });
    expect(attentionButton).toHaveTextContent("waiting");

    await user.click(attentionButton);

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

    await user.click(await screen.findByRole("button", { name: "Open review queue, 1 item" }));

    const queue = screen.getByRole("dialog", { name: "Review queue" });
    expect(queue).toHaveTextContent("ClientApp");
    expect(queue).toHaveTextContent("Codex · review");
    expect(queue).not.toHaveTextContent("Local Codex · review");

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

  it("surfaces current workspace decisions in Alfred's rail instead of the top review button", async () => {
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

    expect(screen.queryByRole("button", { name: "Open review queue, 1 item" })).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-layout")).toHaveClass("alfred-expanded");
    const rail = screen.getByLabelText("Alfred status");
    expect(rail).not.toHaveClass("compact");
    expect(within(rail).getByText("Needs review")).toBeInTheDocument();
    expect(within(rail).getByText("Allow edit?")).toBeInTheDocument();

    await user.click(within(rail).getByRole("button", { name: "Focus decision: Codex · review" }));

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
    expect(within(rail).getByRole("region", { name: "Current workspace decisions" })).toHaveTextContent("Allow edit?");
    expect(within(rail).getByRole("region", { name: "Recovery queue" })).toHaveTextContent("Manual · saved");
    expect(within(rail).getByRole("button", { name: "Relaunch Manual · saved" })).toBeInTheDocument();
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

  it("shows unsafe commands before confirming them from the global review queue", async () => {
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

    await user.click(within(queue).getByRole("button", { name: "Review command Risky cleanup in ClientApp" }));

    expect(resolveStagedPlan).not.toHaveBeenCalled();
    expect(createTerminal).not.toHaveBeenCalled();
    expect(within(queue).getByRole("button", { name: "Confirm launch Risky cleanup in ClientApp" })).toBeInTheDocument();

    await user.click(within(queue).getByRole("button", { name: "Confirm launch Risky cleanup in ClientApp" }));

    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: "alfred-risky-w2",
          command: "rm",
          args: ["-rf", "dist"],
          workspaceId: "W2",
        }),
      );
    });
    await waitFor(() => {
      expect(resolveStagedPlan).toHaveBeenCalledWith({ sessionIds: ["alfred-risky-w2"] });
    });
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

    const rail = await screen.findByLabelText("Alfred status");
    expect(await within(rail).findByRole("button", { name: "Restart Manual · zsh 9" })).toBeInTheDocument();
    await user.click(within(rail).getByRole("button", { name: "Restart Manual · zsh 9" }));

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

  it("sends quick approval responses from the focused activity panel", async () => {
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
    fireEvent.click(tile.querySelector(".tile-header")!);

    expect(screen.getByRole("group", { name: "Approval actions for Codex · session 1" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send yes" }));

    expect(writeTerminal).toHaveBeenCalledWith({ id: "runtime-a", data: "y\n" });
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
    fireEvent.click(tile.querySelector(".tile-header")!);
    await user.click(
      screen.getByRole("button", { name: "Reveal edited: apps/desktop/src/renderer/app.tsx" }),
    );

    expect(revealPath).toHaveBeenCalledWith({
      cwd: "/Users/patryk/Desktop/Alfred",
      path: "apps/desktop/src/renderer/app.tsx",
    });
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
    fireEvent.click(tile.querySelector(".tile-header")!);
    await user.click(screen.getByRole("button", { name: "Open external terminal for Codex · session 1" }));

    expect(openExternalTerminal).toHaveBeenCalledWith({ cwd: "/Users/patryk/Desktop/Alfred" });
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
    const { setWorkspaceViewState } = installDesktopBridge();

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Manual · zsh 1/i });
    fireEvent.click(tile.querySelector(".tile-header")!);

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
    expect(await screen.findByRole("article", { name: /Staged Task B/i })).toBeInTheDocument();

    await user.click(within(rail).getByRole("button", { name: "Focus staged tile: Task B" }));

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

    const restored = await screen.findByRole("article", { name: /Codex · session 9/i });
    await waitFor(() => {
      expect(restored).toHaveTextContent("restored");
    });
    expect(screen.getByRole("region", { name: "Recovery queue" })).toHaveTextContent("Codex · session 9");
    expect(screen.getByLabelText("Alfred status")).not.toHaveClass("compact");
    expect(createTerminal).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Relaunch Codex · session 9" }));

    expect(createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKind: "codex",
        clientId: "codex-9",
        command: "codex",
        cwd: "/repo",
        workspaceId: "A",
      }),
    );
    expect(screen.queryByRole("article", { name: /Manual · zsh 10/i })).not.toBeInTheDocument();
    expect(forgetTerminal).not.toHaveBeenCalled();
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

    expect(await screen.findByRole("region", { name: "Recovery queue" })).toHaveTextContent("Manual · zsh 9");

    await userEvent.click(screen.getByRole("button", { name: "Dismiss Manual · zsh 9" }));

    expect(screen.queryByRole("article", { name: /Manual · zsh 9/i })).not.toBeInTheDocument();
    expect(forgetTerminal).toHaveBeenCalledWith({ clientId: "manual-9" });
  });

  it("dismisses all recoverable sessions from the workspace recovery strip", async () => {
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

    expect(await screen.findByRole("region", { name: "Recovery queue" })).toHaveTextContent("2 saved");
    expect(screen.getByRole("region", { name: "Session recovery" })).toHaveTextContent("2 saved sessions");

    await userEvent.click(screen.getByRole("button", { name: "Dismiss saved sessions" }));

    expect(screen.queryByRole("article", { name: /Manual · zsh 9/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /Codex · session 9/i })).not.toBeInTheDocument();
    expect(forgetTerminal).toHaveBeenCalledWith({ clientId: "manual-9" });
    expect(forgetTerminal).toHaveBeenCalledWith({ clientId: "codex-9" });
  });

  it("relaunches all restored sessions from the workspace recovery strip", async () => {
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

    expect(await screen.findByRole("region", { name: "Recovery queue" })).toHaveTextContent("2 saved");
    expect(screen.getByRole("region", { name: "Session recovery" })).toHaveTextContent("2 restored");

    await userEvent.click(screen.getByRole("button", { name: "Relaunch saved sessions" }));

    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({ clientId: "manual-9" }));
      expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({ clientId: "codex-9", command: "codex" }));
    });
    expect(forgetTerminal).not.toHaveBeenCalled();
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

    expect(await screen.findByRole("region", { name: "Session recovery" })).toHaveTextContent("1 saved session");

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

    expect(await screen.findByRole("region", { name: "Recovery queue" })).toHaveTextContent("2 saved");

    await userEvent.click(screen.getByRole("button", { name: "Relaunch all" }));

    await waitFor(() => {
      expect(screen.getByRole("article", { name: /Manual · zsh 9/i })).toHaveTextContent("restored");
      expect(screen.getByRole("article", { name: /Manual · zsh 10/i })).toHaveTextContent("restored");
    });
    expect(screen.getByRole("region", { name: "Recovery queue" })).toHaveTextContent("2 saved");
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

    await user.click(screen.getByRole("button", { name: "Launch safe" }));

    await waitFor(() => {
      expect(resolveStagedPlan).toHaveBeenCalledWith({ sessionIds: ["alfred-1"] });
    });
    expect(screen.queryByRole("article", { name: /Staged Safe task/i })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Safe task/i })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Staged Risky task/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Alfred review queue" })).toHaveTextContent("0 safe · 1 flagged");
    expect(clearStagedPlan).not.toHaveBeenCalled();
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

    await user.click(screen.getByRole("button", { name: "Launch safe" }));

    await waitFor(() => {
      expect(screen.getByRole("article", { name: /Staged Safe task/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("article", { name: /Staged Risky task/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Alfred review queue" })).toHaveTextContent("1 safe · 1 flagged");
    expect(resolveStagedPlan).not.toHaveBeenCalledWith({ sessionIds: ["alfred-1"] });
  });

  it("requires two clicks before approving an unsafe staged tile", async () => {
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

    await user.click(screen.getByRole("button", { name: "Review unsafe command: Risky task" }));

    expect(resolveStagedPlan).not.toHaveBeenCalled();
    expect(screen.getByRole("article", { name: /Staged Risky task/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm unsafe command: Risky task" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm unsafe command: Risky task" }));

    await waitFor(() => {
      expect(resolveStagedPlan).toHaveBeenCalledWith({ sessionIds: ["alfred-1"] });
    });
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
