import { describe, expect, it } from "vitest";
import {
  addManualSession,
  addStagedSessions,
  approveAllStaged,
  approveStaged,
  closeSession,
  createInitialSessions,
  hydrateLiveTerminalSessions,
  rejectAllStaged,
  rejectStaged,
} from "./session-state";
import type { AlfredPlanSession } from "../shared/alfred-ipc";
import type { TerminalSessionSnapshot } from "../shared/terminal-ipc";

describe("desktop session state", () => {
  it("starts with one first-class manual terminal session", () => {
    const sessions = createInitialSessions("/Users/patryk/Desktop/Alfred");

    expect(sessions).toEqual([
      {
        id: "manual-1",
        source: "manual",
        stage: "live",
        title: "Manual · zsh 1",
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
      title: "Manual · zsh 2",
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
        title: "Manual · zsh 1",
        cwd: "/repo",
        source: "manual",
        stage: "live",
        initialBuffer: "hello\n",
      },
      {
        id: "alfred-1",
        runtimeId: "pty-b",
        title: "API dev",
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

  it("approveAllStaged flips every staged tile to live and leaves manual tiles untouched", () => {
    const initial = createInitialSessions("/repo");
    const before = addStagedSessions(initial, planSessions, "/repo");
    const after = approveAllStaged(before);

    expect(after.every((s) => s.stage === "live")).toBe(true);
    expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id)); // same ids, same order
  });

  it("rejectAllStaged removes every staged tile and leaves manual tiles untouched", () => {
    const initial = createInitialSessions("/repo");
    const before = addStagedSessions(initial, planSessions, "/repo");
    const after = rejectAllStaged(before);

    expect(after).toEqual(initial); // back to just the manual tile
  });
});
