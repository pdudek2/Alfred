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
    patch: [
      "diff --git a/src/app.tsx b/src/app.tsx",
      "@@ -4,2 +4,2 @@",
      "-old value",
      "+new value",
      " unchanged value",
    ].join("\n"),
  },
};

describe("WorktreeDiffPanel", () => {
  it("renders real files, totals, and accessible unified-diff lines", () => {
    render(<WorktreeDiffPanel view={readyView} onClose={vi.fn()} />);

    expect(screen.getByRole("region", { name: "Worktree diff" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Last review" })).toBeInTheDocument();
    expect(screen.getByText("1 changed file")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
    expect(screen.getByText("src/app.tsx")).toBeInTheDocument();
    expect(screen.getByLabelText("Removed line 4")).toHaveTextContent("-old value");
    expect(screen.getByLabelText("Added line 4")).toHaveTextContent("+new value");
    expect(screen.getByLabelText("Unchanged line 5")).toHaveTextContent("unchanged value");
  });

  it("focuses Close diff and closes from the button or Escape", async () => {
    const onClose = vi.fn();
    render(<WorktreeDiffPanel view={readyView} onClose={onClose} />);

    const close = screen.getByRole("button", { name: "Close diff" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.click(close);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders loading and error states with one recovery action", () => {
    const { rerender } = render(
      <WorktreeDiffPanel
        view={{
          status: "loading",
          instanceKey: "codex-1:1",
          sessionId: "codex-1",
          sessionTitle: "Codex review",
        }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Loading checkout diff…")).toBeInTheDocument();

    rerender(
      <WorktreeDiffPanel
        view={{
          status: "error",
          instanceKey: "codex-1:1",
          sessionId: "codex-1",
          sessionTitle: "Codex review",
          error: "Workspace root no longer matches this checkout.",
        }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Workspace root no longer matches this checkout.");
    expect(screen.getByRole("button", { name: "Back to terminal" })).toBeInTheDocument();
  });

  it("explains an empty patch when only untracked files are available", () => {
    render(
      <WorktreeDiffPanel
        view={{
          ...readyView,
          result: {
            ok: true,
            summary: "1 untracked file",
            files: [{ path: "notes/new.md", status: "??" }],
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
