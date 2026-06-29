import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { redactText, redactUnknown } from "@alfred/schema";
import type { AlfredStagedPlanSnapshot, AgentKind } from "../shared/alfred-ipc.js";
import type { DispatchTargetSnapshot, TileLayout, WorkspaceViewState, WorkMode } from "../shared/layout-ipc.js";
import type {
  SessionActivityEvent,
  SessionActivityEventKind,
  SessionActivityPayload,
} from "../shared/session-activity.js";
import type {
  PersistedTerminalSessionSnapshot,
  TerminalResumeTarget,
  TerminalSessionIsolation,
  TerminalSessionSource,
} from "../shared/terminal-ipc.js";
import type { WorkspaceMissionBrief, WorkspaceSnapshot, WorkspaceStateSnapshot } from "../shared/workspace-ipc.js";

export const DESKTOP_STATE_VERSION = 1;
export const DESKTOP_STATE_FILE_NAME = "desktop-state.json";
export const MAX_PERSISTED_TERMINAL_SCROLLBACK_LENGTH = 80_000;

export type TerminalScrollbackRetention = "off" | "redactedTail";

export type DesktopPrivacySettings = {
  terminalScrollbackRetention: TerminalScrollbackRetention;
  externalSessionIndexingEnabled: boolean;
};

export type DesktopSaveStatus =
  | { status: "saved" }
  | { status: "saveFailed"; message: string; failedAt: number };

export type DesktopWindowBounds = {
  width: number;
  height: number;
  x?: number;
  y?: number;
};

export type DesktopWindowState = {
  bounds: DesktopWindowBounds;
  maximized: boolean;
};

export type DesktopStateSnapshot = WorkspaceStateSnapshot & {
  layoutsByWorkspace: Record<string, Record<string, TileLayout>>;
  viewStateByWorkspace: Record<string, WorkspaceViewState>;
  stagedPlan: AlfredStagedPlanSnapshot | null;
  restoredTerminalSessions: PersistedTerminalSessionSnapshot[];
  windowState: DesktopWindowState;
  privacySettings: DesktopPrivacySettings;
};

export type DesktopStateFile = DesktopStateSnapshot & {
  version: typeof DESKTOP_STATE_VERSION;
};

