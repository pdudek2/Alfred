import { describe, expect, it } from "vitest";
import {
  addManualSession,
  addStagedSessions,
  appendSessionActivity,
  attachRuntimeSession,
  approveAllStaged,
  approveStaged,
  closeSession,
  createInitialSessions,
  hydratePersistedTerminalSessions,
  hydrateStagedPlanSessions,
  hydrateLiveTerminalSessions,
  markSessionExited,
  markSessionStartFailed,
  recordSessionOutputActivity,
  rejectAllStaged,
  rejectStaged,
} from "./session-state";
import type { AlfredPlanSession } from "../shared/alfred-ipc";
import type { AlfredStagedPlanSnapshot } from "../shared/alfred-ipc";
import type { TerminalSessionSnapshot } from "../shared/terminal-ipc";

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

  it("hydrates live terminal tiles from persisted runtime snapshots", () => {
    const snapshots: TerminalSessionSnapshot[] = [
      {
        id: "pty-a",
        clientId: "manual-1",
        title: "Manual · zsh 1",
        cwd: "/repo",
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

  it("hydrates restored transcript tiles without runtime ids", () => {
    const hydrated = hydratePersistedTerminalSessions([
      {
        clientId: "manual-4",
        title: "Manual · zsh 4",
        cwd: "/repo",
        source: "manual",
        shell: "/bin/zsh",
        buffer: "last output\n",
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
    expect(markSessionStartFailed(hydrated, "manual-4")[0]?.runtimeStatus).toBe("error");
  });

  it("copies resolved runtime metadata back into the session tile", () => {
    const initial = createInitialSessions("", "A");
    const next = attachRuntimeSession(initial, "manual-1", {
      id: "runtime-1",
      clientId: "manual-1",
      title: "Manual · zsh 1",
      source: "manual",
      workspaceId: "A",
      cwd: "/Users/patryk/Desktop/Alfred",
      shell: "/bin/zsh",
    });

    expect(next[0]).toMatchObject({
      runtimeId: "runtime-1",
      runtimeStatus: "live",
      cwd: "/Users/patryk/Desktop/Alfred",
    });
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

    const next = recordSessionOutputActivity(hydrated, "pty-a", "\u001b[31mError: build failed\u001b[0m\n", 200);

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

    const next = recordSessionOutputActivity(hydrated, "pty-a", "plain shell prompt\n", 240);

    expect(next[0]).toMatchObject({ lastOutputAt: 240 });
    expect(next[0]?.activityEvents).toBeUndefined();
  });

  it("classifies approval prompts as waiting activity", () => {
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

    const next = recordSessionOutputActivity(hydrated, "pty-a", "Do you want to proceed? y/N\n", 260);

    expect(next[0]?.activityEvents?.[0]).toMatchObject({
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
      "pty-a",
      'Bash("pnpm test")\nEdit(apps/desktop/src/renderer/app.tsx)\n',
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
  ];

  it("addStagedSessions appends one tile per plan session with stable Alfred-prefixed ids", () => {
    const initial = createInitialSessions("/repo");
    const next = addStagedSessions(initial, planSessions, "/repo");

    expect(next).toHaveLength(4); // 1 manual + 3 staged
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
    expect(staged[2]).toMatchObject({ id: "alfred-3", agentKind: "codex", safetyNote: "rm -rf detected" });
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
        safetyNote: "review command",
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

    expect(after.map((s) => s.id)).toEqual(["manual-1", "alfred-1", "alfred-3"]);
  });

  it("rejectStaged refuses to remove live tiles", () => {
    const initial = createInitialSessions("/repo");
    const before = addStagedSessions(initial, planSessions, "/repo");
    const after = rejectStaged(before, "manual-1");
    expect(after).toEqual(before); // manual is live, not staged → unchanged
  });

  it("approveAllStaged flips safe staged tiles to live and leaves unsafe tiles staged", () => {
    const initial = createInitialSessions("/repo");
    const before = addStagedSessions(initial, planSessions, "/repo");
    const after = approveAllStaged(before);

    expect(after.find((s) => s.id === "manual-1")?.stage).toBe("live");
    expect(after.find((s) => s.id === "alfred-1")?.stage).toBe("live");
    expect(after.find((s) => s.id === "alfred-2")?.stage).toBe("live");
    expect(after.find((s) => s.id === "alfred-3")?.stage).toBe("staged");
    expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id)); // same ids, same order
  });

  it("rejectAllStaged removes every staged tile and leaves manual tiles untouched", () => {
    const initial = createInitialSessions("/repo");
    const before = addStagedSessions(initial, planSessions, "/repo");
    const after = rejectAllStaged(before);

    expect(after).toEqual(initial); // back to just the manual tile
  });
});
