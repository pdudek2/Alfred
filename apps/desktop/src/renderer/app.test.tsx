import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app";
import type { AlfredApi } from "../shared/alfred-ipc";
import type { TerminalApi } from "../shared/terminal-ipc";

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

function installDesktopBridge(): { requestPlan: ReturnType<typeof vi.fn> } {
  const requestPlan = vi.fn().mockResolvedValue({
    ok: true,
    plan: {
      name: "Demo plan",
      sessions: [
        { kind: "shell", title: "Task A", command: "echo", args: ["a"] },
        { kind: "dev-server", title: "Task B", command: "pnpm", args: ["dev"] },
      ],
    },
  });
  const terminal: TerminalApi = {
    create: vi.fn().mockResolvedValue({
      id: "runtime-1",
      clientId: "manual-1",
      title: "Manual · zsh 1",
      source: "manual",
      cwd: "/tmp",
      shell: "bash",
    }),
    kill: vi.fn(),
    list: vi.fn().mockResolvedValue({ sessions: [] }),
    onData: vi.fn(() => vi.fn()),
    onExit: vi.fn(() => vi.fn()),
    resize: vi.fn(),
    write: vi.fn(),
  };
  const bridge: DesktopBridge = {
    alfred: { requestPlan },
    terminal,
    version: "test",
  };

  window.alfredDesktop = bridge;
  return { requestPlan };
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
  it("turns the first Alfred prompt into staged tiles", async () => {
    const user = userEvent.setup();
    const { requestPlan } = installDesktopBridge();

    render(<App />);

    await user.type(screen.getByLabelText("Alfred prompt"), "launch first plan");
    await user.click(screen.getByRole("button", { name: "Send prompt to Alfred" }));

    expect(requestPlan).toHaveBeenCalledWith({ prompt: "launch first plan" });
    expect(await screen.findByRole("article", { name: /Staged Task A/i })).toBeInTheDocument();
    expect(await screen.findByRole("article", { name: /Staged Task B/i })).toBeInTheDocument();
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
    const { requestPlan } = installDesktopBridge();

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
  });
});
