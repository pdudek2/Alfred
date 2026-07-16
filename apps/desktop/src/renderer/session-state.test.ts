import { describe, expect, it } from "vitest";
import {
  addAgentSession,
  addManualSession,
  addStagedSessions,
  appendSessionActivity,
  attachRuntimeSession,
  approveStaged,
  closeSession,
  createInitialSessions,
  hydratePersistedTerminalSessions,
  hydrateStagedPlanSessions,
  hydrateLiveTerminalSessions,
  markSessionExited,
  markSessionStartFailed,
  recordSessionOutputActivity,
  rejectStaged,
  relaunchRestoredSession,
  renameSession,
  restartSession,
  type SessionTile,
} from "./session-state";
import type { AlfredPlanSession } from "../shared/alfred-ipc";
import type { AlfredStagedPlanSnapshot } from "../shared/alfred-ipc";
import type { TerminalDataEvent, TerminalSessionSnapshot } from "../shared/terminal-ipc";

function restoreSessionWithResumeTarget(sessionId: string) {
  const restored = hydratePersistedTerminalSessions([
    {
      clientId: "alfred-codex",
      title: "Codex audit",
      cwd: "/repo",
      source: "alfred",
      agentKind: "codex",
      command: "codex",
      args: ["resume", "stale-session-id"],
      resumeTarget: { agentKind: "codex", sessionId, source: "codex-session-index" },
      shell: "codex",
      buffer: "saved codex output\n",
    },
  ]);

  return relaunchRestoredSession(restored, "alfred-codex")[0]!;
}

function restoreSessionWithoutResumeTarget() {
  const restored = hydratePersistedTerminalSessions([
    {
      clientId: "alfred-codex",
      title: "Codex audit",
      cwd: "/repo",
      source: "alfred",
      agentKind: "codex",
      command: "codex",
      args: ["resume", "unknown-session-id"],
      shell: "codex",
      buffer: "saved codex output\n",
    },
  ]);

  return relaunchRestoredSession(restored, "alfred-codex")[0]!;
}

