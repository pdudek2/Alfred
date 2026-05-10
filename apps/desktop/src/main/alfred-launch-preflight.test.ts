import { describe, expect, it, vi } from "vitest";
import { preflightAlfredPlan } from "./alfred-launch-preflight.js";

describe("preflightAlfredPlan", () => {
  it("marks shared utility sessions ready when the command is available", async () => {
    const result = await preflightAlfredPlan(
      {
        sessions: [{ kind: "shell", title: "Logs", command: "tail", args: ["-f", "app.log"] }],
      },
      { id: "A", label: "Alfred", rootPath: "/repo" },
      { commandExists: async () => true },
    );

    expect(result.sessions[0]?.launchPreflight).toEqual({
      status: "ready",
      label: "Ready",
      detail: "Will launch in the selected workspace.",
      isolation: "shared",
    });
  });

  it("blocks staged sessions when the command is missing", async () => {
    const result = await preflightAlfredPlan(
      {
        sessions: [{ kind: "codex", title: "Codex", command: "codex", args: [] }],
      },
      { id: "A", label: "Alfred", rootPath: "/repo" },
      { commandExists: async () => false },
    );

    expect(result.sessions[0]?.launchPreflight).toMatchObject({
      status: "blocked",
      code: "command_missing",
      reason: 'Command "codex" is not available on PATH.',
    });
  });

  it("preflights coding agents into a future isolated worktree", async () => {
    const preflightAgentWorktree = vi.fn(async () => ({
      baseCwd: "/repo",
      branchName: "alfred-codex-refactor",
      cwd: "/.alfred-worktrees/repo/alfred-codex-refactor",
    }));

    const result = await preflightAlfredPlan(
      {
        sessions: [{ kind: "codex", title: "Refactor", command: "codex", args: [], cwd: "apps/desktop" }],
      },
      { id: "A", label: "Alfred", rootPath: "/repo" },
      {
        commandExists: async () => true,
        preflightAgentWorktree,
      },
    );

    expect(preflightAgentWorktree).toHaveBeenCalledWith({
      agentKind: "codex",
      clientId: "Refactor",
      cwd: "/repo/apps/desktop",
    });
    expect(result.sessions[0]?.launchPreflight).toEqual({
      status: "ready",
      label: "Worktree ready",
      detail: "Will create an isolated Git worktree on launch.",
      isolation: "worktree",
      branchName: "alfred-codex-refactor",
      baseCwd: "/repo",
      cwd: "/.alfred-worktrees/repo/alfred-codex-refactor",
    });
  });

  it("blocks coding agents that ask to launch outside the selected workspace", async () => {
    const preflightAgentWorktree = vi.fn();
    const result = await preflightAlfredPlan(
      {
        sessions: [{ kind: "codex", title: "Codex", command: "codex", args: [], cwd: "/other/repo" }],
      },
      { id: "A", label: "Alfred", rootPath: "/repo" },
      {
        commandExists: async () => true,
        preflightAgentWorktree,
      },
    );

    expect(preflightAgentWorktree).not.toHaveBeenCalled();
    expect(result.sessions[0]?.launchPreflight).toMatchObject({
      status: "blocked",
      code: "cwd_outside_workspace",
      reason: "This agent asked to launch outside the selected workspace. Bind the right folder or adjust the plan.",
    });
  });

  it("blocks coding agents when no workspace folder is bound", async () => {
    const result = await preflightAlfredPlan(
      {
        sessions: [{ kind: "claude", title: "Review", command: "claude", args: [] }],
      },
      { id: "A", label: "Alfred" },
      { commandExists: async () => true },
    );

    expect(result.sessions[0]?.launchPreflight).toMatchObject({
      status: "blocked",
      code: "no_workspace",
    });
  });

  it("blocks coding agents when Git worktree preparation is not ready", async () => {
    const result = await preflightAlfredPlan(
      {
        sessions: [{ kind: "claude", title: "Review", command: "claude", args: [], cwd: "/repo" }],
      },
      { id: "A", label: "Alfred", rootPath: "/repo" },
      {
        commandExists: async () => true,
        preflightAgentWorktree: async () => {
          throw new Error("Workspace has uncommitted or untracked changes.");
        },
      },
    );

    expect(result.sessions[0]?.launchPreflight).toMatchObject({
      status: "blocked",
      code: "git_not_ready",
      reason: "Workspace has uncommitted or untracked changes.",
    });
  });

  it("falls back to shared workspace for coding agents in non-Git folders", async () => {
    const result = await preflightAlfredPlan(
      {
        sessions: [{ kind: "codex", title: "Codex", command: "codex", args: [] }],
      },
      { id: "A", label: "Alfred", rootPath: "/plain-folder" },
      {
        commandExists: async () => true,
        preflightAgentWorktree: async () => {
          throw new Error("Workspace is not a Git repository. fatal: not a Git repository");
        },
      },
    );

    expect(result.sessions[0]?.launchPreflight).toEqual({
      status: "ready",
      label: "Shared workspace",
      detail: "Workspace is not Git; will launch in the selected folder.",
      isolation: "shared",
    });
  });
});
