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
  inboxCount: 4,
  selectedSession: liveA,
  shortcutModifier: "Cmd",
  workspaceDetail: "Alfred · /workspace",
  onAddAgentSession: vi.fn(),
  onAddManualSession: vi.fn(),
  onOpenCommandPalette: vi.fn(),
  onOpenInbox: vi.fn(),
  onOpenPrepareWork: vi.fn(),
  onOpenPrivacyControls: vi.fn(),
  onSelectSurface: vi.fn(),
  onToggleContext: vi.fn(),
} satisfies WorkbenchHeaderProps;

function renderHeader(overrides: Partial<WorkbenchHeaderProps> = {}) {
  return render(<WorkbenchHeader {...baseProps} {...overrides} />);
}

afterEach(() => {
  cleanup();
});

describe("WorkbenchHeader", () => {
  it("stays at 40 px with multiple sessions and no session tab strip", () => {
    renderHeader({ selectedSession: liveB });
    const header = screen.getByTestId("workbench-header");
    expect(header).toHaveAttribute("data-chrome-height", "40");
    expect(header).toHaveTextContent("Codex review");
    expect(screen.queryByRole("toolbar", { name: "Session and layout controls" })).not.toBeInTheDocument();
    expect(header.querySelector(".alfred-mark svg")).toBeInTheDocument();
  });

  it("shows surface identity outside Work without leaking the selected session", () => {
    renderHeader({ activeSurface: "sessions", selectedSession: liveA });
    expect(screen.getByTestId("workbench-header")).toHaveTextContent("Sessions");
    expect(screen.queryByText(liveA.title)).not.toBeInTheDocument();
  });

  it("uses the frozen 40px title identity for the global Decision Inbox", () => {
    renderHeader({ activeSurface: "inbox", selectedSession: liveA });

    const header = screen.getByTestId("workbench-header");
    expect(header).toHaveAttribute("data-chrome-height", "40");
    expect(header).toHaveTextContent("Decision Inbox");
    expect(within(header).getByText("All projects")).toBeInTheDocument();
    expect(screen.queryByText(liveA.title)).not.toBeInTheDocument();
  });

  it("exposes Inbox Surfaces command palette and the existing launch destinations", async () => {
    const user = userEvent.setup();
    renderHeader();
    expect(screen.getByRole("button", { name: /Open Inbox/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Surfaces menu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open command palette" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open launch menu" }));
    expect(screen.getByRole("menuitem", { name: "Prepare Work" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "New Codex session" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "New Claude session" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "New manual terminal" })).toBeInTheDocument();
  });

  it("announces the exact blocking Inbox count", () => {
    renderHeader({ inboxCount: 2 });

    const inbox = screen.getByRole("button", { name: "Open Inbox surface, 2 items" });
    expect(inbox).toHaveTextContent("2");
    expect(inbox.querySelector(".workbench-attention-count")).toHaveTextContent("2");
  });

  it("exposes every replaced rail destination from the primary row", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: "Open Surfaces menu" }));
    const menu = screen.getByRole("menu", { name: "Surfaces" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Work",
      "Sessions",
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
