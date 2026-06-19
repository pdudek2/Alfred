import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorkspaceRevealPathRequest, WorkspaceRevealPathResult } from "../shared/workspace-ipc.js";

export type WorkspacePathAccessOptions = {
  allowedRoots?: string[];
};

export async function resolveWorkspacePathForReveal(
  request: unknown,
  options: WorkspacePathAccessOptions = {},
): Promise<WorkspaceRevealPathResult> {
  const normalizedRequest = normalizeRevealPathRequest(request);
  if (normalizedRequest.status === "invalid") return normalizedRequest.result;

  const revealRequest = normalizedRequest.request;
  const rawPath = revealRequest.path.trim();
  if (!rawPath) {
    return { ok: false, error: "No path to reveal." };
  }

  const resolvedPath = resolveWorkspacePath(rawPath, revealRequest.cwd);
  if (!await isAllowedWorkspacePath(resolvedPath, options.allowedRoots)) {
    return { ok: false, error: "Path is outside registered workspaces.", resolvedPath };
  }

  try {
    await fs.access(resolvedPath);
  } catch {
    return { ok: false, error: "Path does not exist.", resolvedPath };
  }

  return { ok: true, resolvedPath };
}

function normalizeRevealPathRequest(
  value: unknown,
): { status: "valid"; request: WorkspaceRevealPathRequest } | { status: "invalid"; result: WorkspaceRevealPathResult } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { status: "invalid", result: { ok: false, error: "Invalid reveal request." } };
  }

  const request = value as Record<string, unknown>;
  if (typeof request.path !== "string") {
    return { status: "invalid", result: { ok: false, error: "Invalid reveal path." } };
  }

  if (request.cwd !== undefined && typeof request.cwd !== "string") {
    return { status: "invalid", result: { ok: false, error: "Invalid reveal cwd." } };
  }

  return {
    status: "valid",
    request: {
      path: request.path,
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    },
  };
}

function resolveWorkspacePath(rawPath: string, cwd: string | undefined): string {
  const expandedPath = rawPath === "~" || rawPath.startsWith("~/")
    ? path.join(os.homedir(), rawPath.slice(2))
    : rawPath;

  if (path.isAbsolute(expandedPath)) {
    return path.normalize(expandedPath);
  }

  return path.resolve(cwd?.trim() || process.cwd(), expandedPath);
}

export async function isAllowedWorkspacePath(resolvedPath: string, allowedRoots: string[] | undefined): Promise<boolean> {
  const roots = await Promise.all((allowedRoots ?? []).map((root) => canonicalWorkspacePath(root)));
  if (roots.length === 0) return true;

  const normalizedPath = await canonicalWorkspacePath(resolvedPath);
  return roots.some((root) => normalizedPath === root || normalizedPath.startsWith(`${root}${path.sep}`));
}

async function canonicalWorkspacePath(value: string): Promise<string> {
  const resolved = path.resolve(value);
  try {
    return await fs.realpath(resolved);
  } catch {
    return canonicalMissingPath(resolved);
  }
}

async function canonicalMissingPath(resolvedPath: string): Promise<string> {
  const missingSegments: string[] = [];
  let current = resolvedPath;

  while (true) {
    try {
      const existingPath = await fs.realpath(current);
      return path.join(existingPath, ...missingSegments);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return resolvedPath;
      missingSegments.unshift(path.basename(current));
      current = parent;
    }
  }
}
