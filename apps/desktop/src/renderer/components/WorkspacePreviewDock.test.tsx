import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspacePreviewDock } from "./WorkspacePreviewDock";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WorkspacePreviewDock", () => {
  it("resizes from the keyboard and commits the final width", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const onWidthChange = vi.fn();
    const onWidthCommit = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <WorkspacePreviewDock
        open
        width={500}
        onWidthChange={onWidthChange}
        onWidthCommit={onWidthCommit}
        previewProps={previewProps()}
      >
        <div>terminal work</div>
      </WorkspacePreviewDock>,
    );

    const separator = screen.getByRole("separator", { name: "Resize Preview" });
    separator.focus();
    await user.keyboard("{ArrowLeft}");

    expect(onWidthChange).toHaveBeenLastCalledWith(516);
    expect(onWidthCommit).toHaveBeenLastCalledWith(516);
    rerender(
      <WorkspacePreviewDock
        open
        width={516}
        onWidthChange={onWidthChange}
        onWidthCommit={onWidthCommit}
        previewProps={previewProps()}
      >
        <div>terminal work</div>
      </WorkspacePreviewDock>,
    );
    expect(separator).toHaveAttribute("aria-valuenow", "516");

    await user.keyboard("{Home}");
    expect(onWidthCommit).toHaveBeenLastCalledWith(420);
  });

  it("keeps the work surface mounted when Preview is closed", () => {
    const { rerender } = render(
      <WorkspacePreviewDock
        open
        width={500}
        onWidthChange={vi.fn()}
        onWidthCommit={vi.fn()}
        previewProps={previewProps()}
      >
        <div>terminal work</div>
      </WorkspacePreviewDock>,
    );

    expect(screen.getByText("terminal work")).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace preview")).toBeInTheDocument();

    rerender(
      <WorkspacePreviewDock
        open={false}
        width={500}
        onWidthChange={vi.fn()}
        onWidthCommit={vi.fn()}
        previewProps={previewProps()}
      >
        <div>terminal work</div>
      </WorkspacePreviewDock>,
    );

    expect(screen.getByText("terminal work")).toBeInTheDocument();
    expect(screen.queryByLabelText("Workspace preview")).not.toBeInTheDocument();
  });
});

function previewProps() {
  return {
    candidates: [{
      id: "A:http://127.0.0.1:5173/",
      workspaceId: "A",
      url: "http://127.0.0.1:5173/",
      sessionId: "dev",
      sessionTitle: "Dev server",
      sources: [{ sessionId: "dev", sessionTitle: "Dev server", lastSeenAt: 1 }],
      firstSeenAt: 1,
      lastSeenAt: 1,
    }],
    refreshKey: 0,
    selectedUrl: "http://127.0.0.1:5173/",
    workspaceLabel: "Alfred",
    onClose: vi.fn(),
    onCopyUrl: vi.fn(),
    onOpenExternal: vi.fn(),
    onRefresh: vi.fn(),
    onSelectUrl: vi.fn(),
  };
}