describe("desktop session state", () => {
  it("starts with one first-class manual terminal session", () => {
    const sessions = createInitialSessions("/Users/patryk/Desktop/Alfred");

    expect(sessions).toEqual([
      {
        id: "manual-1",
        source: "manual",
        stage: "live",
        runtimeStatus: "starting",
        title: "Manual · zsh 1",
        workspaceId: "A",
        cwd: "/Users/patryk/Desktop/Alfred",
      },
    ]);
  });

  it("adds manual terminal sessions with stable titles", () => {
    const initial = createInitialSessions("/Users/patryk/Desktop/Alfred");
    const next = addManualSession(initial, "/Users/patryk/Desktop/Alfred");

    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({
      id: "manual-2",
      source: "manual",
      stage: "live",
      runtimeStatus: "starting",
      title: "Manual · zsh 2",
      workspaceId: "A",
      cwd: "/Users/patryk/Desktop/Alfred",
    });
  });

  it("does not reuse an existing session id after close", () => {
    const initial = createInitialSessions("/Users/patryk/Desktop/Alfred");
    const twoSessions = addManualSession(initial, "/Users/patryk/Desktop/Alfred");
    const closedFirst = closeSession(twoSessions, "manual-1");
    const next = addManualSession(closedFirst, "/Users/patryk/Desktop/Alfred");

    expect(next.map((session) => session.id)).toEqual(["manual-2", "manual-3"]);
    expect(next.map((session) => session.title)).toEqual(["Manual · zsh 2", "Manual · zsh 3"]);
  });

  it("renames a session with normalized display text", () => {
    const initial = createInitialSessions("/Users/patryk/Desktop/Alfred");
    const renamed = renameSession(initial, "manual-1", "  Spec   reviewer  ");

    expect(renamed[0]?.title).toBe("Spec reviewer");
  });

  it("adds new Codex sessions in the shared workspace by default", () => {
    const next = addAgentSession([], "codex", "/repo", "A");

    expect(next).toEqual([
      {
        id: "codex-1",
        title: "Codex · session 1",
        workspaceId: "A",
        cwd: "/repo",
        source: "manual",
        stage: "live",
        runtimeStatus: "starting",
        agentKind: "codex",
        command: "codex",
        args: [],
        isolation: "shared",
      },
    ]);
  });

  it("adds first-class Codex and Claude sessions", () => {
    const initial = createInitialSessions("/repo");
    const withCodex = addAgentSession(initial, "codex", "/repo", "A");
    const withClaude = addAgentSession(withCodex, "claude", "/repo", "A");

    expect(withClaude.slice(1)).toEqual([
      {
        id: "codex-1",
        title: "Codex · session 1",
        workspaceId: "A",
        cwd: "/repo",
        source: "manual",
        stage: "live",
        runtimeStatus: "starting",
        agentKind: "codex",
        command: "codex",
        args: [],
        isolation: "shared",
      },
      {
        id: "claude-1",
        title: "Claude · session 1",
        workspaceId: "A",
        cwd: "/repo",
        source: "manual",
        stage: "live",
        runtimeStatus: "starting",
        agentKind: "claude",
        command: "claude",
        args: [],
        isolation: "shared",
      },
    ]);
  });

  it("can add first-class agent sessions in a shared non-Git workspace", () => {
    const initial = createInitialSessions("/plain-folder");
    const withCodex = addAgentSession(initial, "codex", "/plain-folder", "A", "shared");

    expect(withCodex[1]).toMatchObject({
      id: "codex-1",
      title: "Codex · session 1",
      cwd: "/plain-folder",
      agentKind: "codex",
      command: "codex",
      isolation: "shared",
    });
  });

  it("hydrates live terminal tiles from persisted runtime snapshots", () => {
    const snapshots: TerminalSessionSnapshot[] = [
      {
        id: "pty-a",
        clientId: "manual-1",
        title: "Manual · zsh 1",
        cwd: "/repo",
        createdAt: 100,
        source: "manual",
        shell: "/bin/zsh",
        buffer: "hello\n",
        lastOutputAt: 120,
      },
      {
        id: "pty-b",
        clientId: "alfred-1",
        title: "API dev",
        cwd: "/repo/apps/api",
        source: "alfred",
        agentKind: "dev-server",
        shell: "pnpm",
        command: "pnpm",
        args: ["dev"],
        buffer: "ready\n",
      },
    ];

    expect(hydrateLiveTerminalSessions(snapshots)).toEqual([
      {
        id: "manual-1",
        runtimeId: "pty-a",
        runtimeStatus: "live",
        title: "Manual · zsh 1",
        workspaceId: "A",
        cwd: "/repo",
        createdAt: 100,
        source: "manual",
        stage: "live",
        lastOutputAt: 120,
        initialBuffer: "hello\n",
      },
      {
        id: "alfred-1",
        runtimeId: "pty-b",
        runtimeStatus: "live",
        title: "API dev",
        workspaceId: "A",
        cwd: "/repo/apps/api",
        source: "alfred",
        stage: "live",
        agentKind: "dev-server",
        command: "pnpm",
        args: ["dev"],
        initialBuffer: "ready\n",
      },
    ]);
  });

  it("continues manual numbering after hydrated manual sessions", () => {
    const hydrated = hydrateLiveTerminalSessions([
      {
        id: "pty-a",
        clientId: "manual-4",
        title: "Manual · zsh 4",
        cwd: "/repo",
        source: "manual",
        shell: "/bin/zsh",
        buffer: "",
      },
    ]);
    const next = addManualSession(hydrated, "/repo");

    expect(next.map((session) => session.id)).toEqual(["manual-4", "manual-5"]);
  });

  it("restarts an existing tile without carrying stale runtime state", () => {
    const hydrated = hydrateLiveTerminalSessions([
      {
        id: "pty-a",
        clientId: "manual-4",
        title: "Manual · zsh 4",
        cwd: "/repo",
        source: "manual",
        shell: "/bin/zsh",
        buffer: "old output\n",
        lastOutputAt: 100,
      },
    ]);
    const exited = markSessionExited(hydrated, "pty-a");

    expect(restartSession(exited, "manual-4")[0]).toEqual({
      id: "manual-4",
      title: "Manual · zsh 4",
      workspaceId: "A",
      cwd: "/repo",
      source: "manual",
      stage: "live",
      runtimeStatus: "starting",
    });
  });

  it("hydrates restored transcript tiles without runtime ids", () => {
    const hydrated = hydratePersistedTerminalSessions([
      {
        clientId: "manual-4",
        title: "Manual · zsh 4",
        cwd: "/repo",
        source: "manual",
        shell: "/bin/zsh",
        buffer: "last output\n",
        createdAt: 250,
        lastActivityAt: 300,
        lastOutputAt: 320,
        activityEvents: [
          {
            id: "manual-4-activity-300-1",
            kind: "output",
            title: "Progress reported",
            detail: "last output ready",
            at: 300,
          },
        ],
      },
    ]);

    expect(hydrated).toEqual([
      {
        id: "manual-4",
        runtimeStatus: "restored",
        title: "Manual · zsh 4",
        workspaceId: "A",
        cwd: "/repo",
        createdAt: 250,
        source: "manual",
        stage: "live",
        lastActivityAt: 300,
        lastOutputAt: 320,
        activityEvents: [
          {
            id: "manual-4-activity-300-1",
            kind: "output",
            title: "Progress reported",
            detail: "last output ready",
            at: 300,
          },
        ],
        initialBuffer: "last output\n",
      },
    ]);
  });

  it("relaunches a restored transcript in the same tile", () => {
    const restored = hydratePersistedTerminalSessions([
      {
        clientId: "manual-2",
        title: "Manual · zsh 2",
        cwd: "/repo",
        source: "manual",
        command: "pnpm",
        args: ["test"],
        shell: "pnpm",
        buffer: "saved output\n",
        createdAt: 300,
        lastOutputAt: 320,
      },
    ]);

    expect(relaunchRestoredSession(restored, "manual-2")[0]).toEqual({
      id: "manual-2",
      title: "Manual · zsh 2",
      workspaceId: "A",
      cwd: "/repo",
      source: "manual",
      stage: "live",
      runtimeStatus: "starting",
      createdAt: 300,
      lastOutputAt: 320,
      command: "pnpm",
      args: ["test"],
      initialBuffer: "saved output\n",
    });
  });

  it("resumes restored Codex and Claude agent conversations instead of replaying the original prompt", () => {
    const restored = hydratePersistedTerminalSessions([
      {
        clientId: "alfred-codex",
        title: "Codex audit",
        cwd: "/repo/.alfred-worktrees/codex-audit",
        source: "alfred",
        agentKind: "codex",
        command: "codex",
        args: ["do the original audit"],
        shell: "codex",
        buffer: "saved codex output\n",
      },
      {
        clientId: "alfred-claude",
        title: "Claude UI review",
        cwd: "/repo/.alfred-worktrees/claude-ui",
        source: "alfred",
        agentKind: "claude",
        command: "claude",
        args: ["do the original UI review"],
        shell: "claude",
        buffer: "saved claude output\n",
      },
    ]);

    expect(relaunchRestoredSession(restored, "alfred-codex")[0]).toMatchObject({
      id: "alfred-codex",
      runtimeStatus: "starting",
      command: "codex",
      args: ["resume", "--last"],
      initialBuffer: "saved codex output\n",
    });
    expect(relaunchRestoredSession(restored, "alfred-claude")[1]).toMatchObject({
      id: "alfred-claude",
      runtimeStatus: "starting",
      command: "claude",
      args: ["--continue"],
      initialBuffer: "saved claude output\n",
    });
  });

  it("keeps a specific Codex resume target when relaunching a restored external session", () => {
    const codexSessionId = "019edc4b-0000-7000-9000-specific";
    const restored = hydratePersistedTerminalSessions([
      {
        clientId: "external-codex",
        title: "Codex · Load Alfred memory",
        cwd: "/Users/patryk/Desktop/Alfred",
        source: "manual",
        agentKind: "codex",
        command: "codex",
        args: ["resume", codexSessionId],
        resumeTarget: { agentKind: "codex", sessionId: codexSessionId, source: "external-session-index" },
        shell: "codex",
        buffer: "saved external output\n",
      },
    ]);

    expect(relaunchRestoredSession(restored, "external-codex")[0]).toMatchObject({
      id: "external-codex",
      runtimeStatus: "starting",
      command: "codex",
      args: ["resume", codexSessionId],
      resumeTarget: { agentKind: "codex", sessionId: codexSessionId, source: "external-session-index" },
      initialBuffer: "saved external output\n",
    });
  });

  it("resumes exact Codex target when resumeTarget is present", () => {
    const restored = restoreSessionWithResumeTarget("codex-session-123");
    expect(restored.command).toBe("codex");
    expect(restored.args).toEqual(["resume", "codex-session-123"]);
  });

  it("marks Codex resume as latest fallback when resumeTarget is missing", () => {
    const restored = restoreSessionWithoutResumeTarget();
    expect(restored.command).toBe("codex");
    expect(restored.args).toEqual(["resume", "--last"]);
    expect(restored.resumeMode).toBe("latest");
  });

  it("uses persisted resumeTarget when relaunching a restored managed Codex session", () => {
    const codexSessionId = "019edc4b-0000-7000-9000-managed";
    const restored = hydratePersistedTerminalSessions([
      {
        clientId: "alfred-codex",
        title: "Codex audit",
        cwd: "/repo/.alfred-worktrees/codex-audit",
        source: "alfred",
        agentKind: "codex",
        command: "codex",
        args: ["do the original audit"],
        resumeTarget: { agentKind: "codex", sessionId: codexSessionId, source: "codex-session-index" },
        shell: "codex",
        buffer: "saved codex output\n",
      },
    ]);

    expect(restored[0]).toMatchObject({
      resumeTarget: { agentKind: "codex", sessionId: codexSessionId, source: "codex-session-index" },
    });
    expect(relaunchRestoredSession(restored, "alfred-codex")[0]).toMatchObject({
      id: "alfred-codex",
      runtimeStatus: "starting",
      command: "codex",
      args: ["resume", codexSessionId],
      resumeTarget: { agentKind: "codex", sessionId: codexSessionId, source: "codex-session-index" },
    });
  });

  it("returns a failed restored relaunch to recovery instead of losing the transcript", () => {
    const restored = hydratePersistedTerminalSessions([
      {
        clientId: "codex-2",
        title: "Codex · session 2",
        cwd: "/repo",
        source: "manual",
        agentKind: "codex",
        command: "codex",
        args: [],
        shell: "codex",
        buffer: "saved output\n",
      },
    ]);

    const relaunching = relaunchRestoredSession(restored, "codex-2");
    const failed = markSessionStartFailed(relaunching, "codex-2");

    expect(failed[0]).toMatchObject({
      runtimeStatus: "restored",
      initialBuffer: "saved output\n",
    });
  });

  it("tracks runtime lifecycle transitions for live sessions", () => {
    const hydrated = hydrateLiveTerminalSessions([
      {
        id: "pty-a",
        clientId: "manual-4",
        title: "Manual · zsh 4",
        cwd: "/repo",
        source: "manual",
        shell: "/bin/zsh",
        buffer: "",
      },
    ]);

    expect(markSessionExited(hydrated, "pty-a")[0]?.runtimeStatus).toBe("exited");
    expect(markSessionExited(hydrated, "pty-a", 2)[0]?.runtimeStatus).toBe("error");
    expect(markSessionStartFailed(hydrated, "manual-4")[0]?.runtimeStatus).toBe("error");
  });

  it("copies resolved runtime metadata back into the session tile", () => {
    const initial = [{
      ...createInitialSessions("", "A")[0]!,
      initialBuffer: "old transcript\n",
      lastOutputAt: 100,
      launchPreflight: {
        status: "ready",
        label: "Worktree ready",
        detail: "Will create an isolated Git worktree on launch.",
        isolation: "worktree",
        branchName: "alfred-codex-codex-1-20260509191530-abc123",
        baseCwd: "/Users/patryk/Desktop/Alfred",
        cwd: "/Users/patryk/Desktop/.alfred-worktrees/Alfred/alfred-codex-codex-1-20260509191530-abc123",
      } as const,
    }];
    const next = attachRuntimeSession(initial, "manual-1", {
      id: "runtime-1",
      clientId: "manual-1",
      title: "Manual · zsh 1",
      source: "manual",
      workspaceId: "A",
      cwd: "/Users/patryk/Desktop/Alfred",
      isolation: "worktree",
      branchName: "alfred-codex-codex-1-20260509191530-abc123",
      baseCwd: "/Users/patryk/Desktop/Alfred",
      createdAt: 500,
      shell: "/bin/zsh",
    });

    expect(next[0]).toMatchObject({
      runtimeId: "runtime-1",
      runtimeStatus: "live",
      cwd: "/Users/patryk/Desktop/Alfred",
      isolation: "worktree",
      branchName: "alfred-codex-codex-1-20260509191530-abc123",
      baseCwd: "/Users/patryk/Desktop/Alfred",
      createdAt: 500,
    });
    expect(next[0]?.initialBuffer).toBeUndefined();
    expect(next[0]?.launchPreflight).toBeUndefined();
    expect(next[0]?.lastOutputAt).toBeUndefined();
  });

  it("appends bounded first-class activity events to a session", () => {
    const initial = createInitialSessions("/repo");
    const next = appendSessionActivity(
      initial,
      "manual-1",
      { kind: "lifecycle", title: "Session attached", detail: "zsh is running." },
      100,
    );

    expect(next[0]).toMatchObject({
      lastActivityAt: 100,
      activityEvents: [
        {
          id: "manual-1-activity-100-1",
          kind: "lifecycle",
          title: "Session attached",
          detail: "zsh is running.",
          at: 100,
        },
      ],
    });
  });

  it("records notable output lines as session activity", () => {
    const hydrated = hydrateLiveTerminalSessions([
      {
        id: "pty-a",
        clientId: "manual-4",
        title: "Manual · zsh 4",
        cwd: "/repo",
        source: "manual",
        shell: "/bin/zsh",
        buffer: "",
      },
    ]);

    const next = recordSessionOutputActivity(
      hydrated,
      {
        id: "pty-a",
        data: "\u001b[31mError: build failed\u001b[0m\n",
        activities: [
          {
            id: "manual-4-activity-200-1",
            kind: "error",
            title: "Error reported",
            detail: "Error: build failed",
            payload: { type: "error", message: "Error: build failed" },
            at: 200,
          },
        ],
      },
      200,
    );

    expect(next[0]?.lastOutputAt).toBe(200);
    expect(next[0]?.activityEvents?.[0]).toMatchObject({
      kind: "error",
      title: "Error reported",
      detail: "Error: build failed",
      at: 200,
    });
  });

  it("records generic terminal output as freshness without inventing timeline events", () => {
    const hydrated = hydrateLiveTerminalSessions([
      {
        id: "pty-a",
        clientId: "manual-4",
        title: "Manual · zsh 4",
        cwd: "/repo",
        source: "manual",
        shell: "/bin/zsh",
        buffer: "",
      },
    ]);

    const next = recordSessionOutputActivity(
      hydrated,
      { id: "pty-a", data: "plain shell prompt\n", activities: [] },
      240,
    );

    expect(next[0]).toMatchObject({ lastOutputAt: 240 });
    expect(next[0]?.activityEvents).toBeUndefined();
  });

  it("records supplied approval events as waiting activity", () => {
    const hydrated = hydrateLiveTerminalSessions([
      {
        id: "pty-a",
        clientId: "manual-4",
        title: "Manual · zsh 4",
        cwd: "/repo",
        source: "manual",
        shell: "/bin/zsh",
        buffer: "",
      },
    ]);

    const event: TerminalDataEvent = {
      id: "pty-a",
      data: "text that is not parsed in renderer",
      activities: [{
        id: "manual-4-activity-260-1",
        kind: "approval",
        title: "Waiting for approval",
        detail: "Approval required: apply patch?",
        payload: { type: "approval", prompt: "Approval required: apply patch?" },
        at: 260,
      }],
    };
    const next = recordSessionOutputActivity(hydrated, event, 260);

    expect(next[0]?.activityEvents?.[0]).toMatchObject({
      kind: "approval",
      title: "Waiting for approval",
      detail: "Approval required: apply patch?",
    });
  });

  it("preserves producer event identity and ignores repeated delivery by id", () => {
    const hydrated: SessionTile[] = [{
      id: "manual-4",
      title: "Manual · zsh 4",
      workspaceId: "A",
      cwd: "/repo",
      source: "manual",
      stage: "live",
      runtimeStatus: "starting",
    }];
    const producerEvent = {
      id: "manual-4-activity-1234-1",
      kind: "approval" as const,
      title: "Waiting for approval",
      detail: "Approval required: apply patch?",
      payload: { type: "approval" as const, prompt: "Approval required: apply patch?" },
      at: 1_234,
    };
    const terminalEvent: TerminalDataEvent = {
      id: "pty-before-create",
      clientId: "manual-4",
      data: "Approval required: apply patch?",
      activities: [producerEvent],
    };

    const once = recordSessionOutputActivity(hydrated, terminalEvent, 2_000);
    const repeated = recordSessionOutputActivity(once, terminalEvent, 3_000);

    expect(repeated[0]?.activityEvents).toEqual([producerEvent]);
    expect(repeated[0]?.activityEvents?.[0]).toBe(producerEvent);
    expect(repeated[0]?.lastActivityAt).toBe(producerEvent.at);
    expect(repeated[0]?.lastOutputAt).toBe(3_000);
  });

  it("rejects client-id data and exit events from an older runtime generation", () => {
    const hydrated = hydrateLiveTerminalSessions([
      {
        id: "pty-current",
        clientId: "manual-4",
        title: "Manual · zsh 4",
        cwd: "/repo",
        source: "manual",
        shell: "/bin/zsh",
        buffer: "",
      },
    ]);
    const staleData: TerminalDataEvent = {
      id: "pty-stale",
      clientId: "manual-4",
      data: "Approval required: stale generation",
      activities: [{
        id: "stale-activity",
        kind: "approval",
        title: "Stale approval",
        detail: "Must not attach",
        at: 500,
      }],
    };

    expect(recordSessionOutputActivity(hydrated, staleData, 500)).toBe(hydrated);
    expect(markSessionExited(hydrated, "pty-stale", 1, "manual-4")).toEqual(hydrated);
  });

  it("correlates exit by client id only until the runtime id resolves", () => {
    const unresolved: SessionTile[] = [{
      id: "manual-4",
      title: "Manual · zsh 4",
      workspaceId: "A",
      cwd: "/repo",
      source: "manual",
      stage: "live",
      runtimeStatus: "starting",
    }];

    expect(markSessionExited(unresolved, "pty-new", 1, "manual-4")).toEqual([
      expect.objectContaining({ id: "manual-4", runtimeId: "pty-new", runtimeStatus: "error" }),
    ]);
  });

  it("keeps the latest visible activity last after notable output", () => {
    const hydrated = hydrateLiveTerminalSessions([
      {
        id: "pty-a",
        clientId: "codex-1",
        title: "Codex · session 1",
        cwd: "/repo",
        source: "manual",
        agentKind: "codex",
        shell: "codex",
        buffer: "",
      },
    ]);

    const next = recordSessionOutputActivity(
      hydrated,
      {
        id: "pty-a",
        data: 'Bash("pnpm test")\nDo you want to proceed? y/N\n',
        activities: [
          {
            id: "codex-1-activity-300-1",
            kind: "command",
            title: "Ran command",
            detail: '"pnpm test"',
            payload: { type: "command", command: "pnpm test" },
            at: 300,
          },
          {
            id: "codex-1-activity-300-2",
            kind: "approval",
            title: "Waiting for approval",
            detail: "Do you want to proceed? y/N",
            payload: { type: "approval", prompt: "Do you want to proceed? y/N" },
            at: 300,
          },
        ],
      },
      300,
    );

    expect(next[0]?.activityEvents?.at(-1)).toMatchObject({
      kind: "approval",
      title: "Waiting for approval",
      detail: "Do you want to proceed? y/N",
    });
  });

  it("records multiple structured activity events from one terminal chunk", () => {
    const hydrated = hydrateLiveTerminalSessions([
      {
        id: "pty-a",
        clientId: "manual-4",
        title: "Manual · zsh 4",
        cwd: "/repo",
        source: "manual",
        shell: "/bin/zsh",
        buffer: "",
      },
    ]);

    const next = recordSessionOutputActivity(
      hydrated,
      {
        id: "pty-a",
        data: 'Bash("pnpm test")\nEdit(apps/desktop/src/renderer/app.tsx)\n',
        activities: [
          {
            id: "manual-4-activity-280-1",
            kind: "command",
            title: "Ran command",
            detail: '"pnpm test"',
            payload: { type: "command", command: "pnpm test" },
            at: 280,
          },
          {
            id: "manual-4-activity-280-2",
            kind: "file",
            title: "Edit file",
            detail: "apps/desktop/src/renderer/app.tsx",
            payload: {
              type: "file",
              operation: "edited",
              path: "apps/desktop/src/renderer/app.tsx",
            },
            at: 280,
          },
        ],
      },
      280,
    );

    expect(next[0]?.activityEvents).toEqual([
      expect.objectContaining({ kind: "command", title: "Ran command" }),
      expect.objectContaining({ kind: "file", title: "Edit file" }),
    ]);
  });

  it("assigns new manual sessions to the selected workspace", () => {
    const next = addManualSession(createInitialSessions("/repo", "A"), "/repo", "UI");

    expect(next[1]).toMatchObject({ id: "manual-2", workspaceId: "UI" });
  });
});

