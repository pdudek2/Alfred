import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, realpathSync } from "node:fs";
import { copyFile, lstat, mkdir, rm } from "node:fs/promises";
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
  lstat?: typeof lstat;
  mkdir?: typeof mkdir;
  now?: () => Date;
  randomSuffix?: () => string;
  rm?: typeof rm;
  worktreeStoreRoot?: string;
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

export type AgentWorktreeCleanupRequest = {
  baseCwd: string;
  branchName: string;
  cwd?: string;
  force?: boolean;
};

export type AgentWorktreeSnapshot = {
  trackedChanges: boolean;
  untrackedFiles: number;
};

export type AgentWorktreeChangeFile = {
  path: string;
  status: string;
};

export type AgentWorktreeInspection = {
  summary: string;
  files: AgentWorktreeChangeFile[];
  patch: string;
};

const execFile = promisify(execFileCallback) as ExecFile;

export function workspaceRootFingerprint(rootPath: string): string {
  return createHash("sha256")
    .update(canonicalPathIdentity(rootPath))
    .digest("hex")
    .slice(0, 16);
}

export function isAlfredManagedBranchName(value: string): boolean {
  try {
    return value.startsWith("alfred-") && safeCleanupBranchName(value) === value;
  } catch {
    return false;
  }
}

export async function prepareAgentWorktree(
  request: AgentWorktreeRequest,
  options: PrepareAgentWorktreeOptions = {},
): Promise<AgentWorktreeResult> {
  const result = await preflightAgentWorktree(request, options);
  const run = options.execFile ?? execFile;
  const mkdirImpl = options.mkdir ?? mkdir;
  const worktreePath = worktreeRootPath(result, options);

  await mkdirImpl(path.dirname(worktreePath), { recursive: true });
  await gitOutput(
    run,
    ["-C", result.baseCwd, "worktree", "add", "-b", result.branchName, worktreePath, "HEAD"],
    "Unable to create isolated Git worktree.",
  );
  await applyDirtySnapshot(result, options);

  return result;
}

export async function cleanupAgentWorktree(
  request: AgentWorktreeCleanupRequest,
  options: Pick<PrepareAgentWorktreeOptions, "execFile" | "worktreeStoreRoot"> = {},
): Promise<void> {
  const run = options.execFile ?? execFile;
  const cleanupTarget = resolveAgentWorktreeCleanupTarget(request, options);
  const removeArgs = ["-C", request.baseCwd, "worktree", "remove"];
  if (request.force) {
    removeArgs.push("--force");
  }
  removeArgs.push(cleanupTarget.worktreePath);

  await gitOutput(
    run,
    removeArgs,
    "Unable to remove isolated Git worktree.",
  );
  await gitOutput(
    run,
    ["-C", request.baseCwd, "branch", request.force ? "-D" : "-d", cleanupTarget.branchName],
    "Unable to delete isolated Git worktree branch.",
  );
}

