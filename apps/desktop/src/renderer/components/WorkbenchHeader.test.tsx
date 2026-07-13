import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionTile } from "../session-state";
import { WorkbenchHeader, type WorkbenchHeaderProps } from "./WorkbenchHeader";

const liveA: SessionTile = {
  id: "live-a",
  runtimeId: "runtime-a",
  title: "Claude implementation",
  workspaceId: "A",
  cwd: "/workspace",
  source: "manual",
  stage: "live",
  runtimeStatus: "live",
};

const liveB: SessionTile = {
  ...liveA,
  id: "live-b",
  runtimeId: "runtime-b",
  title: "Codex review",
};

const baseProps: WorkbenchHeaderProps = {
  activeSessions: [liveA],
  activeSurface: "work",
  arrangeMode: false,
  inboxCount: 4,
  selectedSessionId: liveA.id,
  shortcutModifier: "Cmd",
  workMode: "desk",
  workspaceDetail: "Alfred · /workspace",
  workspaceSwitcher: <div data-testid="switcher-slot">W4</div>,
  onAddAgentSession: vi.fn(),
  onAddManualSession: vi.fn(),
  onApplyWorkMode: vi.fn(),
  onCloseSession: vi.fn(),
  onFocusSession: vi.fn(),
  onOpenCommandPalette: vi.fn(),
  onOpenInbox: vi.fn(),
  onOpenPrepareWork: vi.fn(),
  onOpenPrivacyControls: vi.fn(),
  onRenameSession: vi.fn(),
  onSelectSurface: vi.fn(),
  onToggleArrangeMode: vi.fn(),
  onToggleContext: vi.fn(),
};

function renderHeader(overrides: Partial<WorkbenchHeaderProps> = {}) {
  return render(<WorkbenchHeader {...baseProps} {...overrides} />);
}

afterEach(() => {
  cleanup();
});

describe("WorkbenchHeader", () => {
  it("renders a compact 40-px contract for zero or one chrome session", () => {
    renderHeader({ activeSessions: [liveA] });
    const header = screen.getByTestId("workbench-header");
    expect(header).toHaveAttribute("data-chrome-height", "40");
    expect(screen.queryByRole("toolbar", { name: "Session and layout controls" })).not.toBeInTheDocument();
    expect(screen.getByText(liveA.title)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open launch menu" })).toBeInTheDocument();
  });

  it("renders a 74-px contract and secondary row for two chrome sessions", () => {
    renderHeader({ activeSessions: [liveA, liveB], workMode: "focus" });
    const header = screen.getByTestId("workbench-header");
    expect(header).toHaveAttribute("data-chrome-height", "74");
    expect(screen.getByRole("toolbar", { name: "Session and layout controls" })).toBeInTheDocument();
  });

  it("renders the secondary row while arrange mode is active", () => {
    renderHeader({ activeSessions: [liveA], arrangeMode: true });
    expect(screen.getByTestId("workbench-header")).toHaveAttribute("data-chrome-height", "74");
    expect(screen.getByRole("toolbar", { name: "Session and layout controls" })).toBeInTheDocument();
  });

  it("exposes Inbox Surfaces command palette and plus destinations", async () => {
    const user = userEvent.setup();
    renderHeader({ activeSessions: [liveA] });
    expect(screen.getByRole("button", { name: /Open Inbox/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Surfaces menu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open command palette" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open launch menu" }));
    expect(screen.getByRole("menuitem", { name: "Prepare Work" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "New Codex session" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "New Claude session" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "New manual terminal" })).toBeInTheDocument();
  });

  it("exposes every replaced rail destination from the primary row", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: "Open Surfaces menu" }));
    const menu = screen.getByRole("menu", { name: "Surfaces" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Work",
      "Observatory",
      "Context",
      "Local Data & Privacy",
    ]);
  });

  it("renders the workspace switcher in the project zone", () => {
    renderHeader();
    const header = screen.getByTestId("workbench-header");
    expect(within(header).getByTestId("switcher-slot")).toBeInTheDocument();
    expect(header.querySelector(".workbench-project-zone")).toContainElement(screen.getByTestId("switcher-slot"));
  });
});
