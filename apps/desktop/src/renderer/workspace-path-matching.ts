export function pathMatchesWorkspace(cwd: string, rootPath: string | undefined): boolean {
  const root = normalizePosixPath(rootPath);
  if (!root) return false;

  const candidate = normalizePosixPath(cwd);
  if (!candidate) return false;

  return isSameOrChildPath(candidate, root);
}

export function pathsReferToSameLocation(
  left: string | undefined,
  right: string | undefined,
): boolean {
  const normalizedLeft = normalizePosixPath(left);
  const normalizedRight = normalizePosixPath(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

/** How a worktree reads beside its project: nothing for the project itself, its path inside it, else its folder name. */
export function workTreeFolderLabel(root: string, projectRoot: string | undefined): string | undefined {
  const tree = normalizePosixPath(root);
  const project = normalizePosixPath(projectRoot);
  if (!tree || tree === project) return undefined;
  if (project && isSameOrChildPath(tree, project)) return tree.slice(project.length + 1);
  return tree.split("/").filter(Boolean).at(-1) ?? tree;
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
