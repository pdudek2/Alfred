import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionTile } from "../session-state";
import { SessionChromeRow, type SessionChromeRowProps } from "./SessionChromeRow";

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

const liveC: SessionTile = {
  ...liveA,
  id: "live-c",
  runtimeId: "runtime-c",
  title: "Manual shell",
};

const restored: SessionTile = {
  ...liveA,
  id: "restored",
  runtimeId: "runtime-restored",
  title: "Restored terminal",
  runtimeStatus: "restored",
};

const staged: SessionTile = {
  id: "staged",
  title: "Staged plan",
  workspaceId: "A",
  cwd: "/workspace",
  source: "manual",
  stage: "staged",
};

const baseProps: SessionChromeRowProps = {
  activeSessionId: liveA.id,
  arrangeMode: false,
  sessions: [liveA, liveB, liveC],
  workMode: "focus",
  workspaceDetail: "A · /workspace",
  onAddManualSession: vi.fn(),
  onApplyWorkMode: vi.fn(),
  onCloseSession: vi.fn(),
  onFocusSession: vi.fn(),
  onRenameSession: vi.fn(),
  onToggleArrangeMode: vi.fn(),
};

function renderRow(overrides: Partial<SessionChromeRowProps> = {}) {
  return render(<SessionChromeRow {...baseProps} {...overrides} />);
}

afterEach(() => {
  cleanup();
});

describe("SessionChromeRow", () => {
  it("shows only live non-restored sessions as Focus tabs", () => {
    renderRow({ workMode: "focus", sessions: [liveA, liveB, restored, staged] });
    const toolbar = screen.getByRole("toolbar", { name: "Session and layout controls" });
    expect(within(toolbar).getAllByRole("tab")).toHaveLength(2);
    expect(within(toolbar).queryByText(restored.title)).not.toBeInTheDocument();
    expect(within(toolbar).queryByText(staged.title)).not.toBeInTheDocument();
  });

  it.each(["split", "desk"] as const)("uses tile headers instead of session tabs in %s", (workMode) => {
    renderRow({ workMode, sessions: [liveB, liveC] });
    expect(screen.queryByRole("tablist", { name: "Sessions" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Layout mode" })).toBeInTheDocument();
  });

  it("renames and closes only from the active Focus tab", async () => {
    const user = userEvent.setup();
    const onRenameSession = vi.fn();
    const onCloseSession = vi.fn();
    renderRow({ workMode: "focus", sessions: [liveA, liveB], onRenameSession, onCloseSession });

    await user.click(screen.getByRole("button", { name: "Rename " + liveA.title }));
    const input = screen.getByRole("textbox", { name: "Rename " + liveA.title });
    await user.clear(input);
    await user.type(input, "Primary agent{Enter}");
    expect(onRenameSession).toHaveBeenCalledWith(liveA.id, "Primary agent");
    await user.click(screen.getByRole("button", { name: "Close " + liveA.title }));
    expect(onCloseSession).toHaveBeenCalledWith(liveA.id);
    expect(screen.queryByRole("button", { name: "Rename " + liveB.title })).not.toBeInTheDocument();
  });
});