export async function inspectAgentWorktree(
  request: AgentWorktreeCleanupRequest,
  options: Pick<PrepareAgentWorktreeOptions, "execFile" | "worktreeStoreRoot"> = {},
): Promise<AgentWorktreeInspection> {
  const run = options.execFile ?? execFile;
  const cleanupTarget = resolveAgentWorktreeCleanupTarget(request, options);
  const status = await gitOutputRaw(
    run,
    ["-C", cleanupTarget.worktreePath, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
    "Unable to inspect isolated Git worktree.",
  );
  const files = statusFilesFromPorcelainZ(status);
  const patch = await gitOutputRaw(
    run,
    ["-C", cleanupTarget.worktreePath, "diff", "--no-ext-diff", "--no-color", "--unified=3", "HEAD", "--"],
    "Unable to inspect isolated Git worktree diff.",
  );

  return {
    summary: changedFilesSummary(files.length),
    files,
    patch,
  };
}

export async function applyAgentWorktreePatch(
  request: AgentWorktreeCleanupRequest,
  options: Pick<PrepareAgentWorktreeOptions, "copyFile" | "execFile" | "lstat" | "mkdir" | "rm" | "worktreeStoreRoot"> = {},
): Promise<{ appliedFiles: number }> {
  const run = options.execFile ?? execFile;
  const rmImpl = options.rm ?? rm;
  const cleanupTarget = resolveAgentWorktreeCleanupTarget(request, options);
  const baseStatus = await gitOutputRaw(
    run,
    ["-C", request.baseCwd, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
    "Unable to inspect base workspace before apply.",
  );
  if (statusFilesFromPorcelainZ(baseStatus).length > 0) {
    throw new Error("Base workspace has local changes. Commit, stash, or discard them before applying an isolated checkout.");
  }

  const inspected = await inspectAgentWorktree(request, options);
  if (inspected.files.length === 0) {
    return { appliedFiles: 0 };
  }
  if (inspected.files.some((file) => isUnmergedStatusCode(file.status))) {
    throw new Error("Isolated checkout has unresolved merge conflicts. Resolve them before applying.");
  }

  const trackedFiles = inspected.files.filter((file) => file.status !== "??");
  const untrackedPaths = await isolatedUntrackedPaths(run, cleanupTarget.worktreePath);
  await assertUntrackedDestinationsAvailable(
    request.baseCwd,
    untrackedPaths,
    trackedFiles.map((file) => file.path),
    options.lstat ?? lstat,
  );

  if (trackedFiles.length > 0) {
    const patchPath = path.join(os.tmpdir(), `${cleanupTarget.branchName}-${randomUUID()}.alfred-apply.patch`);
    try {
      await gitOutput(
        run,
        ["-C", cleanupTarget.worktreePath, "diff", "--binary", "HEAD", `--output=${patchPath}`],
        "Unable to create isolated checkout patch.",
      );
      await gitOutput(
        run,
        ["-C", request.baseCwd, "apply", "--check", "--3way", "--whitespace=nowarn", patchPath],
        "Unable to verify isolated checkout patch.",
      );
      await gitOutput(
        run,
        ["-C", request.baseCwd, "apply", "--3way", "--whitespace=nowarn", patchPath],
        "Unable to apply isolated checkout patch.",
      );
    } finally {
      await rmImpl(patchPath, { force: true }).catch(() => undefined);
    }
  }

  await copyUntrackedWorktreeFiles(
    cleanupTarget.worktreePath,
    request.baseCwd,
    untrackedPaths,
    options,
  );

  return { appliedFiles: inspected.files.length };
}

export function isSafeAgentWorktreeCleanupRequest(
  request:
    | {
        baseCwd?: string | undefined;
        branchName?: string | undefined;
        cwd?: string | undefined;
      }
    | null
    | undefined,
  options: Pick<PrepareAgentWorktreeOptions, "worktreeStoreRoot"> = {},
): request is AgentWorktreeCleanupRequest {
  if (!request?.baseCwd || !request.branchName) return false;

  try {
    resolveAgentWorktreeCleanupTarget({
      baseCwd: request.baseCwd,
      branchName: request.branchName,
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    }, options);
    return true;
  } catch {
    return false;
  }
}

export async function preflightAgentWorktree(
  request: AgentWorktreeRequest,
  options: Pick<PrepareAgentWorktreeOptions, "execFile" | "now" | "randomSuffix" | "worktreeStoreRoot"> = {},
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

  const branchName = request.branchName ? sanitizeBranchName(request.branchName) : createAgentBranchName(request, options);
  const worktreePath = worktreeRootPath({ baseCwd: gitRoot, branchName }, options);
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
  options: Pick<PrepareAgentWorktreeOptions, "copyFile" | "execFile" | "mkdir" | "rm" | "worktreeStoreRoot">,
): Promise<void> {
  if (!result.snapshot) return;

  const run = options.execFile ?? execFile;
  const mkdirImpl = options.mkdir ?? mkdir;
  const copyFileImpl = options.copyFile ?? copyFile;
  const rmImpl = options.rm ?? rm;
  const worktreePath = worktreeRootPath(result, options);

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

function statusFilesFromPorcelainZ(status: string): AgentWorktreeChangeFile[] {
  const entries = splitNulOutput(status);
  const files: AgentWorktreeChangeFile[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || entry.length < 4) continue;

    const statusCode = entry.slice(0, 2);
    const relativePath = entry.slice(3);
    if (!safeSnapshotRelativePath(relativePath)) {
      throw new Error(`Unsafe isolated Git worktree path: ${relativePath}`);
    }

    files.push({
      path: relativePath,
      status: statusCode.trim() || "modified",
    });

    if (statusCode.includes("R") || statusCode.includes("C")) {
      index += 1;
    }
  }

  return files;
}

function changedFilesSummary(count: number): string {
  return `${count} changed file${count === 1 ? "" : "s"}`;
}

function isUnmergedStatusCode(status: string): boolean {
  return status.includes("U") || status === "AA" || status === "DD";
}

async function isolatedUntrackedPaths(run: ExecFile, worktreePath: string): Promise<string[]> {
  const rawUntrackedPaths = await gitOutputRaw(
    run,
    ["-C", worktreePath, "ls-files", "--others", "--exclude-standard", "-z"],
    "Unable to inspect isolated checkout untracked files.",
  );
  return splitNulOutput(rawUntrackedPaths).map((relativePath) => {
    if (!safeSnapshotRelativePath(relativePath)) {
      throw new Error(`Unsafe isolated Git worktree path: ${relativePath}`);
    }
    return relativePath;
  });
}

async function assertUntrackedDestinationsAvailable(
  baseCwd: string,
  relativePaths: string[],
  trackedPaths: string[],
  lstatImpl: typeof lstat,
): Promise<void> {
  for (const relativePath of relativePaths) {
    const destinationPath = path.join(baseCwd, relativePath);
    const state = await destinationPathState(destinationPath, lstatImpl);
    if (state === "exists") {
      throw new Error(`Base workspace already has a file at ${relativePath}. Remove it before applying this isolated checkout.`);
    }
    if (state === "blocked-by-file-parent" && !hasTrackedPathAncestor(relativePath, trackedPaths)) {
      throw new Error(`Base workspace already has a file blocking ${relativePath}. Remove it before applying this isolated checkout.`);
    }
  }
}

async function destinationPathState(
  filePath: string,
  lstatImpl: typeof lstat,
): Promise<"exists" | "missing" | "blocked-by-file-parent"> {
  try {
    await lstatImpl(filePath);
    return "exists";
  } catch (error: unknown) {
    if (isFsErrorCode(error, "ENOENT")) return "missing";
    // Legal when the tracked patch replaces that parent file with a directory before untracked copies run.
    if (isFsErrorCode(error, "ENOTDIR")) return "blocked-by-file-parent";
    throw error;
  }
}

function isFsErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function hasTrackedPathAncestor(relativePath: string, trackedPaths: string[]): boolean {
  const normalizedPath = path.normalize(relativePath);
  return trackedPaths.some((trackedPath) => {
    const normalizedTrackedPath = path.normalize(trackedPath);
    return normalizedPath === normalizedTrackedPath || normalizedPath.startsWith(`${normalizedTrackedPath}${path.sep}`);
  });
}

async function copyUntrackedWorktreeFiles(
  worktreePath: string,
  baseCwd: string,
  relativePaths: string[],
  options: Pick<PrepareAgentWorktreeOptions, "copyFile" | "mkdir">,
): Promise<void> {
  const copyFileImpl = options.copyFile ?? copyFile;
  const mkdirImpl = options.mkdir ?? mkdir;

  for (const relativePath of relativePaths) {
    const sourcePath = path.join(worktreePath, relativePath);
    const destinationPath = path.join(baseCwd, relativePath);
    await mkdirImpl(path.dirname(destinationPath), { recursive: true });
    await copyFileImpl(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL);
  }
}

function safeSnapshotRelativePath(value: string): boolean {
  if (!value || path.isAbsolute(value)) return false;
  const normalized = path.normalize(value);
  return normalized !== ".." && !normalized.startsWith(`..${path.sep}`);
}

export function managedProjectWorktreeRoot(worktreeStoreRoot: string, baseCwd: string): string {
  return path.join(path.resolve(worktreeStoreRoot), projectWorktreeKey(baseCwd));
}

export function projectWorktreeRoots(baseCwd: string, worktreeStoreRoot?: string): string[] {
  const roots = [];
  if (worktreeStoreRoot?.trim()) {
    roots.push(managedProjectWorktreeRoot(worktreeStoreRoot, baseCwd));
  }
  roots.push(legacyProjectWorktreeRoot(baseCwd));
  return roots;
}

function worktreeRootPath(
  result: Pick<AgentWorktreeResult, "baseCwd" | "branchName">,
  options: Pick<PrepareAgentWorktreeOptions, "worktreeStoreRoot"> = {},
): string {
  if (options.worktreeStoreRoot?.trim()) {
    return path.join(managedProjectWorktreeRoot(options.worktreeStoreRoot, result.baseCwd), result.branchName);
  }

  return path.join(legacyProjectWorktreeRoot(result.baseCwd), result.branchName);
}

function projectWorktreeKey(baseCwd: string): string {
  const canonicalBaseCwd = canonicalPathIdentity(baseCwd);
  const basename = sanitizeWorktreePathSegment(path.basename(canonicalBaseCwd) || "workspace");
  const hash = createHash("sha256").update(canonicalBaseCwd).digest("hex").slice(0, 8);
  return `${basename}-${hash}`;
}

function sanitizeWorktreePathSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 48) || "workspace";
}

