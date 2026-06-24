import path from "node:path";

export function codexScratchRootPath(documentsPath: string, date = new Date()): string {
  return path.join(path.resolve(documentsPath), "Codex", formatLocalDate(date));
}

export function scratchWorkspacePath(scratchRootPath: string, workspaceId?: string): string {
  return path.join(path.resolve(scratchRootPath), scratchWorkspaceDirectoryName(workspaceId ?? "default"));
}

export function scratchWorkspaceDirectoryName(workspaceId: string): string {
  return `alfred-${safeScratchSegment(workspaceId)}`;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function safeScratchSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "default";
}
