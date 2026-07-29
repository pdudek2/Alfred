import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applyAgentWorktreePatch,
  cleanupAgentWorktree,
  inspectAgentWorktree,
  isAlfredManagedBranchName,
  prepareAgentWorktree,
  preflightAgentWorktree,
  workspaceRootFingerprint,
} from "./git-worktree.js";

describe("git worktree preparation", () => {
  it("creates a stable opaque workspace root fingerprint", () => {
    expect(workspaceRootFingerprint("/repo")).toMatch(/^[a-f0-9]{16}$/);
    expect(workspaceRootFingerprint("/repo")).toBe(workspaceRootFingerprint("/repo/."));
    expect(workspaceRootFingerprint("/repo")).not.toBe(workspaceRootFingerprint("/other"));
  });

  it("uses the same fingerprint for filesystem aliases of one workspace root", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "alfred-workspace-fingerprint-"));
    const workspaceRoot = path.join(temporaryRoot, "workspace-a");
    const otherRoot = path.join(temporaryRoot, "workspace-b");
    const aliasRoot = path.join(temporaryRoot, "workspace-alias");

    try {
      await mkdir(workspaceRoot);
      await mkdir(otherRoot);
      await symlink(workspaceRoot, aliasRoot);

      expect(workspaceRootFingerprint(aliasRoot)).toBe(workspaceRootFingerprint(workspaceRoot));
      expect(workspaceRootFingerprint(workspaceRoot)).not.toBe(workspaceRootFingerprint(otherRoot));
      expect(workspaceRootFingerprint(aliasRoot)).toMatch(/^[a-f0-9]{16}$/);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["alfred-codex-session-20260729120000-abcd1234", true],
    ["feature/customer-secret", false],
    ["../alfred-codex-session", false],
  ])("validates Alfred-managed recovery branch %s", (branchName, expected) => {
    expect(isAlfredManagedBranchName(branchName)).toBe(expected);
  });

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
        worktreeStoreRoot: "/Users/patryk/Library/Application Support/Alfred/worktrees",
      },
    );

    expect(result).toEqual({
      baseCwd: "/Users/patryk/Desktop/Alfred",
      branchName: "alfred-codex-codex-1-20260509191530-abc123",
      cwd: "/Users/patryk/Library/Application Support/Alfred/worktrees/alfred-44c8fe0e/alfred-codex-codex-1-20260509191530-abc123",
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
        "/Users/patryk/Library/Application Support/Alfred/worktrees/alfred-44c8fe0e/alfred-codex-codex-1-20260509191530-abc123",
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
      { agentKind: "claude", branchName: "alfred-claude-review", clientId: "Review", cwd: "/repo/apps/client" },
      { execFile },
    );

    expect(result).toEqual({
      baseCwd: "/repo",
      branchName: "alfred-claude-review",
      cwd: "/.alfred-worktrees/repo/alfred-claude-review/apps/client",
    });
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it("keeps the legacy sibling worktree path when no managed root is supplied", async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes("rev-parse")) return { stdout: "/repo\n", stderr: "" };
      if (args.includes("status")) return { stdout: "", stderr: "" };
      return { stdout: "prepared\n", stderr: "" };
    });

    const result = await prepareAgentWorktree(
      { agentKind: "codex", branchName: "alfred-codex-review", clientId: "codex-1", cwd: "/repo" },
      {
        execFile,
        mkdir: vi.fn(async () => undefined),
      },
    );

    expect(result.cwd).toBe("/.alfred-worktrees/repo/alfred-codex-review");
  });

  it("preflights launch cwd under the managed worktree store root", async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes("rev-parse")) return { stdout: "/Users/patryk/Desktop/Alfred\n", stderr: "" };
      if (args.includes("status")) return { stdout: "", stderr: "" };
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    });

    const result = await preflightAgentWorktree(
      { agentKind: "claude", branchName: "alfred-claude-review", clientId: "Review", cwd: "/Users/patryk/Desktop/Alfred/apps/client" },
      {
        execFile,
        worktreeStoreRoot: "/Users/patryk/Library/Application Support/Alfred/worktrees",
      },
    );

    expect(result).toEqual({
      baseCwd: "/Users/patryk/Desktop/Alfred",
      branchName: "alfred-claude-review",
      cwd: "/Users/patryk/Library/Application Support/Alfred/worktrees/alfred-44c8fe0e/alfred-claude-review/apps/client",
    });
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

  it("removes an isolated worktree and deletes its merged branch without forcing", async () => {
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));

    await cleanupAgentWorktree(
      { baseCwd: "/repo", branchName: "alfred-codex-review" },
      { execFile },
    );

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "git",
      ["-C", "/repo", "worktree", "remove", "/.alfred-worktrees/repo/alfred-codex-review"],
      expect.any(Object),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "git",
      ["-C", "/repo", "branch", "-d", "alfred-codex-review"],
      expect.any(Object),
    );
  });

  it("force-removes a discarded isolated worktree and branch", async () => {
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));

    await cleanupAgentWorktree(
      { baseCwd: "/repo", branchName: "alfred-codex-review", force: true },
      { execFile },
    );

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "git",
      ["-C", "/repo", "worktree", "remove", "--force", "/.alfred-worktrees/repo/alfred-codex-review"],
      expect.any(Object),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "git",
      ["-C", "/repo", "branch", "-D", "alfred-codex-review"],
      expect.any(Object),
    );
  });

  it("cleans a restored legacy worktree using its saved cwd even when a managed root is configured", async () => {
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));

    await cleanupAgentWorktree(
      {
        baseCwd: "/repo",
        branchName: "alfred-codex-review",
        cwd: "/.alfred-worktrees/repo/alfred-codex-review/packages/app",
        force: true,
      },
      { execFile, worktreeStoreRoot: "/managed/worktrees" },
    );

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "git",
      ["-C", "/repo", "worktree", "remove", "--force", "/.alfred-worktrees/repo/alfred-codex-review"],
      expect.any(Object),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "git",
      ["-C", "/repo", "branch", "-D", "alfred-codex-review"],
      expect.any(Object),
    );
  });

  it("cleans a restored managed worktree using its saved cwd", async () => {
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));

    await cleanupAgentWorktree(
      {
        baseCwd: "/Users/patryk/Desktop/Alfred",
        branchName: "alfred-codex-review",
        cwd: "/managed/worktrees/alfred-44c8fe0e/alfred-codex-review/apps/client",
        force: true,
      },
      { execFile, worktreeStoreRoot: "/managed/worktrees" },
    );

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "git",
      [
        "-C",
        "/Users/patryk/Desktop/Alfred",
        "worktree",
        "remove",
        "--force",
        "/managed/worktrees/alfred-44c8fe0e/alfred-codex-review",
      ],
      expect.any(Object),
    );
  });

  it("rejects unsafe cleanup branch names before running git", async () => {
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));

    await expect(
      cleanupAgentWorktree(
        { baseCwd: "/repo", branchName: "../escape", cwd: "/.alfred-worktrees/repo/escape", force: true },
        { execFile, worktreeStoreRoot: "/managed/worktrees" },
      ),
    ).rejects.toThrow("Unsafe isolated Git worktree branch name.");

    expect(execFile).not.toHaveBeenCalled();
  });

  it("rejects cleanup cwd values outside known worktree roots before running git", async () => {
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));

    await expect(
      cleanupAgentWorktree(
        {
          baseCwd: "/repo",
          branchName: "alfred-codex-review",
          cwd: "/managed/worktrees/other-project/alfred-codex-review",
          force: true,
        },
        { execFile, worktreeStoreRoot: "/managed/worktrees" },
      ),
    ).rejects.toThrow("Unsafe isolated Git worktree cleanup path.");

    expect(execFile).not.toHaveBeenCalled();
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

  it("inspects isolated worktree tracked and untracked changes from the managed root", async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes("status")) {
        return { stdout: " M apps/desktop/src/renderer/app.tsx\0?? notes/review.md\0", stderr: "" };
      }
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    });

    const result = await inspectAgentWorktree(
      {
        baseCwd: "/Users/patryk/Desktop/Alfred",
        branchName: "alfred-codex-review",
        cwd: "/managed/worktrees/alfred-44c8fe0e/alfred-codex-review/apps/desktop",
      },
      { execFile, worktreeStoreRoot: "/managed/worktrees" },
    );

    expect(result).toEqual({
      summary: "2 changed files",
      files: [
        { path: "apps/desktop/src/renderer/app.tsx", status: "M" },
        { path: "notes/review.md", status: "??" },
      ],
    });
    expect(execFile).toHaveBeenCalledWith(
      "git",
      [
        "-C",
        "/managed/worktrees/alfred-44c8fe0e/alfred-codex-review",
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ],
      expect.any(Object),
    );
  });

  it("applies clean isolated worktree changes into a clean base workspace", async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const cwd = args[1];
      if (cwd === "/repo" && args.includes("status")) return { stdout: "", stderr: "" };
      if (cwd === "/.alfred-worktrees/repo/alfred-codex-review" && args.includes("status")) {
        return { stdout: " M src/app.tsx\0?? notes/review.md\0", stderr: "" };
      }
      if (args.includes("diff")) return { stdout: "", stderr: "" };
      if (args.includes("apply")) return { stdout: "", stderr: "" };
      if (args.includes("ls-files")) return { stdout: "notes/review.md\0", stderr: "" };
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    });
    const copyFile = vi.fn(async () => undefined);
    const mkdir = vi.fn(async () => undefined);
    const rm = vi.fn(async () => undefined);

    const result = await applyAgentWorktreePatch(
      { baseCwd: "/repo", branchName: "alfred-codex-review" },
      { copyFile, execFile, mkdir, rm },
    );

    expect(result).toEqual({ appliedFiles: 2 });
    expect(execFile).toHaveBeenCalledWith(
      "git",
      [
        "-C",
        "/.alfred-worktrees/repo/alfred-codex-review",
        "diff",
        "--binary",
        "HEAD",
        expect.stringMatching(/^--output=/),
      ],
      expect.any(Object),
    );
    expect(execFile).toHaveBeenCalledWith(
      "git",
      [
        "-C",
        "/repo",
        "apply",
        "--check",
        "--3way",
        "--whitespace=nowarn",
        expect.stringContaining("alfred-codex-review"),
      ],
      expect.any(Object),
    );
    expect(execFile).toHaveBeenCalledWith(
      "git",
      [
        "-C",
        "/repo",
        "apply",
        "--3way",
        "--whitespace=nowarn",
        expect.stringContaining("alfred-codex-review"),
      ],
      expect.any(Object),
    );
    expect(copyFile).toHaveBeenCalledWith(
      "/.alfred-worktrees/repo/alfred-codex-review/notes/review.md",
      "/repo/notes/review.md",
      expect.any(Number),
    );
    expect(mkdir).toHaveBeenCalledWith("/repo/notes", { recursive: true });
    expect(rm).toHaveBeenCalledWith(expect.stringContaining("alfred-codex-review"), { force: true });
  });

  it("allows untracked files under directories created by the tracked patch", async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const cwd = args[1];
      if (cwd === "/repo" && args.includes("status")) return { stdout: "", stderr: "" };
      if (cwd === "/.alfred-worktrees/repo/alfred-codex-review" && args.includes("status")) {
        return { stdout: " D notes\0?? notes/review.md\0", stderr: "" };
      }
      if (args.includes("diff")) return { stdout: "", stderr: "" };
      if (args.includes("apply")) return { stdout: "", stderr: "" };
      if (args.includes("ls-files")) return { stdout: "notes/review.md\0", stderr: "" };
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    });
    const lstat = vi.fn(async () => {
      throw Object.assign(new Error("not a directory"), { code: "ENOTDIR" });
    });
    const copyFile = vi.fn(async () => undefined);
    const mkdir = vi.fn(async () => undefined);

    const result = await applyAgentWorktreePatch(
      { baseCwd: "/repo", branchName: "alfred-codex-review" },
      { copyFile, execFile, lstat, mkdir, rm: vi.fn(async () => undefined) },
    );

    expect(result).toEqual({ appliedFiles: 2 });
    expect(lstat).toHaveBeenCalledWith("/repo/notes/review.md");
    expect(copyFile).toHaveBeenCalledWith(
      "/.alfred-worktrees/repo/alfred-codex-review/notes/review.md",
      "/repo/notes/review.md",
      expect.any(Number),
    );
  });

  it("blocks untracked files under a base file when the tracked patch does not replace that parent", async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      const cwd = args[1];
      if (cwd === "/repo" && args.includes("status")) return { stdout: "", stderr: "" };
      if (cwd === "/.alfred-worktrees/repo/alfred-codex-review" && args.includes("status")) {
        return { stdout: " M src/app.tsx\0?? notes/review.md\0", stderr: "" };
      }
      if (args.includes("ls-files")) return { stdout: "notes/review.md\0", stderr: "" };
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    });
    const lstat = vi.fn(async () => {
      throw Object.assign(new Error("not a directory"), { code: "ENOTDIR" });
    });

    await expect(
      applyAgentWorktreePatch(
        { baseCwd: "/repo", branchName: "alfred-codex-review" },
        { execFile, lstat },
      ),
    ).rejects.toThrow("Base workspace already has a file blocking notes/review.md.");

    expect(execFile).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["apply"]),
      expect.any(Object),
    );
  });

  it("blocks applying an isolated worktree when the base workspace is dirty", async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args[1] === "/repo" && args.includes("status")) {
        return { stdout: " M README.md\0", stderr: "" };
      }
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    });

    await expect(
      applyAgentWorktreePatch(
        { baseCwd: "/repo", branchName: "alfred-codex-review" },
        { execFile },
      ),
    ).rejects.toThrow("Base workspace has local changes.");

    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe apply metadata before running git", async () => {
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));

    await expect(
      applyAgentWorktreePatch(
        { baseCwd: "/repo", branchName: "../escape", cwd: "/.alfred-worktrees/repo/escape" },
        { execFile, worktreeStoreRoot: "/managed/worktrees" },
      ),
    ).rejects.toThrow("Unsafe isolated Git worktree branch name.");

    expect(execFile).not.toHaveBeenCalled();
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
