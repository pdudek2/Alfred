import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
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
  copyFile?: typeof copyFile;
  execFile?: ExecFile;
  mkdir?: typeof mkdir;
  now?: () => Date;
  randomSuffix?: () => string;
  rm?: typeof rm;
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
  snapshot?: AgentWorktreeSnapshot;
};

export type AgentWorktreeSnapshot = {
  trackedChanges: boolean;
  untrackedFiles: number;
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
  await applyDirtySnapshot(result, options);

  return result;
}

export async function preflightAgentWorktree(
  request: AgentWorktreeRequest,
  options: Pick<PrepareAgentWorktreeOptions, "execFile" | "now" | "randomSuffix"> = {},
): Promise<AgentWorktreeResult> {
  const run = options.execFile ?? execFile;
  const gitRoot = await gitOutput(run, ["-C", request.cwd, "rev-parse", "--show-toplevel"], "Workspace is not a Git repository.");
  const relativeLaunchPath = safeRelativePath(gitRoot, path.resolve(request.cwd));
  const status = await gitOutput(
    run,
    ["-C", gitRoot, "status", "--porcelain", "--untracked-files=all"],
    "Unable to inspect Git workspace status.",
  );
  const snapshot = dirtySnapshotFromStatus(status);

  const branchName = request.branchName ? sanitizeBranchSegment(request.branchName) : createAgentBranchName(request, options);
  const worktreePath = path.join(path.dirname(gitRoot), ".alfred-worktrees", path.basename(gitRoot), branchName);
  const launchCwd = relativeLaunchPath ? path.join(worktreePath, relativeLaunchPath) : worktreePath;

  return {
    baseCwd: gitRoot,
    branchName,
    cwd: launchCwd,
    ...(snapshot === null ? {} : { snapshot }),
  };
}

async function applyDirtySnapshot(
  result: AgentWorktreeResult,
  options: Pick<PrepareAgentWorktreeOptions, "copyFile" | "execFile" | "mkdir" | "rm">,
): Promise<void> {
  if (!result.snapshot) return;

  const run = options.execFile ?? execFile;
  const mkdirImpl = options.mkdir ?? mkdir;
  const copyFileImpl = options.copyFile ?? copyFile;
  const rmImpl = options.rm ?? rm;
  const worktreePath = worktreeRootPath(result);

  if (result.snapshot.trackedChanges) {
    const patchPath = path.join(os.tmpdir(), `${result.branchName}.patch`);
    try {
      await gitOutput(
        run,
        ["-C", result.baseCwd, "diff", "--binary", "HEAD", `--output=${patchPath}`],
        "Unable to snapshot tracked workspace changes.",
      );
      await gitOutput(
        run,
        ["-C", worktreePath, "apply", "--whitespace=nowarn", patchPath],
        "Unable to apply tracked workspace snapshot.",
      );
    } finally {
      await rmImpl(patchPath, { force: true }).catch(() => undefined);
    }
  }

  if (result.snapshot.untrackedFiles === 0) return;

  const rawUntrackedPaths = await gitOutputRaw(
    run,
    ["-C", result.baseCwd, "ls-files", "--others", "--exclude-standard", "-z"],
    "Unable to snapshot untracked workspace files.",
  );
  for (const relativePath of splitNulOutput(rawUntrackedPaths)) {
    if (!safeSnapshotRelativePath(relativePath)) {
      throw new Error(`Unable to snapshot unsafe untracked path: ${relativePath}`);
    }

    const sourcePath = path.join(result.baseCwd, relativePath);
    const destinationPath = path.join(worktreePath, relativePath);
    await mkdirImpl(path.dirname(destinationPath), { recursive: true });
    await copyFileImpl(sourcePath, destinationPath);
  }
}

function dirtySnapshotFromStatus(status: string): AgentWorktreeSnapshot | null {
  if (!status.trim()) return null;

  const lines = status.split(/\r?\n/).filter(Boolean);
  const unmerged = lines.find(isUnmergedStatusLine);
  if (unmerged) {
    throw new Error("Workspace has unresolved merge conflicts. Resolve them before launching isolated agent sessions.");
  }

  const untrackedFiles = lines.filter((line) => line.startsWith("?? ")).length;
  const trackedChanges = lines.some((line) => !line.startsWith("?? "));

  return { trackedChanges, untrackedFiles };
}

function isUnmergedStatusLine(line: string): boolean {
  const code = line.slice(0, 2);
  return code.includes("U") || code === "AA" || code === "DD";
}

function splitNulOutput(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function safeSnapshotRelativePath(value: string): boolean {
  if (!value || path.isAbsolute(value)) return false;
  const normalized = path.normalize(value);
  return normalized !== ".." && !normalized.startsWith(`..${path.sep}`);
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
  return (await gitOutputRaw(run, args, fallbackMessage)).trim();
}

async function gitOutputRaw(run: ExecFile, args: string[], fallbackMessage: string): Promise<string> {
  try {
    const { stdout } = await run("git", args, { cwd: os.homedir(), timeout: 2_500 });
    return stdout;
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
