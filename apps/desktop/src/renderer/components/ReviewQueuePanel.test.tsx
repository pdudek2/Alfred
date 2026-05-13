import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionTile } from "../session-state";
import type { WorkspaceReviewItem } from "../workspace-attention";
import { ReviewQueuePanel } from "./ReviewQueuePanel";

afterEach(() => {
  cleanup();
});

const endedSession = {
  id: "client-shell",
  title: "Client shell",
  workspaceId: "W2",
  cwd: "/repo/client",
  source: "manual",
  stage: "live",
  runtimeStatus: "exited",
} satisfies SessionTile;

function renderPanel(item: WorkspaceReviewItem, armedUnsafeSessionIds = new Set<string>()) {
  const handlers = {
    onApproveTile: vi.fn(),
    onClose: vi.fn(),
    onContinueRestoredSession: vi.fn(),
    onDiscardSession: vi.fn(),
    onFocusItem: vi.fn(),
    onLaunchItem: vi.fn(),
    onRestartSession: vi.fn(),
  };

  render(
    <ReviewQueuePanel
      armedUnsafeSessionIds={armedUnsafeSessionIds}
      items={[item]}
      selectedSessionId={null}
      {...handlers}
    />,
  );

  return handlers;
}

describe("ReviewQueuePanel", () => {
  it("restarts ended sessions from their owning workspace", async () => {
    const user = userEvent.setup();
    const handlers = renderPanel({
      id: "W2:client-shell",
      priority: 5,
      session: endedSession,
      status: { kind: "done", label: "done" },
      detail: "can be restarted",
      workspaceId: "W2",
      workspaceLabel: "ClientApp",
      workspaceShortLabel: "CLI",
    });

    await user.click(screen.getByRole("button", { name: "Restart Client shell in ClientApp" }));

    expect(handlers.onRestartSession).toHaveBeenCalledWith("client-shell");
    expect(handlers.onFocusItem).toHaveBeenCalledWith("W2", "client-shell");
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it("keeps unsafe restored relaunches in the queue for explicit confirmation", async () => {
    const user = userEvent.setup();
    const handlers = renderPanel({
      id: "A:clean-desktop",
      priority: 4,
      session: {
        id: "clean-desktop",
        title: "Clean Desktop",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop",
        source: "manual",
        stage: "live",
        runtimeStatus: "restored",
        command: "find",
        args: ["/Users/patryk/Desktop", "-maxdepth", "1", "-exec", "mv", "{}", "/Users/patryk/Desktop/Alfred", ";"],
      },
      status: { kind: "restored", label: "restored" },
      detail: "can be relaunched",
      workspaceId: "A",
      workspaceLabel: "Alfred",
      workspaceShortLabel: "A",
    });

    expect(screen.getByText("find -exec mutates files when replayed")).toBeInTheDocument();
    expect(screen.getByText(/find .* -exec mv/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review relaunch Clean Desktop in Alfred" }));

    expect(handlers.onContinueRestoredSession).toHaveBeenCalledWith("clean-desktop");
    expect(handlers.onFocusItem).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it("lets recovery items be discarded without relaunching", async () => {
    const user = userEvent.setup();
    const handlers = renderPanel({
      id: "W2:client-shell",
      priority: 5,
      session: endedSession,
      status: { kind: "done", label: "done" },
      detail: "can be restarted",
      workspaceId: "W2",
      workspaceLabel: "ClientApp",
      workspaceShortLabel: "CLI",
    });

    await user.click(screen.getByRole("button", { name: "Discard Client shell from ClientApp" }));

    expect(handlers.onDiscardSession).toHaveBeenCalledWith("client-shell");
    expect(handlers.onRestartSession).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it("lets blocked staged commands be discarded from the queue", async () => {
    const user = userEvent.setup();
    const handlers = renderPanel({
      id: "A:claude-review",
      priority: 6,
      session: {
        id: "claude-review",
        title: "UI/UX Deep Analysis",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
        source: "alfred",
        stage: "staged",
        command: "claude",
        args: ["--print", "review UI"],
        agentKind: "claude",
        launchPreflight: {
          status: "blocked",
          code: "command_missing",
          label: "Launch blocked",
          reason: "Command \"claude\" is not available on PATH.",
        },
      },
      status: { kind: "blocked", label: "blocked" },
      detail: "Command is unavailable",
      workspaceId: "A",
      workspaceLabel: "Alfred",
      workspaceShortLabel: "A",
    });

    expect(screen.getByRole("button", { name: "Blocked UI/UX Deep Analysis in Alfred" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Discard UI/UX Deep Analysis from Alfred" }));

    expect(handlers.onDiscardSession).toHaveBeenCalledWith("claude-review");
    expect(handlers.onLaunchItem).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });
});
