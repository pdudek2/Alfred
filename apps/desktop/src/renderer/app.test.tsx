import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app";
import type {
  AlfredApi,
  AlfredPlanResponse,
  AlfredRuntimeStatus,
  AlfredStagedPlanSnapshot,
} from "../shared/alfred-ipc";
import type { TerminalApi, TerminalSessionSnapshot } from "../shared/terminal-ipc";

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
  terminal: TerminalApi;
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
  runtimeStatus: AlfredRuntimeStatus = {
    model: "anthropic/claude-sonnet-4-6",
    openRouterConfigured: true,
  },
): {
  clearStagedPlan: ReturnType<typeof vi.fn>;
  getStagedPlan: ReturnType<typeof vi.fn>;
  getRuntimeStatus: ReturnType<typeof vi.fn>;
  requestPlan: ReturnType<typeof vi.fn>;
  resolveStagedPlan: ReturnType<typeof vi.fn>;
  setStagedPlan: ReturnType<typeof vi.fn>;
} {
  const clearStagedPlan = vi.fn().mockResolvedValue({ plan: null });
  const getStagedPlan = vi.fn().mockResolvedValue({ plan: stagedPlan });
  const getRuntimeStatus = vi.fn().mockResolvedValue(runtimeStatus);
  const requestPlan = vi.fn().mockResolvedValue(planResponse);
  const resolveStagedPlan = vi.fn().mockResolvedValue({ plan: null });
  const setStagedPlan = vi.fn().mockImplementation((request) => Promise.resolve({ plan: request }));
  const createTerminal = vi.fn().mockImplementation((request: Parameters<TerminalApi["create"]>[0]) =>
    Promise.resolve({
      id: "runtime-1",
      clientId: request.clientId ?? "manual-1",
      title: request.title ?? "Manual · zsh 1",
      source: request.source ?? "manual",
      cwd: request.cwd ?? "/tmp",
      shell: "bash",
      ...(request.agentKind === undefined ? {} : { agentKind: request.agentKind }),
      ...(request.command === undefined ? {} : { command: request.command }),
      ...(request.args === undefined ? {} : { args: request.args }),
    }),
  );
  const terminal: TerminalApi = {
    create: createTerminal,
    kill: vi.fn(),
    list: vi.fn().mockResolvedValue({ sessions: terminalSessions }),
    onData: vi.fn(() => vi.fn()),
    onExit: vi.fn(() => vi.fn()),
    resize: vi.fn(),
    write: vi.fn(),
  };
  const bridge: DesktopBridge = {
    alfred: { clearStagedPlan, getRuntimeStatus, getStagedPlan, requestPlan, resolveStagedPlan, setStagedPlan },
    terminal,
    version: "test",
  };

  window.alfredDesktop = bridge;
  return { clearStagedPlan, getRuntimeStatus, getStagedPlan, requestPlan, resolveStagedPlan, setStagedPlan };
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
  it("keeps planned workspace rail items non-interactive until they are real", async () => {
    installDesktopBridge();

    render(<App />);

    expect(screen.getByRole("button", { name: "Alfred workspace" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "UI workspace planned" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "API workspace planned" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Docs workspace planned" })).toBeDisabled();
    expect(screen.getByText("Alfred workspace")).toBeInTheDocument();
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

  it("turns the first Alfred prompt into staged tiles", async () => {
    const user = userEvent.setup();
    const { requestPlan, setStagedPlan } = installDesktopBridge();

    render(<App />);

    await user.type(screen.getByLabelText("Alfred prompt"), "launch first plan");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));

    expect(requestPlan).toHaveBeenCalledWith({ prompt: "launch first plan" });
    expect(await screen.findByRole("article", { name: /Staged Task A/i })).toBeInTheDocument();
    expect(await screen.findByRole("article", { name: /Staged Task B/i })).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "Reject All" }));
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

    await user.click(screen.getByRole("button", { name: "Approve Task A" }));

    await waitFor(() => {
      expect(resolveStagedPlan).toHaveBeenCalledWith({ sessionIds: ["alfred-1"] });
    });
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
