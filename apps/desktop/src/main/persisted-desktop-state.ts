import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AlfredStagedPlanSnapshot, AgentKind } from "../shared/alfred-ipc.js";
import type { TileLayout } from "../shared/layout-ipc.js";
import type { PersistedTerminalSessionSnapshot, TerminalSessionSource } from "../shared/terminal-ipc.js";
import type { WorkspaceSnapshot, WorkspaceStateSnapshot } from "../shared/workspace-ipc.js";

export const DESKTOP_STATE_VERSION = 1;
export const DESKTOP_STATE_FILE_NAME = "desktop-state.json";

export type DesktopStateSnapshot = WorkspaceStateSnapshot & {
  layoutsByWorkspace: Record<string, Record<string, TileLayout>>;
  stagedPlan: AlfredStagedPlanSnapshot | null;
  restoredTerminalSessions: PersistedTerminalSessionSnapshot[];
};

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
  layoutsByWorkspace: {},
  stagedPlan: null,
  restoredTerminalSessions: [],
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
    layoutsByWorkspace: normalizeLayoutsByWorkspace(value.layoutsByWorkspace),
    stagedPlan: normalizeStagedPlan(value.stagedPlan),
    restoredTerminalSessions: normalizeRestoredTerminalSessions(value.restoredTerminalSessions),
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
    const rootPath = typeof item.rootPath === "string" ? item.rootPath.trim() : undefined;

    if (!id || !label || !shortLabel || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    workspaces.push({ id, label, shortLabel, ...(rootPath ? { rootPath } : {}) });
  }

  return workspaces;
}

function normalizeLayoutsByWorkspace(value: unknown): Record<string, Record<string, TileLayout>> {
  if (!isRecord(value)) return {};

  const layoutsByWorkspace: Record<string, Record<string, TileLayout>> = {};

  for (const [workspaceId, rawLayouts] of Object.entries(value)) {
    if (!workspaceId.trim() || !isRecord(rawLayouts)) continue;
    const layouts: Record<string, TileLayout> = {};

    for (const [tileId, rawLayout] of Object.entries(rawLayouts)) {
      if (!isRecord(rawLayout)) continue;
      if (
        typeof rawLayout.tileId !== "string" ||
        typeof rawLayout.col !== "number" ||
        typeof rawLayout.row !== "number" ||
        typeof rawLayout.colSpan !== "number" ||
        typeof rawLayout.rowSpan !== "number"
      ) {
        continue;
      }

      layouts[tileId] = {
        tileId: rawLayout.tileId,
        col: rawLayout.col,
        row: rawLayout.row,
        colSpan: rawLayout.colSpan,
        rowSpan: rawLayout.rowSpan,
      };
    }

    layoutsByWorkspace[workspaceId] = layouts;
  }

  return layoutsByWorkspace;
}

function normalizeStagedPlan(value: unknown): AlfredStagedPlanSnapshot | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.prompt !== "string" || !Array.isArray(value.sessions)) {
    return null;
  }

  const sessions = value.sessions.flatMap((session) => {
    if (!isRecord(session)) return [];
    if (
      typeof session.id !== "string" ||
      !isAgentKind(session.kind) ||
      typeof session.title !== "string" ||
      typeof session.command !== "string" ||
      !Array.isArray(session.args) ||
      !session.args.every((arg) => typeof arg === "string")
    ) {
      return [];
    }

    return [{
      id: session.id,
      kind: session.kind,
      title: session.title,
      command: session.command,
      args: [...session.args],
      ...(typeof session.cwd === "string" ? { cwd: session.cwd } : {}),
      ...(typeof session.workspaceId === "string" ? { workspaceId: session.workspaceId } : {}),
      ...(typeof session.safetyNote === "string" ? { safetyNote: session.safetyNote } : {}),
    }];
  });

  if (sessions.length === 0) return null;

  return {
    id: value.id,
    prompt: value.prompt,
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    sessions,
  };
}

function isAgentKind(value: unknown): value is AgentKind {
  return value === "codex" || value === "claude" || value === "dev-server" || value === "shell";
}

function normalizeRestoredTerminalSessions(value: unknown): PersistedTerminalSessionSnapshot[] {
  if (!Array.isArray(value)) return [];

  const seenClientIds = new Set<string>();
  const sessions: PersistedTerminalSessionSnapshot[] = [];

  for (const item of value) {
    if (!isRecord(item)) continue;
    if (
      typeof item.clientId !== "string" ||
      typeof item.title !== "string" ||
      !isTerminalSessionSource(item.source) ||
      typeof item.cwd !== "string" ||
      typeof item.shell !== "string" ||
      typeof item.buffer !== "string"
    ) {
      continue;
    }

    const clientId = item.clientId.trim();
    if (!clientId || seenClientIds.has(clientId)) continue;

    seenClientIds.add(clientId);
    sessions.push({
      clientId,
      title: item.title,
      source: item.source,
      cwd: item.cwd,
      shell: item.shell,
      buffer: item.buffer,
      ...(isAgentKind(item.agentKind) ? { agentKind: item.agentKind } : {}),
      ...(typeof item.workspaceId === "string" ? { workspaceId: item.workspaceId } : {}),
      ...(typeof item.command === "string" ? { command: item.command } : {}),
      ...(Array.isArray(item.args) && item.args.every((arg) => typeof arg === "string")
        ? { args: [...item.args] }
        : {}),
    });
  }

  return sessions;
}

function isTerminalSessionSource(value: unknown): value is TerminalSessionSource {
  return value === "manual" || value === "alfred";
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
    layoutsByWorkspace: Object.fromEntries(
      Object.entries(state.layoutsByWorkspace).map(([workspaceId, layouts]) => [
        workspaceId,
        Object.fromEntries(Object.entries(layouts).map(([tileId, layout]) => [tileId, { ...layout }])),
      ]),
    ),
    stagedPlan: cloneStagedPlan(state.stagedPlan),
    restoredTerminalSessions: state.restoredTerminalSessions.map((session) => cloneRestoredTerminalSession(session)),
  };
}

function cloneStagedPlan(plan: AlfredStagedPlanSnapshot | null): AlfredStagedPlanSnapshot | null {
  if (!plan) return null;
  return {
    ...plan,
    sessions: plan.sessions.map((session) => ({ ...session, args: [...session.args] })),
  };
}

function cloneRestoredTerminalSession(session: PersistedTerminalSessionSnapshot): PersistedTerminalSessionSnapshot {
  return {
    ...session,
    ...(session.args === undefined ? {} : { args: [...session.args] }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
