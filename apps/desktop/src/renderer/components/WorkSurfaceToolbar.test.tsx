import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkSurfaceToolbar } from "./WorkSurfaceToolbar";

afterEach(() => {
  cleanup();
});

describe("WorkSurfaceToolbar", () => {
  it("routes the compact layout menu, Preview toggle, and new-terminal control", async () => {
    const onApplyWorkMode = vi.fn();
    const onToggleArrangeMode = vi.fn();
    const onAddManualSession = vi.fn();
    const onTogglePreview = vi.fn();
    render(
      <WorkSurfaceToolbar
        arrangeMode={false}
        branch="main"
        previewAvailable
        previewOpen
        rootPath="/Users/patryk/Desktop/Alfred"
        visibleSessionCount={4}
        workMode="desk"
        onAddManualSession={onAddManualSession}
        onApplyWorkMode={onApplyWorkMode}
        onToggleArrangeMode={onToggleArrangeMode}
        onTogglePreview={onTogglePreview}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open layout menu, Grid selected" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Focus" }));
    await userEvent.click(screen.getByRole("button", { name: "Open layout menu, Grid selected" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Arrange" }));
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await userEvent.click(screen.getByRole("button", { name: "New terminal" }));
    expect(onApplyWorkMode).toHaveBeenCalledWith("focus");
    expect(onToggleArrangeMode).toHaveBeenCalledOnce();
    expect(onTogglePreview).toHaveBeenCalledOnce();
    expect(onAddManualSession).toHaveBeenCalledOnce();
    expect(screen.getByText("…/Desktop/Alfred · main · 4 visible sessions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("tablist", { name: "Sessions" })).not.toBeInTheDocument();
  });

  it("keeps Preview unavailable until Alfred detects a local URL", () => {
    render(
      <WorkSurfaceToolbar
        arrangeMode={false}
        previewAvailable={false}
        previewOpen={false}
        rootPath={undefined}
        branch={undefined}
        visibleSessionCount={0}
        workMode="focus"
        onAddManualSession={vi.fn()}
        onApplyWorkMode={vi.fn()}
        onToggleArrangeMode={vi.fn()}
        onTogglePreview={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
  });
});
