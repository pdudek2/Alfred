import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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
): WorkspaceReviewItem {
  return {
    id: `${session.workspaceId}:${session.id}`,
    priority: 4,
    session,
    status,
    detail,
    workspaceId: session.workspaceId,
    workspaceLabel: "CodexPulse",
    workspaceShortLabel: "COD",
  };
}

function renderSurface(items: WorkspaceReviewItem[]) {
  render(
    <ReviewSurface
      armedUnsafeSessionIds={new Set()}
      items={items}
      selectedSessionId={null}
      onApproveTile={vi.fn()}
      onContinueRestoredSession={vi.fn()}
      onDiscardSession={vi.fn()}
      onFocusItem={vi.fn()}
      onLaunchItem={vi.fn()}
      onRestartSession={vi.fn()}
    />,
  );
}

describe("ReviewSurface", () => {
  it("keeps empty Inbox sections compact and expands only sections with work", () => {
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

    const needsDecision = screen.getByRole("region", { name: "Needs decision" });
    const blockedSafety = screen.getByRole("region", { name: "Blocked & safety" });
    const recovery = screen.getByRole("region", { name: "Recovery" });

    expect(needsDecision).toHaveAttribute("data-state", "empty");
    expect(blockedSafety).toHaveAttribute("data-state", "empty");
    expect(recovery).toHaveAttribute("data-state", "populated");
    expect(within(needsDecision).queryByText("Clear.")).not.toBeInTheDocument();
    expect(within(blockedSafety).queryByText("Clear.")).not.toBeInTheDocument();
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
});