function legacyProjectWorktreeRoot(baseCwd: string): string {
  return path.join(path.dirname(baseCwd), ".alfred-worktrees", path.basename(baseCwd));
}

function resolveAgentWorktreeCleanupTarget(
  request: AgentWorktreeCleanupRequest,
  options: Pick<PrepareAgentWorktreeOptions, "worktreeStoreRoot"> = {},
): { branchName: string; worktreePath: string } {
  const branchName = safeCleanupBranchName(request.branchName);
  const projectRoots = cleanupProjectRoots(request.baseCwd, options);
  const candidateWorktreeRoots = projectRoots.map((root) => path.join(root, branchName));

  if (!request.cwd?.trim()) {
    return {
      branchName,
      worktreePath: candidateWorktreeRoots[0] ?? path.join(legacyProjectWorktreeRoot(request.baseCwd), branchName),
    };
  }

  const savedCwd = path.resolve(request.cwd);
  const worktreePath = candidateWorktreeRoots.find((candidate) => isPathWithin(savedCwd, candidate));
  if (!worktreePath) {
    throw new Error("Unsafe isolated Git worktree cleanup path.");
  }

  return { branchName, worktreePath };
}

function cleanupProjectRoots(
  baseCwd: string,
  options: Pick<PrepareAgentWorktreeOptions, "worktreeStoreRoot">,
): string[] {
  return projectWorktreeRoots(baseCwd, options.worktreeStoreRoot);
}

