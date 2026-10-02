import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi } from "vitest";
import { AgentTimelinePanel } from "./AgentTimelinePanel";
import type { SessionTile } from "../session-state";

afterEach(() => {
  cleanup();
});

describe("AgentTimelinePanel", () => {
  it("renders an empty state when no session is focused", () => {
    render(<AgentTimelinePanel session={null} />);
    expect(screen.getByLabelText("Agent activity")).toBeInTheDocument();
    expect(screen.getByText("no selected session")).toBeInTheDocument();
    expect(screen.getByText(/select a session to see its location/i)).toBeInTheDocument();
  });

  it("shows the focused session location and state", async () => {
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
    expect(screen.getByText("working")).toBeInTheDocument();
    expect(screen.getByTitle("/tmp")).toBeInTheDocument();

    expect(screen.queryByText("last output")).not.toBeInTheDocument();

    expect(screen.getByText("No activity yet.")).toBeInTheDocument();
  });

  it("shows Location without kind or fact label layers", () => {
    const session: SessionTile = {
      id: "s1",
      title: "codex — feature",
      workspaceId: "w1",
      stage: "live",
      cwd: "/repo/alfred",
      source: "alfred",
      agentKind: "codex",
      command: "codex",
      runtimeId: "runtime-1",
    };

    const { container } = render(<AgentTimelinePanel session={session} />);

    expect(container.querySelectorAll(".agent-context-zone-heading")).toHaveLength(0);
    expect(container.querySelectorAll(".agent-section-heading")).toHaveLength(0);
    expect(screen.queryByText(/use the facts below/i)).not.toBeInTheDocument();

    const essentials = screen.getByRole("region", { name: "Location" });
    expect(within(essentials).getByText("w1")).toBeInTheDocument();
    expect(within(essentials).getByText("/repo/alfred")).toBeInTheDocument();
    expect(essentials.querySelector("dl")).toBeNull();
  });

  it("shows the branch and full path without a disclosure", async () => {
    const session: SessionTile = {
      id: "s1",
      title: "codex — worktree",
      workspaceId: "w1",
      stage: "live",
      cwd: "/repo/.worktrees/feature",
      source: "alfred",
      command: "codex",
      runtimeId: "runtime-1",
      isolation: "worktree",
      branchName: "feature-branch",
      baseCwd: "/repo/alfred",
      lastOutputAt: Date.now(),
    };

    render(<AgentTimelinePanel session={session} />);

    const location = screen.getByRole("region", { name: "Location" });
    expect(within(location).queryByText("Branch")).not.toBeInTheDocument();
    expect(within(location).getByText("feature-branch")).toBeVisible();
    expect(within(location).getByTitle(session.cwd)).toBeVisible();
  });

  it("shows Activity immediately in newest-first order", async () => {
    const session: SessionTile = {
      id: "s1",
      title: "codex — feature",
      workspaceId: "w1",
      stage: "live",
      cwd: "/repo/alfred",
      source: "alfred",
      command: "codex",
      runtimeId: "runtime-1",
      activityEvents: [
        { id: "e1", kind: "command", title: "Command ran", detail: "pnpm test", at: 100 },
        { id: "e2", kind: "output", title: "Progress reported", detail: "build passed", at: 200 },
      ],
    };

    const { container } = render(<AgentTimelinePanel session={session} />);

    const activity = within(container).getByRole("region", { name: "Activity" });
    const rows = within(activity).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector(".details-activity-text > span:first-child")?.textContent)).toEqual(["Progress reported", "Command ran"]);
  });

  it("shows relative seconds and minutes in plain Activity rows without a session creation time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    try {
      const { container } = render(<AgentTimelinePanel session={{
        id: "s1", title: "Review", workspaceId: "w1", cwd: "/repo", source: "manual", stage: "live",
        activityEvents: [40, 120, 1080].map((seconds) => ({
          id: String(seconds), kind: "command", title: `Command ${seconds}`, detail: "", at: Date.now() - seconds * 1000,
        })),
      }} />);
      expect(Array.from(container.querySelectorAll("time"), (time) => time.textContent)).toEqual(["40s", "2m", "18m"]);
      expect(container.querySelector("details")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the worktree folder name then the project label when no branch is available", () => {
    const session: SessionTile = { id: "s1", title: "Review", workspaceId: "w1", cwd: "/repo/.worktrees/review/", source: "manual", stage: "live", isolation: "worktree" };
    const { rerender } = render(<AgentTimelinePanel session={session} projectName="Alfred" />);
    expect(within(screen.getByRole("region", { name: "Location" })).getByText("review")).toBeVisible();
    rerender(<AgentTimelinePanel session={{ ...session, isolation: "shared", cwd: "/repo" }} projectName="Alfred" />);
    expect(within(screen.getByRole("region", { name: "Location" })).getByText("Alfred")).toBeVisible();
  });

  it("rebinds Location and Activity when the selected session changes", async () => {
    const baseSession: SessionTile = {
      id: "s1",
      title: "codex — one",
      workspaceId: "w1",
      stage: "live",
      cwd: "/repo/alfred",
      source: "alfred",
      command: "codex",
      runtimeId: "runtime-1",
      branchName: "feature-one",
      baseCwd: "/repo/alfred",
    };

    const { rerender } = render(<AgentTimelinePanel session={baseSession} />);
    expect(screen.getByRole("region", { name: "Location" })).toHaveTextContent("feature-one");
    rerender(<AgentTimelinePanel session={{ ...baseSession, id: "s2", title: "codex — two", branchName: "feature-two" }} />);
    expect(screen.getByRole("region", { name: "Location" })).toHaveTextContent("feature-two");
    expect(screen.queryByText("feature-one")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Activity" })).toBeVisible();
  });

  it("offers the three Location path actions", async () => {
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

    const handoff = screen.getByRole("group", { name: "Session actions for codex — feature" });

    await user.click(within(handoff).getByRole("button", { name: "Show in Finder for codex — feature" }));
    await user.click(within(handoff).getByRole("button", { name: "Open in terminal for codex — feature" }));
    await user.click(within(handoff).getByRole("button", { name: "Copy path for codex — feature" }));

    expect(onRevealActivityFile).toHaveBeenCalledWith(".", "/repo/alfred");
    expect(onOpenExternalTerminal).toHaveBeenCalledWith("/repo/alfred");
    expect(onCopyActivityText).toHaveBeenCalledWith("/repo/alfred");
  });

  it("preserves full worktree path in title and copy action", async () => {
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

    const path = screen.getByTitle(cwd);
    expect(path).toHaveTextContent(cwd);
    expect(screen.getByText(branchName)).toBeVisible();
    expect(container.querySelector("dl")).toBeNull();

    const handoff = within(container).getByRole("group", { name: "Session actions for codex — path noise" });
    await user.click(within(handoff).getByRole("button", { name: "Copy path for codex — path noise" }));

    expect(onCopyActivityText).toHaveBeenCalledWith(cwd);
  });

  it("shows worktree Location for legacy worktrees and omits it for shared sessions", () => {
    const legacyWorktreeSession: SessionTile = {
      id: "s1",
      title: "codex — isolated",
      workspaceId: "w1",
      stage: "live",
      cwd: "/repo/.worktrees/codex-isolated",
      source: "alfred",
      command: "codex",
      runtimeId: "runtime-1",
      branchName: "alfred-codex-isolated",
      baseCwd: "/repo",
    };

    const { rerender, container } = render(<AgentTimelinePanel session={legacyWorktreeSession} />);
    expect(within(container).getByTitle(legacyWorktreeSession.cwd)).toBeVisible();
    expect(within(container).getByText("alfred-codex-isolated")).toBeVisible();

    rerender(
      <AgentTimelinePanel
        session={{
          id: "s2",
          title: "codex — shared",
          workspaceId: "w1",
          stage: "live",
          cwd: "/repo",
          source: "alfred",
          command: "codex",
          runtimeId: "runtime-1",
          isolation: "shared",
          branchName: "alfred-codex-stale",
          baseCwd: "/repo",
        }}
      />,
    );

    expect(within(container).queryByText("Worktree")).not.toBeInTheDocument();
  });

  it("renders recent stored activity events before generic runtime copy", async () => {
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


    const timeline = within(container).getByRole("list");
    expect(within(timeline).getByText("Progress reported")).toBeInTheDocument();
    expect(within(timeline).getByText("✓ tests passed")).toBeInTheDocument();
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(2);
    expect(container).not.toHaveTextContent("Terminal output is streaming in the project.");
  });

  it("shows all important activity without truncating older events", async () => {
    const session: SessionTile = {
      id: "s1",
      title: "codex — busy",
      workspaceId: "w1",
      stage: "live",
      cwd: "/tmp",
      source: "alfred",
      runtimeId: "runtime-1",
      activityEvents: [
        { id: "activity-1", kind: "command", title: "Oldest command", detail: "pnpm install", at: 100 },
        { id: "activity-2", kind: "file", title: "File one", detail: "a.ts", at: 110 },
        { id: "activity-3", kind: "file", title: "File two", detail: "b.ts", at: 120 },
        { id: "activity-4", kind: "plan", title: "Plan update", detail: "next edits", at: 130 },
        { id: "activity-5", kind: "command", title: "Latest command", detail: "pnpm test", at: 140 },
      ],
    };

    const { container } = render(<AgentTimelinePanel session={session} />);
    const timeline = within(container).getByRole("list");

    expect(within(timeline).getByText("Latest command")).toBeInTheDocument();
    expect(within(timeline).getByText("Oldest command")).toBeInTheDocument();
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(5);
  });

  it("renders structured activity payloads as plain actionable rows", async () => {
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
    const objects = Array.from(container.querySelectorAll("button.details-activity-text"));
    expect(objects.map((object) => object.getAttribute("title"))).toEqual([
      "Allow edit in app.tsx?", "Alfred terminal UX", "apps/desktop/src/renderer/app.tsx", "pnpm test",
    ]);
    expect(container.querySelector("details")).toBeNull();
  });

  it("hides raw hook noise behind an explicit raw toggle", async () => {
    const user = userEvent.setup();
    const session: SessionTile = {
      id: "s1",
      title: "codex — hygiene",
      workspaceId: "w1",
      stage: "live",
      cwd: "/tmp",
      source: "alfred",
      runtimeId: "runtime-1",
      activityEvents: [
        {
          id: "raw-1",
          kind: "output",
          title: "Progress reported",
          detail: "SessionStart hook (completed)",
          at: 100,
        },
        {
          id: "work-1",
          kind: "file",
          title: "File activity",
          detail: "apps/desktop/src/renderer/app.tsx(modified)",
          at: 120,
        },
      ],
    };

    render(<AgentTimelinePanel session={session} />);



    expect(screen.getByText("File activity")).toBeInTheDocument();
    expect(screen.queryByText("SessionStart hook (completed)")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show raw (1)" }));

    expect(screen.getByText("SessionStart hook (completed)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide raw" })).toBeInTheDocument();
  });

  it("counts the full bounded activity buffer and reveals older raw events", async () => {
    const user = userEvent.setup();
    const session: SessionTile = {
      id: "s1",
      title: "codex — long activity",
      workspaceId: "w1",
      stage: "live",
      cwd: "/tmp",
      source: "alfred",
      runtimeId: "runtime-1",
      activityEvents: [
        ...Array.from({ length: 9 }, (_, index) => ({
          id: `work-${index + 1}`,
          kind: "file" as const,
          title: `File activity ${index + 1}`,
          detail: `src/file-${index + 1}.ts(modified)`,
          at: 100 + index,
        })),
        {
          id: "raw-old",
          kind: "output",
          title: "Progress reported",
          detail: "SessionStart hook (completed)",
          at: 1,
        },
      ],
    };

    render(<AgentTimelinePanel session={session} />);

    expect(screen.getByRole("button", { name: "Show raw (1)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show raw (1)" }));

    expect(screen.getByText("SessionStart hook (completed)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide raw" })).toBeInTheDocument();
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

  it("keeps every activity row without a Location digest", async () => {
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

    expect(screen.queryByRole("region", { name: "Activity digest" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Activity" })).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("region", { name: "Location" }).querySelector("dl")).toBeNull();
  });

  it("shows approval in the plain Activity log", () => {
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

    const pulse = screen.getByRole("region", { name: "Activity" });
    expect(pulse).toBeDefined();
    if (!pulse) throw new Error("Session pulse not rendered");
    expect(pulse.querySelector("details")).toBeNull();
    expect(within(pulse).getByText("Waiting for approval")).toBeInTheDocument();
    expect(within(pulse).getByText("Allow edit?")).toBeInTheDocument();
  });

  it("shows errors beside routine Activity signals", () => {
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

    const pulse = screen.getByRole("region", { name: "Activity" });
    expect(pulse).toBeDefined();
    if (!pulse) throw new Error("Session pulse not rendered");
    expect(pulse.querySelector("details")).toBeNull();
    expect(within(pulse).getByText("Error reported")).toBeInTheDocument();
    expect(within(pulse).getByText("build failed")).toBeInTheDocument();
  });

  it("shows progress output in the plain Activity log", () => {
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

    const pulse = screen.getByRole("region", { name: "Activity" });
    expect(pulse).toBeDefined();
    if (!pulse) throw new Error("Session pulse not rendered");
    expect(pulse.querySelector("details")).toBeNull();
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

    const pulse = screen.getByRole("region", { name: "Activity" });
    expect(pulse).toBeDefined();
    if (!pulse) throw new Error("Session pulse not rendered");
    expect(pulse.querySelector("details")).toBeNull();
    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(within(pulse).getByText("No activity yet.")).toBeInTheDocument();
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

  it("keeps staged command edit state inside the context hierarchy", async () => {
    const user = userEvent.setup();
    const onUpdateStagedSession = vi.fn();
    const stagedSession: SessionTile = {
      id: "s2",
      title: "resume agent",
      workspaceId: "w1",
      stage: "staged",
      cwd: "/repo",
      source: "alfred",
      agentKind: "shell",
      command: "codex",
      args: ["resume", "old"],
    };

    const { rerender } = render(
      <div data-context-open="true">
        <AgentTimelinePanel session={stagedSession} onUpdateStagedSession={onUpdateStagedSession} />
      </div>,
    );

    await user.click(screen.getByRole("button", { name: /edit command/i }));
    await user.clear(screen.getByLabelText("Command"));
    await user.type(screen.getByLabelText("Command"), "codex resume abc");

    rerender(
      <div data-context-open="false" inert>
        <AgentTimelinePanel session={stagedSession} onUpdateStagedSession={onUpdateStagedSession} />
      </div>,
    );
    rerender(
      <div data-context-open="true">
        <AgentTimelinePanel session={stagedSession} onUpdateStagedSession={onUpdateStagedSession} />
      </div>,
    );

    expect(screen.getByLabelText("Command")).toHaveValue("codex resume abc");
    expect(screen.getByRole("form", { name: /Edit draft command for/ })).toBeInTheDocument();
  });

  it.each(["codex", "claude"] as const)(
    "lets staged %s sessions save command changes for re-check",
    async (agentKind) => {
      const user = userEvent.setup();
      const onUpdateStagedSession = vi.fn().mockResolvedValue(undefined);
      const session: SessionTile = {
        id: `staged-${agentKind}`,
        title: `review ${agentKind}`,
        workspaceId: "w1",
        stage: "staged",
        cwd: "/repo",
        source: "alfred",
        agentKind,
        command: agentKind,
        args: ["--old"],
      };

      render(<AgentTimelinePanel session={session} onUpdateStagedSession={onUpdateStagedSession} />);
      await user.click(screen.getByRole("button", { name: "Edit command" }));
      await user.clear(screen.getByLabelText("Arguments"));
      await user.type(screen.getByLabelText("Arguments"), "--new");
      await user.click(screen.getByRole("button", { name: "Save and re-check" }));

      expect(onUpdateStagedSession).toHaveBeenCalledWith(session.id, {
        command: agentKind,
        args: ["--new"],
        cwd: "/repo",
      });
    },
  );

  it.each(["live", "restored", "exited"] as const)(
    "does not edit live sessions with %s runtime status",
    (runtimeStatus) => {
      const sessionFixture: SessionTile = {
        id: `live-${runtimeStatus}`,
        title: "active coding session",
        workspaceId: "w1",
        stage: "live",
        cwd: "/repo",
        source: "alfred",
        agentKind: "codex",
        command: "codex",
        args: [],
        runtimeId: "runtime-1",
      };

      render(
        <AgentTimelinePanel
          session={{ ...sessionFixture, runtimeStatus }}
          onUpdateStagedSession={vi.fn()}
        />,
      );

      expect(screen.queryByRole("button", { name: "Edit command" })).not.toBeInTheDocument();
    },
  );

  it("keeps relative activity time moving while the panel stays open", async () => {
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
      activityEvents: [{ id: "e1", kind: "command", title: "Ran command", detail: "", at: new Date("2026-05-09T11:50:00Z").getTime() }],
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

    expect(screen.getByText("needs you")).toBeInTheDocument();
    expect(screen.queryByText("Current state")).not.toBeInTheDocument();
    expect(screen.getAllByText("rm -rf detected").length).toBeGreaterThan(0);
  });

  it("keeps live approval sessions informational in the right dock", () => {
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

    render(<AgentTimelinePanel session={session} />);

    const pulse = screen.getByRole("region", { name: "Activity" });
    expect(pulse).toBeDefined();
    if (!pulse) throw new Error("Session pulse not rendered");
    expect(pulse.querySelector("details")).toBeNull();
    expect(within(pulse).getByText("Waiting for approval")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Session input" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send yes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send no" })).not.toBeInTheDocument();
  });
});
