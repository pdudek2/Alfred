import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AgentTimelinePanel } from "./AgentTimelinePanel";
import type { SessionTile } from "../session-state";

describe("AgentTimelinePanel", () => {
  it("renders an empty state when no session is focused", () => {
    render(<AgentTimelinePanel session={null} />);
    expect(screen.getByLabelText("Agent activity")).toBeInTheDocument();
    expect(screen.getByText("no selected session")).toBeInTheDocument();
    expect(screen.getByText(/select a terminal to inspect/i)).toBeInTheDocument();
  });

  it("shows actionable session facts when a session is provided", () => {
    const session: SessionTile = {
      id: "s1",
      title: "claude — alfred",
      workspaceId: "w1",
      stage: "live",
      cwd: "/tmp",
      source: "manual",
      command: "claude",
      args: ["--continue"],
      runtimeId: "runtime-1",
    };
    render(<AgentTimelinePanel session={session} />);
    expect(screen.getByText("claude — alfred")).toBeInTheDocument();
    expect(screen.getByText("live runtime")).toBeInTheDocument();
    expect(screen.getByText("claude --continue")).toBeInTheDocument();
    expect(screen.getByText("Session attached")).toBeInTheDocument();
  });

  it("renders recent stored activity events before generic runtime copy", () => {
    const session: SessionTile = {
      id: "s1",
      title: "codex — fix",
      workspaceId: "w1",
      stage: "live",
      cwd: "/tmp",
      source: "alfred",
      runtimeId: "runtime-1",
      lastActivityAt: 100,
      activityEvents: [
        {
          id: "activity-1",
          kind: "output",
          title: "Progress reported",
          detail: "✓ tests passed",
          at: 100,
        },
      ],
    };

    const { container } = render(<AgentTimelinePanel session={session} />);

    expect(screen.getByText("Progress reported")).toBeInTheDocument();
    expect(screen.getByText("✓ tests passed")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("Terminal output is streaming in the workspace.");
  });

  it("surfaces safety notes for staged sessions", () => {
    const session: SessionTile = {
      id: "s2",
      title: "dangerous cleanup",
      workspaceId: "w1",
      stage: "staged",
      cwd: "/tmp",
      source: "alfred",
      command: "rm",
      args: ["-rf", "dist"],
      safetyNote: "rm -rf detected",
    };

    render(<AgentTimelinePanel session={session} />);

    expect(screen.getByText("waiting for approval")).toBeInTheDocument();
    expect(screen.getByText("Safety review required")).toBeInTheDocument();
    expect(screen.getByText("rm -rf detected")).toBeInTheDocument();
  });
});
