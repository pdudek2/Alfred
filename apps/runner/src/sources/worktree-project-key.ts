import { basename, normalize } from "node:path";

export function projectKeyFromCwdPath(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;

  const legacyProject = legacyAlfredWorktreeProject(cwd);
  if (legacyProject) return legacyProject;

  return basename(cwd) || undefined;
}

function legacyAlfredWorktreeProject(cwd: string): string | undefined {
  const parts = normalize(cwd).split(/[\\/]+/).filter(Boolean);
  const markerIndex = parts.lastIndexOf(".alfred-worktrees");
  if (markerIndex < 0) return undefined;
  return parts[markerIndex + 1] || undefined;
}
