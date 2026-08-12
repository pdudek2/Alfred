import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkSurfaceToolbar } from "./WorkSurfaceToolbar";

afterEach(() => {
  cleanup();
});

describe("WorkSurfaceToolbar", () => {
  it("caps normal Grid session count at three visible sessions", () => {
    render(
      <WorkSurfaceToolbar
        activeAgentCount={0}
        agentsOpen={false}
        arrangeMode={false}
        branch="main"
        previewAvailable={false}
        previewOpen={false}
        rootPath="/Users/patryk/Desktop/Alfred"
        savedSessionCount={0}
        visibleSessionCount={5}
        workMode="desk"
        onAddManualSession={vi.fn()}
        onApplyWorkMode={vi.fn()}
        onOpenSavedSessions={vi.fn()}
        onToggleArrangeMode={vi.fn()}
        onToggleAgents={vi.fn()}
        onTogglePreview={vi.fn()}
      />,
    );

    expect(screen.getByRole("toolbar", { name: "Work layout controls" }))
      .toHaveTextContent("3 visible sessions");
  });

  it("routes the compact layout menu, Preview toggle, and new-terminal control", async () => {
    const onApplyWorkMode = vi.fn();
    const onToggleArrangeMode = vi.fn();
    const onAddManualSession = vi.fn();
    const onTogglePreview = vi.fn();
    render(
      <WorkSurfaceToolbar
        activeAgentCount={3}
        agentsOpen={false}
        arrangeMode={false}
        branch="main"
        previewAvailable
        previewOpen
        rootPath="/Users/patryk/Desktop/Alfred"
        savedSessionCount={0}
        visibleSessionCount={4}
        workMode="desk"
        onAddManualSession={onAddManualSession}
        onApplyWorkMode={onApplyWorkMode}
        onOpenSavedSessions={vi.fn()}
        onToggleArrangeMode={onToggleArrangeMode}
        onToggleAgents={vi.fn()}
        onTogglePreview={onTogglePreview}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open layout menu, Grid selected" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Focus" }));
    await userEvent.click(screen.getByRole("button", { name: "Open layout menu, Grid selected" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Arrange" }));
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await userEvent.click(screen.getByRole("button", { name: "New terminal" }));
    expect(onApplyWorkMode).toHaveBeenCalledWith("focus");
    expect(onToggleArrangeMode).toHaveBeenCalledOnce();
    expect(onTogglePreview).toHaveBeenCalledOnce();
    expect(onAddManualSession).toHaveBeenCalledOnce();
    expect(screen.getByText("…/Desktop/Alfred · main · 3 visible sessions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("tablist", { name: "Sessions" })).not.toBeInTheDocument();
  });

  it("announces and initially focuses the selected layout option", async () => {
    render(
      <WorkSurfaceToolbar
        activeAgentCount={0}
        agentsOpen={false}
        arrangeMode={false}
        branch={undefined}
        previewAvailable={false}
        previewOpen={false}
        rootPath="/repo"
        savedSessionCount={0}
        visibleSessionCount={3}
        workMode="desk"
        onAddManualSession={vi.fn()}
        onApplyWorkMode={vi.fn()}
        onOpenSavedSessions={vi.fn()}
        onToggleArrangeMode={vi.fn()}
        onToggleAgents={vi.fn()}
        onTogglePreview={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open layout menu, Grid selected" }));
    const selectedGrid = screen.getByRole("menuitemradio", { name: "Grid" });
    expect(selectedGrid).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(selectedGrid).toHaveFocus());
    expect(screen.getByRole("menuitemradio", { name: "Focus" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("keeps Preview unavailable until Alfred detects a local URL", () => {
    render(
      <WorkSurfaceToolbar
        activeAgentCount={0}
        agentsOpen={false}
        arrangeMode={false}
        previewAvailable={false}
        previewOpen={false}
        rootPath={undefined}
        savedSessionCount={0}
        branch={undefined}
        visibleSessionCount={0}
        workMode="focus"
        onAddManualSession={vi.fn()}
        onApplyWorkMode={vi.fn()}
        onOpenSavedSessions={vi.fn()}
        onToggleArrangeMode={vi.fn()}
        onToggleAgents={vi.fn()}
        onTogglePreview={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
  });

  it("opens the Agents drawer from a pressed toolbar control", async () => {
    const onToggleAgents = vi.fn();
    const { rerender } = render(
      <WorkSurfaceToolbar
        activeAgentCount={3}
        agentsOpen={false}
        arrangeMode={false}
        previewAvailable={false}
        previewOpen={false}
        rootPath="/repo"
        savedSessionCount={0}
        branch="main"
        visibleSessionCount={3}
        workMode="desk"
        onAddManualSession={vi.fn()}
        onApplyWorkMode={vi.fn()}
        onOpenSavedSessions={vi.fn()}
        onToggleArrangeMode={vi.fn()}
        onToggleAgents={onToggleAgents}
        onTogglePreview={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Agents, 3 active" });
    expect(trigger).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(trigger);
    expect(onToggleAgents).toHaveBeenCalledOnce();

    rerender(
      <WorkSurfaceToolbar
        activeAgentCount={3}
        agentsOpen
        arrangeMode={false}
        previewAvailable={false}
        previewOpen={false}
        rootPath="/repo"
        savedSessionCount={0}
        branch="main"
        visibleSessionCount={3}
        workMode="desk"
        onAddManualSession={vi.fn()}
        onApplyWorkMode={vi.fn()}
        onOpenSavedSessions={vi.fn()}
        onToggleArrangeMode={vi.fn()}
        onToggleAgents={onToggleAgents}
        onTogglePreview={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Agents, 3 active" })).toHaveAttribute("aria-pressed", "true");
  });
});
