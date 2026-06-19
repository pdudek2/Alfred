import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  WorkspaceOpenExternalTerminalRequest,
  WorkspaceOpenExternalTerminalResult,
} from "../shared/workspace-ipc.js";
import { isAllowedWorkspacePath, type WorkspacePathAccessOptions } from "./workspace-path.js";

type SpawnLike = typeof spawn;

export type ExternalTerminalOptions = {
  allowedRoots?: WorkspacePathAccessOptions["allowedRoots"];
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  spawnImpl?: SpawnLike;
};

type ExternalTerminalLaunch = {
  args: string[];
  command: string;
  terminal: string;
};

export async function openExternalTerminal(
  request: unknown,
  options: ExternalTerminalOptions = {},
): Promise<WorkspaceOpenExternalTerminalResult> {
  const normalizedRequest = normalizeOpenTerminalRequest(request);
  if (normalizedRequest.status === "invalid") return normalizedRequest.result;

  const resolvedPath = path.resolve(normalizedRequest.request.cwd);
  if (!await isAllowedWorkspacePath(resolvedPath, options.allowedRoots)) {
    return { ok: false, error: "Path is outside registered workspaces.", resolvedPath };
  }

  const directoryResult = await verifyDirectory(resolvedPath);
  if (!directoryResult.ok) return directoryResult;

  const launch = externalTerminalLaunch(resolvedPath, options);
  if (!launch) {
    return { ok: false, error: "External terminal is not supported on this platform.", resolvedPath };
  }

  try {
    await spawnAndDetach(launch, options.spawnImpl ?? spawn);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "External terminal failed to open.",
      resolvedPath,
      terminal: launch.terminal,
    };
  }

  return { ok: true, resolvedPath, terminal: launch.terminal };
}

export function externalTerminalLaunch(
  cwd: string,
  options: Pick<ExternalTerminalOptions, "env" | "platform"> = {},
): ExternalTerminalLaunch | null {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (platform === "darwin") {
    const terminal = env.ALFRED_EXTERNAL_TERMINAL_APP?.trim() || "Ghostty";
    return {
      command: "open",
      args: ["-a", terminal, cwd],
      terminal,
    };
  }

  if (platform === "win32") {
    return {
      command: "wt.exe",
      args: ["-d", cwd],
      terminal: "Windows Terminal",
    };
  }

  if (platform === "linux") {
    return {
      command: "xdg-terminal-exec",
      args: [`--dir=${cwd}`],
      terminal: "system terminal",
    };
  }

  return null;
}

function normalizeOpenTerminalRequest(
  value: unknown,
): { status: "valid"; request: WorkspaceOpenExternalTerminalRequest } | { status: "invalid"; result: WorkspaceOpenExternalTerminalResult } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { status: "invalid", result: { ok: false, error: "Invalid external terminal request." } };
  }

  const request = value as Record<string, unknown>;
  if (typeof request.cwd !== "string") {
    return { status: "invalid", result: { ok: false, error: "Invalid external terminal cwd." } };
  }

  if (!request.cwd.trim()) {
    return { status: "invalid", result: { ok: false, error: "No cwd to open." } };
  }

  return { status: "valid", request: { cwd: request.cwd } };
}

async function verifyDirectory(resolvedPath: string): Promise<WorkspaceOpenExternalTerminalResult> {
  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      return { ok: false, error: "Path is not a directory.", resolvedPath };
    }
  } catch {
    return { ok: false, error: "Directory does not exist.", resolvedPath };
  }

  return { ok: true, resolvedPath, terminal: "" };
}

function spawnAndDetach(launch: ExternalTerminalLaunch, spawnImpl: SpawnLike): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawnImpl(launch.command, launch.args, {
      detached: true,
      stdio: "ignore",
    }) as ChildProcess;

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve();
    });
  });
}
