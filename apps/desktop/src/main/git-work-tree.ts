import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import type { TerminalWorkTree } from "../shared/terminal-ipc.js";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 1500;

/** The git worktree holding `folder` and its branch; none outside a repository, no branch on a detached HEAD. */
export async function resolveWorkTree(folder: string): Promise<TerminalWorkTree | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", folder, "rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"], {
      timeout: GIT_TIMEOUT_MS,
    });
    const [root, branch] = stdout.trim().split("\n");
    if (!root) return undefined;
    return branch && branch !== "HEAD" ? { root, branch } : { root };
  } catch {
    return undefined;
  }
}

/** Every worktree git lists for the repository whose own worktree `root` is; none when `root` is not one. */
export async function worktreesOf(root: string): Promise<string[]> {
  try {
    const [{ stdout }, canonicalRoot] = await Promise.all([
      execFileAsync("git", ["-C", root, "worktree", "list", "--porcelain"], { timeout: GIT_TIMEOUT_MS }),
      realpath(root),
    ]);
    const worktrees = stdout.split("\n").filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length));
    // A project inside a bigger repository must not open up that repository's other folders.
    return worktrees.includes(canonicalRoot) ? worktrees : [];
  } catch {
    return [];
  }
}
