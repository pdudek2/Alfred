import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { AlfredLaunchPreflight, AlfredPlan, AlfredPlanSession, AlfredWorkspaceContext } from "../shared/alfred-ipc.js";
import { preflightAgentWorktree as defaultPreflightAgentWorktree, type AgentWorktreeResult } from "./git-worktree.js";

type ExecFile = (
  file: string,
  args: string[],
  options?: { cwd?: string | undefined; timeout?: number | undefined },
) => Promise<{ stdout: string; stderr: string }>;

type PreflightAgentWorktree = typeof defaultPreflightAgentWorktree;

export type AlfredLaunchPreflightOptions = {
  commandExists?: (command: string) => Promise<boolean>;
  preflightAgentWorktree?: PreflightAgentWorktree;
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
  const commandExists = options.commandExists ?? defaultCommandExists;

  if (!(await commandExists(session.command))) {
    return {
      ...session,
      launchPreflight: blockedPreflight(
        "command_missing",
        "Command missing",
        `Command "${session.command}" is not available on PATH.`,
      ),
    };
  }

  if (!usesIsolatedWorktree(session)) {
    return {
      ...session,
      launchPreflight: {
        status: "ready",
        label: "Ready",
        detail: "Will launch in the selected workspace.",
        isolation: "shared",
      },
    };
  }

  if (!workspace?.rootPath) {
    return {
      ...session,
      launchPreflight: {
        status: "ready",
        label: "Scratch workspace",
        detail: "No folder is bound; will launch in Alfred's scratch desk.",
        isolation: "shared",
      },
    };
  }

  const cwd = resolveSessionCwd(session.cwd, workspace.rootPath);
  if (!cwd) {
    return {
      ...session,
      launchPreflight: blockedPreflight(
        "cwd_outside_workspace",
        "Workspace mismatch",
        "This agent asked to launch outside the selected workspace. Bind the right folder or adjust the plan.",
      ),
    };
  }

  try {
    const worktree = await (options.preflightAgentWorktree ?? defaultPreflightAgentWorktree)({
      agentKind: session.kind,
      clientId: session.title,
      cwd,
    });

    return {
      ...session,
      launchPreflight: readyWorktreePreflight(worktree),
    };
  } catch (error: unknown) {
    if (isNotGitRepositoryError(error)) {
      return {
        ...session,
        launchPreflight: {
          status: "ready",
          label: "Shared workspace",
          detail: "Workspace is not Git; will launch in the selected folder.",
          isolation: "shared",
        },
      };
    }

    return {
      ...session,
      launchPreflight: blockedPreflight(
        "git_not_ready",
        "Git not ready",
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

function isNotGitRepositoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("not a Git repository");
}

function usesIsolatedWorktree(session: AlfredPlanSession): boolean {
  return session.kind === "codex" || session.kind === "claude";
}

function readyWorktreePreflight(worktree: AgentWorktreeResult): AlfredLaunchPreflight {
  const dirtySnapshot = worktree.snapshot !== undefined;
  return {
    status: "ready",
    label: dirtySnapshot ? "Snapshot worktree ready" : "Worktree ready",
    detail: dirtySnapshot
      ? "Will create an isolated Git worktree and copy current workspace changes into it."
      : "Will create an isolated Git worktree on launch.",
    isolation: "worktree",
    branchName: worktree.branchName,
    baseCwd: worktree.baseCwd,
    cwd: worktree.cwd,
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
