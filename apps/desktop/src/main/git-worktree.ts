import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentKind } from "../shared/alfred-ipc.js";

type ExecFile = (
  file: string,
  args: string[],
  options?: { cwd?: string | undefined; timeout?: number | undefined },
) => Promise<{ stdout: string; stderr: string }>;

type PrepareAgentWorktreeOptions = {
  execFile?: ExecFile;
  mkdir?: typeof mkdir;
  now?: () => Date;
  randomSuffix?: () => string;
};

export type AgentWorktreeRequest = {
  agentKind?: AgentKind | undefined;
  branchName?: string | undefined;
  clientId?: string | undefined;
  cwd: string;
};

export type AgentWorktreeResult = {
  baseCwd: string;
  branchName: string;
  cwd: string;
};

const execFile = promisify(execFileCallback) as ExecFile;

export async function prepareAgentWorktree(
  request: AgentWorktreeRequest,
  options: PrepareAgentWorktreeOptions = {},
): Promise<AgentWorktreeResult> {
  const result = await preflightAgentWorktree(request, options);
  const run = options.execFile ?? execFile;
  const mkdirImpl = options.mkdir ?? mkdir;
  const worktreePath = worktreeRootPath(result);

  await mkdirImpl(path.dirname(worktreePath), { recursive: true });
  await gitOutput(
    run,
    ["-C", result.baseCwd, "worktree", "add", "-b", result.branchName, worktreePath, "HEAD"],
    "Unable to create isolated Git worktree.",
  );

  return result;
}

export async function preflightAgentWorktree(
  request: AgentWorktreeRequest,
  options: Pick<PrepareAgentWorktreeOptions, "execFile" | "now" | "randomSuffix"> = {},
): Promise<AgentWorktreeResult> {
  const run = options.execFile ?? execFile;
  const gitRoot = await gitOutput(run, ["-C", request.cwd, "rev-parse", "--show-toplevel"], "Workspace is not a Git repository.");
  const relativeLaunchPath = safeRelativePath(gitRoot, path.resolve(request.cwd));
  const status = await gitOutput(run, ["-C", gitRoot, "status", "--porcelain"], "Unable to inspect Git workspace status.");

  if (status.length > 0) {
    throw new Error(
      "Workspace has uncommitted or untracked changes. Commit, stash with git stash -u, or clean them before launching isolated agent sessions.",
    );
  }

  const branchName = request.branchName ? sanitizeBranchSegment(request.branchName) : createAgentBranchName(request, options);
  const worktreePath = path.join(path.dirname(gitRoot), ".alfred-worktrees", path.basename(gitRoot), branchName);
  const launchCwd = relativeLaunchPath ? path.join(worktreePath, relativeLaunchPath) : worktreePath;

  return {
    baseCwd: gitRoot,
    branchName,
    cwd: launchCwd,
  };
}

function worktreeRootPath(result: AgentWorktreeResult): string {
  return path.join(path.dirname(result.baseCwd), ".alfred-worktrees", path.basename(result.baseCwd), result.branchName);
}

function safeRelativePath(root: string, cwd: string): string {
  const relative = path.relative(root, cwd);
  if (!relative || relative === ".") return "";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return relative;
}

function createAgentBranchName(
  request: AgentWorktreeRequest,
  options: Pick<PrepareAgentWorktreeOptions, "now" | "randomSuffix">,
): string {
  const agent = sanitizeBranchSegment(request.agentKind ?? "agent");
  const client = sanitizeBranchSegment(request.clientId ?? "session");
  const timestamp = (options.now?.() ?? new Date()).toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = sanitizeBranchSegment(options.randomSuffix?.() ?? randomUUID().slice(0, 8));

  return ["alfred", agent, client, timestamp, suffix].filter(Boolean).join("-");
}

function sanitizeBranchSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 48) || "session";
}

async function gitOutput(run: ExecFile, args: string[], fallbackMessage: string): Promise<string> {
  try {
    const { stdout } = await run("git", args, { cwd: os.homedir(), timeout: 2_500 });
    return stdout.trim();
  } catch (error: unknown) {
    throw new Error(`${fallbackMessage} ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}
