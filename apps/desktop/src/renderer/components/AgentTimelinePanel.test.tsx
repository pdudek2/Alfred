import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
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
      lastOutputAt: Date.now(),
    };
    render(<AgentTimelinePanel session={session} />);
    expect(screen.getByText("claude — alfred")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("claude --continue")).toBeInTheDocument();
    expect(screen.getByText("last output")).toBeInTheDocument();
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
        {
          id: "activity-2",
          kind: "command",
          title: "Ran command",
          detail: "pnpm test",
          at: 120,
        },
      ],
    };

    const { container } = render(<AgentTimelinePanel session={session} />);

    expect(screen.getByText("Progress reported")).toBeInTheDocument();
    expect(screen.getByText("✓ tests passed")).toBeInTheDocument();
    expect(screen.getByText("1 command · 1 signal")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("Terminal output is streaming in the workspace.");
  });

  it("summarizes structured activity as a compact digest", () => {
    const session: SessionTile = {
      id: "s1",
      title: "codex — implementation",
      workspaceId: "w1",
      stage: "live",
      cwd: "/tmp",
      source: "alfred",
      runtimeId: "runtime-1",
      activityEvents: [
        { id: "activity-1", kind: "command", title: "Ran command", detail: "pnpm test", at: 100 },
        { id: "activity-2", kind: "file", title: "Edit file", detail: "app.tsx", at: 110 },
        { id: "activity-3", kind: "plan", title: "Plan updated", detail: "next step", at: 120 },
        { id: "activity-4", kind: "approval", title: "Waiting for approval", detail: "Proceed?", at: 130 },
        { id: "activity-5", kind: "error", title: "Error reported", detail: "build failed", at: 140 },
      ],
    };

    render(<AgentTimelinePanel session={session} />);

    const digest = screen.getAllByRole("region", { name: "Activity digest" }).at(-1);
    expect(digest).toBeDefined();
    if (!digest) throw new Error("Activity digest not rendered");
    expect(within(digest).getByText("command")).toBeInTheDocument();
    expect(within(digest).getByText("file")).toBeInTheDocument();
    expect(within(digest).getByText("plan")).toBeInTheDocument();
    expect(within(digest).getByText("ask")).toBeInTheDocument();
    expect(within(digest).getByText("issue")).toBeInTheDocument();
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

    expect(screen.getByText("blocked")).toBeInTheDocument();
    expect(screen.getByText("Safety review required")).toBeInTheDocument();
    expect(screen.getByText("rm -rf detected")).toBeInTheDocument();
  });
});