export type PersistedDesktopStateStore = {
  getState(): Promise<DesktopStateSnapshot>;
  getFilePath(): string;
  getSaveStatus(): DesktopSaveStatus;
  onSaveStatus(listener: (status: DesktopSaveStatus) => void): () => void;
  retrySave(): Promise<DesktopStateSnapshot>;
  setState(state: DesktopStateSnapshot): Promise<DesktopStateSnapshot>;
  updateState(
    updater: (current: DesktopStateSnapshot) => DesktopStateSnapshot | Promise<DesktopStateSnapshot>,
  ): Promise<DesktopStateSnapshot>;
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

export const DEFAULT_DESKTOP_WINDOW_STATE: DesktopWindowState = {
  bounds: {
    width: 1440,
    height: 920,
  },
  maximized: false,
};

export const DEFAULT_PRIVACY_SETTINGS: DesktopPrivacySettings = {
  terminalScrollbackRetention: "redactedTail",
  externalSessionIndexingEnabled: true,
};

export const DEFAULT_DESKTOP_STATE: DesktopStateSnapshot = {
  workspaces: [DEFAULT_WORKSPACE],
  activeWorkspaceId: DEFAULT_WORKSPACE.id,
  layoutsByWorkspace: {},
  viewStateByWorkspace: {},
  stagedPlan: null,
  restoredTerminalSessions: [],
  windowState: DEFAULT_DESKTOP_WINDOW_STATE,
  privacySettings: DEFAULT_PRIVACY_SETTINGS,
};

export function createPersistedDesktopStateStore(
  options: PersistedDesktopStateStoreOptions = {},
): PersistedDesktopStateStore {
  const filePath = resolveDesktopStateFilePath(options);
  let hydrated = false;
  let cachedState = cloneDesktopState(DEFAULT_DESKTOP_STATE);
  let failedState: DesktopStateSnapshot | null = null;
  let saveStatus: DesktopSaveStatus = { status: "saved" };
  const saveStatusListeners = new Set<(status: DesktopSaveStatus) => void>();
  let mutationQueue: Promise<void> = Promise.resolve();

  const hydrate = async (): Promise<void> => {
    if (hydrated) return;
    cachedState = await readDesktopStateFile(filePath, options.onWarning);
    hydrated = true;
  };

  const enqueueMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const persistState = async (state: DesktopStateSnapshot): Promise<DesktopStateSnapshot> => {
    const nextState = normalizeDesktopState(state);

    try {
      await writeDesktopStateFile(filePath, nextState);
    } catch (error) {
      failedState = nextState;
      setSaveStatus({ status: "saveFailed", message: "Failed to persist desktop state.", failedAt: Date.now() });
      options.onWarning?.("Failed to persist desktop state.", error);
      throw new Error("Failed to persist desktop state.", { cause: error });
    }

    cachedState = nextState;
    failedState = null;
    hydrated = true;
    setSaveStatus({ status: "saved" });
    return cloneDesktopState(cachedState);
  };

  const setSaveStatus = (status: DesktopSaveStatus): void => {
    saveStatus = status;
    for (const listener of saveStatusListeners) {
      listener({ ...status });
    }
  };

  return {
    async getState(): Promise<DesktopStateSnapshot> {
      await hydrate();

      return cloneDesktopState(cachedState);
    },

    getFilePath(): string {
      return filePath;
    },

    getSaveStatus(): DesktopSaveStatus {
      return { ...saveStatus };
    },

    onSaveStatus(listener: (status: DesktopSaveStatus) => void): () => void {
      saveStatusListeners.add(listener);
      return () => {
        saveStatusListeners.delete(listener);
      };
    },

    async retrySave(): Promise<DesktopStateSnapshot> {
      return enqueueMutation(async () => {
        if (!failedState) {
          await hydrate();
          return cloneDesktopState(cachedState);
        }
        return persistState(failedState);
      });
    },

    async setState(state: DesktopStateSnapshot): Promise<DesktopStateSnapshot> {
      return enqueueMutation(async () => persistState(state));
    },

    async updateState(
      updater: (current: DesktopStateSnapshot) => DesktopStateSnapshot | Promise<DesktopStateSnapshot>,
    ): Promise<DesktopStateSnapshot> {
      return enqueueMutation(async () => {
        await hydrate();
        return persistState(await updater(cloneDesktopState(cachedState)));
      });
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

  const privacySettings = normalizeDesktopPrivacySettings(value.privacySettings);

  return {
    workspaces,
    activeWorkspaceId,
    layoutsByWorkspace: normalizeLayoutsByWorkspace(value.layoutsByWorkspace),
    viewStateByWorkspace: normalizeViewStateByWorkspace(value.viewStateByWorkspace),
    stagedPlan: normalizeStagedPlan(value.stagedPlan),
    restoredTerminalSessions: normalizeRestoredTerminalSessions(value.restoredTerminalSessions, privacySettings),
    windowState: normalizeWindowState(value.windowState),
    privacySettings,
  };
}

export function normalizeDesktopPrivacySettings(value: unknown): DesktopPrivacySettings {
  if (!isRecord(value)) return { ...DEFAULT_PRIVACY_SETTINGS };

  return {
    terminalScrollbackRetention:
      value.terminalScrollbackRetention === "off" || value.terminalScrollbackRetention === "redactedTail"
        ? value.terminalScrollbackRetention
        : DEFAULT_PRIVACY_SETTINGS.terminalScrollbackRetention,
    externalSessionIndexingEnabled:
      typeof value.externalSessionIndexingEnabled === "boolean"
        ? value.externalSessionIndexingEnabled
        : DEFAULT_PRIVACY_SETTINGS.externalSessionIndexingEnabled,
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
    const gitBranch = typeof item.gitBranch === "string" ? item.gitBranch.trim() : undefined;
    const missionBrief = normalizeMissionBrief(item.missionBrief);

    if (!id || !label || !shortLabel || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    workspaces.push({
      id,
      label,
      shortLabel,
      ...(rootPath ? { rootPath } : {}),
      ...(gitBranch ? { gitBranch } : {}),
      ...(missionBrief ? { missionBrief } : {}),
    });
  }

  return workspaces;
}

function normalizeMissionBrief(value: unknown): WorkspaceMissionBrief | undefined {
  if (!isRecord(value)) return undefined;

  const goal = normalizeMissionLine(value.goal, 320);
  const doneWhen = normalizeMissionList(value.doneWhen);
  const guardrails = normalizeMissionList(value.guardrails);

  if (!goal) return undefined;
  return { goal, doneWhen, guardrails };
}

function normalizeMissionList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of value) {
    const normalized = normalizeMissionLine(item, 240);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
    if (items.length >= 8) break;
  }

  return items;
}

function normalizeMissionLine(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
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

function normalizeViewStateByWorkspace(value: unknown): Record<string, WorkspaceViewState> {
  if (!isRecord(value)) return {};

  const viewStateByWorkspace: Record<string, WorkspaceViewState> = {};
  for (const [workspaceId, rawViewState] of Object.entries(value)) {
    if (!workspaceId.trim() || !isRecord(rawViewState)) continue;
    const collapsedSessionIds = normalizeStringList(rawViewState.collapsedSessionIds);
    const contextDrawerOpen = typeof rawViewState.contextDrawerOpen === "boolean" ? rawViewState.contextDrawerOpen : undefined;
    const dispatchTarget = normalizeDispatchTarget(rawViewState.dispatchTarget);
    const workMode = normalizeWorkMode(rawViewState.workMode);
    const selectedSessionId =
      typeof rawViewState.selectedSessionId === "string" && rawViewState.selectedSessionId.trim()
        ? rawViewState.selectedSessionId.trim()
        : undefined;

    if (!collapsedSessionIds.length && contextDrawerOpen === undefined && !dispatchTarget && !workMode && !selectedSessionId) {
      continue;
    }
    viewStateByWorkspace[workspaceId] = {
      ...(collapsedSessionIds.length === 0 ? {} : { collapsedSessionIds }),
      ...(contextDrawerOpen === undefined ? {} : { contextDrawerOpen }),
      ...(dispatchTarget === undefined ? {} : { dispatchTarget }),
      ...(workMode === undefined ? {} : { workMode }),
      ...(selectedSessionId === undefined ? {} : { selectedSessionId }),
    };
  }

  return viewStateByWorkspace;
}

function normalizeWorkMode(value: unknown): WorkMode | undefined {
  return value === "desk" || value === "focus" || value === "split" ? value : undefined;
}

function normalizeDispatchTarget(value: unknown): DispatchTargetSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const kind = value.kind === "session" || value.kind === "workspace" ? value.kind : undefined;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const label = typeof value.label === "string" ? value.label.trim() : "";
  if (!kind || !id || !label) return undefined;
  return { kind, id, label };
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
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
      ...(isTerminalSessionIsolation(session.isolation) ? { isolation: session.isolation } : {}),
      ...(typeof session.safetyNote === "string" ? { safetyNote: session.safetyNote } : {}),
      ...(isAlfredLaunchPreflight(session.launchPreflight) ? { launchPreflight: cloneLaunchPreflight(session.launchPreflight) } : {}),
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

function isTerminalSessionIsolation(value: unknown): value is TerminalSessionIsolation {
  return value === "shared" || value === "worktree";
}

function normalizeRestoredTerminalSessions(
  value: unknown,
  privacySettings: DesktopPrivacySettings,
): PersistedTerminalSessionSnapshot[] {
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
    const activityEvents = Array.isArray(item.activityEvents) ? normalizeActivityEvents(item.activityEvents) : undefined;
    const buffer =
      privacySettings.terminalScrollbackRetention === "off"
        ? ""
        : redactText(tailText(item.buffer, MAX_PERSISTED_TERMINAL_SCROLLBACK_LENGTH));

    sessions.push({
      clientId,
      title: redactText(item.title),
      source: item.source,
      cwd: item.cwd,
      shell: item.shell,
      buffer,
      ...(isAgentKind(item.agentKind) ? { agentKind: item.agentKind } : {}),
      ...(typeof item.workspaceId === "string" ? { workspaceId: item.workspaceId } : {}),
      ...(isTerminalSessionIsolation(item.isolation) ? { isolation: item.isolation } : {}),
      ...(typeof item.branchName === "string" ? { branchName: item.branchName } : {}),
      ...(typeof item.baseCwd === "string" ? { baseCwd: item.baseCwd } : {}),
      ...(typeof item.createdAt === "number" ? { createdAt: item.createdAt } : {}),
      ...(typeof item.command === "string" ? { command: item.command } : {}),
      ...(Array.isArray(item.args) && item.args.every((arg) => typeof arg === "string")
        ? { args: [...item.args] }
        : {}),
      ...(isTerminalResumeTarget(item.resumeTarget) ? { resumeTarget: { ...item.resumeTarget } } : {}),
      ...(typeof item.lastActivityAt === "number" ? { lastActivityAt: item.lastActivityAt } : {}),
      ...(typeof item.lastOutputAt === "number" ? { lastOutputAt: item.lastOutputAt } : {}),
      ...(privacySettings.terminalScrollbackRetention === "off" || activityEvents === undefined
        ? {}
        : { activityEvents: redactActivityEvents(activityEvents) }),
    });
  }

  return sessions;
}

function redactActivityEvents(events: SessionActivityEvent[]): SessionActivityEvent[] {
  return events.map((event) => {
    const payload = event.payload === undefined ? undefined : normalizeActivityPayload(redactUnknown(event.payload), event.kind);
    return {
      ...event,
      title: redactText(event.title),
      detail: redactText(event.detail),
      ...(payload === undefined ? {} : { payload }),
    };
  });
}

function isTerminalSessionSource(value: unknown): value is TerminalSessionSource {
  return value === "manual" || value === "alfred";
}

function isTerminalResumeTarget(value: unknown): value is TerminalResumeTarget {
  if (!isRecord(value)) return false;
  return (
    value.agentKind === "codex" &&
    typeof value.sessionId === "string" &&
    value.sessionId.trim().length > 0 &&
    (value.source === "codex-session-index" || value.source === "external-session-index")
  );
}

function normalizeWindowState(value: unknown): DesktopWindowState {
  if (!isRecord(value) || !isRecord(value.bounds)) {
    return cloneWindowState(DEFAULT_DESKTOP_WINDOW_STATE);
  }

  const width = normalizeWindowDimension(value.bounds.width, DEFAULT_DESKTOP_WINDOW_STATE.bounds.width, 1120);
  const height = normalizeWindowDimension(value.bounds.height, DEFAULT_DESKTOP_WINDOW_STATE.bounds.height, 720);
  const x = normalizeWindowPosition(value.bounds.x);
  const y = normalizeWindowPosition(value.bounds.y);

  return {
    bounds: {
      width,
      height,
      ...(x === undefined ? {} : { x }),
      ...(y === undefined ? {} : { y }),
    },
    maximized: value.maximized === true,
  };
}

function normalizeWindowDimension(value: unknown, fallback: number, minimum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(Math.round(value), minimum);
}

function normalizeWindowPosition(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.round(value);
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
    workspaces: state.workspaces.map((workspace) => ({
      ...workspace,
      ...(workspace.missionBrief ? { missionBrief: cloneMissionBrief(workspace.missionBrief) } : {}),
    })),
    activeWorkspaceId: state.activeWorkspaceId,
    layoutsByWorkspace: Object.fromEntries(
      Object.entries(state.layoutsByWorkspace).map(([workspaceId, layouts]) => [
        workspaceId,
        Object.fromEntries(Object.entries(layouts).map(([tileId, layout]) => [tileId, { ...layout }])),
      ]),
    ),
    viewStateByWorkspace: Object.fromEntries(
      Object.entries(state.viewStateByWorkspace).map(([workspaceId, viewState]) => [workspaceId, { ...viewState }]),
    ),
    stagedPlan: cloneStagedPlan(state.stagedPlan),
    restoredTerminalSessions: state.restoredTerminalSessions.map((session) => cloneRestoredTerminalSession(session)),
    windowState: cloneWindowState(state.windowState),
    privacySettings: { ...state.privacySettings },
  };
}

function tailText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(-maxLength) : value;
}