function safeCleanupBranchName(value: string): string {
  const branchName = sanitizeBranchName(value);
  if (branchName !== value || !safePathSegment(branchName)) {
    throw new Error("Unsafe isolated Git worktree branch name.");
  }
  return branchName;
}

function safePathSegment(value: string): boolean {
  if (!value || value === "." || value === "..") return false;
  return !value.includes("/") && !value.includes("\\") && !path.isAbsolute(value);
}

function isPathWithin(childPath: string, parentPath: string): boolean {
  const resolvedParent = canonicalPathIdentity(parentPath);
  const resolvedChild = canonicalPathIdentity(childPath);
  const relative = path.relative(resolvedParent, resolvedChild);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function canonicalPathIdentity(value: string): string {
  const resolvedPath = path.resolve(value);
  try {
    return realpathSync.native(resolvedPath);
  } catch {
    // Paths unavailable to realpath retain their stable pre-existing identity.
    return resolvedPath;
  }
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

function sanitizeBranchName(value: string): string {
  const segments = value
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .split("/")
    .map((segment) => segment.replace(/^[._-]+|[._-]+$/g, ""))
    .filter(Boolean);

  return segments.join("-") || "session";
}

async function gitOutput(run: ExecFile, args: string[], fallbackMessage: string): Promise<string> {
  return (await gitOutputRaw(run, args, fallbackMessage)).trim();
}

async function gitOutputRaw(run: ExecFile, args: string[], fallbackMessage: string): Promise<string> {
  try {
    const { stdout } = await run("git", args, { cwd: os.homedir(), timeout: 2_500 });
    return stdout;
  } catch (error: unknown) {
    throw new Error(`${fallbackMessage} ${errorMessage(error)}`, { cause: error });
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}
