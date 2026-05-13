import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createPersistedDesktopStateStore,
  DEFAULT_WORKSPACE,
  normalizeDesktopState,
  type DesktopStateSnapshot,
  type PersistedDesktopStateStore,
  type PersistedDesktopStateStoreOptions,
} from "./persisted-desktop-state.js";
import { shortLabelForWorkspace } from "../shared/workspace-label.js";
import type { WorkspaceStateSetRequest, WorkspaceStateSnapshot } from "../shared/workspace-ipc.js";

const execFileAsync = promisify(execFile);

export type WorkspaceStore = {
  createWorkspaceFromPath(rootPath: string): Promise<WorkspaceStateSnapshot>;
  getWorkspaceState(): Promise<WorkspaceStateSnapshot>;
  setWorkspaceState(request: WorkspaceStateSetRequest): Promise<WorkspaceStateSnapshot>;
};

export type WorkspaceStoreOptions = PersistedDesktopStateStoreOptions & {
  defaultRootPath?: string;
  persistedStateStore?: PersistedDesktopStateStore;
  resolveGitBranch?: (rootPath: string) => Promise<string | undefined>;
};

export function createWorkspaceStore(options: WorkspaceStoreOptions = {}): WorkspaceStore {
  const persistedStateStore = options.persistedStateStore ?? createPersistedDesktopStateStore(options);

  return {
    async createWorkspaceFromPath(rootPath: string): Promise<WorkspaceStateSnapshot> {
      const normalizedRootPath = rootPath.trim();
      const current = await persistedStateStore.getState();
      if (!normalizedRootPath) return toWorkspaceState(current);

      const label = path.basename(normalizedRootPath) || normalizedRootPath;
      const gitBranch = await (options.resolveGitBranch ?? resolveGitBranch)(normalizedRootPath);
      const next = await persistedStateStore.updateState((latest) => {
        const existing = latest.workspaces.find((workspace) => workspace.rootPath === normalizedRootPath);
        if (existing) return { ...latest, activeWorkspaceId: existing.id };

        const id = uniqueWorkspaceId(label, latest.workspaces.map((workspace) => workspace.id));
        const workspace = {
          id,
          label,
          shortLabel: shortLabelForWorkspace(label),
          rootPath: normalizedRootPath,
          ...(gitBranch === undefined ? {} : { gitBranch }),
        };

        return {
          ...latest,
          workspaces: [...latest.workspaces, workspace],
          activeWorkspaceId: workspace.id,
        };
      });

      return toWorkspaceState(next);
    },

    async getWorkspaceState(): Promise<WorkspaceStateSnapshot> {
      const state = await ensureDefaultWorkspaceRoot(await persistedStateStore.getState());
      return toWorkspaceState(await refreshWorkspaceBranches(state));
    },

    async setWorkspaceState(request: WorkspaceStateSetRequest): Promise<WorkspaceStateSnapshot> {
      const workspaceState = toWorkspaceState(normalizeDesktopState(request));
      const next = await persistedStateStore.updateState((current) => ({ ...current, ...workspaceState }));
      return toWorkspaceState(next);
    },
  };

  async function ensureDefaultWorkspaceRoot(state: DesktopStateSnapshot): Promise<DesktopStateSnapshot> {
    const defaultRootPath = options.defaultRootPath?.trim();
    if (!defaultRootPath) return state;

    const normalizedRootPath = path.resolve(defaultRootPath);
    const defaultWorkspace = state.workspaces.find((workspace) => workspace.id === DEFAULT_WORKSPACE.id);
    if (!defaultWorkspace || defaultWorkspace.rootPath) return state;

    const gitBranch = await (options.resolveGitBranch ?? resolveGitBranch)(normalizedRootPath);
    return persistedStateStore.updateState((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) => {
        if (workspace.id !== DEFAULT_WORKSPACE.id || workspace.rootPath) return workspace;
        return {
          ...workspace,
          rootPath: normalizedRootPath,
          ...(gitBranch === undefined ? {} : { gitBranch }),
        };
      }),
    }));
  }

  async function refreshWorkspaceBranches(state: DesktopStateSnapshot): Promise<DesktopStateSnapshot> {
    let changed = false;
    const workspaces = await Promise.all(
      state.workspaces.map(async (workspace) => {
        if (!workspace.rootPath) return workspace;
        const gitBranch = await (options.resolveGitBranch ?? resolveGitBranch)(workspace.rootPath);
        if (workspace.gitBranch === gitBranch) return workspace;
        changed = true;
        if (gitBranch === undefined) {
          const { gitBranch: _staleGitBranch, ...withoutGitBranch } = workspace;
          return withoutGitBranch;
        }
        return { ...workspace, gitBranch };
      }),
    );

    if (!changed) return state;
    const refreshedById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
    return persistedStateStore.updateState((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) => refreshedById.get(workspace.id) ?? workspace),
    }));
  }
}

function toWorkspaceState(state: WorkspaceStateSnapshot): WorkspaceStateSnapshot {
  return {
    workspaces: state.workspaces.map((workspace) => ({ ...workspace })),
    activeWorkspaceId: state.activeWorkspaceId,
  };
}

async function resolveGitBranch(rootPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", rootPath, "rev-parse", "--abbrev-ref", "HEAD"], {
      timeout: 1500,
    });
    const branch = stdout.trim();
    if (!branch || branch === "HEAD") return undefined;
    return branch;
  } catch {
    return undefined;
  }
}

function uniqueWorkspaceId(label: string, existingIds: string[]): string {
  const used = new Set(existingIds);
  const base = label
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase() || "WORKSPACE";
  let candidate = base;
  let suffix = 2;

  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}
