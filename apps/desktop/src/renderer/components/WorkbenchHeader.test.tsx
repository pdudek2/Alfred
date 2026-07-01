import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchHeader } from "./WorkbenchHeader";

const baseProps = {
  activeSurface: "work" as const,
  activeSessionCount: 2,
  arrangeMode: false,
  contextOpen: false,
  contextSignalCount: 3,
  inboxCount: 4,
  sessionCount: 9,
  workMode: "desk" as const,
  workspaceLabel: "CodexPulse",
  workspacePathLabel: "~/Desktop/CodexPulse · main",
  onAddAgentSession: vi.fn(),
  onAddManualSession: vi.fn(),
  onApplyWorkMode: vi.fn(),
  onOpenInbox: vi.fn(),
  onOpenSessionObservatory: vi.fn(),
  onToggleArrangeMode: vi.fn(),
  onToggleContext: vi.fn(),
};

afterEach(() => {
  cleanup();
});

describe("WorkbenchHeader", () => {
  it("groups actions into layout, panels, and launch controls", () => {
    render(<WorkbenchHeader {...baseProps} />);

    expect(screen.getByRole("group", { name: "Layout mode" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Panels" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Launch" })).toBeInTheDocument();
  });

  it("keeps exact counts in accessible labels while rendering quiet indicators", () => {
    render(<WorkbenchHeader {...baseProps} />);

    const panels = screen.getByRole("group", { name: "Panels" });
    expect(within(panels).getByRole("button", { name: /3 important signals/i })).toBeInTheDocument();
    expect(within(panels).getByRole("button", { name: /9 sessions/i })).toBeInTheDocument();
    expect(within(panels).getByRole("button", { name: /4 items/i })).toBeInTheDocument();
    expect(panels.querySelectorAll(".quiet-count-dot, .quiet-count-mark").length).toBeGreaterThan(0);
  });
});
