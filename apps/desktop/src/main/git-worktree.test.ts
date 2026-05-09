import { describe, expect, it, vi } from "vitest";
import { prepareAgentWorktree } from "./git-worktree.js";

describe("git worktree preparation", () => {
  it("creates a unique isolated worktree branch for agent sessions", async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes("rev-parse")) return { stdout: "/Users/patryk/Desktop/Alfred\n", stderr: "" };
      if (args.includes("status")) return { stdout: "", stderr: "" };
      return { stdout: "prepared\n", stderr: "" };
    });

    const result = await prepareAgentWorktree(
      { agentKind: "codex", clientId: "codex-1", cwd: "/Users/patryk/Desktop/Alfred" },
      {
        execFile,
        mkdir: vi.fn(async () => undefined),
        now: () => new Date("2026-05-09T19:15:30.000Z"),
        randomSuffix: () => "abc123",
      },
    );

    expect(result).toEqual({
      baseCwd: "/Users/patryk/Desktop/Alfred",
      branchName: "alfred-codex-codex-1-20260509191530-abc123",
      cwd: "/Users/patryk/Desktop/.alfred-worktrees/Alfred/alfred-codex-codex-1-20260509191530-abc123",
    });
    expect(execFile).toHaveBeenLastCalledWith(
      "git",
      [
        "-C",
        "/Users/patryk/Desktop/Alfred",
        "worktree",
        "add",
        "-b",
        "alfred-codex-codex-1-20260509191530-abc123",
        "/Users/patryk/Desktop/.alfred-worktrees/Alfred/alfred-codex-codex-1-20260509191530-abc123",
        "HEAD",
      ],
      expect.any(Object),
    );
  });

  it("blocks isolated agent launch when the base workspace is dirty", async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes("rev-parse")) return { stdout: "/repo\n", stderr: "" };
      if (args.includes("status")) return { stdout: " M apps/desktop/src/renderer/app.tsx\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });

    await expect(prepareAgentWorktree({ agentKind: "claude", clientId: "claude-1", cwd: "/repo" }, { execFile }))
      .rejects.toThrow("Workspace has uncommitted or untracked changes.");
  });

  it("uses the same clear preflight message for untracked files", async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes("rev-parse")) return { stdout: "/repo\n", stderr: "" };
      if (args.includes("status")) return { stdout: "?? scratch.md\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });

    await expect(prepareAgentWorktree({ agentKind: "codex", clientId: "codex-1", cwd: "/repo" }, { execFile }))
      .rejects.toThrow("git stash -u");
  });

  it("preserves the launch subdirectory inside the isolated worktree", async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes("rev-parse")) return { stdout: "/repo\n", stderr: "" };
      if (args.includes("status")) return { stdout: "", stderr: "" };
      return { stdout: "prepared\n", stderr: "" };
    });

    const result = await prepareAgentWorktree(
      { agentKind: "codex", clientId: "codex-1", cwd: "/repo/packages/app" },
      {
        execFile,
        mkdir: vi.fn(async () => undefined),
        now: () => new Date("2026-05-09T19:15:30.000Z"),
        randomSuffix: () => "abc123",
      },
    );

    expect(result).toMatchObject({
      baseCwd: "/repo",
      cwd: "/.alfred-worktrees/repo/alfred-codex-codex-1-20260509191530-abc123/packages/app",
    });
  });

  it("returns a clear error when the workspace is not a Git repository", async () => {
    const execFile = vi.fn(async () => {
      throw new Error("fatal: not a git repository");
    });

    await expect(prepareAgentWorktree({ agentKind: "codex", clientId: "codex-1", cwd: "/tmp/project" }, { execFile }))
      .rejects.toThrow("Workspace is not a Git repository.");
  });
});
