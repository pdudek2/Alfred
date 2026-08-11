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

describe("ContextColumn", () => {
  it("exposes one elevated Session context boundary with no nested dock card", () => {
    renderContext({ contextOpen: true });

    const column = screen.getByRole("complementary", { name: "Session context" });
    expect(column).toHaveAttribute("data-testid", "context-column");
    expect(within(column).getByText("Context", { exact: true })).toBeVisible();
    expect(within(column).getByRole("button", { name: "Close Context panel" })).toBeVisible();
    expect(column.querySelectorAll(".context-drawer")).toHaveLength(1);
    expect(column.querySelector(".side-dock-stack")).toBeNull();
  });

  it("closes on Escape and restores focus to the Surfaces trigger", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const returnFocusRef = { current: trigger };
    const onCloseContext = vi.fn();
    const { rerender } = renderContext({ contextOpen: true, returnFocusRef, onCloseContext });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCloseContext).toHaveBeenCalledOnce();
    rerender(contextWith({ contextOpen: false, returnFocusRef, onCloseContext }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("leaves Escape for a higher layer while dismissal is suspended", () => {
    const onCloseContext = vi.fn();
    renderContext({ contextOpen: true, dismissalSuspended: true, onCloseContext });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCloseContext).not.toHaveBeenCalled();
  });

  it("focuses the close control when Context opens", async () => {
    const { rerender } = renderContext({ contextOpen: false });

    rerender(contextWith({ contextOpen: true, focusRequestKey: 1 }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Close Context panel" })).toHaveFocus());
  });

  it("does not restore Surfaces focus when Context closes from external workspace state", async () => {
    const surfacesTrigger = document.createElement("button");
    const workspaceTrigger = document.createElement("button");
    document.body.append(surfacesTrigger, workspaceTrigger);
    const returnFocusRef = { current: surfacesTrigger };
    const { rerender } = renderContext({ contextOpen: true, focusRequestKey: 1, returnFocusRef });
    await waitFor(() => expect(screen.getByRole("button", { name: "Close Context panel" })).toHaveFocus());

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