function cloneMissionBrief(brief: WorkspaceMissionBrief): WorkspaceMissionBrief {
  return {
    goal: brief.goal,
    doneWhen: [...brief.doneWhen],
    guardrails: [...brief.guardrails],
  };
}

function cloneStagedPlan(plan: AlfredStagedPlanSnapshot | null): AlfredStagedPlanSnapshot | null {
  if (!plan) return null;
  return {
    ...plan,
    sessions: plan.sessions.map((session) => ({
      ...session,
      args: [...session.args],
      ...(session.launchPreflight === undefined ? {} : { launchPreflight: cloneLaunchPreflight(session.launchPreflight) }),
    })),
  };
}

function isAlfredLaunchPreflight(value: unknown): value is NonNullable<AlfredStagedPlanSnapshot["sessions"][number]["launchPreflight"]> {
  if (!isRecord(value) || typeof value.status !== "string" || typeof value.label !== "string") return false;
  if (value.status === "ready") {
    return typeof value.detail === "string";
  }
  if (value.status === "blocked") {
    return (
      isLaunchPreflightBlockCode(value.code) &&
      typeof value.reason === "string" &&
      (value.detail === undefined || typeof value.detail === "string")
    );
  }
  return false;
}

function isLaunchPreflightBlockCode(value: unknown): boolean {
  return value === "command_missing" || value === "cwd_outside_workspace" || value === "git_not_ready" || value === "no_workspace";
}

