import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionTile } from "../session-state";
import type { WorkspaceReviewItem } from "../workspace-attention";
import { ReviewSurface } from "./ReviewSurface";

afterEach(() => {
  cleanup();
});

function reviewItem(
  session: SessionTile,
  status: WorkspaceReviewItem["status"],
  detail = "Stopped on quit: Alfred stopped this terminal while quitting.",
  workspace = { label: "CodexPulse", shortLabel: "COD" },
): WorkspaceReviewItem {
  return {
    id: `${session.workspaceId}:${session.id}`,
    priority: 4,
    session,
    status,
    detail,
    workspaceId: session.workspaceId,
    workspaceLabel: workspace.label,
    workspaceShortLabel: workspace.shortLabel,
  };
}

function renderSurface(
  items: WorkspaceReviewItem[],
  armedUnsafeSessionIds = new Set<string>(),
) {
  const handlers = {
    onApproveTile: vi.fn(),
    onContinueRestoredSession: vi.fn(),
    onDiscardSession: vi.fn(),
    onFocusItem: vi.fn(),
    onLaunchItem: vi.fn(),
    onRestartSession: vi.fn(),
  };

  render(
    <ReviewSurface
      armedUnsafeSessionIds={armedUnsafeSessionIds}
      items={items}
      selectedSessionId={null}
      {...handlers}
    />,
  );

  return handlers;
}

