import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createPersistedDesktopStateStore,
  normalizeDesktopState,
  type PersistedDesktopStateStore,
  type PersistedDesktopStateStoreOptions,
} from "./persisted-desktop-state.js";
import type { WorkspaceStateSetRequest, WorkspaceStateSnapshot } from "../shared/workspace-ipc.js";

const execFileAsync = promisify(execFile);

export type WorkspaceStore = {
  createWorkspaceFromPath(rootPath: string): Promise<WorkspaceStateSnapshot>;
  getWorkspaceState(): Promise<WorkspaceStateSnapshot>;
  setWorkspaceState(request: WorkspaceStateSetRequest): Promise<WorkspaceStateSnapshot>;
};

export type WorkspaceStoreOptions = PersistedDesktopStateStoreOptions & {
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

      const existing = current.workspaces.find((workspace) => workspace.rootPath === normalizedRootPath);
      if (existing) {
        const next = await persistedStateStore.setState({ ...current, activeWorkspaceId: existing.id });
        return toWorkspaceState(next);
      }

      const label = path.basename(normalizedRootPath) || normalizedRootPath;
      const id = uniqueWorkspaceId(label, current.workspaces.map((workspace) => workspace.id));
      const gitBranch = await (options.resolveGitBranch ?? resolveGitBranch)(normalizedRootPath);
      const workspace = {
        id,
        label,
        shortLabel: shortLabelForWorkspace(label),
        rootPath: normalizedRootPath,
        ...(gitBranch === undefined ? {} : { gitBranch }),
      };
      const next = await persistedStateStore.setState({
        ...current,
        workspaces: [...current.workspaces, workspace],
        activeWorkspaceId: workspace.id,
      });

      return toWorkspaceState(next);
    },

    async getWorkspaceState(): Promise<WorkspaceStateSnapshot> {
      return toWorkspaceState(await persistedStateStore.getState());
    },

    async setWorkspaceState(request: WorkspaceStateSetRequest): Promise<WorkspaceStateSnapshot> {
      const current = await persistedStateStore.getState();
      const workspaceState = toWorkspaceState(normalizeDesktopState(request));
      const next = await persistedStateStore.setState({ ...current, ...workspaceState });
      return toWorkspaceState(next);
    },
  };
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

function shortLabelForWorkspace(label: string): string {
  const words = label.trim().split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const letters = words.length > 1 ? words.map((word) => word[0]).join("") : label.slice(0, 3);
  return (letters || "W").slice(0, 3).toUpperCase();
}