function cloneLaunchPreflight<T extends NonNullable<AlfredStagedPlanSnapshot["sessions"][number]["launchPreflight"]>>(
  value: T,
): T {
  return { ...value };
}

function cloneRestoredTerminalSession(session: PersistedTerminalSessionSnapshot): PersistedTerminalSessionSnapshot {
  return {
    ...session,
    ...(session.args === undefined ? {} : { args: [...session.args] }),
    ...(session.resumeTarget === undefined ? {} : { resumeTarget: { ...session.resumeTarget } }),
    ...(session.activityEvents === undefined ? {} : { activityEvents: cloneActivityEvents(session.activityEvents) }),
  };
}

function cloneWindowState(state: DesktopWindowState): DesktopWindowState {
  return {
    bounds: { ...state.bounds },
    maximized: state.maximized,
  };
}

function normalizeActivityEvents(value: unknown[]): SessionActivityEvent[] {
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (
      typeof item.id !== "string" ||
      !isSessionActivityEventKind(item.kind) ||
      typeof item.title !== "string" ||
      typeof item.detail !== "string" ||
      typeof item.at !== "number"
    ) {
      return [];
    }

    const payload = normalizeActivityPayload(item.payload, item.kind);
    return [{
      id: item.id,
      kind: item.kind,
      title: item.title,
      detail: item.detail,
      at: item.at,
      ...(payload === undefined ? {} : { payload }),
    }];
  });
}

