import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionTile } from "../session-state";
import { ProjectNavigator, type ProjectNavigatorProps } from "./ProjectNavigator";

const workspaces = [
  { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/patryk/Desktop/Alfred", gitBranch: "main" },
  { id: "CLIENT", label: "ClientApp", shortLabel: "CLI", rootPath: "/repo/client" },
  { id: "CLOUD", label: "Chmury_lab04", shortLabel: "CHM", rootPath: "/repo/cloud" },
  { id: "GOTHAM", label: "GothamTab", shortLabel: "GOT", rootPath: "/repo/gotham" },
  { id: "IRON", label: "IronLog", shortLabel: "IRO", rootPath: "/repo/iron" },
  { id: "LONG", label: "A project name long enough to require visual truncation", shortLabel: "LNG", rootPath: "/repo/long" },
  { id: "SEVEN", label: "SeventhProject", shortLabel: "SVN", rootPath: "/repo/seven" },
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

function navigator(props: Partial<ProjectNavigatorProps> = {}) {
  return (
    <ProjectNavigator
      activeSessionId="codex-live"
      activeWorkspaceId="A"
      activeAgentCountsByWorkspace={new Map()}
      attentionCountsByWorkspace={new Map()}
      collapsed={false}
      sessions={sessions}
      workspaces={workspaces}
      workspaceActions={<button type="button">Workspace actions</button>}
      onAddWorkspace={vi.fn()}
      onSelectSessionInWorkspace={vi.fn()}
      onSelectWorkspace={vi.fn()}
      onToggleCollapsed={vi.fn()}
      {...props}
    />
  );
}

function renderNavigator(props: Partial<ProjectNavigatorProps> = {}) {
  return render(navigator(props));
}

function navigatorWithWaitingSessionInClientApp() {
  return navigator({
    attentionCountsByWorkspace: new Map([["CLIENT", 1]]),
    sessions: [
      ...sessions,
      {
        ...liveSession("client-waiting", "Codex · review", "CLIENT", "/repo/client", "codex"),
        activityEvents: [{ id: "ask", kind: "approval", title: "Waiting", detail: "Approve?", at: 1 }],
      },
    ],
  });
}

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

  it("renders five stable projects, expands only the active project, and keeps Free Chats separate", () => {
    renderNavigator();

    const projectList = screen.getByRole("list", { name: "Workspaces" });
    const projects = within(projectList).getAllByRole("button", { name: / workspace(?:,|$)/i });
    expect(projects.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Alfred"),
      expect.stringContaining("ClientApp"),
      expect.stringContaining("Chmury_lab04"),
      expect.stringContaining("GothamTab"),
      expect.stringContaining("IronLog"),
    ]);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alfred workspace" })).toHaveAttribute(
      "aria-current",
      "location",
    );
    expect(screen.getByRole("button", { name: "Show 2 more projects" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Codex · Slice 2/i })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: /Codex · restored/i })).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Free Chats" })).getAllByRole("button")).toHaveLength(4);
  });

  it("shows the two newest finished agent results without moving projects or including manual shells", () => {
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

    const projectList = screen.getByRole("list", { name: "Workspaces" });
    expect(within(projectList).getAllByRole("button", { name: / workspace(?:,|$)/i }).map((row) => row.getAttribute("data-label"))).toEqual([
      "Alfred",
      "ClientApp",
      "Chmury_lab04",
      "GothamTab",
      "IronLog",
    ]);
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

  it("exposes one disclosure for an active project with live sessions", () => {
    renderNavigator();

    const sessionGroup = screen.getByRole("group", { name: "Alfred sessions" });
    expect(sessionGroup).toBeVisible();
    expect(screen.getByRole("button", { name: "Collapse Alfred sessions" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getAllByRole("list", { name: "Workspaces" })).toHaveLength(1);
  });

  it("keeps previously expanded project sessions visible after the active project changes", () => {
    const projectSessions = [
      ...sessions,
      liveSession("client-live", "Claude · Client review", "CLIENT", "/repo/client", "claude"),
    ];
    const view = renderNavigator({ activeWorkspaceId: "A", sessions: projectSessions });
    expect(screen.getByRole("group", { name: "Alfred sessions" })).toBeVisible();

    view.rerender(navigator({ activeWorkspaceId: "CLIENT", sessions: projectSessions }));

    expect(screen.getByRole("group", { name: "Alfred sessions" })).toBeVisible();
    expect(screen.getByRole("group", { name: "ClientApp sessions" })).toBeVisible();
  });

  it("lets the user collapse a project's sessions independently", async () => {
    const user = userEvent.setup();
    renderNavigator();
    const disclosure = screen.getByRole("button", { name: "Collapse Alfred sessions" });

    await user.click(disclosure);

    expect(screen.queryByRole("group", { name: "Alfred sessions" })).not.toBeInTheDocument();
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(disclosure).toHaveAccessibleName("Expand Alfred sessions");
  });

  it("routes every selection through the supplied callbacks", async () => {
    const user = userEvent.setup();
    const onSelectWorkspace = vi.fn();
    const onSelectSessionInWorkspace = vi.fn();
    renderNavigator({ onSelectWorkspace, onSelectSessionInWorkspace });

    await user.click(screen.getByRole("button", { name: /ClientApp workspace/i }));
    expect(onSelectWorkspace).toHaveBeenCalledWith("CLIENT");
    await user.click(screen.getByRole("button", { name: /Codex · Slice 2/i }));
    expect(onSelectSessionInWorkspace).toHaveBeenCalledWith("A", "codex-live");
  });

  it("keeps project order stable when attention changes and supports native tab stops and arrow shortcuts", async () => {
    const { rerender } = renderNavigator();
    const projectList = screen.getByRole("list", { name: "Workspaces" });
    const before = within(projectList)
      .getAllByRole("button", { name: / workspace(?:,|$)/i })
      .map((node) => node.getAttribute("data-label"));

    rerender(navigatorWithWaitingSessionInClientApp());
    const projectButtons = within(screen.getByRole("list", { name: "Workspaces" }))
      .getAllByRole("button", { name: / workspace(?:,|$)/i });
    expect(projectButtons.map((node) => node.getAttribute("data-label"))).toEqual(before);
    expect(projectButtons.every((button) => button.tabIndex === 0)).toBe(true);

    screen.getByRole("button", { name: /Alfred workspace/i }).focus();
    await userEvent.keyboard("{ArrowDown}{End}{Home}{ArrowUp}");
    expect(screen.getByRole("button", { name: /IronLog workspace/i })).toHaveFocus();
  });

  it("labels the first five project shortcuts as command 1 through 5", () => {
    renderNavigator();

    const projectButtons = within(screen.getByRole("list", { name: "Workspaces" }))
      .getAllByRole("button", { name: / workspace(?:,|$)/i });
    expect(projectButtons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("⌘1"),
      expect.stringContaining("⌘2"),
      expect.stringContaining("⌘3"),
      expect.stringContaining("⌘4"),
      expect.stringContaining("⌘5"),
    ]);
  });

  it("keeps the complete long project name in its accessible label", async () => {
    const user = userEvent.setup();
    renderNavigator();
    await user.click(screen.getByRole("button", { name: "Show 2 more projects" }));

    expect(screen.getByRole("button", { name: `${workspaces[5]!.label} workspace` })).toBeInTheDocument();
  });

  it("shows the exact remaining project count and keeps an overflow selection visible", () => {
    const { rerender } = renderNavigator();
    rerender(navigator({ activeWorkspaceId: "SEVEN" }));

    expect(screen.getByRole("button", { name: /SeventhProject workspace/i })).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  it("collapses an expanded overflow when the active project remains visible", async () => {
    const user = userEvent.setup();
    renderNavigator();

    await user.click(screen.getByRole("button", { name: "Show 2 more projects" }));
    expect(
      within(screen.getByRole("list", { name: "Workspaces" }))
        .getAllByRole("button", { name: / workspace(?:,|$)/i }),
    ).toHaveLength(7);

    await user.click(screen.getByRole("button", { name: "Show fewer projects" }));

    expect(
      within(screen.getByRole("list", { name: "Workspaces" }))
        .getAllByRole("button", { name: / workspace(?:,|$)/i }),
    ).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Show 2 more projects" })).toBeInTheDocument();
  });

  it("keeps overflow expanded while it contains the active project", () => {
    renderNavigator({ activeWorkspaceId: "SEVEN" });

    expect(
      within(screen.getByRole("list", { name: "Workspaces" }))
        .getAllByRole("button", { name: / workspace(?:,|$)/i }),
    ).toHaveLength(7);
    expect(screen.getByRole("button", { name: "Show fewer projects" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /SeventhProject workspace/i })).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  it("propagates a hidden project's honest review marker to the overflow control", () => {
    renderNavigator({ attentionCountsByWorkspace: new Map([["SEVEN", 1]]) });

    expect(
      within(screen.getByRole("list", { name: "Workspaces" }))
        .getAllByRole("button", { name: / workspace(?:,|$)/i }),
    ).toHaveLength(5);
    expect(
      screen.getByRole("button", { name: "Show 2 more projects, hidden project needs review" }),
    ).toHaveAttribute("data-attention", "true");
  });

  it("includes the exact blocking decision count in the accessible project row", () => {
    renderNavigator({ attentionCountsByWorkspace: new Map([["CLIENT", 2]]) });

    expect(
      within(screen.getByRole("list", { name: "Workspaces" }))
        .getAllByRole("button", { name: / workspace(?:,|$)/i }),
    ).toHaveLength(5);
    const client = screen.getByRole("button", { name: "ClientApp workspace" });
    expect(client).toHaveAttribute(
      "data-attention",
      "true",
    );
    expect(client).toHaveAccessibleDescription("2 decisions need review");
    const signal = client.querySelector(".project-attention-signal");
    expect(signal).toHaveClass("project-attention-signal");
    expect(signal).toHaveTextContent("2");
  });

  it("shows active agent counts beside their projects without reordering the rail", () => {
    renderNavigator({
      activeAgentCountsByWorkspace: new Map([
        ["CLIENT", 3],
        ["CLOUD", 1],
      ]),
      attentionCountsByWorkspace: new Map([["CLIENT", 2]]),
    });

    const projectButtons = within(screen.getByRole("list", { name: "Workspaces" }))
      .getAllByRole("button", { name: / workspace(?:,|$)/i });
    expect(projectButtons.map((button) => button.getAttribute("data-label"))).toEqual([
      "Alfred",
      "ClientApp",
      "Chmury_lab04",
      "GothamTab",
      "IronLog",
    ]);
    const client = screen.getByRole("button", { name: "ClientApp workspace" });
    expect(client).toHaveAccessibleDescription("2 decisions need review, 3 active agents");
    expect(client.querySelector(".project-agent-signal")).toHaveTextContent("3");
    expect(client.querySelector(".project-attention-signal")).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Chmury_lab04 workspace" })).toHaveAccessibleDescription(
      "1 active agent",
    );
  });

  it("does not invent a signal for a recovery-only workspace omitted from the blocking map", () => {
    renderNavigator({ attentionCountsByWorkspace: new Map() });

    const client = screen.getByRole("button", { name: "ClientApp workspace" });
    expect(client).not.toHaveAttribute("data-attention");
    expect(within(client).queryByLabelText(/need review/i)).not.toBeInTheDocument();
  });

  it("keeps one destination tree and visible session destinations in collapsed mode", () => {
    const { container } = renderNavigator({ collapsed: true });

    expect(container.querySelector(".project-navigator")).toHaveClass("is-collapsed");
    expect(
      within(screen.getByRole("list", { name: "Workspaces" }))
        .getAllByRole("button", { name: / workspace(?:,|$)/i }),
    ).toHaveLength(5);
    expect(screen.getAllByRole("list", { name: "Workspaces" })).toHaveLength(1);

    expect(screen.getByRole("group", { name: "Alfred sessions" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Alfred workspace" })).toHaveAttribute("data-label", "Alfred");
    expect(screen.getByRole("button", { name: "Codex · Slice 2" })).toHaveAttribute(
      "data-label",
      "Codex · Slice 2",
    );
    expect(screen.getByRole("button", { name: "Codex · Slice 2" })).toHaveAttribute(
      "data-session-id",
      "codex-live",
    );
  });

  it("omits Free Chats when there are no matching live sessions", () => {
    renderNavigator({ sessions: sessions.slice(0, 3) });

    expect(screen.queryByRole("group", { name: "Free Chats" })).not.toBeInTheDocument();
  });

  it.each(["restored", "exited", "error"] as const)(
    "excludes %s scratch sessions from both active rows and Free Chats",
    (runtimeStatus) => {
      const activeScratch = {
        ...liveSession(
          `active-scratch-${runtimeStatus}`,
          `Active scratch ${runtimeStatus}`,
          "CLIENT",
          `/Users/patryk/Documents/Codex/active-${runtimeStatus}`,
          "codex",
        ),
        runtimeStatus,
      };
      const foreignScratch = {
        ...activeScratch,
        id: `foreign-scratch-${runtimeStatus}`,
        title: `Foreign scratch ${runtimeStatus}`,
        workspaceId: "CLOUD",
      };

      renderNavigator({ activeWorkspaceId: "CLIENT", sessions: [activeScratch, foreignScratch] });

      expect(screen.queryByRole("button", { name: `Active scratch ${runtimeStatus}` })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: `Foreign scratch ${runtimeStatus}` })).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Free Chats" })).not.toBeInTheDocument();
    },
  );
});
