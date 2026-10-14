import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionTile } from "../session-state";
import { ContextColumn, type ContextColumnProps } from "./ContextColumn";

const sessionA: SessionTile = {
  id: "session-a",
  title: "Codex · session A",
  workspaceId: "workspace-a",
  cwd: "/workspace/a",
  source: "manual",
  stage: "live",
  runtimeId: "runtime-a",
};

const sessionB: SessionTile = {
  ...sessionA,
  id: "session-b",
  title: "Claude · session B",
  runtimeId: "runtime-b",
};

const baseProps = {
  contextOpen: true,
  focusRequestKey: 0,
  returnFocusRef: { current: null },
  triggerRef: { current: null },
  shortcutModifier: "Cmd" as const,
  timelineProps: { session: sessionA },
  onCloseContext: vi.fn(),
};

type ContextOverrides = Partial<ContextColumnProps> & {
  dismissalSuspended?: boolean;
  session?: SessionTile;
};

function contextWith(overrides: ContextOverrides = {}) {
  const { session, ...props } = overrides;
  const contextProps = {
    ...baseProps,
    ...props,
    timelineProps: {
      ...baseProps.timelineProps,
      ...props.timelineProps,
      session: session ?? props.timelineProps?.session ?? sessionA,
    },
  } as ContextColumnProps;
  return <ContextColumn {...contextProps} />;
}

function renderContext(overrides: ContextOverrides = {}) {
  return render(contextWith(overrides));
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("Details tab", () => {
  it("shows empty Changes and Location for the focused session", () => {
    renderContext({ session: { ...sessionA, agentKind: "codex", branchName: "feature/details", isolation: "worktree", baseCwd: "/workspace" } });
    expect(screen.getByRole("heading", { name: "Changes" })).toBeVisible();
    expect(screen.getByText("No worktree changes.")).toBeVisible();
    const location = screen.getByRole("region", { name: "Location" });
    expect(location.querySelector("dl")).toBeNull();
    expect(location).toHaveTextContent("/workspace/a");
    expect(location).toHaveTextContent("feature/details");
    expect(within(location).getByTitle("/workspace/a")).toHaveTextContent("/workspace/a");
  });

  it("closes Details on Escape even when focus is outside", () => {
    const onCloseContext = vi.fn();
    renderContext({ contextOpen: true, onCloseContext });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onCloseContext).toHaveBeenCalledOnce();
  });

  it("exposes one elevated Details boundary with no nested dock card", () => {
    renderContext({ contextOpen: true });

    const column = screen.getByRole("complementary", { name: "Details" });
    expect(column).toHaveAttribute("data-testid", "context-column");
    const tabs = within(column).getByRole("tablist", { name: "Side column" });
    expect(within(tabs).getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(within(tabs).getByRole("tab", { name: "Sessions" })).toHaveAttribute("aria-selected", "false");
    expect(column).toHaveTextContent("⌘I");
    expect(within(column).queryByRole("button", { name: "Close Details panel" })).toBeNull();
    expect(column.querySelectorAll(".context-drawer")).toHaveLength(1);
    expect(column.querySelector(".side-dock-stack")).toBeNull();
  });

  it("closes from the Sessions tab and falls back to the stack's Details tab when the opener is gone", async () => {
    const opener = document.createElement("button");
    const stackDetailsTab = document.createElement("button");
    document.body.append(stackDetailsTab);
    const returnFocusRef = { current: opener };
    const triggerRef = { current: stackDetailsTab };
    const onCloseContext = vi.fn();
    const { rerender } = renderContext({ contextOpen: true, returnFocusRef, triggerRef, onCloseContext });

    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(onCloseContext).toHaveBeenCalledOnce();
    rerender(contextWith({ contextOpen: false, returnFocusRef, triggerRef, onCloseContext }));
    await waitFor(() => expect(stackDetailsTab).toHaveFocus());
  });

  it("moves between its tabs with the arrow keys without closing", () => {
    const onCloseContext = vi.fn();
    renderContext({ contextOpen: true, onCloseContext });
    const sessions = screen.getByRole("tab", { name: "Sessions" });
    const details = screen.getByRole("tab", { name: "Details" });
    // The row is one Tab stop: the selected tab.
    expect([sessions.tabIndex, details.tabIndex]).toEqual([-1, 0]);

    details.focus();
    fireEvent.keyDown(details, { key: "ArrowLeft" });
    expect(sessions).toHaveFocus();
    fireEvent.keyDown(sessions, { key: "ArrowLeft" });
    expect(details).toHaveFocus();
    fireEvent.keyDown(details, { key: "Home" });
    expect(sessions).toHaveFocus();
    // A modified arrow belongs to someone else.
    fireEvent.keyDown(sessions, { key: "ArrowRight", metaKey: true });
    expect(sessions).toHaveFocus();
    expect(onCloseContext).not.toHaveBeenCalled();
  });

  it("closes on Escape and restores focus to the Details trigger", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const returnFocusRef = { current: trigger };
    const onCloseContext = vi.fn();
    const { rerender } = renderContext({ contextOpen: true, returnFocusRef, onCloseContext });

    screen.getByRole("tab", { name: "Details" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onCloseContext).toHaveBeenCalledOnce();
    rerender(contextWith({ contextOpen: false, returnFocusRef, onCloseContext }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("leaves Escape for a higher layer while dismissal is suspended", () => {
    const onCloseContext = vi.fn();
    renderContext({ contextOpen: true, dismissalSuspended: true, onCloseContext });

    screen.getByRole("tab", { name: "Details" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(onCloseContext).not.toHaveBeenCalled();
  });

  it("focuses its Details tab when Details opens", async () => {
    const { rerender } = renderContext({ contextOpen: false });

    rerender(contextWith({ contextOpen: true, focusRequestKey: 1 }));

    await waitFor(() => expect(screen.getByRole("tab", { name: "Details" })).toHaveFocus());
  });

  it("does not restore Details focus when Details closes from external workspace state", async () => {
    const surfacesTrigger = document.createElement("button");
    const workspaceTrigger = document.createElement("button");
    document.body.append(surfacesTrigger, workspaceTrigger);
    const returnFocusRef = { current: surfacesTrigger };
    const { rerender } = renderContext({ contextOpen: true, focusRequestKey: 1, returnFocusRef });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Details" })).toHaveFocus());

    workspaceTrigger.focus();
    rerender(contextWith({ contextOpen: false, returnFocusRef }));

    await waitFor(() => expect(workspaceTrigger).toHaveFocus());
    expect(surfacesTrigger).not.toHaveFocus();
  });

  it("rebinds the visible timeline to the selected session without a second status rail", () => {
    const { rerender } = renderContext({ session: sessionA, contextOpen: true });
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent(sessionA.title);

    rerender(contextWith({ session: sessionB, contextOpen: true }));

    expect(screen.getByLabelText("Agent activity")).toHaveTextContent(sessionB.title);
    expect(screen.getByTestId("context-column").children).toHaveLength(1);
  });
});
