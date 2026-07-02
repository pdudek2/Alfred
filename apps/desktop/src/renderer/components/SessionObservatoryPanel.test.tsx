import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionTile } from "../session-state";
import { SessionObservatoryPanel } from "./SessionObservatoryPanel";
import type { WorkspaceRailWorkspace } from "./WorkspaceRail";

afterEach(() => {
  cleanup();
});

const workspaces: WorkspaceRailWorkspace[] = [
  {
    id: "A",
    label: "Alfred",
    shortLabel: "A",
    rootPath: "/Users/patryk/Desktop/Alfred",
    gitBranch: "main",
  },
  {
    id: "IRO",
    label: "IronLog",
    shortLabel: "IRO",
    rootPath: "/Users/patryk/Desktop/IronLog",
    gitBranch: "main",
  },
];

const sessions: SessionTile[] = [
  {
    id: "codex-1",
    title: "Code audit",
    workspaceId: "A",
    cwd: "/Users/patryk/Desktop/Alfred",
    source: "manual",
    stage: "live",
    runtimeStatus: "live",
    agentKind: "codex",
    command: "codex",
    lastOutputAt: Date.now(),
  },
  {
    id: "claude-1",
    title: "Frontend review",
    workspaceId: "IRO",
    cwd: "/Users/patryk/Desktop/IronLog",
    branchName: "alfred-claude-ui-review",
    source: "manual",
    stage: "live",
    runtimeStatus: "restored",
    agentKind: "claude",
    command: "claude",
  },
  {
    id: "plan-1",
    title: "Launch plan",
    workspaceId: "IRO",
    cwd: "/Users/patryk/Desktop/IronLog",
    source: "alfred",
    stage: "staged",
    runtimeStatus: "starting",
    command: "codex",
  },
];

describe("SessionObservatoryPanel", () => {
  it("filters sessions and opens the selected workspace session", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onOpenSession = vi.fn();

    render(
      <SessionObservatoryPanel
        activeWorkspaceId="A"
        sessions={sessions}
        workspaces={workspaces}
        onClose={onClose}
        onOpenSession={onOpenSession}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Session quick switch" })).toBeInTheDocument();
    expect(screen.getByLabelText("Session quick switch results")).toBeInTheDocument();
    expect(screen.getByText("Code audit")).toBeInTheDocument();
    expect(screen.getByText("Frontend review")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Search sessions" }), "ironlog claude");

    expect(screen.queryByText("Code audit")).not.toBeInTheDocument();
    expect(screen.getByText("Frontend review")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Frontend review/i }));

    expect(onOpenSession).toHaveBeenCalledWith("IRO", "claude-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an empty state when no session matches the search", async () => {
    const user = userEvent.setup();

    render(
      <SessionObservatoryPanel
        activeWorkspaceId="A"
        sessions={sessions}
        workspaces={workspaces}
        onClose={vi.fn()}
        onOpenSession={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "Search sessions" }), "not-a-session");

    expect(screen.getByText("No matching sessions")).toBeInTheDocument();
    expect(screen.getByText("Try a workspace name, agent, branch, or path.")).toBeInTheDocument();
  });
});
