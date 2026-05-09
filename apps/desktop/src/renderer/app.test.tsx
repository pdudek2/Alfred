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
import type { PersistedTerminalSessionSnapshot, TerminalApi, TerminalSessionSnapshot } from "../shared/terminal-ipc";
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
  layouts: WorkspaceLayoutsSnapshot = { layoutsByWorkspace: {} },
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
  requestPlan: ReturnType<typeof vi.fn>;
  resolveStagedPlan: ReturnType<typeof vi.fn>;
  setWorkspaceLayout: ReturnType<typeof vi.fn>;
  getWorkspaceState: ReturnType<typeof vi.fn>;
  createWorkspaceFromFolder: ReturnType<typeof vi.fn>;
  setWorkspaceState: ReturnType<typeof vi.fn>;
  setStagedPlan: ReturnType<typeof vi.fn>;
} {
  const clearStagedPlan = vi.fn().mockResolvedValue({ plan: null });
  const getStagedPlan = vi.fn().mockResolvedValue({ plan: stagedPlan });
  const getRuntimeStatus = vi.fn().mockResolvedValue(runtimeStatus);
  const requestPlan = vi.fn().mockResolvedValue(planResponse);
  const resolveStagedPlan = vi.fn().mockResolvedValue({ plan: null });
  const setStagedPlan = vi.fn().mockImplementation((request) => Promise.resolve({ plan: request }));
  const getLayouts = vi.fn().mockResolvedValue(layouts);
  const setWorkspaceLayout = vi.fn().mockResolvedValue(layouts);
  const getWorkspaceState = vi.fn().mockResolvedValue(workspaceState);
  const setWorkspaceState = vi.fn().mockImplementation((request) => Promise.resolve(request));
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
    onExit: vi.fn(() => vi.fn()),
    resize: vi.fn(),
    write: vi.fn(),
  };
  const bridge: DesktopBridge = {
    alfred: { clearStagedPlan, getRuntimeStatus, getStagedPlan, requestPlan, resolveStagedPlan, setStagedPlan },
    layout: { getLayouts, setWorkspaceLayout },
    terminal,
    workspace: { createWorkspaceFromFolder, getWorkspaceState, setWorkspaceState },
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
    requestPlan,
    resolveStagedPlan,
    setStagedPlan,
    createWorkspaceFromFolder,
    getWorkspaceState,
    setWorkspaceState,
    setWorkspaceLayout,
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
    const missionGraph = screen.getByRole("region", { name: "Mission graph" });
    expect(missionGraph).toBeInTheDocument();
    expect(within(missionGraph).getAllByRole("listitem")).toHaveLength(1);
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

    expect(await screen.findByRole("tab", { name: "Alfred workspace, 1 live, 0 staged" })).toBeInTheDocument();
    expect(screen.getByText("Alfred workspace")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add workspace" }));

    expect(createWorkspaceFromFolder).toHaveBeenCalledOnce();
    expect(screen.getByRole("tab", { name: "ClientApp workspace, 1 live, 0 staged" })).toHaveAttribute(
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

    await user.click(screen.getByRole("tab", { name: "Alfred workspace, 1 live, 0 staged" }));

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

  it("hydrates persisted workspaces and opens the last active workspace", async () => {
    const { createTerminal } = installDesktopBridge(undefined, null, [], undefined, { layoutsByWorkspace: {} }, {
      workspaces: [
        { id: "A", label: "Alfred", shortLabel: "A" },
        { id: "W2", label: "Workspace 2", shortLabel: "W2", rootPath: "/tmp/workspace-2" },
      ],
      activeWorkspaceId: "W2",
    });

    render(<App />);

    expect(await screen.findByRole("tab", { name: "Workspace 2 workspace, 1 live, 0 staged" })).toHaveAttribute(
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

    await user.click(screen.getByRole("tab", { name: "Alfred workspace, 1 live, 0 staged" }));

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
      expect(screen.getByRole("tab", { name: "Alfred workspace, 2 live, 0 staged" })).toHaveAttribute(
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

    await user.type(screen.getByLabelText("Alfred prompt"), "prepare agents");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));

    expect(await screen.findByRole("article", { name: /Staged Task A/i })).toBeInTheDocument();
    expect(document.querySelector(".workspace-layout")).toHaveClass("alfred-expanded");
    expect(screen.getByLabelText("Alfred status")).not.toHaveClass("compact");
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

  it("hydrates saved workspace layouts from the desktop runtime", async () => {
    installDesktopBridge(undefined, null, [], undefined, {
      layoutsByWorkspace: {
        A: {
          "manual-1": { tileId: "manual-1", col: 3, row: 2, colSpan: 6, rowSpan: 4 },
        },
      },
    });

    render(<App />);

    const tile = await screen.findByRole("article", { name: /Manual · zsh 1/i });
    await userEvent.click(screen.getByRole("button", { name: "Arrange" }));

    expect(tile).toHaveStyle({ gridColumn: "3 / span 6", gridRow: "2 / span 4" });
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
    expect(requestPlan).toHaveBeenCalledWith({ prompt: "prepare agents" });
  });

  it("turns the first Alfred prompt into staged tiles", async () => {
    const user = userEvent.setup();
    const { requestPlan, setStagedPlan } = installDesktopBridge();

    render(<App />);

    await user.type(screen.getByLabelText("Alfred prompt"), "launch first plan");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));

    expect(requestPlan).toHaveBeenCalledWith({ prompt: "launch first plan" });
    expect(await screen.findByRole("region", { name: "Alfred launch plan" })).toHaveTextContent("Workspace prepared");
    expect(screen.getByRole("region", { name: "Alfred review queue" })).toHaveTextContent("2 safe · 0 flagged");
    expect(screen.getByRole("button", { name: "Launch queue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear staged plan from review queue" })).toBeInTheDocument();
    expect(await screen.findByRole("article", { name: /Staged Task A/i })).toBeInTheDocument();
    expect(await screen.findByRole("article", { name: /Staged Task B/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Focus staged tile: Task B" }));

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

  it("hydrates restored terminal transcripts without starting a new runtime", async () => {
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
      ],
    );

    render(<App />);

    const restored = await screen.findByRole("article", { name: /Manual · zsh 9/i });
    await waitFor(() => {
      expect(restored).toHaveTextContent("restored");
    });
    expect(createTerminal).not.toHaveBeenCalled();

    await userEvent.click(within(restored).getByRole("button", { name: "Continue from Manual · zsh 9" }));

    await screen.findByRole("article", { name: /Manual · zsh 10/i });
    expect(createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "manual-10",
        cwd: "/repo",
        workspaceId: "A",
      }),
    );

    await userEvent.click(within(restored).getByRole("button", { name: "Close Manual · zsh 9" }));

    expect(forgetTerminal).toHaveBeenCalledWith({ clientId: "manual-9" });
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
    expect(screen.getByRole("region", { name: "Alfred launch plan" })).toHaveTextContent("1 need review");
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
    expect(screen.getByRole("region", { name: "Alfred launch plan" })).toHaveTextContent("2 proposed");
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