function cloneActivityEvents(events: SessionActivityEvent[]): SessionActivityEvent[] {
  return events.map((event) => ({
    ...event,
    ...(event.payload === undefined ? {} : { payload: { ...event.payload } }),
  }));
}

function isSessionActivityEventKind(value: unknown): value is SessionActivityEventKind {
  return (
    value === "approval" ||
    value === "command" ||
    value === "error" ||
    value === "file" ||
    value === "lifecycle" ||
    value === "output" ||
    value === "plan" ||
    value === "tool" ||
    value === "warning"
  );
}

function normalizeActivityPayload(
  value: unknown,
  kind: SessionActivityEventKind,
): SessionActivityPayload | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;

  if (value.type === "command" && kind === "command" && typeof value.command === "string") {
    return { type: "command", command: value.command };
  }

  if (
    value.type === "file" &&
    kind === "file" &&
    isFileActivityOperation(value.operation) &&
    typeof value.path === "string"
  ) {
    return { type: "file", operation: value.operation, path: value.path };
  }

  if (
    value.type === "tool" &&
    kind === "tool" &&
    typeof value.name === "string" &&
    typeof value.input === "string"
  ) {
    return { type: "tool", name: value.name, input: value.input };
  }

  if (value.type === "plan" && kind === "plan" && typeof value.summary === "string") {
    return { type: "plan", summary: value.summary };
  }

  if (value.type === "approval" && kind === "approval" && typeof value.prompt === "string") {
    return { type: "approval", prompt: value.prompt };
  }

  if (value.type === "error" && kind === "error" && typeof value.message === "string") {
    return { type: "error", message: value.message };
  }

  if (value.type === "warning" && kind === "warning" && typeof value.message === "string") {
    return { type: "warning", message: value.message };
  }

  return undefined;
}

function isFileActivityOperation(
  value: unknown,
): value is Extract<SessionActivityPayload, { type: "file" }>["operation"] {
  return (
    value === "created" ||
    value === "deleted" ||
    value === "edited" ||
    value === "read" ||
    value === "renamed" ||
    value === "updated" ||
    value === "wrote"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
