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

  it("keeps discard as an icon action and the meta line free of the workspace name", () => {
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

    expect(screen.getByRole("button", { name: "Discard Codex · session 1" })).toBeInTheDocument();
    const meta = screen.getByText(/Stopped on quit/);
    expect(meta.textContent).not.toContain("CodexPulse");
    expect(meta).toHaveAttribute("title", expect.stringContaining("CodexPulse"));
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
