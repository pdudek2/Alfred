import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionTile } from "../session-state";
import { ProjectNavigator, projectRailState, type ProjectNavigatorProps } from "./ProjectNavigator";

const workspaces = [
  { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/patryk/Desktop/Alfred", gitBranch: "main" },
  { id: "CLIENT", label: "ClientApp", shortLabel: "CLI", rootPath: "/repo/client" },
  { id: "CLOUD", label: "Chmury_lab04", shortLabel: "CHM", rootPath: "/repo/cloud" },
  { id: "GOTHAM", label: "GothamTab", shortLabel: "GOT", rootPath: "/repo/gotham" },
  { id: "IRON", label: "IronLog", shortLabel: "IRO", rootPath: "/repo/iron" },
  { id: "LONG", label: "A project name long enough to require visual truncation", shortLabel: "LNG", rootPath: "/repo/long" },
  { id: "SEVEN", label: "SeventhProject", shortLabel: "SVN", rootPath: "/repo/seven" },
];

const sandboxes = [
  { id: "W3", label: "Workspace 3", shortLabel: "W3" },
  { id: "W4", label: "Workspace 4", shortLabel: "W4" },
  { id: "W12", label: "Workspace 12", shortLabel: "W12" },
];

const sessions: SessionTile[] = [
  liveSession("codex-live", "Codex · Slice 2", "A", "/Users/patryk/Desktop/Alfred", "codex"),
  liveSession("claude-live", "Claude · CSS", "A", "/Users/patryk/Desktop/Alfred", "claude"),
  { ...liveSession("codex-restored", "Codex · restored", "A", "/Users/patryk/Desktop/Alfred", "codex"), runtimeStatus: "restored" },
  ...Array.from({ length: 4 }, (_, index) =>
    liveSession(
      `free-${index + 1}`,
      `Free Chat ${index + 1}`,
      `FREE-${index + 1}`,
      `/Users/patryk/Documents/Codex/chat-${index + 1}`,
      "codex",
    ),
  ),
];

function liveSession(
  id: string,
  title: string,
  workspaceId: string,
  cwd: string,
  agentKind: "claude" | "codex",
): SessionTile {
  return {
    id,
    title,
    workspaceId,
    cwd,
    source: "manual",
    stage: "live",
    runtimeStatus: "live",
    agentKind,
  };
}

function shell(id: string, workspaceId: string, shellBusy: boolean): SessionTile {
  return { id, title: id, workspaceId, cwd: "/repo", source: "manual", stage: "live", runtimeStatus: "live", shellBusy };
}

function agent(id: string, workspaceId: string, signal: "needs-you" | "your-turn" | "working"): SessionTile {
  return { ...liveSession(id, id, workspaceId, "/repo", "codex"), agentSignal: { state: signal, source: "hook", at: Date.now() } };
}

function railRow(label: string) {
  return screen.getByRole("button", { name: `${label} project` });
}

function railGlyph(label: string) {
  return railRow(label).querySelector(".session-status-glyph");
}

function navigator(props: Partial<ProjectNavigatorProps> = {}) {
  return (
    <ProjectNavigator
      activeSessionId="codex-live"
      activeWorkspaceId="A"
      attentionCountsByWorkspace={new Map()}
      sessions={sessions}
      workspaces={workspaces}
      workspaceActions={<button type="button">Project actions</button>}
      onAddWorkspace={vi.fn()}
      onSelectSessionInWorkspace={vi.fn()}
      onSelectWorkspace={vi.fn()}
      {...props}
    />
  );
}

function renderNavigator(props: Partial<ProjectNavigatorProps> = {}) {
  return render(navigator(props));
}

describe("projectRailState", () => {
  const now = Date.now();

  it("ranks only the four active states and counts Needs you items", () => {
    expect(projectRailState([agent("a", "A", "working"), agent("b", "A", "your-turn")], "A", 0, now)).toBe("your-turn");
    expect(projectRailState([agent("a", "A", "working"), shell("s", "A", true)], "A", 0, now)).toBe("working");
    expect(projectRailState([shell("s", "A", true)], "A", 0, now)).toBe("running");
    expect(projectRailState([shell("s", "A", false)], "A", 0, now)).toBeNull();
    expect(projectRailState([shell("s", "A", false)], "A", 1, now)).toBe("needs-you");
    expect(projectRailState([agent("a", "A", "needs-you")], "A", 0, now)).toBe("needs-you");
    expect(projectRailState([agent("a", "B", "needs-you")], "A", 0, now)).toBeNull();
    expect(projectRailState([{ ...agent("a", "A", "working"), runtimeStatus: "exited" }], "A", 0, now)).toBeNull();
  });
});

describe("ProjectNavigator", () => {
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

  it("lists every project as one row without session rows, hints, counts or a collapse button", () => {
    const { container } = renderNavigator();

    const projectList = screen.getByRole("list", { name: "Projects" });
    expect(within(projectList).getAllByRole("button", { name: / project$/ }).map((row) => row.getAttribute("data-label")))
      .toEqual(workspaces.map((workspace) => workspace.label));
    expect(railRow("Alfred")).toHaveAttribute("aria-current", "location");
    expect(projectList.querySelector(".project-session")).toBeNull();
    expect(container.querySelector("kbd")).toBeNull();
    expect(screen.queryByRole("button", { name: /Collapse project navigator|Expand project navigator/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /more projects/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Add project" }).closest("header")).not.toBeNull();
  });

  it("shows one glyph per project for its highest active state and mutes calm projects", () => {
    renderNavigator({
      attentionCountsByWorkspace: new Map([["CLIENT", 1]]),
      sessions: [
        agent("client-working", "CLIENT", "working"),
        agent("cloud-working", "CLOUD", "working"),
        shell("iron-shell", "IRON", false),
      ],
    });

    expect(railGlyph("ClientApp")).toHaveClass("status-needs-you");
    expect(railRow("ClientApp")).toHaveAccessibleDescription("needs you");
    expect(railGlyph("Chmury_lab04")).toHaveClass("status-working");
    expect(railGlyph("IronLog")).toBeNull();
    expect(railRow("IronLog")).not.toHaveClass("is-calm");
    expect(railRow("GothamTab")).toHaveClass("is-calm");
    expect(railRow("GothamTab")).not.toHaveAttribute("aria-describedby");
  });

  it("groups rootless projects into one collapsed Sandboxes row with the group's highest state", async () => {
    const user = userEvent.setup();
    const onSelectWorkspace = vi.fn();
    renderNavigator({
      onSelectWorkspace,
      sessions: [agent("w4-turn", "W4", "your-turn"), shell("w12-run", "W12", true)],
      workspaces: [...workspaces, ...sandboxes],
    });

    const toggle = screen.getByRole("button", { name: "Sandboxes, 3 projects" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Sandboxes3");
    expect(toggle.querySelector(".session-status-glyph")).toHaveClass("status-your-turn");
    expect(screen.queryByRole("button", { name: "Workspace 3 project" })).toBeNull();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const group = screen.getByRole("list", { name: "Sandboxes" });
    expect(within(group).getAllByRole("button").map((row) => row.getAttribute("data-label")))
      .toEqual(["Workspace 3", "Workspace 4", "Workspace 12"]);
    await user.click(railRow("Workspace 12"));
    expect(onSelectWorkspace).toHaveBeenCalledWith("W12");
  });

  it("opens Sandboxes when a sandbox becomes active and marks the collapsed group as current", async () => {
    const user = userEvent.setup();
    const all = [...workspaces, ...sandboxes];
    const view = renderNavigator({ workspaces: all });
    expect(screen.getByRole("button", { name: "Sandboxes, 3 projects" })).toHaveAttribute("aria-expanded", "false");

    view.rerender(navigator({ activeWorkspaceId: "W4", workspaces: all }));

    const toggle = screen.getByRole("button", { name: "Sandboxes, 3 projects" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(railRow("Workspace 4")).toHaveAttribute("aria-current", "location");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-current", "location");
  });

  it("omits the Sandboxes row when every project has a folder", () => {
    renderNavigator();

    expect(screen.queryByRole("button", { name: /^Sandboxes/ })).toBeNull();
  });

  it("lists rootless projects flat when there is no real project to separate them from", () => {
    renderNavigator({ activeWorkspaceId: "W3", workspaces: sandboxes });

    expect(screen.queryByRole("button", { name: /^Sandboxes/ })).toBeNull();
    expect(within(screen.getByRole("list", { name: "Projects" })).getAllByRole("button", { name: / project$/ }).map((row) => row.getAttribute("data-label")))
      .toEqual(["Workspace 3", "Workspace 4", "Workspace 12"]);
  });

  it("shows the two newest finished agent results without including manual shells", () => {
    const now = Date.now();
    renderNavigator({
      sessions: [
        ...sessions,
        { ...liveSession("codex-old", "Older result", "CLIENT", "/repo/client", "codex"), runtimeStatus: "exited", lastActivityAt: now - 30_000 },
        { ...liveSession("claude-error", "Index logs", "IRON", "/repo/iron", "claude"), runtimeStatus: "error", lastActivityAt: now - 20_000 },
        { ...liveSession("codex-new", "Sync files", "CLOUD", "/repo/cloud", "codex"), runtimeStatus: "exited", lastActivityAt: now - 10_000 },
        {
          id: "manual-done",
          title: "Manual · zsh 9",
          workspaceId: "A",
          cwd: "/repo",
          source: "manual",
          stage: "live",
          runtimeStatus: "exited",
          lastActivityAt: now,
        },
      ],
    });

    const recent = screen.getByRole("region", { name: "Recent agent results" });
    expect(within(recent).getAllByRole("button").map((button) => button.textContent)).toEqual([
      expect.stringContaining("Sync files"),
      expect.stringContaining("Index logs"),
    ]);
    expect(recent).not.toHaveTextContent("Older result");
    expect(recent).not.toHaveTextContent("Manual · zsh 9");
  });

  it("opens the exact recent session in its workspace", async () => {
    const onSelectSessionInWorkspace = vi.fn();
    renderNavigator({
      onSelectSessionInWorkspace,
      sessions: [
        ...sessions,
        { ...liveSession("codex-done", "Sync files", "CLOUD", "/repo/cloud", "codex"), runtimeStatus: "exited", lastActivityAt: Date.now() },
      ],
    });

    await userEvent.click(screen.getByRole("button", { name: "Open finished Sync files in Chmury_lab04" }));

    expect(onSelectSessionInWorkspace).toHaveBeenCalledWith("CLOUD", "codex-done");
  });

  it("keeps Free Chats as their own group and routes their selection", async () => {
    const onSelectSessionInWorkspace = vi.fn();
    renderNavigator({ onSelectSessionInWorkspace });

    const freeChats = screen.getByRole("group", { name: "Free Chats" });
    expect(within(freeChats).getAllByRole("button")).toHaveLength(4);
    await userEvent.click(within(freeChats).getByRole("button", { name: "Free Chat 2" }));
    expect(onSelectSessionInWorkspace).toHaveBeenCalledWith("FREE-2", "free-2");
  });

  it("keeps project order stable when attention changes and supports arrow shortcuts", async () => {
    const { rerender } = renderNavigator();
    const labels = () => within(screen.getByRole("list", { name: "Projects" }))
      .getAllByRole("button", { name: / project$/ })
      .map((node) => node.getAttribute("data-label"));
    const before = labels();

    rerender(navigator({ attentionCountsByWorkspace: new Map([["CLIENT", 1]]) }));
    expect(labels()).toEqual(before);

    railRow("Alfred").focus();
    await userEvent.keyboard("{ArrowDown}{End}{Home}{ArrowUp}");
    expect(railRow("SeventhProject")).toHaveFocus();
  });

  it("keeps the complete long project name and a short label for the compact rail", () => {
    renderNavigator();

    expect(railRow(workspaces[5]!.label)).toHaveAttribute("data-label", workspaces[5]!.label);
    expect(railRow("ClientApp").querySelector(".project-row-monogram")).toHaveTextContent("CLI");
  });

  it("omits Free Chats when there are no matching live sessions", () => {
    renderNavigator({ sessions: sessions.slice(0, 3) });

    expect(screen.queryByRole("group", { name: "Free Chats" })).not.toBeInTheDocument();
  });

  it.each(["restored", "exited", "error"] as const)(
    "excludes %s scratch sessions from Free Chats",
    (runtimeStatus) => {
      const scratch = {
        ...liveSession(`scratch-${runtimeStatus}`, `Scratch ${runtimeStatus}`, "CLOUD", `/Users/patryk/Documents/Codex/s-${runtimeStatus}`, "codex"),
        runtimeStatus,
      };

      renderNavigator({ activeWorkspaceId: "CLIENT", sessions: [scratch] });

      expect(screen.queryByRole("button", { name: `Scratch ${runtimeStatus}` })).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Free Chats" })).not.toBeInTheDocument();
    },
  );
});
