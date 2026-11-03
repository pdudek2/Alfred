import { execFile as execFileCallback } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeAgentCommand } from "../shared/agent-command.js";
import type { AlfredLaunchPreflight, AlfredPlan, AlfredPlanSession, AlfredWorkspaceContext } from "../shared/alfred-ipc.js";

type ExecFile = (
  file: string,
  args: string[],
  options?: { cwd?: string | undefined; timeout?: number | undefined },
) => Promise<{ stdout: string; stderr: string }>;

export type AlfredLaunchPreflightOptions = {
  commandExists?: (command: string) => Promise<boolean>;
  directoryExists?: (path: string) => Promise<boolean>;
};

const execFile = promisify(execFileCallback) as ExecFile;

export async function preflightAlfredPlan(
  plan: AlfredPlan,
  workspace: AlfredWorkspaceContext | undefined,
  options: AlfredLaunchPreflightOptions = {},
): Promise<AlfredPlan> {
  const sessions = await Promise.all(
    plan.sessions.map((session) => preflightAlfredPlanSession(session, workspace, options)),
  );

  return { ...plan, sessions };
}

export async function preflightAlfredPlanSession<T extends AlfredPlanSession>(
  session: T,
  workspace: AlfredWorkspaceContext | undefined,
  options: AlfredLaunchPreflightOptions = {},
): Promise<T> {
  const normalizedSession = normalizeAgentCommand(session);
  const commandExists = options.commandExists ?? defaultCommandExists;

  if (!(await commandExists(normalizedSession.command))) {
    return {
      ...normalizedSession,
      launchPreflight: blockedPreflight(
        "command_missing",
        "Command missing",
        `Command "${normalizedSession.command}" is not available on PATH.`,
      ),
    };
  }

  if (!workspace?.rootPath) {
    return {
      ...normalizedSession,
      launchPreflight: {
        status: "ready",
        label: "Scratch project",
        detail: "No folder is bound; will launch in Alfred's scratch project.",
      },
    };
  }

  const cwd = resolveSessionCwd(normalizedSession.cwd, workspace.rootPath);
  if (!cwd) {
    return {
      ...normalizedSession,
      launchPreflight: blockedPreflight(
        "cwd_outside_workspace",
        "Project mismatch",
        "This agent asked to launch outside the selected project. Bind the right folder or adjust the plan.",
      ),
    };
  }

  // The planner guesses a session's folder, and an edited draft can misspell it; a terminal cannot start there.
  const directoryExists = options.directoryExists ?? defaultDirectoryExists;
  if (normalizedSession.cwd && cwd !== path.resolve(workspace.rootPath) && !(await directoryExists(cwd))) {
    return {
      ...normalizedSession,
      launchPreflight: blockedPreflight(
        "cwd_missing",
        "Folder missing",
        `${normalizedSession.cwd} is not a folder in this project.`,
      ),
    };
  }

  return {
    ...normalizedSession,
    launchPreflight: {
      status: "ready",
      label: "Ready",
      detail: "Will launch in the selected project.",
    },
  };
}

function blockedPreflight(
  code: Extract<AlfredLaunchPreflight, { status: "blocked" }>["code"],
  label: string,
  reason: string,
): AlfredLaunchPreflight {
  return {
    status: "blocked",
    code,
    label,
    reason,
  };
}

function resolveSessionCwd(sessionCwd: string | undefined, workspaceRoot: string): string | null {
  const root = path.resolve(workspaceRoot);
  const candidate = sessionCwd
    ? path.resolve(path.isAbsolute(sessionCwd) ? sessionCwd : path.join(root, sessionCwd))
    : root;
  const relative = path.relative(root, candidate);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return candidate;
}

async function defaultDirectoryExists(folder: string): Promise<boolean> {
  return (await stat(folder).catch(() => null))?.isDirectory() ?? false;
}

async function defaultCommandExists(command: string): Promise<boolean> {
  const trimmed = command.trim();
  if (!trimmed) return false;

  try {
    if (process.platform === "win32") {
      await execFile("where", [trimmed], { timeout: 1_500 });
    } else {
      await execFile("sh", ["-lc", 'command -v "$1" >/dev/null 2>&1', "sh", trimmed], { timeout: 1_500 });
    }
    return true;
  } catch {
    return false;
  }
}
