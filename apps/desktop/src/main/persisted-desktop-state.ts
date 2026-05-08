import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { WorkspaceSnapshot, WorkspaceStateSnapshot } from "../shared/workspace-ipc.js";

export const DESKTOP_STATE_VERSION = 1;
export const DESKTOP_STATE_FILE_NAME = "desktop-state.json";

export type DesktopStateSnapshot = WorkspaceStateSnapshot;

export type DesktopStateFile = DesktopStateSnapshot & {
  version: typeof DESKTOP_STATE_VERSION;
};

export type PersistedDesktopStateStore = {
  getState(): Promise<DesktopStateSnapshot>;
  setState(state: DesktopStateSnapshot): Promise<DesktopStateSnapshot>;
};

export type PersistedDesktopStateStoreOptions = {
  filePath?: string;
  userDataPath?: string;
  onWarning?: (message: string, error: unknown) => void;
};

export const DEFAULT_WORKSPACE: WorkspaceSnapshot = {
  id: "A",
  label: "Alfred",
  shortLabel: "A",
};

export const DEFAULT_DESKTOP_STATE: DesktopStateSnapshot = {
  workspaces: [DEFAULT_WORKSPACE],
  activeWorkspaceId: DEFAULT_WORKSPACE.id,
};

export function createPersistedDesktopStateStore(
  options: PersistedDesktopStateStoreOptions = {},
): PersistedDesktopStateStore {
  const filePath = resolveDesktopStateFilePath(options);
  let hydrated = false;
  let cachedState = cloneDesktopState(DEFAULT_DESKTOP_STATE);

  return {
    async getState(): Promise<DesktopStateSnapshot> {
      if (!hydrated) {
        cachedState = await readDesktopStateFile(filePath, options.onWarning);
        hydrated = true;
      }

      return cloneDesktopState(cachedState);
    },

    async setState(state: DesktopStateSnapshot): Promise<DesktopStateSnapshot> {
      cachedState = normalizeDesktopState(state);
      hydrated = true;

      try {
        await writeDesktopStateFile(filePath, cachedState);
      } catch (error) {
        options.onWarning?.("Failed to persist desktop state.", error);
      }

      return cloneDesktopState(cachedState);
    },
  };
}

export function resolveDesktopStateFilePath(options: PersistedDesktopStateStoreOptions): string {
  if (options.filePath) {
    return options.filePath;
  }

  if (!options.userDataPath) {
    throw new Error("Desktop state persistence requires userDataPath or filePath.");
  }

  return path.join(options.userDataPath, DESKTOP_STATE_FILE_NAME);
}

export function normalizeDesktopState(value: unknown): DesktopStateSnapshot {
  if (!isRecord(value) || !Array.isArray(value.workspaces) || typeof value.activeWorkspaceId !== "string") {
    return cloneDesktopState(DEFAULT_DESKTOP_STATE);
  }

  const workspaces = normalizeWorkspaces(value.workspaces);

  if (workspaces.length === 0) {
    return cloneDesktopState(DEFAULT_DESKTOP_STATE);
  }

  const activeWorkspaceId = workspaces.some((workspace) => workspace.id === value.activeWorkspaceId)
    ? value.activeWorkspaceId
    : workspaces[0]?.id ?? DEFAULT_WORKSPACE.id;

  return {
    workspaces,
    activeWorkspaceId,
  };
}

function normalizeWorkspaces(value: unknown[]): WorkspaceSnapshot[] {
  const seenIds = new Set<string>();
  const workspaces: WorkspaceSnapshot[] = [];

  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== "string" || typeof item.label !== "string" || typeof item.shortLabel !== "string") {
      continue;
    }

    const id = item.id.trim();
    const label = item.label.trim();
    const shortLabel = item.shortLabel.trim();

    if (!id || !label || !shortLabel || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    workspaces.push({ id, label, shortLabel });
  }

  return workspaces;
}

async function readDesktopStateFile(
  filePath: string,
  onWarning: PersistedDesktopStateStoreOptions["onWarning"],
): Promise<DesktopStateSnapshot> {
  let raw: string;

  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return cloneDesktopState(DEFAULT_DESKTOP_STATE);
    }

    onWarning?.("Failed to read desktop state; using defaults.", error);
    return cloneDesktopState(DEFAULT_DESKTOP_STATE);
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!isRecord(parsed) || parsed.version !== DESKTOP_STATE_VERSION) {
      return cloneDesktopState(DEFAULT_DESKTOP_STATE);
    }

    return normalizeDesktopState(parsed);
  } catch (error) {
    onWarning?.("Failed to parse desktop state; using defaults.", error);
    return cloneDesktopState(DEFAULT_DESKTOP_STATE);
  }
}

async function writeDesktopStateFile(filePath: string, state: DesktopStateSnapshot): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });

  const fileState: DesktopStateFile = {
    version: DESKTOP_STATE_VERSION,
    ...cloneDesktopState(state),
  };
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  await writeFile(temporaryPath, `${JSON.stringify(fileState, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function cloneDesktopState(state: DesktopStateSnapshot): DesktopStateSnapshot {
  return {
    workspaces: state.workspaces.map((workspace) => ({ ...workspace })),
    activeWorkspaceId: state.activeWorkspaceId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
