import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import { prepareAgentWorktree, preflightAgentWorktree } from "./git-worktree.js";

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

  it("preflights the exact branch and cwd without creating the worktree", async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes("rev-parse")) return { stdout: "/repo\n", stderr: "" };
      if (args.includes("status")) return { stdout: "", stderr: "" };
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    });

    const result = await preflightAgentWorktree(
      { agentKind: "claude", branchName: "alfred-claude-review", clientId: "Review", cwd: "/repo/apps/web" },
      { execFile },
    );

    expect(result).toEqual({
      baseCwd: "/repo",
      branchName: "alfred-claude-review",
      cwd: "/.alfred-worktrees/repo/alfred-claude-review/apps/web",
    });
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it("preserves a preflighted launch branch during worktree creation", async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes("rev-parse")) return { stdout: "/repo\n", stderr: "" };
      if (args.includes("status")) return { stdout: "", stderr: "" };
      if (args.includes("worktree")) return { stdout: "prepared\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });
    const branchName = "alfred-codex-codex-backend-code-quality-analysis-20260513213856-2069afba";

    const result = await prepareAgentWorktree(
      { agentKind: "codex", branchName, clientId: "alfred-1", cwd: "/repo" },
      {
        execFile,
        mkdir: vi.fn(async () => undefined),
      },
    );

    expect(result).toEqual({
      baseCwd: "/repo",
      branchName,
      cwd: `/.alfred-worktrees/repo/${branchName}`,
    });
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["-C", "/repo", "worktree", "add", "-b", branchName, `/.alfred-worktrees/repo/${branchName}`, "HEAD"],
      expect.any(Object),
    );
  });

  it("applies tracked dirty workspace changes into the isolated worktree", async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes("rev-parse")) return { stdout: "/repo\n", stderr: "" };
      if (args.includes("status")) return { stdout: " M apps/desktop/src/renderer/app.tsx\n", stderr: "" };
      if (args.includes("worktree")) return { stdout: "prepared\n", stderr: "" };
      if (args.includes("diff")) return { stdout: "", stderr: "" };
      if (args.includes("apply")) return { stdout: "", stderr: "" };
      return { stdout: "", stderr: "" };
    });
    const rm = vi.fn(async () => undefined);

    const result = await prepareAgentWorktree(
      { agentKind: "claude", clientId: "claude-1", cwd: "/repo" },
      {
        execFile,
        mkdir: vi.fn(async () => undefined),
        now: () => new Date("2026-05-09T19:15:30.000Z"),
        randomSuffix: () => "abc123",
        rm,
      },
    );

    const patchPath = `${os.tmpdir()}/alfred-claude-claude-1-20260509191530-abc123.patch`;
    expect(result.snapshot).toEqual({ trackedChanges: true, untrackedFiles: 0 });
    expect(execFile).toHaveBeenCalledWith(
      "git",
      [
        "-C",
        "/repo",
        "diff",
        "--binary",
        "HEAD",
        `--output=${patchPath}`,
      ],
      expect.any(Object),
    );
    expect(execFile).toHaveBeenCalledWith(
      "git",
      [
        "-C",
        "/.alfred-worktrees/repo/alfred-claude-claude-1-20260509191530-abc123",
        "apply",
        "--whitespace=nowarn",
        patchPath,
      ],
      expect.any(Object),
    );
    expect(rm).toHaveBeenCalledWith(patchPath, { force: true });
  });

  it("copies untracked workspace files into the isolated worktree snapshot", async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes("rev-parse")) return { stdout: "/repo\n", stderr: "" };
      if (args.includes("status")) return { stdout: "?? scratch.md\n?? notes/todo.md\n", stderr: "" };
      if (args.includes("worktree")) return { stdout: "prepared\n", stderr: "" };
      if (args.includes("ls-files")) return { stdout: "scratch.md\0notes/todo.md\0", stderr: "" };
      return { stdout: "", stderr: "" };
    });
    const mkdir = vi.fn(async () => undefined);
    const copyFile = vi.fn(async () => undefined);

    const result = await prepareAgentWorktree(
      { agentKind: "codex", clientId: "codex-1", cwd: "/repo" },
      {
        copyFile,
        execFile,
        mkdir,
        now: () => new Date("2026-05-09T19:15:30.000Z"),
        randomSuffix: () => "abc123",
      },
    );

    expect(result.snapshot).toEqual({ trackedChanges: false, untrackedFiles: 2 });
    expect(copyFile).toHaveBeenCalledWith(
      "/repo/scratch.md",
      "/.alfred-worktrees/repo/alfred-codex-codex-1-20260509191530-abc123/scratch.md",
    );
    expect(copyFile).toHaveBeenCalledWith(
      "/repo/notes/todo.md",
      "/.alfred-worktrees/repo/alfred-codex-codex-1-20260509191530-abc123/notes/todo.md",
    );
    expect(mkdir).toHaveBeenCalledWith(
      "/.alfred-worktrees/repo/alfred-codex-codex-1-20260509191530-abc123/notes",
      { recursive: true },
    );
  });

  it("still blocks isolated launch for unresolved merge conflicts", async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes("rev-parse")) return { stdout: "/repo\n", stderr: "" };
      if (args.includes("status")) return { stdout: "UU apps/desktop/src/renderer/app.tsx\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });

    await expect(prepareAgentWorktree({ agentKind: "codex", clientId: "codex-1", cwd: "/repo" }, { execFile }))
      .rejects.toThrow("Workspace has unresolved merge conflicts.");
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
