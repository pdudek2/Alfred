import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
  shortcutModifier: "Cmd" as const,
  timelineProps: { session: sessionA },
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
  it("shows Location for the focused session", () => {
    renderContext({ session: { ...sessionA, agentKind: "codex", branchName: "feature/details", isolation: "worktree", baseCwd: "/workspace" } });
    const location = screen.getByRole("region", { name: "Location" });
    expect(location.querySelector("dl")).toBeNull();
    expect(location).toHaveTextContent("/workspace/a");
    expect(location).toHaveTextContent("feature/details");
    expect(within(location).getByTitle("/workspace/a")).toHaveTextContent("/workspace/a");
  });

  it("leaves Escape to whatever has focus, as a column rather than a drawer", () => {
    const confirmation = document.createElement("button");
    document.body.append(confirmation);
    renderContext({ contextOpen: true });
    confirmation.focus();
    expect(fireEvent.keyDown(confirmation, { key: "Escape" })).toBe(true);
    screen.getByRole("heading", { name: "Details" }).focus();
    expect(fireEvent.keyDown(document.activeElement!, { key: "Escape" })).toBe(true);
  });

  it("exposes one elevated Details boundary with no nested dock card", () => {
    renderContext({ contextOpen: true });

    const column = screen.getByRole("complementary", { name: "Details" });
    expect(column).toHaveAttribute("data-testid", "context-column");
    // Sessions live in the rail's tree, so the column is headed Details alone.
    expect(within(column).getByRole("heading", { level: 2, name: "Details" })).toBeInTheDocument();
    expect(within(column).queryByRole("tablist")).toBeNull();
    expect(column).toHaveTextContent("⌘I");
    expect(within(column).queryByRole("button", { name: "Close Details panel" })).toBeNull();
    expect(column.querySelectorAll(".context-drawer")).toHaveLength(1);
    expect(column.querySelector(".side-dock-stack")).toBeNull();
  });

  it("focuses its heading when Details opens", async () => {
    const { rerender } = renderContext({ contextOpen: false });

    rerender(contextWith({ contextOpen: true, focusRequestKey: 1 }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Details" })).toHaveFocus());
  });

  it("leaves focus where it is when Details closes from outside", async () => {
    const workspaceTrigger = document.createElement("button");
    document.body.append(workspaceTrigger);
    const { rerender } = renderContext({ contextOpen: true, focusRequestKey: 1 });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Details" })).toHaveFocus());

    workspaceTrigger.focus();
    rerender(contextWith({ contextOpen: false }));

    await waitFor(() => expect(workspaceTrigger).toHaveFocus());
  });

  it("keeps focus with a higher panel when Details opens under it", async () => {
    const palette = document.createElement("input");
    document.body.append(palette);
    palette.focus();
    const { rerender } = renderContext({ contextOpen: false });
    rerender(contextWith({ contextOpen: true, dismissalSuspended: true, focusRequestKey: 1 }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(palette).toHaveFocus();
  });

  it("rebinds the visible timeline to the selected session without a second status rail", () => {
    const { rerender } = renderContext({ session: sessionA, contextOpen: true });
    expect(screen.getByLabelText("Agent activity")).toHaveTextContent(sessionA.title);

    rerender(contextWith({ session: sessionB, contextOpen: true }));

    expect(screen.getByLabelText("Agent activity")).toHaveTextContent(sessionB.title);
    expect(screen.getByTestId("context-column").children).toHaveLength(1);
  });
});
