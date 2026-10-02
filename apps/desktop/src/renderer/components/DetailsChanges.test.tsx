import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionTile } from "../session-state";
import { DetailsChanges } from "./DetailsChanges";

const { worktreeDiff } = vi.hoisted(() => ({ worktreeDiff: vi.fn() }));
vi.mock("../desktop-api", () => ({ getDesktopTerminalApi: () => ({ worktreeDiff }) }));
const session: SessionTile = { id: "a", workspaceId: "A", title: "Codex", source: "manual", stage: "live", cwd: "/repo/wt", isolation: "worktree", branchName: "feature", baseCwd: "/repo" };
const props = { open: true, session, projectName: "Alfred", pending: false, onReview: vi.fn(), onApply: vi.fn() };
const changes = { ok: true, summary: "1 file changed", files: [{ path: "a.ts", status: " M" }], patch: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n" };
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("Details Changes", () => {
  it("shows file count and diff stats and routes review/apply to existing handlers", async () => {
    worktreeDiff.mockResolvedValue(changes);
    render(<DetailsChanges {...props} />);
    expect(await screen.findByText("a.ts")).toBeVisible();
    expect(screen.getByText("1 file")).toBeVisible();
    expect(screen.getByText("+1")).toBeVisible();
    expect(screen.getByText("−1")).toBeVisible();
    expect(screen.getByText("+1 −1")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Review diff" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply to Alfred" }));
    expect(props.onReview).toHaveBeenCalledWith("a");
    expect(props.onApply).toHaveBeenCalledWith("a");
  });

  it("shows the neutral empty state for a clean worktree and shared sessions", async () => {
    worktreeDiff.mockResolvedValue({ ...changes, files: [], patch: "" });
    const { rerender } = render(<DetailsChanges {...props} />);
    expect(await screen.findByText("No worktree changes.")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(<DetailsChanges {...props} session={{ ...session, isolation: "shared" }} />);
    expect(screen.getByText("No worktree changes.")).toBeVisible();
    expect(worktreeDiff).toHaveBeenCalledTimes(1);
  });

  it("does not display a late response from the previously focused session", async () => {
    let resolve!: (value: typeof changes) => void;
    worktreeDiff.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { rerender } = render(<DetailsChanges {...props} />);
    rerender(<DetailsChanges {...props} session={{ ...session, id: "b", isolation: "shared" }} />);
    await act(async () => resolve(changes));
    expect(screen.queryByText("a.ts")).not.toBeInTheDocument();
    expect(screen.getByText("No worktree changes.")).toBeVisible();
  });

  it("shows inspection failures rather than claiming a clean worktree", async () => {
    worktreeDiff.mockRejectedValue(new Error("Checkout is missing"));
    render(<DetailsChanges {...props} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Checkout is missing");
    expect(screen.queryByText("No worktree changes.")).not.toBeInTheDocument();
  });
});
