import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
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

const baseProps = {
  activeSurface: "work",
  selectedSession: liveA,
  shortcutModifier: "Cmd",
  workspaceDetail: "Alfred · /project",
  onAddAgentSession: vi.fn(),
  onAddManualSession: vi.fn(),
  onOpenCommandPalette: vi.fn(),
  onOpenPrepareWork: vi.fn(),
  onReconnectWorkspace: vi.fn(),
  onOpenPrivacyControls: vi.fn(),
  onSelectSurface: vi.fn(),
  onToggleContext: vi.fn(),
  needsYouCount: 0,
  needsYouOpen: false,
  onToggleNeedsYou: vi.fn(),
} satisfies WorkbenchHeaderProps;

function renderHeader(overrides: Partial<WorkbenchHeaderProps> = {}) {
  return render(<WorkbenchHeader {...baseProps} {...overrides} />);
}

afterEach(() => {
  cleanup();
});

describe("WorkbenchHeader", () => {
  it("uses the 44px quiet chrome without a session tab strip", () => {
    renderHeader({ selectedSession: liveB });
    const header = screen.getByTestId("workbench-header");
    expect(header).toHaveAttribute("data-chrome-height", "44");
    expect(header).toHaveTextContent("Codex review");
    expect(screen.queryByRole("toolbar", { name: "Session and layout controls" })).not.toBeInTheDocument();
    expect(header.querySelector(".alfred-mark svg")).toBeInTheDocument();
  });

  it("shows surface identity outside Work without leaking the selected session", () => {
    renderHeader({ activeSurface: "sessions", selectedSession: liveA });
    expect(screen.getByRole("button", { name: "Open Surfaces menu" })).toHaveTextContent("History");
    expect(screen.queryByText(liveA.title)).not.toBeInTheDocument();
  });

  it("keeps surface navigation attached to the visible surface name", async () => {
    const user = userEvent.setup();
    renderHeader({ activeSurface: "sessions" });

    const surfaces = screen.getByRole("button", { name: "Open Surfaces menu" });
    expect(surfaces).toHaveTextContent("History");

    await user.click(surfaces);
    expect(screen.getByRole("menuitem", { name: "History" })).toBeInTheDocument();
  });

  it("exposes Needs you Surfaces command palette and the existing launch destinations", async () => {
    const user = userEvent.setup();
    renderHeader({ needsYouCount: 1 });
    expect(screen.getByRole("button", { name: "Needs you, 1 session" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Surfaces menu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open command palette" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open launch menu" }));
    expect(screen.getByRole("menuitem", { name: "Prepare Work" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "New Codex session" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "New Claude session" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "New manual terminal" })).toBeInTheDocument();
  });

  it("explains a missing project folder and offers the recovery action", async () => {
    const user = userEvent.setup();
    const onReconnectWorkspace = vi.fn();
    renderHeader({ workspaceRootMissing: true, onReconnectWorkspace });

    await user.click(screen.getByRole("button", { name: "Open launch menu" }));
    expect(screen.getByRole("menuitem", { name: /^Prepare Work/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /^New Codex session/ })).toHaveTextContent(
      "Reconnect the project folder first",
    );
    await user.click(screen.getByRole("menuitem", { name: "Reconnect project folder" }));

    expect(onReconnectWorkspace).toHaveBeenCalledOnce();
  });

  it("hides the Needs you count at zero and toggles the popover from it", async () => {
    const user = userEvent.setup();
    const onToggleNeedsYou = vi.fn();
    const { rerender } = renderHeader({ needsYouCount: 0, onToggleNeedsYou });
    expect(screen.queryByRole("button", { name: /^Needs you/ })).not.toBeInTheDocument();

    rerender(<WorkbenchHeader {...baseProps} needsYouCount={1} onToggleNeedsYou={onToggleNeedsYou} />);
    const single = screen.getByRole("button", { name: "Needs you, 1 session" });
    expect(single).toHaveTextContent("1 needs you");
    expect(single).toHaveAttribute("aria-expanded", "false");

    rerender(<WorkbenchHeader {...baseProps} needsYouCount={3} needsYouOpen onToggleNeedsYou={onToggleNeedsYou} />);
    const trigger = screen.getByRole("button", { name: "Needs you, 3 sessions" });
    expect(trigger).toHaveTextContent("3 need you");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.click(trigger);
    expect(onToggleNeedsYou).toHaveBeenCalledOnce();
  });

  it("exposes every replaced rail destination from the primary row", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: "Open Surfaces menu" }));
    const menu = screen.getByRole("menu", { name: "Surfaces" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Work",
      "History",
      "Context",
      "Local Data & Privacy",
    ]);
  });

  it("passes the surfaces trigger ref through to the menu button", () => {
    const surfacesTriggerRef = createRef<HTMLButtonElement>();
    renderHeader({ surfacesTriggerRef });

    expect(surfacesTriggerRef.current).toBe(screen.getByRole("button", { name: "Open Surfaces menu" }));
  });
});
