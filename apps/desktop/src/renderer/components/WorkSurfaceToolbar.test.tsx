import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkSurfaceToolbar } from "./WorkSurfaceToolbar";

afterEach(() => {
  cleanup();
});

describe("WorkSurfaceToolbar", () => {
  it("leaves the workspace path to the primary window header", () => {
    render(
      <WorkSurfaceToolbar
        previewAvailable={false}
        previewOpen={false}
        onAddManualSession={vi.fn()}
        onTogglePreview={vi.fn()}
      />,
    );

    expect(screen.getByRole("toolbar", { name: "Work layout controls" }))
      .not.toHaveTextContent("Desktop/Alfred");
  });

  it("routes the Preview toggle and new-terminal control without a layout menu", async () => {
    const onAddManualSession = vi.fn();
    const onTogglePreview = vi.fn();
    render(
      <WorkSurfaceToolbar
        previewAvailable
        previewOpen
        onAddManualSession={onAddManualSession}
        onTogglePreview={onTogglePreview}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await userEvent.click(screen.getByRole("button", { name: "New terminal" }));
    expect(onTogglePreview).toHaveBeenCalledOnce();
    expect(onAddManualSession).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /layout menu/ })).not.toBeInTheDocument();
  });

  it("keeps Preview unavailable until Alfred detects a local URL", () => {
    render(
      <WorkSurfaceToolbar
        previewAvailable={false}
        previewOpen={false}
        onAddManualSession={vi.fn()}
        onTogglePreview={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
  });
});
