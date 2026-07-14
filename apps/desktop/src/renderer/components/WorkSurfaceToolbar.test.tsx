import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkSurfaceToolbar } from "./WorkSurfaceToolbar";

afterEach(() => {
  cleanup();
});

describe("WorkSurfaceToolbar", () => {
  it("routes layout and new-terminal controls without owning session selection", async () => {
    const onApplyWorkMode = vi.fn();
    const onToggleArrangeMode = vi.fn();
    const onAddManualSession = vi.fn();
    render(
      <WorkSurfaceToolbar
        arrangeMode={false}
        branch="main"
        rootPath="/Users/patryk/Desktop/Alfred"
        visibleSessionCount={4}
        workMode="desk"
        onAddManualSession={onAddManualSession}
        onApplyWorkMode={onApplyWorkMode}
        onToggleArrangeMode={onToggleArrangeMode}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Focus" }));
    await userEvent.click(screen.getByRole("button", { name: "Arrange" }));
    await userEvent.click(screen.getByRole("button", { name: "New terminal" }));
    expect(onApplyWorkMode).toHaveBeenCalledWith("focus");
    expect(onToggleArrangeMode).toHaveBeenCalledOnce();
    expect(onAddManualSession).toHaveBeenCalledOnce();
    expect(screen.getByText("…/Desktop/Alfred · main · 4 visible sessions")).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Sessions" })).not.toBeInTheDocument();
  });
});
