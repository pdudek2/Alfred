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

  it("offers session handoff actions for cwd and command", async () => {
    const user = userEvent.setup();
    const onCopyActivityText = vi.fn();
    const onOpenExternalTerminal = vi.fn();
    const onRevealActivityFile = vi.fn();
    const session: SessionTile = {
      id: "s1",
      title: "codex — feature",
      workspaceId: "w1",
      stage: "live",
      cwd: "/repo/alfred",
      source: "alfred",
      command: "codex",
      args: ["--resume", "hello world", "src/odd's file.ts"],
      runtimeId: "runtime-1",
    };

    render(
      <AgentTimelinePanel
        session={session}
        onCopyActivityText={onCopyActivityText}
        onOpenExternalTerminal={onOpenExternalTerminal}
        onRevealActivityFile={onRevealActivityFile}
      />,
    );

    const handoff = screen.getByRole("region", { name: "Handoff actions for codex — feature" });
    expect(handoff).toHaveTextContent("Continue outside Alfred");

    await user.click(within(handoff).getByRole("button", { name: "Reveal folder for codex — feature" }));
    await user.click(within(handoff).getByRole("button", { name: "Open external terminal for codex — feature" }));
    await user.click(within(handoff).getByRole("button", { name: "Copy cwd for codex — feature" }));
    await user.click(within(handoff).getByRole("button", { name: "Copy command for codex — feature" }));

    expect(onRevealActivityFile).toHaveBeenCalledWith(".", "/repo/alfred");
    expect(onOpenExternalTerminal).toHaveBeenCalledWith("/repo/alfred");
    expect(onCopyActivityText).toHaveBeenCalledWith("/repo/alfred");
    expect(onCopyActivityText).toHaveBeenCalledWith("codex --resume 'hello world' 'src/odd'\\''s file.ts'");
  });

  it("shortens noisy worktree facts without changing cwd handoff copy", async () => {
    const user = userEvent.setup();
    const onCopyActivityText = vi.fn();
    const cwd = "/Users/patryk/Desktop/Alfred/.worktrees/path-noise-pass-with-extra-detail";
    const branchName = "codex/alfred/focus/right-dock/path-noise-pass-branch";
    const baseCwd = "/Users/patryk/Desktop/Alfred";
    const session: SessionTile = {
      id: "s1",
      title: "codex — path noise",
      workspaceId: "w1",
      stage: "live",
      cwd,
      source: "alfred",
      command: "codex",
      runtimeId: "runtime-1",
      isolation: "worktree",
      branchName,
      baseCwd,
    };

    const { container } = render(<AgentTimelinePanel session={session} onCopyActivityText={onCopyActivityText} />);

    const facts = container.querySelector<HTMLElement>(".agent-session-facts");
    if (!facts) throw new Error("Session facts not rendered");
    expect(within(facts).getByText("…/.worktrees/path…with-extra-detail")).toHaveAttribute("title", cwd);
    expect(within(facts).getByText("…/.worktrees/path…with-extra-detail")).toHaveAttribute("aria-label", cwd);
    expect(within(facts).getByText("…/right-dock/path-noise-pass-branch")).toHaveAttribute("title", branchName);
    expect(within(facts).getByText("…/Desktop/Alfred")).toHaveAttribute("title", baseCwd);
    expect(facts).not.toHaveTextContent(cwd);
    expect(facts).not.toHaveTextContent(branchName);

    const handoff = within(container).getByRole("region", { name: "Handoff actions for codex — path noise" });
    await user.click(within(handoff).getByRole("button", { name: "Copy cwd for codex — path noise" }));

    expect(onCopyActivityText).toHaveBeenCalledWith(cwd);
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

  it("renders structured activity payloads as inspectable objects", () => {
    const session: SessionTile = {
      id: "s1",
      title: "codex — activity",
      workspaceId: "w1",
      stage: "live",
      cwd: "/tmp",
      source: "alfred",
      runtimeId: "runtime-1",
      activityEvents: [
        {
          id: "activity-1",
          kind: "command",
          title: "Ran command",
          detail: '"pnpm test"',
          at: 100,
          payload: { type: "command", command: "pnpm test" },
        },
        {
          id: "activity-2",
          kind: "file",
          title: "Edit file",
          detail: "apps/desktop/src/renderer/app.tsx",
          at: 110,
          payload: { type: "file", operation: "edited", path: "apps/desktop/src/renderer/app.tsx" },
        },
        {
          id: "activity-3",
          kind: "tool",
          title: "WebSearch tool",
          detail: "Alfred terminal UX",
          at: 120,
          payload: { type: "tool", name: "WebSearch", input: "Alfred terminal UX" },
        },
        {
          id: "activity-4",
          kind: "approval",
          title: "Waiting for approval",
          detail: "Allow edit?",
          at: 130,
          payload: { type: "approval", prompt: "Allow edit in app.tsx?" },
        },
      ],
    };

    const { container } = render(<AgentTimelinePanel session={session} />);
    const objects = Array.from(container.querySelectorAll(".agent-activity-object"));

    expect(objects).toHaveLength(4);
    expect(objects.some((object) => object.textContent?.includes("commandpnpm test"))).toBe(true);
    expect(objects.some((object) => object.textContent?.includes("editedapps/desktop/src/renderer/app.tsx"))).toBe(true);
    expect(objects.some((object) => object.textContent?.includes("WebSearchAlfred terminal UX"))).toBe(true);
    expect(objects.some((object) => object.textContent?.includes("approvalAllow edit in app.tsx?"))).toBe(true);
  });

  it("reveals file payloads and copies text payloads from the activity object", async () => {
    const user = userEvent.setup();
    const onCopyActivityText = vi.fn();
    const onRevealActivityFile = vi.fn();
    const session: SessionTile = {
      id: "s1",
      title: "codex — activity",
      workspaceId: "w1",
      stage: "live",
      cwd: "/repo",
      source: "alfred",
      runtimeId: "runtime-1",
      activityEvents: [
        {
          id: "activity-1",
          kind: "command",
          title: "Ran command",
          detail: '"pnpm test"',
          at: 100,
          payload: { type: "command", command: "pnpm test" },
        },
        {
          id: "activity-2",
          kind: "file",
          title: "Edit file",
          detail: "apps/desktop/src/renderer/app.tsx",
          at: 110,
          payload: { type: "file", operation: "edited", path: "apps/desktop/src/renderer/app.tsx" },
        },
      ],
    };

    const { container } = render(
      <AgentTimelinePanel
        session={session}
        onCopyActivityText={onCopyActivityText}
        onRevealActivityFile={onRevealActivityFile}
      />,
    );
    const panel = within(container);

    await user.click(
      panel.getByRole("button", { name: "Reveal edited: apps/desktop/src/renderer/app.tsx" }),
    );
    await user.click(panel.getByRole("button", { name: "Copy command: pnpm test" }));

    expect(onRevealActivityFile).toHaveBeenCalledWith("apps/desktop/src/renderer/app.tsx", "/repo");
    expect(onCopyActivityText).toHaveBeenCalledWith("pnpm test");
  });

  it("marks payload copy actions as missing when the clipboard handler fails", async () => {
    const user = userEvent.setup();
    const session: SessionTile = {
      id: "s1",
      title: "codex — activity",
      workspaceId: "w1",
      stage: "live",
      cwd: "/repo",
      source: "alfred",
      runtimeId: "runtime-1",
      activityEvents: [
        {
          id: "activity-1",
          kind: "command",
          title: "Ran command",
          detail: '"pnpm test"',
          at: 100,
          payload: { type: "command", command: "pnpm test" },
        },
      ],
    };

    const { container } = render(
      <AgentTimelinePanel
        session={session}
        onCopyActivityText={() => {
          throw new Error("Clipboard is unavailable.");
        }}
      />,
    );
    const panel = within(container);

    await user.click(panel.getByRole("button", { name: "Copy command: pnpm test" }));

    expect(panel.getByRole("button", { name: "Copy command: pnpm test" })).toHaveTextContent("missing");
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

  it("lets editable staged shell sessions save command changes for re-check", async () => {
    const user = userEvent.setup();
    const onUpdateStagedSession = vi.fn().mockResolvedValue(undefined);
    const session: SessionTile = {
      id: "s2",
      title: "run tests",
      workspaceId: "w1",
      stage: "staged",
      cwd: "/repo",
      source: "alfred",
      agentKind: "shell",
      command: "echo",
      args: ["old"],
    };

    render(<AgentTimelinePanel session={session} onUpdateStagedSession={onUpdateStagedSession} />);

    await user.click(screen.getByRole("button", { name: "Edit command" }));
    await user.clear(screen.getByLabelText("Command"));
    await user.type(screen.getByLabelText("Command"), "pnpm");
    await user.clear(screen.getByLabelText("Arguments"));
    await user.type(screen.getByLabelText("Arguments"), "test{enter}--watch");
    await user.clear(screen.getByLabelText("Working directory"));
    await user.type(screen.getByLabelText("Working directory"), "apps/desktop");
    await user.click(screen.getByRole("button", { name: "Save and re-check" }));

    expect(onUpdateStagedSession).toHaveBeenCalledWith("s2", {
      command: "pnpm",
      args: ["test", "--watch"],
      cwd: "apps/desktop",
    });
  });

  it("keeps coding-agent staged sessions read-only until launch defaults are wired", () => {
    const onUpdateStagedSession = vi.fn().mockResolvedValue(undefined);
    const session: SessionTile = {
      id: "s3",
      title: "review feature",
      workspaceId: "w1",
      stage: "staged",
      cwd: "/repo",
      source: "alfred",
      agentKind: "codex",
      command: "codex",
      args: [],
    };

    const { container } = render(<AgentTimelinePanel session={session} onUpdateStagedSession={onUpdateStagedSession} />);

    expect(within(container).queryByRole("button", { name: "Edit command" })).not.toBeInTheDocument();
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
