export type WorkspacePathTarget = {
  rootPath?: string | undefined;
};

export function findWorkspaceForCwd<T extends WorkspacePathTarget>(
  cwd: string | undefined,
  workspaces: readonly T[],
): T | null {
  const normalizedCwd = normalizePosixPath(cwd);
  if (!normalizedCwd) return null;

  return workspaces
    .filter((workspace) => pathMatchesWorkspace(normalizedCwd, workspace.rootPath))
    .sort((left, right) => (normalizedPathLength(right.rootPath) - normalizedPathLength(left.rootPath)))
    [0] ?? null;
}

export function pathMatchesWorkspace(cwd: string, rootPath: string | undefined): boolean {
  const root = normalizePosixPath(rootPath);
  if (!root) return false;

  return isSameOrChildPath(cwd, root) || isSameOrChildPath(cwd, legacyProjectWorktreeRoot(root));
}

function legacyProjectWorktreeRoot(rootPath: string): string {
  return `${dirname(rootPath)}/.alfred-worktrees/${basename(rootPath)}`;
}

function isSameOrChildPath(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function normalizedPathLength(path: string | undefined): number {
  return normalizePosixPath(path)?.length ?? 0;
}

function normalizePosixPath(path: string | undefined): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;
  const withoutTrailingSlashes = trimmed.replace(/\/+$/g, "");
  return withoutTrailingSlashes || "/";
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  if (index <= 0) return "/";
  return path.slice(0, index);
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}
