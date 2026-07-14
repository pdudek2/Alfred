import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceActionsMenu, type WorkspaceActionsMenuProps } from "./WorkspaceActionsMenu";

function props(overrides: Partial<WorkspaceActionsMenuProps> = {}): WorkspaceActionsMenuProps {
  return {
    canCloseWorkspace: true,
    detail: "…/Desktop/Alfred · main",
    menuOpen: true,
    missionBrief: undefined,
    renameDraft: "Alfred",
    renameEditing: false,
    rootPath: "/Users/patryk/Desktop/Alfred",
    workspaceLabel: "Alfred",
    onCancelRename: vi.fn(),
    onCloseWorkspace: vi.fn(),
    onChangeRenameDraft: vi.fn(),
    onClose: vi.fn(),
    onOpenExternalTerminal: vi.fn(),
    onRevealFolder: vi.fn(),
    onSaveMissionBrief: vi.fn(),
    onSaveRename: vi.fn(),
    onStartRename: vi.fn(),
    onToggleMenu: vi.fn(),
    ...overrides,
  };
}

describe("WorkspaceActionsMenu", () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, "platform", { configurable: true, value: "MacIntel" });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    ["Open in Ghostty", "onOpenExternalTerminal"],
    ["Reveal in Finder", "onRevealFolder"],
  ] as const)("runs %s once and closes the menu", async (label, callbackName) => {
    const user = userEvent.setup();
    const menuProps = props();
    render(<WorkspaceActionsMenu {...menuProps} />);

    await user.click(screen.getByRole("button", { name: new RegExp(label) }));

    expect(menuProps[callbackName]).toHaveBeenCalledTimes(1);
    expect(menuProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("starts rename, focuses the input, and submits the draft once", async () => {
    const user = userEvent.setup();
    const menuProps = props();
    const { rerender } = render(<WorkspaceActionsMenu {...menuProps} />);

    await user.click(screen.getByRole("button", { name: /Rename workspace/i }));
    expect(menuProps.onStartRename).toHaveBeenCalledTimes(1);

    rerender(<WorkspaceActionsMenu {...menuProps} renameEditing renameDraft="New Alfred" />);
    const input = screen.getByRole("textbox", { name: "Workspace name" });
    expect(input).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(menuProps.onSaveRename).toHaveBeenCalledOnce();
    expect(menuProps.onSaveRename).toHaveBeenCalledWith("New Alfred");
  });

  it("edits and saves a normalized mission brief once", async () => {
    const user = userEvent.setup();
    const menuProps = props();
    render(<WorkspaceActionsMenu {...menuProps} />);

    await user.click(screen.getByRole("button", { name: /Add mission brief/i }));
    const goal = screen.getByRole("textbox", { name: "Mission goal" });
    expect(goal).toHaveFocus();
    await user.type(goal, "Ship the project shell");
    await user.type(screen.getByRole("textbox", { name: "Done when" }), "Tests pass\nReview is clean");
    await user.type(screen.getByRole("textbox", { name: "Guardrails" }), "Do not push");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(menuProps.onSaveMissionBrief).toHaveBeenCalledOnce();
    expect(menuProps.onSaveMissionBrief).toHaveBeenCalledWith({
      goal: "Ship the project shell",
      doneWhen: ["Tests pass", "Review is clean"],
      guardrails: ["Do not push"],
    });
  });

  it("runs the guarded close callback once and closes the menu", async () => {
    const user = userEvent.setup();
    const menuProps = props();
    render(<WorkspaceActionsMenu {...menuProps} />);

    await user.click(screen.getByRole("button", { name: "Close workspace" }));

    expect(menuProps.onCloseWorkspace).toHaveBeenCalledTimes(1);
    expect(menuProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not expose close workspace when the guarded action is unavailable", () => {
    render(<WorkspaceActionsMenu {...props({ canCloseWorkspace: false })} />);

    expect(screen.queryByRole("button", { name: "Close workspace" })).not.toBeInTheDocument();
  });

  it("closes on document Escape even when focus is outside the menu", () => {
    const menuProps = props();
    render(<WorkspaceActionsMenu {...menuProps} />);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(menuProps.onClose).toHaveBeenCalledOnce();
    outside.remove();
  });

  it("positions the open popover against its trigger in viewport coordinates", () => {
    const menuProps = props({ menuOpen: false });
    const { rerender } = render(<WorkspaceActionsMenu {...menuProps} />);
    const trigger = screen.getByRole("button", { name: "Workspace menu for Alfred" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      bottom: 72,
      height: 28,
      left: 220,
      right: 248,
      top: 44,
      width: 28,
      x: 220,
      y: 44,
      toJSON: () => ({}),
    });

    rerender(<WorkspaceActionsMenu {...menuProps} menuOpen />);

    expect(screen.getByRole("dialog", { name: "Workspace actions" })).toHaveStyle({
      left: "218px",
      top: "80px",
    });
  });
});
