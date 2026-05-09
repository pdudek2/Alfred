import "@testing-library/jest-dom/vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
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
        { id: "activity-3", kind: "tool", title: "WebSearch tool", detail: "docs", at: 120 },
        { id: "activity-4", kind: "plan", title: "Plan updated", detail: "next step", at: 130 },
        { id: "activity-5", kind: "approval", title: "Waiting for approval", detail: "Proceed?", at: 140 },
        { id: "activity-6", kind: "error", title: "Error reported", detail: "build failed", at: 150 },
      ],
    };

    render(<AgentTimelinePanel session={session} />);

    const digest = screen.getAllByRole("region", { name: "Activity digest" }).at(-1);
    expect(digest).toBeDefined();
    if (!digest) throw new Error("Activity digest not rendered");
    expect(within(digest).getByText("command")).toBeInTheDocument();
    expect(within(digest).getByText("file")).toBeInTheDocument();
    expect(within(digest).getByText("tool")).toBeInTheDocument();
    expect(within(digest).getByText("plan")).toBeInTheDocument();
    expect(within(digest).getByText("ask")).toBeInTheDocument();
    expect(within(digest).getByText("issue")).toBeInTheDocument();
  });

  it("surfaces the next approval as the primary session pulse", () => {
    const session: SessionTile = {
      id: "s1",
      title: "codex — needs review",
      workspaceId: "w1",
      stage: "live",
      cwd: "/tmp",
      source: "alfred",
      runtimeId: "runtime-1",
      activityEvents: [
        { id: "activity-1", kind: "command", title: "Ran command", detail: "pnpm build", at: 100 },
        { id: "activity-2", kind: "approval", title: "Waiting for approval", detail: "Allow edit?", at: 120 },
      ],
    };

    render(<AgentTimelinePanel session={session} />);

    const pulse = screen.getAllByRole("region", { name: "Session pulse" }).at(-1);
    expect(pulse).toBeDefined();
    if (!pulse) throw new Error("Session pulse not rendered");
    expect(within(pulse).getByText("needs you")).toBeInTheDocument();
    expect(within(pulse).getByText("Waiting for approval")).toBeInTheDocument();
    expect(within(pulse).getByText("Allow edit?")).toBeInTheDocument();
  });

  it("prioritizes errors over routine structured signals", () => {
    const session: SessionTile = {
      id: "s1",
      title: "claude — review",
      workspaceId: "w1",
      stage: "live",
      cwd: "/tmp",
      source: "manual",
      runtimeId: "runtime-1",
      runtimeStatus: "error",
      activityEvents: [
        { id: "activity-1", kind: "file", title: "Edit file", detail: "app.tsx", at: 100 },
        { id: "activity-2", kind: "error", title: "Error reported", detail: "build failed", at: 120 },
      ],
    };

    render(<AgentTimelinePanel session={session} />);

    const pulse = screen.getAllByRole("region", { name: "Session pulse" }).at(-1);
    expect(pulse).toBeDefined();
    if (!pulse) throw new Error("Session pulse not rendered");
    expect(within(pulse).getByText("check this")).toBeInTheDocument();
    expect(within(pulse).getByText("Error reported")).toBeInTheDocument();
    expect(within(pulse).getByText("build failed")).toBeInTheDocument();
  });

  it("uses progress output as a pulse when no richer structured signal exists", () => {
    const session: SessionTile = {
      id: "s1",
      title: "codex — build",
      workspaceId: "w1",
      stage: "live",
      cwd: "/tmp",
      source: "alfred",
      runtimeId: "runtime-1",
      activityEvents: [
        { id: "activity-1", kind: "output", title: "Progress reported", detail: "✓ build passed", at: 100 },
      ],
    };

    render(<AgentTimelinePanel session={session} />);

    const pulse = screen.getAllByRole("region", { name: "Session pulse" }).at(-1);
    expect(pulse).toBeDefined();
    if (!pulse) throw new Error("Session pulse not rendered");
    expect(within(pulse).getByText("latest output")).toBeInTheDocument();
    expect(within(pulse).getByText("Progress reported")).toBeInTheDocument();
    expect(within(pulse).getByText("✓ build passed")).toBeInTheDocument();
  });

  it("shows ready staged sessions as launchable work", () => {
    const session: SessionTile = {
      id: "s2",
      title: "run tests",
      workspaceId: "w1",
      stage: "staged",
      cwd: "/tmp",
      source: "alfred",
      command: "pnpm",
      args: ["test", "--filter", "@alfred/desktop"],
    };

    render(<AgentTimelinePanel session={session} />);

    const pulse = screen.getAllByRole("region", { name: "Session pulse" }).at(-1);
    expect(pulse).toBeDefined();
    if (!pulse) throw new Error("Session pulse not rendered");
    expect(within(pulse).getByText("ready to launch")).toBeInTheDocument();
    expect(within(pulse).getByText("Plan item staged")).toBeInTheDocument();
    expect(within(pulse).getByText("pnpm test --filter @alfred/desktop")).toBeInTheDocument();
  });

  it("keeps the focused session age moving while the panel stays open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-09T12:00:00Z"));
    const session: SessionTile = {
      id: "s1",
      title: "codex — long task",
      workspaceId: "w1",
      stage: "live",
      cwd: "/tmp",
      source: "alfred",
      runtimeId: "runtime-1",
      createdAt: new Date("2026-05-09T11:50:00Z").getTime(),
    };

    try {
      render(<AgentTimelinePanel session={session} />);
      expect(screen.getByText("10m")).toBeInTheDocument();

      await act(async () => {
        vi.setSystemTime(new Date("2026-05-09T12:12:00Z"));
        await vi.advanceTimersByTimeAsync(5_000);
      });

      expect(screen.getByText("22m")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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
    expect(screen.getAllByText("rm -rf detected").length).toBeGreaterThan(0);
  });

  it("sends custom input to the focused live session", async () => {
    const user = userEvent.setup();
    const onSendInput = vi.fn();
    const session: SessionTile = {
      id: "s1",
      title: "codex — approval",
      workspaceId: "w1",
      stage: "live",
      cwd: "/tmp",
      source: "alfred",
      runtimeId: "runtime-1",
      activityEvents: [
        { id: "activity-1", kind: "approval", title: "Waiting for approval", detail: "Pick an option.", at: 100 },
      ],
    };

    render(<AgentTimelinePanel session={session} onSendInput={onSendInput} />);

    await user.type(screen.getByRole("textbox", { name: "Session input" }), "2");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSendInput).toHaveBeenCalledWith("runtime-1", "2\n");
    expect(screen.getByRole("textbox", { name: "Session input" })).toHaveValue("");
  });
});
