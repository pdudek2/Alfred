import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWorkTree, worktreesOf } from "./git-work-tree.js";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-C", cwd, ...args], { stdio: "pipe" });

describe("git work tree", () => {
  let dir: string;
  let repo: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "alfred-work-tree-")));
    repo = path.join(dir, "repo");
    await mkdir(path.join(repo, "src"), { recursive: true });
    git(repo, "init", "-b", "main");
    git(repo, "commit", "--allow-empty", "-m", "first");
    git(repo, "worktree", "add", "-b", "fix", ".worktrees/fix");
    git(repo, "worktree", "add", "--detach", path.join(dir, "detached"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("names the worktree and branch a folder belongs to", async () => {
    await expect(resolveWorkTree(path.join(repo, "src"))).resolves.toEqual({ root: repo, branch: "main" });
    await expect(resolveWorkTree(path.join(repo, ".worktrees/fix"))).resolves.toEqual({ root: path.join(repo, ".worktrees/fix"), branch: "fix" });
    await expect(resolveWorkTree(path.join(dir, "detached"))).resolves.toEqual({ root: path.join(dir, "detached") });
    await expect(resolveWorkTree(dir)).resolves.toBeUndefined();
  });

  it("lists a project's worktrees only when the project is a worktree root", async () => {
    expect((await worktreesOf(repo)).sort()).toEqual([path.join(dir, "detached"), repo, path.join(repo, ".worktrees/fix")]);
    await expect(worktreesOf(path.join(repo, "src"))).resolves.toEqual([]);
    await expect(worktreesOf(dir)).resolves.toEqual([]);
  });
});
