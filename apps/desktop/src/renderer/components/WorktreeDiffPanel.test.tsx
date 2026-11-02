import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorktreeDiffView } from "../worktree-diff";
import { WorktreeDiffPanel } from "./WorktreeDiffPanel";

const readyView: WorktreeDiffView = {
  status: "ready",
  instanceKey: "codex-1:1",
  sessionId: "codex-1",
  sessionTitle: "Codex review",
  result: {
    ok: true,
    summary: "1 changed file",
    files: [{ path: "src/app.tsx", status: "M" }],
    applied: false,
    patch: [
      "diff --git a/src/app.tsx b/src/app.tsx",
      "@@ -4,2 +4,2 @@",
      "-old value",
      "+new value",
      " unchanged value",
    ].join("\n"),
  },
};

const actions = { projectName: "Alfred", onApply: vi.fn(), onDiscard: vi.fn() };

describe("WorktreeDiffPanel", () => {
  it("renders real files, totals, and accessible unified-diff lines", () => {
    render(<WorktreeDiffPanel {...actions} view={readyView} onClose={vi.fn()} />);

    expect(screen.getByRole("region", { name: "Worktree diff" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Codex review" })).toBeInTheDocument();
    expect(screen.getByText("1 changed file")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
    expect(screen.getByText("src/app.tsx")).toBeInTheDocument();
    // Each line reads what changed, then its code.
    const lines = screen.getAllByRole("listitem").filter((item) => item.classList.contains("worktree-diff-panel__line"));
    expect(lines.map((item) => item.querySelector("code")?.textContent)).toEqual([
      "Diff hunk: @@ -4,2 +4,2 @@",
      "Removed line 4: -old value",
      "Added line 4: +new value",
      "Unchanged line 5:  unchanged value",
    ]);
    // Git's header line repeats the file row; the hunk line stays.
    expect(screen.queryByText("diff --git a/src/app.tsx b/src/app.tsx")).toBeNull();
  });

  it("reports whether Close diff or Escape dismissed the panel", async () => {
    const onClose = vi.fn();
    render(<WorktreeDiffPanel {...actions} view={readyView} onClose={onClose} />);

    const close = screen.getByRole("button", { name: "Close diff" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.click(close);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose.mock.calls).toEqual([["button"], ["escape"]]);
  });

  it("applies or discards from the header only while there is something to act on", async () => {
    const onApply = vi.fn();
    const onDiscard = vi.fn();
    const panel = (view: WorktreeDiffView, pendingAction?: "apply") => (
      <WorktreeDiffPanel {...actions} view={view} pendingAction={pendingAction} onApply={onApply} onDiscard={onDiscard} onClose={vi.fn()} />
    );
    const { rerender } = render(panel(readyView));

    fireEvent.click(screen.getByRole("button", { name: "Apply to Alfred" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onApply.mock.calls).toEqual([["codex-1"]]);
    expect(onDiscard.mock.calls).toEqual([["codex-1"]]);

    rerender(panel(readyView, "apply"));
    expect(screen.getByRole("button", { name: "Applying..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();

    rerender(panel({ ...readyView, result: { ...readyView.result, applied: true } }));
    expect(screen.getByRole("status")).toHaveTextContent("Applied to Alfred");
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Close diff" })).toHaveFocus());

    rerender(panel({ ...readyView, result: { ...readyView.result, files: [] } }));
    expect(screen.queryByRole("button", { name: "Apply to Alfred" })).not.toBeInTheDocument();
  });

  it("renders loading and error states with one recovery action", () => {
    const { rerender } = render(
      <WorktreeDiffPanel
        {...actions}
        view={{
          status: "loading",
          instanceKey: "codex-1:1",
          sessionId: "codex-1",
          sessionTitle: "Codex review",
        }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Loading worktree diff…")).toBeInTheDocument();

    rerender(
      <WorktreeDiffPanel
        {...actions}
        view={{
          status: "error",
          instanceKey: "codex-1:1",
          sessionId: "codex-1",
          sessionTitle: "Codex review",
          error: "Project root no longer matches this worktree.",
        }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Project root no longer matches this worktree.");
    expect(screen.getByRole("button", { name: "Back to terminal" })).toBeInTheDocument();
  });

  it("explains an empty patch when only untracked files are available", () => {
    render(
      <WorktreeDiffPanel
        {...actions}
        view={{
          ...readyView,
          result: {
            ok: true,
            summary: "1 untracked file",
            files: [{ path: "notes/new.md", status: "??" }],
            applied: false,
            patch: "",
          },
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("notes/new.md")).toBeInTheDocument();
    expect(screen.getByText(/Git cannot show their contents until they are added/i)).toBeInTheDocument();
  });
});
