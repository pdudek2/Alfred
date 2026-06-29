import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExternalCodexSessionSummary } from "../../shared/session-index-ipc";
import type { SessionTile } from "../session-state";
import { ObservatorySurface } from "./ObservatorySurface";
import type { WorkspaceRailWorkspace } from "./WorkspaceRail";

const workspaces: WorkspaceRailWorkspace[] = [
  { id: "A", label: "Alfred", shortLabel: "A", rootPath: "/Users/patryk/Desktop/Alfred", gitBranch: "main" },
  { id: "IRO", label: "IronLog", shortLabel: "IRO", rootPath: "/Users/patryk/Desktop/IronLog", gitBranch: "main" },
];

const managedSessions: SessionTile[] = [
  {
    id: "codex-1",
    title: "Managed code audit",
    workspaceId: "A",
    cwd: "/Users/patryk/Desktop/Alfred",
    source: "manual",
    stage: "live",
    runtimeStatus: "live",
    agentKind: "codex",
    command: "codex",
    lastActivityAt: 1_800,
  },
];

const externalSessions: ExternalCodexSessionSummary[] = [
  {
    id: "019eee11-1111-7222-8333-444444444444",
    title: "Codex App redesign thread",
    cwd: "/Users/patryk/Desktop/IronLog",
    createdAt: 1_000,
    updatedAt: 2_000,
    transcriptPath: "/Users/patryk/.codex/sessions/hidden.jsonl",
    model: "gpt-5.5",
    originator: "Codex Desktop",
  },
];

afterEach(() => {
  cleanup();
});

describe("ObservatorySurface", () => {
  it("shows managed Alfred and external Codex sessions with separate actions", async () => {
    const user = userEvent.setup();
    const onOpenManagedSession = vi.fn();
    const onResumeExternalCodexSession = vi.fn();

    render(
      <ObservatorySurface
        activeWorkspaceId="A"
        externalCodexSessions={externalSessions}
        loadingExternalSessions={false}
        sessions={managedSessions}
        workspaces={workspaces}
        onOpenManagedSession={onOpenManagedSession}
        onRefreshExternalSessions={vi.fn()}
        onResumeExternalCodexSession={onResumeExternalCodexSession}
        onSelectWorkspace={vi.fn()}
      />,
    );

    const sessionList = screen.getByLabelText("Sessions");
    expect(within(sessionList).getByText("Managed code audit")).toBeInTheDocument();
    expect(within(sessionList).getByText("Codex App redesign thread")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Codex App redesign thread/i }));
    const detail = screen.getByRole("complementary", { name: "Session detail" });
    expect(within(detail).getByText("External Codex")).toBeInTheDocument();
    expect(within(detail).getByText("gpt-5.5")).toBeInTheDocument();

    await user.click(within(detail).getByRole("button", { name: "Resume in Alfred" }));
    expect(onResumeExternalCodexSession).toHaveBeenCalledWith(externalSessions[0]);

    await user.click(screen.getByRole("button", { name: /Managed code audit/i }));
    await user.click(within(detail).getByRole("button", { name: "Open in Work" }));
    expect(onOpenManagedSession).toHaveBeenCalledWith("A", "codex-1");
  });

  it("filters by project and search without exposing transcript paths", async () => {
    const user = userEvent.setup();

    render(
      <ObservatorySurface
        activeWorkspaceId="A"
        externalCodexSessions={externalSessions}
        loadingExternalSessions={false}
        sessions={managedSessions}
        workspaces={workspaces}
        onOpenManagedSession={vi.fn()}
        onRefreshExternalSessions={vi.fn()}
        onResumeExternalCodexSession={vi.fn()}
        onSelectWorkspace={vi.fn()}
      />,
    );

    const projects = screen.getByRole("complementary", { name: "Projects" });
    const sessionList = screen.getByLabelText("Sessions");

    await user.click(within(projects).getByRole("button", { name: /IronLog/i }));
    expect(within(sessionList).queryByText("Managed code audit")).not.toBeInTheDocument();
    expect(within(sessionList).getByText("Codex App redesign thread")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Search History sessions" }), "not-found");
    expect(screen.getByText("No sessions match.")).toBeInTheDocument();
    expect(screen.queryByText("/Users/patryk/.codex/sessions/hidden.jsonl")).not.toBeInTheDocument();
  });

  it("blocks external Codex resume when the cwd is not a trusted workspace", async () => {
    const user = userEvent.setup();
    const onResumeExternalCodexSession = vi.fn();
    const onTrustExternalCodexWorkspace = vi.fn();
    const untrustedSession: ExternalCodexSessionSummary = {
      id: "019eee11-5555-7222-8333-444444444444",
      title: "External unknown workspace",
      cwd: "/Users/patryk/Downloads/UnknownProject",
      createdAt: 1_000,
      updatedAt: 2_100,
      transcriptPath: "/Users/patryk/.codex/sessions/unknown.jsonl",
    };

    render(
      <ObservatorySurface
        activeWorkspaceId="A"
        externalCodexSessions={[untrustedSession]}
        loadingExternalSessions={false}
        sessions={managedSessions}
        workspaces={workspaces}
        onOpenManagedSession={vi.fn()}
        onRefreshExternalSessions={vi.fn()}
        onResumeExternalCodexSession={onResumeExternalCodexSession}
        onTrustExternalCodexWorkspace={onTrustExternalCodexWorkspace}
        onSelectWorkspace={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /External unknown workspace/i }));
    const detail = screen.getByRole("complementary", { name: "Session detail" });
    const resume = within(detail).getByRole("button", { name: "Trust workspace first" });

    expect(within(detail).getByText("Add this folder as a workspace before resuming this Codex session.")).toBeInTheDocument();
    expect(resume).toBeEnabled();

    await user.click(resume);
    expect(onResumeExternalCodexSession).not.toHaveBeenCalled();
    expect(onTrustExternalCodexWorkspace).toHaveBeenCalledWith(untrustedSession);
  });

  it("attributes external Codex sessions in legacy Alfred worktrees to the base workspace", async () => {
    const user = userEvent.setup();
    const onResumeExternalCodexSession = vi.fn();
    const worktreeSession: ExternalCodexSessionSummary = {
      id: "019eee11-6666-7222-8333-444444444444",
      title: "Legacy worktree session",
      cwd: "/Users/patryk/Desktop/.alfred-worktrees/Alfred/audit-hardening",
      createdAt: 1_000,
      updatedAt: 2_200,
      transcriptPath: "/Users/patryk/.codex/sessions/worktree.jsonl",
    };

    render(
      <ObservatorySurface
        activeWorkspaceId="A"
        externalCodexSessions={[worktreeSession]}
        loadingExternalSessions={false}
        sessions={[]}
        workspaces={workspaces}
        onOpenManagedSession={vi.fn()}
        onRefreshExternalSessions={vi.fn()}
        onResumeExternalCodexSession={onResumeExternalCodexSession}
        onSelectWorkspace={vi.fn()}
      />,
    );

    const projects = screen.getByRole("complementary", { name: "Projects" });
    await user.click(within(projects).getByRole("button", { name: /Alfred, 1 sessions/i }));
    expect(screen.getByRole("button", { name: /Legacy worktree session/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Legacy worktree session/i }));
    const detail = screen.getByRole("complementary", { name: "Session detail" });

    expect(within(detail).getByText("Alfred")).toBeInTheDocument();
    await user.click(within(detail).getByRole("button", { name: "Resume in Alfred" }));
    expect(onResumeExternalCodexSession).toHaveBeenCalledWith(worktreeSession);
  });

});
