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
    expect(screen.getByText(/select a terminal to inspect/i)).toBeInTheDocument();
  });

  it("shows actionable session facts when a session is provided", async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("last output")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Activity (1)" }));
    expect(screen.getByText("Session attached")).toBeInTheDocument();
  });

  it("shows session essentials without zone or summary label layers", () => {
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

    const essentials = screen.getByRole("region", { name: "Session essentials" });
    expect(within(essentials).getByText("Codex")).toBeInTheDocument();
    expect(within(essentials).getByText("/repo/alfred")).toBeInTheDocument();
    expect(within(essentials).getByText("codex")).toBeInTheDocument();
  });

  it("keeps secondary facts behind a collapsed Details disclosure", async () => {
    const user = userEvent.setup();
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

    expect(screen.queryByText("branch")).not.toBeInTheDocument();
    expect(screen.queryByText("last output")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Details" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("branch")).toBeInTheDocument();
    expect(screen.getByText("last output")).toBeInTheDocument();
  });

  it("keeps the activity timeline behind a counted disclosure", async () => {
    const user = userEvent.setup();
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

    expect(screen.queryByText("Command ran")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Activity (2)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);

    const activity = within(container).getByRole("region", { name: "Recent activity" });
    expect(within(activity).getByText("Command ran")).toBeInTheDocument();
    expect(within(activity).getByText("Progress reported")).toBeInTheDocument();
  });

  it("collapses disclosures again when the selected session changes", async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "true");

    rerender(<AgentTimelinePanel session={{ ...baseSession, id: "s2", title: "codex — two" }} />);
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "false");
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

    const handoff = screen.getByRole("group", { name: "Handoff actions for codex — feature" });

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

    const essentialsCwd = container.querySelector<HTMLElement>(".agent-essentials-cwd");
    if (!essentialsCwd) throw new Error("Essentials cwd not rendered");
    expect(essentialsCwd).toHaveTextContent("…/.worktrees/path…with-extra-detail");
    expect(essentialsCwd).toHaveAttribute("title", cwd);
    expect(essentialsCwd).toHaveAttribute("aria-label", cwd);
    expect(essentialsCwd).not.toHaveTextContent(cwd);

    await user.click(screen.getByRole("button", { name: "Details" }));

    const facts = container.querySelector<HTMLElement>(".agent-session-facts");
    if (!facts) throw new Error("Session facts not rendered");
    expect(within(facts).getByText("…/right-dock/path-noise-pass-branch")).toHaveAttribute("title", branchName);
    expect(within(facts).getByText("…/Desktop/Alfred")).toHaveAttribute("title", baseCwd);
    expect(facts).not.toHaveTextContent(branchName);

    const handoff = within(container).getByRole("group", { name: "Handoff actions for codex — path noise" });
    await user.click(within(handoff).getByRole("button", { name: "Copy cwd for codex — path noise" }));

    expect(onCopyActivityText).toHaveBeenCalledWith(cwd);
  });

  it("shows isolated checkout lifecycle preview for worktree and legacy worktree sessions only", () => {
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
    const lifecycle = within(container).getByRole("group", { name: "Handoff actions for codex — isolated" });

    expect(within(lifecycle).getByText("Review diff")).toBeInTheDocument();
    expect(within(lifecycle).getByText("Apply to project")).toBeInTheDocument();
    expect(within(lifecycle).queryByRole("button", { name: "Review diff" })).not.toBeInTheDocument();
    expect(within(lifecycle).queryByRole("button", { name: "Apply to project" })).not.toBeInTheDocument();

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

    expect(within(container).queryByText("Review diff")).not.toBeInTheDocument();
    expect(within(container).queryByText("Apply to project")).not.toBeInTheDocument();
  });

  it("renders recent stored activity events before generic runtime copy", async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: /^Activity \(/ }));
    await user.click(screen.getByRole("button", { name: "Details" }));

    const timeline = within(container).getByRole("region", { name: "Recent activity" });
    expect(within(timeline).getByText("Progress reported")).toBeInTheDocument();
    expect(within(timeline).getByText("✓ tests passed")).toBeInTheDocument();
    expect(screen.getByText("1 command · 1 signal")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("Terminal output is streaming in the workspace.");
  });

  it("keeps the timeline to a short important preview", async () => {
    const user = userEvent.setup();
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
    const timeline = within(container).getByRole("region", { name: "Recent activity" });
    await user.click(within(timeline).getByRole("button", { name: /^Activity \(/ }));

    expect(within(timeline).getByText("Latest command")).toBeInTheDocument();
    expect(within(timeline).queryByText("Oldest command")).not.toBeInTheDocument();
    expect(within(timeline).getByText("1 older event hidden; debug noise stays out.")).toBeInTheDocument();
  });

  it("renders structured activity payloads as inspectable objects", async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByRole("button", { name: /^Activity \(/ }));
    const objects = Array.from(container.querySelectorAll(".agent-activity-object"));

    expect(objects).toHaveLength(4);
    expect(objects.some((object) => object.textContent?.includes("commandpnpm test"))).toBe(true);
    expect(objects.some((object) => object.textContent?.includes("editedapps/desktop/src/renderer/app.tsx"))).toBe(true);
    expect(objects.some((object) => object.textContent?.includes("WebSearchAlfred terminal UX"))).toBe(true);
    expect(objects.some((object) => object.textContent?.includes("approvalAllow edit in app.tsx?"))).toBe(true);
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

    expect(screen.queryByText("File activity")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Activity \(/ }));

    expect(screen.getByText("File activity")).toBeInTheDocument();
    expect(screen.queryByText("SessionStart hook (completed)")).not.toBeInTheDocument();

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
    await user.click(panel.getByRole("button", { name: /^Activity \(/ }));

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
    await user.click(panel.getByRole("button", { name: /^Activity \(/ }));

    await user.click(panel.getByRole("button", { name: "Copy command: pnpm test" }));

    expect(panel.getByRole("button", { name: "Copy command: pnpm test" })).toHaveTextContent("missing");
  });

  it("summarizes structured activity as a compact digest", async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByRole("button", { name: "Details" }));

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
    expect(screen.getByRole("form", { name: /Edit staged command for/ })).toBeInTheDocument();
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

    const pulse = screen.getAllByRole("region", { name: "Session pulse" }).at(-1);
    expect(pulse).toBeDefined();
    if (!pulse) throw new Error("Session pulse not rendered");
    expect(within(pulse).getByText("needs you")).toBeInTheDocument();
    expect(within(pulse).getByText("Waiting for approval")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Session input" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send yes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send no" })).not.toBeInTheDocument();
  });
});