describe("ReviewSurface", () => {
  it("renders only populated sections with a single waiting count", () => {
    renderSurface([
      reviewItem(
        {
          id: "codex-1",
          title: "Codex · session 1",
          workspaceId: "COD",
          cwd: "/Users/patryk/Desktop/CodexPulse",
          source: "alfred",
          stage: "live",
          runtimeStatus: "restored",
          command: "codex",
          args: ["resume", "--last"],
          agentKind: "codex",
        },
        { kind: "restored", label: "restored" },
      ),
    ]);

    expect(screen.queryByRole("region", { name: "Needs decision" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Blocked & safety" })).not.toBeInTheDocument();
    const recovery = screen.getByRole("region", { name: "Recovery" });
    expect(within(recovery).getByText("1")).toBeInTheDocument();
    expect(screen.getByText("1 waiting")).toBeInTheDocument();
    expect(document.querySelector(".review-surface-stats")).toBeNull();
  });

  it("exposes section detail as a visually hidden accessible description", () => {
    renderSurface([
      reviewItem(
        {
          id: "codex-1",
          title: "Codex · session 1",
          workspaceId: "COD",
          cwd: "/Users/patryk/Desktop/CodexPulse",
          source: "alfred",
          stage: "live",
          runtimeStatus: "restored",
          command: "codex",
          args: ["resume", "--last"],
          agentKind: "codex",
        },
        { kind: "restored", label: "restored" },
      ),
    ]);

    const recovery = screen.getByRole("region", { name: "Recovery" });
    const detail = document.getElementById("inbox-section-recovery-detail");

    expect(recovery).toHaveAttribute("aria-describedby", "inbox-section-recovery-detail");
    expect(recovery).toHaveAccessibleDescription(
      "Restored, exited and failed sessions that need a restart or discard.",
    );
    expect(detail).toHaveClass("visually-hidden");
  });

  it("shows the full workspace identity in metadata and action labels", () => {
    renderSurface([
      reviewItem(
        {
          id: "codex-1",
          title: "Codex · session 1",
          workspaceId: "COD",
          cwd: "/Users/patryk/Desktop/CodexPulse",
          source: "alfred",
          stage: "live",
          runtimeStatus: "restored",
          command: "codex",
          args: ["resume", "--last"],
          agentKind: "codex",
        },
        { kind: "restored", label: "restored" },
        "Stopped on quit: Alfred stopped this terminal while quitting.",
        { label: "ClientApp", shortLabel: "CLI" },
      ),
    ]);

    expect(screen.getByText(/ClientApp · restored/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume latest Codex · session 1 in ClientApp" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard Codex · session 1 from ClientApp" })).toBeInTheDocument();
  });

  it("tucks recovery commands behind an explicit disclosure instead of a prominent debug block", () => {
    renderSurface([
      reviewItem(
        {
          id: "codex-1",
          title: "Codex · session 1",
          workspaceId: "COD",
          cwd: "/Users/patryk/Desktop/CodexPulse",
          source: "alfred",
          stage: "live",
          runtimeStatus: "restored",
          command: "codex",
          args: ["resume", "--last"],
          agentKind: "codex",
        },
        { kind: "restored", label: "restored" },
      ),
    ]);

    const summary = screen.getByText("Restart command");
    const disclosure = summary.closest("details");

    expect(disclosure).toHaveClass("review-surface-command");
    expect(disclosure).not.toHaveAttribute("open");
    expect(disclosure).toHaveTextContent("codex resume --last");
  });

  it("opens a waiting session without launching or restarting it", async () => {
    const user = userEvent.setup();
    const handlers = renderSurface([
      reviewItem(
        {
          id: "waiting-agent",
          title: "Waiting agent",
          workspaceId: "W2",
          cwd: "/repo/client",
          source: "manual",
          stage: "live",
          runtimeStatus: "live",
          activityEvents: [
            { id: "ask-1", kind: "approval", title: "Approval needed", detail: "Approve command?", at: 100 },
          ],
        },
        { kind: "waiting", label: "waiting" },
        "Approve command?",
        { label: "ClientApp", shortLabel: "CLI" },
      ),
    ]);

    const action = document.querySelector<HTMLButtonElement>(".review-surface-primary");
    expect(action).toHaveAccessibleName("Open Waiting agent in ClientApp");
    expect(action).toBeEnabled();
    await user.click(action!);

    expect(handlers.onFocusItem).toHaveBeenCalledOnce();
    expect(handlers.onFocusItem).toHaveBeenCalledWith("W2", "waiting-agent");
    expect(handlers.onLaunchItem).not.toHaveBeenCalled();
    expect(handlers.onRestartSession).not.toHaveBeenCalled();
  });

  it("does not invent a primary action for an active session", () => {
    renderSurface([
      reviewItem(
        {
          id: "active-agent",
          title: "Active agent",
          workspaceId: "W2",
          cwd: "/repo/client",
          source: "manual",
          stage: "live",
          runtimeStatus: "live",
        },
        { kind: "active", label: "active" },
        "is working",
        { label: "ClientApp", shortLabel: "CLI" },
      ),
    ]);

    expect(document.querySelector(".review-surface-primary")).toBeNull();
  });

  it("keeps unsafe restored relaunches in Inbox until explicit confirmation", async () => {
    const user = userEvent.setup();
    const item = reviewItem(
      {
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
      { kind: "restored", label: "restored" },
      "can be relaunched",
      { label: "Alfred", shortLabel: "A" },
    );
    const handlers = renderSurface([item]);

    await user.click(screen.getByRole("button", { name: "Review relaunch Clean Desktop in Alfred" }));

    expect(handlers.onContinueRestoredSession).toHaveBeenCalledWith("clean-desktop");
    expect(handlers.onFocusItem).not.toHaveBeenCalled();

    cleanup();
    const armedHandlers = renderSurface([item], new Set(["clean-desktop"]));
    await user.click(screen.getByRole("button", { name: "Confirm relaunch Clean Desktop in Alfred" }));

    expect(armedHandlers.onContinueRestoredSession).toHaveBeenCalledWith("clean-desktop");
    expect(armedHandlers.onFocusItem).toHaveBeenCalledWith("A", "clean-desktop");
  });

  it("requires review before restarting an unsafe ended session", async () => {
    const user = userEvent.setup();
    const item = reviewItem(
      {
        id: "cleanup",
        title: "Cleanup",
        workspaceId: "A",
        cwd: "/repo",
        source: "manual",
        stage: "live",
        runtimeStatus: "exited",
        command: "rm",
        args: ["-rf", "tmp/build"],
      },
      { kind: "done", label: "done" },
      "can be restarted",
      { label: "Alfred", shortLabel: "A" },
    );
    const handlers = renderSurface([item]);

    await user.click(screen.getByRole("button", { name: "Review restart Cleanup in Alfred" }));

    expect(handlers.onRestartSession).toHaveBeenCalledWith("cleanup");
    expect(handlers.onFocusItem).not.toHaveBeenCalled();

    cleanup();
    renderSurface([item], new Set(["cleanup"]));
    expect(screen.getByRole("button", { name: "Confirm restart Cleanup in Alfred" })).toBeEnabled();
  });

  it("restarts safe ended sessions and then focuses their workspace", async () => {
    const user = userEvent.setup();
    const handlers = renderSurface([
      reviewItem(
        {
          id: "client-shell",
          title: "Client shell",
          workspaceId: "W2",
          cwd: "/repo/client",
          source: "manual",
          stage: "live",
          runtimeStatus: "exited",
        },
        { kind: "done", label: "done" },
        "can be restarted",
        { label: "ClientApp", shortLabel: "CLI" },
      ),
    ]);

    await user.click(screen.getByRole("button", { name: "Restart Client shell in ClientApp" }));

    expect(handlers.onRestartSession).toHaveBeenCalledWith("client-shell");
    expect(handlers.onFocusItem).toHaveBeenCalledWith("W2", "client-shell");
  });

  it("distinguishes exact Codex resume from latest fallback", () => {
    renderSurface([
      reviewItem(
        {
          id: "codex-exact",
          title: "Codex · exact session",
          workspaceId: "A",
          cwd: "/repo",
          source: "alfred",
          stage: "live",
          runtimeStatus: "restored",
          command: "codex",
          args: [],
          agentKind: "codex",
          resumeTarget: {
            agentKind: "codex",
            sessionId: "019edc4b-99a7-7781-beb2-b3a2e7d7ff1f",
            source: "codex-session-index",
          },
        },
        { kind: "restored", label: "restored" },
        "can be resumed",
        { label: "Alfred", shortLabel: "A" },
      ),
      reviewItem(
        {
          id: "codex-latest",
          title: "Codex · latest session",
          workspaceId: "W2",
          cwd: "/repo/client",
          source: "alfred",
          stage: "live",
          runtimeStatus: "restored",
          command: "codex",
          args: [],
          agentKind: "codex",
        },
        { kind: "restored", label: "restored" },
        "can be resumed",
        { label: "ClientApp", shortLabel: "CLI" },
      ),
    ]);

    expect(screen.getByRole("button", { name: "Resume Codex · exact session in Alfred" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume latest Codex · latest session in ClientApp" })).toBeInTheDocument();
  });

  it("keeps blocked staged commands disabled but independently discardable", async () => {
    const user = userEvent.setup();
    const handlers = renderSurface([
      reviewItem(
        {
          id: "claude-review",
          title: "UI/UX Deep Analysis",
          workspaceId: "A",
          cwd: "/repo",
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
        { kind: "blocked", label: "blocked" },
        "Command is unavailable",
        { label: "Alfred", shortLabel: "A" },
      ),
    ]);

    expect(screen.getByRole("button", { name: "Blocked UI/UX Deep Analysis in Alfred" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Discard UI/UX Deep Analysis from Alfred" }));

    expect(handlers.onDiscardSession).toHaveBeenCalledWith("claude-review");
    expect(handlers.onLaunchItem).not.toHaveBeenCalled();
  });
});
