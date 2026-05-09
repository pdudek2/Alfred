import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorkspaceRevealPathRequest, WorkspaceRevealPathResult } from "../shared/workspace-ipc.js";

export async function resolveWorkspacePathForReveal(
  request: unknown,
): Promise<WorkspaceRevealPathResult> {
  const normalizedRequest = normalizeRevealPathRequest(request);
  if (normalizedRequest.status === "invalid") return normalizedRequest.result;

  const revealRequest = normalizedRequest.request;
  const rawPath = revealRequest.path.trim();
  if (!rawPath) {
    return { ok: false, error: "No path to reveal." };
  }

  const resolvedPath = resolveWorkspacePath(rawPath, revealRequest.cwd);
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
