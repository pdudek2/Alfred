import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRail } from "./WorkspaceRail";
import type { SessionTile } from "../session-state";

const baseSession = {
  stage: "live",
  source: "manual",
  runtimeId: "runtime-1",
} satisfies Partial<SessionTile>;

describe("WorkspaceRail", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows workspace names, project context, and priority state", () => {
    render(
      <WorkspaceRail
        activeWorkspaceId="A"
        sessions={[
          {
            ...baseSession,
            id: "s1",
            title: "Codex review",
            workspaceId: "A",
            activityEvents: [{ id: "ask-1", kind: "approval", title: "Waiting", detail: "approve?", at: 100 }],
          },
          {
            ...baseSession,
            id: "s2",
            title: "Broken shell",
            workspaceId: "CLIENT",
            runtimeStatus: "error",
          },
        ] as SessionTile[]}
        workspaces={[
          { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/patryk/Desktop/Alfred", gitBranch: "main" },
          { id: "CLIENT", label: "ClientApp", shortLabel: "CLI", rootPath: "/repo/client" },
          { id: "DOCS", label: "Docs", shortLabel: "DOC" },
        ]}
        onAddWorkspace={vi.fn()}
        onSelectWorkspace={vi.fn()}
      />,
    );

    expect(screen.getByRole("tablist", { name: "workspaces" })).toHaveAttribute("aria-orientation", "vertical");
    const alfredTab = screen.getByRole("tab", { name: "Alfred workspace, 1 waiting" });
    expect(alfredTab).toHaveTextContent("Alfred");
    expect(alfredTab).toHaveAccessibleDescription("…/Desktop/Alfred · main");
    expect(screen.getByText("…/Desktop/Alfred · main")).toBeInTheDocument();
    expect(screen.getByText("1 waiting")).toBeInTheDocument();
    expect(screen.getByText("1 error")).toBeInTheDocument();
    expect(screen.getByText("folder not bound")).toBeInTheDocument();
  });

  it("moves workspace focus with arrow keys", async () => {
    const user = userEvent.setup();
    const onSelectWorkspace = vi.fn();
    render(
      <WorkspaceRail
        activeWorkspaceId="A"
        sessions={[]}
        workspaces={[
          { id: "A", label: "Alfred", shortLabel: "A" },
          { id: "CLIENT", label: "ClientApp", shortLabel: "CLI" },
        ]}
        onAddWorkspace={vi.fn()}
        onSelectWorkspace={onSelectWorkspace}
      />,
    );

    screen.getByRole("tab", { name: "Alfred workspace, empty" }).focus();
    await user.keyboard("{ArrowDown}");

    expect(onSelectWorkspace).toHaveBeenCalledWith("CLIENT");
    expect(screen.getByRole("tab", { name: "ClientApp workspace, empty" })).toHaveFocus();
  });

  it("supports roving focus home, end, and wraparound keys", async () => {
    const user = userEvent.setup();
    const onSelectWorkspace = vi.fn();
    render(
      <WorkspaceRail
        activeWorkspaceId="CLIENT"
        sessions={[]}
        workspaces={[
          { id: "A", label: "Alfred", shortLabel: "A" },
          { id: "CLIENT", label: "ClientApp", shortLabel: "CLI" },
          { id: "DOCS", label: "Docs", shortLabel: "DOC" },
        ]}
        onAddWorkspace={vi.fn()}
        onSelectWorkspace={onSelectWorkspace}
      />,
    );

    screen.getByRole("tab", { name: "ClientApp workspace, empty" }).focus();

    await user.keyboard("{End}");
    expect(onSelectWorkspace).toHaveBeenLastCalledWith("DOCS");
    expect(screen.getByRole("tab", { name: "Docs workspace, empty" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(onSelectWorkspace).toHaveBeenLastCalledWith("A");
    expect(screen.getByRole("tab", { name: "Alfred workspace, empty" })).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(onSelectWorkspace).toHaveBeenLastCalledWith("DOCS");

    await user.keyboard("{Home}");
    expect(onSelectWorkspace).toHaveBeenLastCalledWith("A");
  });
});