describe("staged sessions", () => {
  const planSessions: AlfredPlanSession[] = [
    { kind: "dev-server", title: "API dev", command: "pnpm", args: ["--filter", "@alfred/api", "dev"] },
    { kind: "shell", title: "DB logs", command: "tail", args: ["-f", "logs/db.log"], cwd: "/var/log" },
    { kind: "codex", title: "Refactor pass", command: "codex", args: [], safetyNote: "rm -rf detected" },
    {
      kind: "claude",
      title: "Blocked review",
      command: "claude",
      args: [],
      launchPreflight: {
        status: "blocked",
        code: "git_not_ready",
        label: "Git not ready",
        reason: "Workspace has uncommitted or untracked changes.",
      },
    },
  ];

  it("addStagedSessions appends one tile per plan session with stable Alfred-prefixed ids", () => {
    const initial = createInitialSessions("/repo");
    const next = addStagedSessions(initial, planSessions, "/repo");

    expect(next).toHaveLength(5); // 1 manual + 4 staged
    const staged = next.slice(1);
    expect(staged[0]).toEqual({
      id: "alfred-1",
      title: "API dev",
      workspaceId: "A",
      cwd: "/repo",
      source: "alfred",
      stage: "staged",
      command: "pnpm",
      args: ["--filter", "@alfred/api", "dev"],
      agentKind: "dev-server",
    });
    expect(staged[1]).toMatchObject({ id: "alfred-2", cwd: "/var/log", agentKind: "shell" });
    expect(staged[2]).toMatchObject({
      id: "alfred-3",
      agentKind: "codex",
      isolation: "shared",
      safetyNote: "rm -rf detected",
    });
    expect(staged[3]).toMatchObject({
      id: "alfred-4",
      agentKind: "claude",
      isolation: "shared",
      launchPreflight: expect.objectContaining({ status: "blocked" }),
    });
  });

  it("hydrates staged tiles from a persisted Alfred plan snapshot", () => {
    const snapshot: AlfredStagedPlanSnapshot = {
      id: "plan-1",
      prompt: "prepare",
      sessions: [
        { id: "alfred-9", kind: "shell", title: "Logs", command: "tail", args: ["-f", "app.log"] },
        {
          id: "alfred-10",
          kind: "codex",
          title: "Review",
          command: "codex",
          args: [],
          cwd: "/repo",
          safetyNote: "review command",
          launchPreflight: {
            status: "ready",
            label: "Worktree ready",
            detail: "Will create an isolated Git worktree on launch.",
            isolation: "worktree",
            branchName: "alfred-codex-review",
            baseCwd: "/repo",
            cwd: "/.alfred-worktrees/repo/alfred-codex-review",
          },
        },
      ],
    };

    expect(hydrateStagedPlanSessions(snapshot, "/fallback")).toEqual([
      {
        id: "alfred-9",
        title: "Logs",
        workspaceId: "A",
        cwd: "/fallback",
        source: "alfred",
        stage: "staged",
        command: "tail",
        args: ["-f", "app.log"],
        agentKind: "shell",
      },
      {
        id: "alfred-10",
        title: "Review",
        workspaceId: "A",
        cwd: "/repo",
        source: "alfred",
        stage: "staged",
        command: "codex",
        args: [],
        agentKind: "codex",
        isolation: "worktree",
        safetyNote: "review command",
        launchPreflight: {
          status: "ready",
          label: "Worktree ready",
          detail: "Will create an isolated Git worktree on launch.",
          isolation: "worktree",
          branchName: "alfred-codex-review",
          baseCwd: "/repo",
          cwd: "/.alfred-worktrees/repo/alfred-codex-review",
        },
      },
    ]);
  });

  it("addStagedSessions assigns ids that do not collide across multiple plans", () => {
    const initial = createInitialSessions("/repo");
    const firstPlan = addStagedSessions(initial, planSessions.slice(0, 2), "/repo");
    const secondPlan = addStagedSessions(firstPlan, planSessions.slice(0, 1), "/repo");

    const ids = secondPlan.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    expect(ids).toEqual(["manual-1", "alfred-1", "alfred-2", "alfred-3"]);
  });

  it("addStagedSessions falls back to defaultCwd when plan session omits cwd", () => {
    const initial = createInitialSessions("/repo");
    const planWithoutCwd: AlfredPlanSession[] = [
      { kind: "shell", title: "no cwd", command: "ls", args: [] },
    ];
    const next = addStagedSessions(initial, planWithoutCwd, "/some/default");
    expect(next[1]?.cwd).toBe("/some/default");
  });

  it("keeps staged coding agents shared when preflight falls back from Git worktrees", () => {
    const initial = createInitialSessions("/plain-folder");
    const next = addStagedSessions(initial, [
      {
        kind: "codex",
        title: "Codex in plain folder",
        command: "codex",
        args: [],
        launchPreflight: {
          status: "ready",
          label: "Shared workspace",
          detail: "Workspace is not Git; will launch in the selected folder.",
          isolation: "shared",
        },
      },
    ], "/plain-folder");

    expect(next[1]).toMatchObject({
      agentKind: "codex",
      isolation: "shared",
      launchPreflight: expect.objectContaining({ status: "ready", isolation: "shared" }),
    });
  });

  it("addStagedSessions assigns staged tiles to the active workspace", () => {
    const next = addStagedSessions(createInitialSessions("/repo", "A"), planSessions.slice(0, 1), "/repo", "UI");

    expect(next[1]).toMatchObject({ id: "alfred-1", workspaceId: "UI" });
  });

  it("approveStaged flips stage from 'staged' to 'live' on the matching id only", () => {
    const initial = createInitialSessions("/repo");
    const withStaged = addStagedSessions(initial, planSessions, "/repo");
    const after = approveStaged(withStaged, "alfred-2");

    expect(after.find((s) => s.id === "alfred-2")?.stage).toBe("live");
    expect(after.find((s) => s.id === "alfred-1")?.stage).toBe("staged");
    expect(after.find((s) => s.id === "alfred-3")?.stage).toBe("staged");
    expect(after.find((s) => s.id === "alfred-4")?.stage).toBe("staged");
  });

  it("approveStaged is a no-op for unknown ids and for already-live tiles", () => {
    const initial = createInitialSessions("/repo");
    const before = addStagedSessions(initial, planSessions, "/repo");
    expect(approveStaged(before, "no-such-id")).toEqual(before);
    expect(approveStaged(before, "manual-1")).toEqual(before); // already live
  });

  it("rejectStaged removes the matching staged tile only", () => {
    const initial = createInitialSessions("/repo");
    const before = addStagedSessions(initial, planSessions, "/repo");
    const after = rejectStaged(before, "alfred-2");

    expect(after.map((s) => s.id)).toEqual(["manual-1", "alfred-1", "alfred-3", "alfred-4"]);
  });

  it("rejectStaged refuses to remove live tiles", () => {
    const initial = createInitialSessions("/repo");
    const before = addStagedSessions(initial, planSessions, "/repo");
    const after = rejectStaged(before, "manual-1");
    expect(after).toEqual(before); // manual is live, not staged → unchanged
  });

  it("keeps staged tiles queued while an edit is being rechecked", () => {
    const initial = createInitialSessions("/repo");
    const before = addStagedSessions(initial, planSessions, "/repo").map((session) =>
      session.id === "alfred-1" ? { ...session, stagedReviewStatus: "checking" as const } : session,
    );

    expect(approveStaged(before, "alfred-1")).toEqual(before);
  });

  it("refuses to approve preflight-blocked staged tiles", () => {
    const initial = createInitialSessions("/repo");
    const before = addStagedSessions(initial, planSessions, "/repo");

    expect(approveStaged(before, "alfred-4")).toEqual(before);
  });

  it("drops one-shot launch preflight after a staged launch fails", () => {
    const initial = createInitialSessions("/repo");
    const before = addStagedSessions(
      initial,
      [
        {
          kind: "codex",
          title: "Codex task",
          command: "codex",
          args: [],
          launchPreflight: {
            status: "ready",
            label: "Worktree ready",
            detail: "Will create an isolated Git worktree on launch.",
            isolation: "worktree",
            branchName: "alfred-codex-task",
            baseCwd: "/repo",
            cwd: "/.alfred-worktrees/repo/alfred-codex-task",
          },
        },
      ],
      "/repo",
    );
    const launching = approveStaged(before, "alfred-1");
    const failed = markSessionStartFailed(launching, "alfred-1");

    expect(failed[1]).toMatchObject({
      id: "alfred-1",
      stage: "staged",
      runtimeStatus: "error",
    });
    expect(failed[1]?.launchPreflight).toBeUndefined();
  });
});
