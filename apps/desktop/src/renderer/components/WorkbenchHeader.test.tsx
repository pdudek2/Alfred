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
  previewAvailable: true,
  previewOpen: false,
  projectDetail: "…/project · main",
  projectLabel: "Alfred",
  selectedSession: liveA,
  shortcutModifier: "Cmd",
  onOpenCommandPalette: vi.fn(),
  onOpenNewSession: vi.fn(),
  onToggleContext: vi.fn(),
  onTogglePreview: vi.fn(),
  needsYouCount: 0,
  needsYouOpen: false,
  onToggleNeedsYou: vi.fn(),
} satisfies WorkbenchHeaderProps;

function renderHeader(overrides: Partial<WorkbenchHeaderProps> = {}) {
  return render(<WorkbenchHeader {...baseProps} {...overrides} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkbenchHeader", () => {
  it("names the project and the focused session in the breadcrumb", () => {
    renderHeader({ selectedSession: liveB });
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb).toHaveTextContent("AlfredCodex review");
    expect(within(breadcrumb).getByText("Alfred")).toHaveAttribute("title", "…/project · main");
    expect(breadcrumb.querySelector(".session-status-glyph")).toBeInTheDocument();
  });

  it("shows only the project when no session is focused", () => {
    renderHeader({ selectedSession: null, previewAvailable: false });
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(/^Alfred$/);
    expect(screen.queryByRole("tablist", { name: "Session view" })).not.toBeInTheDocument();
  });

  it("shows History outside the deck without leaking the selected session", () => {
    renderHeader({ activeSurface: "sessions", selectedSession: liveA });
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(/^History$/);
    expect(screen.queryByText(liveA.title)).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Session view" })).not.toBeInTheDocument();
  });

  it("switches between Terminal and Preview from the session view tabs", async () => {
    const user = userEvent.setup();
    const previewTriggerRef = createRef<HTMLButtonElement>();
    const { rerender } = renderHeader({ previewTriggerRef });
    const tabs = screen.getByRole("tablist", { name: "Session view" });
    const terminal = within(tabs).getByRole("tab", { name: "Terminal" });
    const preview = within(tabs).getByRole("tab", { name: "Preview" });
    expect(previewTriggerRef.current).toBe(preview);
    expect(terminal).toHaveAttribute("aria-selected", "true");
    expect(preview).toHaveAttribute("aria-selected", "false");

    await user.click(terminal);
    expect(baseProps.onTogglePreview).not.toHaveBeenCalled();
    await user.click(preview);
    expect(baseProps.onTogglePreview).toHaveBeenCalledOnce();

    rerender(<WorkbenchHeader {...baseProps} previewOpen />);
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    expect(baseProps.onTogglePreview).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("tab", { name: "Terminal" }));
    expect(baseProps.onTogglePreview).toHaveBeenCalledTimes(2);
  });

  it("disables Preview until a local dev server is running", () => {
    renderHeader({ previewAvailable: false });
    const preview = screen.getByRole("tab", { name: "Preview" });
    expect(preview).toBeDisabled();
    expect(preview).toHaveAttribute("title", "Start a local dev server to enable Preview");
  });

  it("exposes Details, search and New", async () => {
    const user = userEvent.setup();
    renderHeader();
    expect(screen.getByRole("button", { name: "Details" })).toHaveTextContent("⌘I");
    expect(screen.getByRole("button", { name: "Open command palette" })).toHaveTextContent("⌘K");
    await user.click(screen.getByRole("button", { name: "New" }));
    expect(baseProps.onOpenNewSession).toHaveBeenCalledOnce();
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
});
