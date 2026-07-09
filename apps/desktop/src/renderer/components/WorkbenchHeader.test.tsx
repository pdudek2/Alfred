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
  shortcutModifier: "Cmd",
  workMode: "desk" as const,
  workspaceSwitcher: <div data-testid="switcher-slot">W4</div>,
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

  it("renders the workspace switcher slot with no breadcrumb or path line", () => {
    render(<WorkbenchHeader {...baseProps} />);

    const header = screen.getByTestId("workbench-header");
    expect(within(header).getByTestId("switcher-slot")).toBeInTheDocument();
    expect(header.querySelector(".workbench-crumbs")).toBeNull();
    expect(header.querySelector(".workbench-title-block")).toBeNull();
  });

  it("shows the Terminal grid title on work and hides it elsewhere", () => {
    const { rerender } = render(<WorkbenchHeader {...baseProps} />);
    expect(screen.getByRole("heading", { name: "Terminal grid" })).toBeInTheDocument();
    expect(screen.getByText("2 sessions")).toBeInTheDocument();

    rerender(<WorkbenchHeader {...baseProps} activeSurface="inbox" />);
    expect(screen.queryByRole("heading", { name: "Terminal grid" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Layout mode" })).not.toBeInTheDocument();
  });

  it("advertises the new-terminal shortcut on the primary action", () => {
    render(<WorkbenchHeader {...baseProps} />);

    const button = screen.getByRole("button", { name: "New terminal" });
    expect(button).toHaveAttribute("aria-keyshortcuts", "Meta+T");
    expect(button).toHaveAttribute("title", "New terminal (Cmd+T)");
  });

  it("keeps exact context count in the accessible label when the drawer is open", () => {
    render(<WorkbenchHeader {...baseProps} contextOpen />);

    expect(screen.getByRole("button", { name: "Close Context drawer, 3 important signals" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
