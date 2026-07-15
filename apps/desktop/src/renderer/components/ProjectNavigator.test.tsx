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
      attentionCountsByWorkspace={new Map()}
      collapsed={false}
      sessions={sessions}
      workspaces={workspaces}
      workspaceActions={<button type="button">Workspace actions</button>}
      onAddWorkspace={vi.fn()}
      onFocusSessionInWorkspace={vi.fn()}
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

    const projects = screen.getAllByRole("tab", { name: /workspace/i });
    expect(projects.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Alfred"),
      expect.stringContaining("ClientApp"),
      expect.stringContaining("Chmury_lab04"),
      expect.stringContaining("GothamTab"),
      expect.stringContaining("IronLog"),
    ]);
    expect(screen.getByRole("button", { name: "Show 2 more projects" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Codex · Slice 2/i })).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("button", { name: /Codex · restored/i })).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Free Chats" })).getAllByRole("button")).toHaveLength(4);
  });

  it("exposes the active project's sessions as a keyboard-operable disclosure", async () => {
    const user = userEvent.setup();
    renderNavigator();

    const disclosure = screen.getByRole("button", { name: "Collapse Alfred sessions" });
    const sessionGroup = screen.getByRole("group", { name: "Alfred sessions" });
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(sessionGroup).toBeVisible();

    disclosure.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: "Expand Alfred sessions" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(sessionGroup).not.toBeVisible();

    await user.keyboard(" ");

    expect(screen.getByRole("button", { name: "Collapse Alfred sessions" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("group", { name: "Alfred sessions" })).toBeVisible();
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
  });

  it("routes every selection through the supplied callbacks", async () => {
    const user = userEvent.setup();
    const onSelectWorkspace = vi.fn();
    const onFocusSessionInWorkspace = vi.fn();
    renderNavigator({ onSelectWorkspace, onFocusSessionInWorkspace });

    await user.click(screen.getByRole("tab", { name: /ClientApp workspace/i }));
    expect(onSelectWorkspace).toHaveBeenCalledWith("CLIENT");
    await user.click(screen.getByRole("button", { name: /Codex · Slice 2/i }));
    expect(onFocusSessionInWorkspace).toHaveBeenCalledWith("A", "codex-live");
  });

  it("keeps project order stable when attention changes and supports roving focus", async () => {
    const { rerender } = renderNavigator();
    const before = screen.getAllByRole("tab").map((node) => node.getAttribute("data-label"));
    rerender(navigatorWithWaitingSessionInClientApp());
    expect(screen.getAllByRole("tab").map((node) => node.getAttribute("data-label"))).toEqual(before);

    screen.getByRole("tab", { name: /Alfred workspace/i }).focus();
    await userEvent.keyboard("{ArrowDown}{End}{Home}{ArrowUp}");
    expect(screen.getByRole("tab", { name: /IronLog workspace/i })).toHaveFocus();
  });

  it("labels the first five project shortcuts as command 1 through 5", () => {
    renderNavigator();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
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

    expect(screen.getByRole("tab", { name: `${workspaces[5]!.label} workspace` })).toBeInTheDocument();
  });

  it("shows the exact remaining project count and keeps an overflow selection visible", () => {
    const { rerender } = renderNavigator();
    rerender(navigator({ activeWorkspaceId: "SEVEN" }));

    expect(screen.getByRole("tab", { name: /SeventhProject workspace/i })).toHaveAttribute("aria-selected", "true");
  });

  it("collapses an expanded overflow when the active project remains visible", async () => {
    const user = userEvent.setup();
    renderNavigator();

    await user.click(screen.getByRole("button", { name: "Show 2 more projects" }));
    expect(screen.getAllByRole("tab")).toHaveLength(7);

    await user.click(screen.getByRole("button", { name: "Show fewer projects" }));

    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Show 2 more projects" })).toBeInTheDocument();
  });

  it("keeps overflow expanded while it contains the active project", () => {
    renderNavigator({ activeWorkspaceId: "SEVEN" });

    expect(screen.getAllByRole("tab")).toHaveLength(7);
    expect(screen.getByRole("button", { name: "Show fewer projects" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: /SeventhProject workspace/i })).toHaveAttribute("aria-selected", "true");
  });

  it("propagates a hidden project's honest review marker to the overflow control", () => {
    renderNavigator({ attentionCountsByWorkspace: new Map([["SEVEN", 1]]) });

    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(
      screen.getByRole("button", { name: "Show 2 more projects, hidden project needs review" }),
    ).toHaveAttribute("data-attention", "true");
  });

  it("includes the exact blocking decision count in the accessible project row", () => {
    renderNavigator({ attentionCountsByWorkspace: new Map([["CLIENT", 2]]) });

    expect(screen.getAllByRole("tab")).toHaveLength(5);
    const client = screen.getByRole("tab", { name: "ClientApp workspace, 2 decisions need review" });
    expect(client).toHaveAttribute(
      "data-attention",
      "true",
    );
    expect(within(client).getByLabelText("2 decisions need review")).toHaveTextContent("2");
  });

  it("does not invent a signal for a recovery-only workspace omitted from the blocking map", () => {
    renderNavigator({ attentionCountsByWorkspace: new Map() });

    const client = screen.getByRole("tab", { name: "ClientApp workspace" });
    expect(client).not.toHaveAttribute("data-attention");
    expect(within(client).queryByLabelText(/need review/i)).not.toBeInTheDocument();
  });

  it("keeps one destination tree and an operable session disclosure in collapsed mode", async () => {
    const user = userEvent.setup();
    const { container } = renderNavigator({ collapsed: true });

    expect(container.querySelector(".project-navigator")).toHaveClass("is-collapsed");
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(container.querySelectorAll('[role="tablist"]')).toHaveLength(1);

    const disclosure = screen.getByRole("button", { name: "Collapse Alfred sessions" });
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    disclosure.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Expand Alfred sessions" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Collapse Alfred sessions" })).toHaveAttribute(
      "aria-expanded",
      "true",
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
