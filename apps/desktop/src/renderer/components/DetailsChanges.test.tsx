import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionTile } from "../session-state";
import { DetailsChanges } from "./DetailsChanges";

const { worktreeDiff } = vi.hoisted(() => ({ worktreeDiff: vi.fn() }));
vi.mock("../desktop-api", () => ({ getDesktopTerminalApi: () => ({ worktreeDiff }) }));
const session: SessionTile = { id: "a", workspaceId: "A", title: "Codex", source: "manual", stage: "live", cwd: "/repo/wt", isolation: "worktree", branchName: "feature", baseCwd: "/repo" };
const props = { open: true, session, projectName: "Alfred", onReview: vi.fn(), onApply: vi.fn() };
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

  it("reads the changes on opening, then once more when a burst of activity has gone quiet", async () => {
    vi.useFakeTimers();
    try {
      worktreeDiff.mockResolvedValue(changes);
      const { rerender } = render(<DetailsChanges {...props} session={{ ...session, lastActivityAt: 1 }} />);
      await act(async () => {});
      expect(worktreeDiff).toHaveBeenCalledTimes(1);

      // An agent at work records activity many times a second.
      for (let at = 2; at <= 11; at += 1) {
        rerender(<DetailsChanges {...props} session={{ ...session, lastActivityAt: at }} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      }
      expect(worktreeDiff).toHaveBeenCalledTimes(1);

      await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
      expect(worktreeDiff).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(worktreeDiff).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says a clean checkout has no changes, and shows nothing for a session working in the project", async () => {
    worktreeDiff.mockResolvedValue({ ...changes, files: [], patch: "" });
    const { container, rerender } = render(<DetailsChanges {...props} />);
    expect(await screen.findByText("No worktree changes.")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(<DetailsChanges {...props} session={{ ...session, isolation: "shared" }} />);
    expect(container).toBeEmptyDOMElement();
    expect(worktreeDiff).toHaveBeenCalledTimes(1);
  });

  it("does not display a late response from the previously focused session", async () => {
    let resolve!: (value: typeof changes) => void;
    worktreeDiff.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { container, rerender } = render(<DetailsChanges {...props} />);
    rerender(<DetailsChanges {...props} session={{ ...session, id: "b", isolation: "shared" }} />);
    await act(async () => resolve(changes));
    expect(screen.queryByText("a.ts")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows inspection failures rather than claiming a clean worktree", async () => {
    worktreeDiff.mockRejectedValue(new Error("Checkout is missing"));
    render(<DetailsChanges {...props} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Checkout is missing");
    expect(screen.queryByText("No worktree changes.")).not.toBeInTheDocument();
  });
});
