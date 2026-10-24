import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionTile } from "../session-state";
import { ProjectNavigator, projectRailState, railOrder, type ProjectNavigatorProps } from "./ProjectNavigator";

const workspaces = [
  { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/sample/Desktop/Alfred", gitBranch: "main" },
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
  liveSession("codex-live", "Codex · Atlas", "A", "/Users/sample/Desktop/Alfred", "codex"),
  liveSession("claude-live", "Claude · CSS", "A", "/Users/sample/Desktop/Alfred", "claude"),
  { ...liveSession("codex-restored", "Codex · restored", "A", "/Users/sample/Desktop/Alfred", "codex"), runtimeStatus: "restored" },
  ...Array.from({ length: 4 }, (_, index) =>
    liveSession(
      `free-${index + 1}`,
      `Free Chat ${index + 1}`,
      `FREE-${index + 1}`,
      `/Users/sample/Documents/Codex/chat-${index + 1}`,
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
      activeSurface="work"
      activeWorkspaceId="A"
      asleepCount={0}
      attentionCountsByWorkspace={new Map()}
      now={Date.now()}
      pinnedSessionId={null}
      sessions={sessions}
      workspaces={workspaces}
      workspaceActions={<button type="button">Project actions</button>}
      onAddWorkspace={vi.fn()}
      onFocusSession={vi.fn()}
      onNewWorker={vi.fn()}
      onOpenAsleep={vi.fn()}
      onOpenSettings={vi.fn()}
      onPinSession={vi.fn()}
      onSelectSessionInWorkspace={vi.fn()}
      onSelectSurface={vi.fn()}
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

describe("railOrder", () => {
  it("puts real projects before sandboxes so ⌘1–⌘9 match the rail", () => {
    const mixed = [workspaces[0]!, sandboxes[0]!, workspaces[1]!, sandboxes[1]!];
    expect(railOrder(mixed).map((workspace) => workspace.id)).toEqual(["A", "CLIENT", "W3", "W4"]);
    expect(railOrder(sandboxes).map((workspace) => workspace.id)).toEqual(["W3", "W4", "W12"]);
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

  it("lists every project as one row without hints, counts or a collapse button", () => {
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

  it("shows the active project's sessions as a tree under its row and none under the others", () => {
    const { rerender } = renderNavigator({
      sessions: [...sessions, liveSession("client-live", "Codex · Client", "CLIENT", "/repo/client", "codex")],
    });

    const tree = screen.getByRole("list", { name: "Sessions in Alfred" });
    expect(within(tree).getByRole("button", { name: /^Codex · Atlas/ })).toHaveAttribute("aria-current", "true");
    expect(within(tree).getByRole("button", { name: /^Claude · CSS/ })).toBeInTheDocument();
    // Asleep sessions are counted, not listed.
    expect(within(tree).queryByRole("button", { name: /^Codex · restored/ })).toBeNull();
    expect(screen.queryByRole("list", { name: "Sessions in ClientApp" })).toBeNull();
    // The focused session carries the fill, so the project row reads as the tree's heading.
    expect(railRow("Alfred").closest(".project-row")).toHaveClass("is-active", "has-tree");
    expect(railRow("ClientApp").closest(".project-row")).not.toHaveClass("has-tree");

    rerender(navigator({ activeSurface: "sessions" }));
    expect(screen.queryByRole("list", { name: "Sessions in Alfred" })).toBeNull();
  });

  it("focuses, pins and starts a worker from the tree and opens the asleep list", async () => {
    const user = userEvent.setup();
    const onFocusSession = vi.fn();
    const onPinSession = vi.fn();
    const onNewWorker = vi.fn();
    const onOpenAsleep = vi.fn();
    const { rerender } = renderNavigator({ asleepCount: 2, onFocusSession, onPinSession, onNewWorker, onOpenAsleep });

    const tree = screen.getByRole("list", { name: "Sessions in Alfred" });
    await user.click(within(tree).getByRole("button", { name: /^Claude · CSS/ }));
    await user.click(within(tree).getByRole("button", { name: "Pin under the focus", description: /Claude · CSS/ }));
    await user.click(within(tree).getByRole("button", { name: "New worker for Codex · Atlas" }));
    await user.click(screen.getByRole("button", { name: "Browse 2 asleep sessions" }));

    expect(onFocusSession).toHaveBeenCalledWith("claude-live");
    expect(onPinSession).toHaveBeenCalledWith("claude-live");
    expect(onNewWorker).toHaveBeenCalledWith("codex-live");
    expect(onOpenAsleep).toHaveBeenCalledOnce();

    rerender(navigator({ pinnedSessionId: "claude-live" }));
    expect(screen.queryByRole("button", { name: "Pin under the focus", description: /Claude · CSS/ })).toBeNull();
  });

  it("keeps a parent's workers hidden across a project switch once you hide them", async () => {
    const user = userEvent.setup();
    const withWorker = [...sessions, { ...liveSession("worker", "Codex · worker", "A", "/Users/sample/Desktop/Alfred", "codex"), parentSessionId: "codex-live" }];
    const { rerender } = renderNavigator({ sessions: withWorker });

    expect(screen.getByRole("list", { name: "Workers of Codex · Atlas" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide workers of Codex · Atlas" }));
    expect(screen.queryByRole("list", { name: "Workers of Codex · Atlas" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Codex · Atlas/ })).toHaveTextContent("1 worker");

    rerender(navigator({ sessions: withWorker, activeWorkspaceId: "CLIENT" }));
    rerender(navigator({ sessions: withWorker }));
    expect(screen.queryByRole("list", { name: "Workers of Codex · Atlas" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show workers of Codex · Atlas" }));
    expect(screen.getByRole("list", { name: "Workers of Codex · Atlas" })).toBeInTheDocument();
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

  it("leaves a running agent that waits on a login out of the finished results", () => {
    const now = Date.now();
    renderNavigator({
      sessions: [
        ...sessions,
        {
          ...liveSession("claude-login", "Needs a login", "CLOUD", "/repo/cloud", "claude"),
          lastActivityAt: now,
          activityEvents: [{ id: "e1", at: now, kind: "error", title: "Runtime blocked", detail: "Not logged in · Please run /login" }],
        },
        { ...liveSession("codex-done", "Sync files", "CLOUD", "/repo/cloud", "codex"), runtimeStatus: "exited", lastActivityAt: now - 10_000 },
      ],
    });

    const recent = screen.getByRole("region", { name: "Recent agent results" });
    expect(recent).not.toHaveTextContent("Needs a login");
    expect(recent).toHaveTextContent("Sync files");
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

  it("keeps the complete long project name on the row", () => {
    renderNavigator();

    expect(railRow(workspaces[5]!.label)).toHaveAttribute("title", workspaces[5]!.label);
  });

  it("switches between Deck and History and opens Settings from the rail", async () => {
    const user = userEvent.setup();
    const onSelectSurface = vi.fn();
    const onOpenSettings = vi.fn();
    renderNavigator({ onOpenSettings, onSelectSurface });

    expect(screen.getByRole("button", { name: "Deck" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "History" })).not.toHaveAttribute("aria-current");
    await user.click(screen.getByRole("button", { name: "History" }));
    expect(onSelectSurface).toHaveBeenCalledWith("sessions");
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("marks no project as current on History", () => {
    renderNavigator({ activeSurface: "sessions" });

    expect(screen.getByRole("button", { name: "History" })).toHaveAttribute("aria-current", "page");
    expect(railRow("Alfred")).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("button", { name: "Project actions" })).not.toBeInTheDocument();
  });

  it("omits Free Chats when there are no matching live sessions", () => {
    renderNavigator({ sessions: sessions.slice(0, 3) });

    expect(screen.queryByRole("group", { name: "Free Chats" })).not.toBeInTheDocument();
  });

  it.each(["restored", "exited", "error"] as const)(
    "excludes %s scratch sessions from Free Chats",
    (runtimeStatus) => {
      const scratch = {
        ...liveSession(`scratch-${runtimeStatus}`, `Scratch ${runtimeStatus}`, "CLOUD", `/Users/sample/Documents/Codex/s-${runtimeStatus}`, "codex"),
        runtimeStatus,
      };

      renderNavigator({ activeWorkspaceId: "CLIENT", sessions: [scratch] });

      expect(screen.queryByRole("button", { name: `Scratch ${runtimeStatus}` })).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Free Chats" })).not.toBeInTheDocument();
    },
  );
});
