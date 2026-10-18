import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ATTACHABLE_IMAGE_PATH,
  type WorkspaceRevealPathRequest,
  type WorkspaceRevealPathResult,
} from "../shared/workspace-ipc.js";

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

// ponytail: a cap so a hover never decodes a huge file; raise it if real screenshots hit it.
const LINKED_IMAGE_MAX_BYTES = 50 * 1024 * 1024;

/**
 * An image a terminal links to, for its hover preview and Quick Look. Agents keep pasted images outside
 * the workspace (Claude in its temp folder), so any image file passes, but nothing else does.
 */
export async function resolveLinkedImage(
  request: unknown,
): Promise<{ ok: true; resolvedPath: string } | { ok: false; error: string }> {
  const { path: rawPath, cwd } = typeof request === "object" && request !== null ? request as Record<string, unknown> : {};
  // A relative path needs the session's folder; anything else as a base is ignored.
  const base = typeof cwd === "string" && path.isAbsolute(cwd) ? cwd : undefined;
  if (typeof rawPath !== "string" || (!path.isAbsolute(rawPath) && !rawPath.startsWith("~/") && !base)) {
    return { ok: false, error: "Invalid image path." };
  }

  const resolvedPath = resolveWorkspacePath(rawPath, base);
  if (!ATTACHABLE_IMAGE_PATH.test(resolvedPath)) return { ok: false, error: "Invalid image path." };
  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) return { ok: false, error: "Not an image file." };
    if (stat.size > LINKED_IMAGE_MAX_BYTES) return { ok: false, error: "Image is too large." };
  } catch {
    return { ok: false, error: "Image does not exist." };
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
  if (roots.length === 0) return false;

  const normalizedPath = await canonicalWorkspacePath(resolvedPath);
  return roots.some((root) => normalizedPath === root || normalizedPath.startsWith(`${root}${path.sep}`));
}

export async function canonicalWorkspacePath(value: string): Promise<string> {
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
