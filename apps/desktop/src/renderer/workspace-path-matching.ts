export function pathMatchesWorkspace(cwd: string, rootPath: string | undefined): boolean {
  const root = normalizePosixPath(rootPath);
  if (!root) return false;

  const candidate = normalizePosixPath(cwd);
  if (!candidate) return false;

  return isSameOrChildPath(candidate, root) || isSameOrChildPath(candidate, legacyProjectWorktreeRoot(root));
}

export function pathsReferToSameLocation(
  left: string | undefined,
  right: string | undefined,
): boolean {
  const normalizedLeft = normalizePosixPath(left);
  const normalizedRight = normalizePosixPath(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function legacyProjectWorktreeRoot(rootPath: string): string {
  return `${dirname(rootPath)}/.alfred-worktrees/${basename(rootPath)}`;
}

function isSameOrChildPath(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function normalizePosixPath(path: string | undefined): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;
  const withoutTrailingSlashes = trimmed.replace(/\/+$/g, "");
  const normalized = withoutTrailingSlashes || "/";
  return normalized === "/private/var" || normalized.startsWith("/private/var/")
    ? normalized.slice("/private".length)
    : normalized;
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
