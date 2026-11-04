import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { REDACTED, redactArgs, redactSecrets, redactText, redactUnknown } from "@alfred/schema";
import { checkSafety } from "../shared/terminal-command-safety.js";
import type { AlfredStagedPlanSnapshot, AgentKind } from "../shared/alfred-ipc.js";
import { clampRailWidth, type DispatchTargetSnapshot, type WorkspaceViewState } from "../shared/layout-ipc.js";
import type {
  SessionActivityEvent,
  SessionActivityEventKind,
  SessionActivityPayload,
} from "../shared/session-activity.js";
import {
  isAgentConversationId,
  type PersistedTerminalSessionSnapshot,
  type TerminalResumeTarget,
  type TerminalSessionSource,
} from "../shared/terminal-ipc.js";
import type { WorkspaceMissionBrief, WorkspaceSnapshot, WorkspaceStateSnapshot } from "../shared/workspace-ipc.js";

export const DESKTOP_STATE_VERSION = 1;
export const DESKTOP_STATE_FILE_NAME = "desktop-state.json";
export const MAX_PERSISTED_TERMINAL_SCROLLBACK_LENGTH = 80_000;
/**
 * Redaction needs a secret's start, such as "ghp_" or a key's BEGIN line, so it reads this much of the scrollback
 * before the tail that is kept.
 * ponytail: a secret longer than this that the tail cuts through keeps its end; redacting output as it arrives would not.
 */
export const SCROLLBACK_REDACTION_MARGIN = 16_000;

export type TerminalScrollbackRetention = "off" | "redactedTail";

export type DesktopPrivacySettings = {
  terminalScrollbackRetention: TerminalScrollbackRetention;
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
  viewStateByWorkspace: Record<string, WorkspaceViewState>;
  railWidth?: number;
  stagedPlans: Record<string, AlfredStagedPlanSnapshot>;
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

type DesktopStateReadResult = {
  state: DesktopStateSnapshot;
  rewrite: boolean;
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
};

export const DEFAULT_DESKTOP_STATE: DesktopStateSnapshot = {
  workspaces: [DEFAULT_WORKSPACE],
  activeWorkspaceId: DEFAULT_WORKSPACE.id,
  viewStateByWorkspace: {},
  stagedPlans: {},
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
  let hydrationPromise: Promise<void> | null = null;

  const hydrate = (): Promise<void> => {
    if (hydrated) return Promise.resolve();
    if (hydrationPromise) return hydrationPromise;

    const hydration = enqueueMutation(async () => {
      if (hydrated) return;
      await removeUnfinishedSaves(filePath);
      const result = await readDesktopStateFile(filePath, options.onWarning);
      cachedState = result.state;
      hydrated = true;
      if (result.rewrite) {
        // A failed migration write must not block startup: the state was read fine,
        // persistState already records saveFailed and retrySave can write it again.
        // The file it replaces predates this build's redaction, so it is not kept as the previous save.
        await persistState(result.state, false).catch(() => undefined);
      }
    });
    hydrationPromise = hydration;
    void hydration.catch(() => {
      if (hydrationPromise === hydration) hydrationPromise = null;
    });
    return hydration;
  };

  const enqueueMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const persistState = async (state: DesktopStateSnapshot, keepPrevious = true): Promise<DesktopStateSnapshot> => {
    const nextState = normalizeDesktopState(state);
    const diskState = { ...nextState, stagedPlans: redactStagedPlansForDisk(nextState) };

    try {
      await writeDesktopStateFile(filePath, diskState, keepPrevious);
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

      // After a failed save, readers see the same unsaved state that mutations build on.
      return cloneDesktopState(failedState ?? cachedState);
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
      const hydration = failedState ? Promise.resolve() : hydrate();
      return enqueueMutation(async () => {
        if (!failedState) {
          await hydration;
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
      const hydration = failedState ? Promise.resolve() : hydrate();
      return enqueueMutation(async () => {
        await hydration;
        return persistState(await updater(cloneDesktopState(failedState ?? cachedState)));
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
    // Builds before the retired tile grid was removed also saved layoutsByWorkspace and a work mode; both are dropped.
    viewStateByWorkspace: normalizeViewStateByWorkspace(value.viewStateByWorkspace),
    ...(typeof value.railWidth === "number" ? { railWidth: clampRailWidth(value.railWidth) } : {}),
    stagedPlans: normalizeStagedPlans(value.stagedPlans, value.stagedPlan, activeWorkspaceId),
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

function normalizeViewStateByWorkspace(value: unknown): Record<string, WorkspaceViewState> {
  if (!isRecord(value)) return {};

  const viewStateByWorkspace: Record<string, WorkspaceViewState> = {};
  for (const [workspaceId, rawViewState] of Object.entries(value)) {
    if (!workspaceId.trim() || !isRecord(rawViewState)) continue;
    const dispatchTarget = normalizeDispatchTarget(rawViewState.dispatchTarget);
    const previewDockOpen = typeof rawViewState.previewDockOpen === "boolean"
      ? rawViewState.previewDockOpen
      : undefined;
    const selectedSessionId =
      typeof rawViewState.selectedSessionId === "string" && rawViewState.selectedSessionId.trim()
        ? rawViewState.selectedSessionId.trim()
        : undefined;

    if (!dispatchTarget && previewDockOpen === undefined && !selectedSessionId) continue;
    viewStateByWorkspace[workspaceId] = {
      ...(dispatchTarget === undefined ? {} : { dispatchTarget }),
      ...(previewDockOpen === undefined ? {} : { previewDockOpen }),
      ...(selectedSessionId === undefined ? {} : { selectedSessionId }),
    };
  }

  return viewStateByWorkspace;
}

function normalizeDispatchTarget(value: unknown): DispatchTargetSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const kind = value.kind === "session" || value.kind === "workspace" ? value.kind : undefined;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const label = typeof value.label === "string" ? value.label.trim() : "";
  if (!kind || !id || !label) return undefined;
  return { kind, id, label };
}

function normalizeStagedPlans(
  value: unknown,
  legacy: unknown,
  activeWorkspaceId: string,
): Record<string, AlfredStagedPlanSnapshot> {
  const plans: Record<string, AlfredStagedPlanSnapshot> = {};
  if (isRecord(legacy) && typeof legacy.id === "string" && Array.isArray(legacy.sessions)) {
    const grouped = new Map<string, unknown[]>();
    for (const session of legacy.sessions) {
      if (!isRecord(session)) continue;
      const workspaceId = typeof session.workspaceId === "string" && session.workspaceId
        ? session.workspaceId : activeWorkspaceId;
      grouped.set(workspaceId, [...(grouped.get(workspaceId) ?? []), session]);
    }
    for (const [workspaceId, sessions] of grouped) {
      const plan = normalizeStagedPlan({ ...legacy, id: `${legacy.id}:${workspaceId}`, workspaceId, sessions });
      if (plan) plans[workspaceId] = plan;
    }
  }
  if (isRecord(value)) {
    for (const [workspaceId, item] of Object.entries(value)) {
      if (!isRecord(item) || item.workspaceId !== workspaceId) continue;
      const plan = normalizeStagedPlan(item);
      if (plan) plans[workspaceId] = plan;
    }
  }
  return plans;
}

function normalizeStagedPlan(value: unknown): AlfredStagedPlanSnapshot | null {
  if (!isRecord(value) || typeof value.workspaceId !== "string" || !value.workspaceId.trim() || typeof value.id !== "string" || typeof value.prompt !== "string" || !Array.isArray(value.sessions)) {
    return null;
  }

  const workspaceId = value.workspaceId;
  const sessions = value.sessions.flatMap((session) => {
    if (!isRecord(session)) return [];
    if (session.workspaceId !== undefined && session.workspaceId !== workspaceId) return [];
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
      workspaceId,
      ...(typeof session.safetyNote === "string" ? { safetyNote: session.safetyNote } : {}),
      ...(isAlfredLaunchPreflight(session.launchPreflight) ? { launchPreflight: cloneLaunchPreflight(session.launchPreflight) } : {}),
    }];
  });

  if (sessions.length === 0) return null;

  return {
    id: value.id,
    workspaceId: value.workspaceId,
    prompt: value.prompt,
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    sessions,
  };
}

function isAgentKind(value: unknown): value is AgentKind {
  return value === "codex" || value === "claude" || value === "dev-server" || value === "shell";
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
      !isTerminalSessionSource(item.source)
    ) {
      continue;
    }

    const clientId = item.clientId.trim();
    if (!clientId || seenClientIds.has(clientId)) continue;

    const activityEvents = Array.isArray(item.activityEvents) ? normalizeActivityEvents(item.activityEvents) : undefined;
    const legacyAgentKind = legacyGeneratedTerminalAgentKind(clientId, item.title, item.agentKind, item.command);
    const session = sanitizePersistedTerminalSession({
      clientId,
      title: item.title,
      source: item.source,
      ...(isAgentKind(item.agentKind)
        ? { agentKind: item.agentKind }
        : legacyAgentKind === undefined ? {} : { agentKind: legacyAgentKind }),
      ...(typeof item.workspaceId === "string" ? { workspaceId: item.workspaceId } : {}),
      ...(typeof item.createdAt === "number" ? { createdAt: item.createdAt } : {}),
      ...(typeof item.eventLogKey === "string" ? { eventLogKey: item.eventLogKey } : {}),
      ...(typeof item.cwd === "string" ? { cwd: item.cwd } : {}),
      ...(typeof item.shell === "string" ? { shell: item.shell } : {}),
      ...(typeof item.command === "string"
        ? { command: item.command }
        : legacyAgentKind === undefined ? {} : { command: legacyAgentKind }),
      ...(Array.isArray(item.args) && item.args.every((arg) => typeof arg === "string")
        ? { args: [...item.args] }
        : legacyAgentKind === undefined ? {} : { args: [] }),
      ...(isTerminalResumeTarget(item.resumeTarget) ? { resumeTarget: { ...item.resumeTarget } } : {}),
      ...(typeof item.parentClientId === "string" ? { parentClientId: item.parentClientId } : {}),
      ...(item.namedByYou === true ? { namedByYou: true as const } : {}),
      ...(typeof item.buffer === "string" ? { buffer: item.buffer } : {}),
      ...(activityEvents === undefined ? {} : { activityEvents }),
      ...(typeof item.lastActivityAt === "number" ? { lastActivityAt: item.lastActivityAt } : {}),
      ...(typeof item.lastOutputAt === "number" ? { lastOutputAt: item.lastOutputAt } : {}),
    }, privacySettings);
    seenClientIds.add(clientId);
    sessions.push(session);
  }

  return sessions;
}

/**
 * A saved session is asleep, and a title's number only tells sessions that run side by side apart, so saved ones lose
 * it: "Codex 3" and what builds before 2026-10-20 wrote, "Manual · zsh 3" and "Codex · session 3", become "Codex" and
 * "zsh". The agent kind the older titles imply is read from them before this runs.
 */
function currentGeneratedTitle(title: string): string {
  const match = /^(?:Manual · (zsh)|(Codex|Claude) · session|(zsh|Codex|Claude)) \d+$/.exec(title);
  return match ? (match[1] ?? match[2] ?? match[3])! : title;
}

function legacyGeneratedTerminalAgentKind(
  clientId: string,
  title: string,
  agentKind: unknown,
  command: unknown,
): "codex" | "claude" | undefined {
  if (agentKind !== undefined || command !== undefined) return undefined;
  const idMatch = /^manual-(\d+)$/.exec(clientId);
  const titleMatch = /^(Codex|Claude) · session (\d+)$/.exec(title);
  if (!idMatch || !titleMatch || idMatch[1] !== titleMatch[2]) return undefined;
  return titleMatch[1] === "Codex" ? "codex" : "claude";
}

export function sanitizePersistedTerminalSession(
  session: PersistedTerminalSessionSnapshot,
  privacySettings: DesktopPrivacySettings,
  clearLaunchData = false,
): PersistedTerminalSessionSnapshot {
  if (clearLaunchData || privacySettings.terminalScrollbackRetention === "off") return persistedSessionIdentity(session);
  // A launch that lost a secret would relaunch with the marker as a real argument, so it is not kept at all.
  const keepsLaunch = ![redactSecrets(session.command ?? ""), ...redactArgs(session.args ?? [])]
    .some((part) => part.includes(REDACTED));

  return {
    ...persistedSessionIdentity(session),
    ...(session.shell === undefined ? {} : { shell: session.shell }),
    ...(session.command === undefined || !keepsLaunch ? {} : { command: session.command }),
    ...(session.args === undefined || !keepsLaunch ? {} : { args: [...session.args] }),
    ...(session.buffer === undefined
      ? {}
      : {
          buffer: tailText(
            redactText(tailText(session.buffer, MAX_PERSISTED_TERMINAL_SCROLLBACK_LENGTH + SCROLLBACK_REDACTION_MARGIN)),
            MAX_PERSISTED_TERMINAL_SCROLLBACK_LENGTH,
          ),
        }),
    ...(session.activityEvents === undefined
      ? {}
      : { activityEvents: redactActivityEvents(session.activityEvents) }),
  };
}

/** What a session keeps while terminal data is not saved: enough to list it asleep and resume its conversation. */
export function persistedSessionIdentity(session: PersistedTerminalSessionSnapshot): PersistedTerminalSessionSnapshot {
  return {
    clientId: session.clientId.trim(),
    title: currentGeneratedTitle(redactText(session.title)),
    source: session.source,
    ...(session.agentKind === undefined ? {} : { agentKind: session.agentKind }),
    ...(session.workspaceId === undefined ? {} : { workspaceId: session.workspaceId }),
    ...(session.createdAt === undefined ? {} : { createdAt: session.createdAt }),
    ...(session.eventLogKey === undefined ? {} : { eventLogKey: session.eventLogKey }),
    ...(session.parentClientId === undefined ? {} : { parentClientId: session.parentClientId }),
    ...(session.namedByYou ? { namedByYou: true as const } : {}),
    ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
    ...(session.resumeTarget === undefined ? {} : { resumeTarget: { ...session.resumeTarget } }),
    ...(session.lastActivityAt === undefined ? {} : { lastActivityAt: session.lastActivityAt }),
    ...(session.lastOutputAt === undefined ? {} : { lastOutputAt: session.lastOutputAt }),
  };
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
  // Claude resumes take the id as an argument, so it must be a UUID, as from hooks.
  if (value.source === "agent-hook" || value.agentKind === "claude") {
    return (value.agentKind === "claude" || value.agentKind === "codex")
      && isAgentConversationId(value.sessionId)
      && (value.source === "agent-hook" || value.source === "external-session-index");
  }
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

function redactStagedPlansForDisk(state: DesktopStateSnapshot): Record<string, AlfredStagedPlanSnapshot> {
  if (state.privacySettings.terminalScrollbackRetention === "off") return {};
  return Object.fromEntries(Object.entries(state.stagedPlans).map(([workspaceId, plan]) => [workspaceId, {
    ...plan,
    prompt: redactText(plan.prompt),
    sessions: plan.sessions.map((session) => {
      const command = redactSecrets(session.command);
      const args = redactArgs(session.args);
      const safety = checkSafety(command, args);
      const safetyNote = session.safetyNote === undefined
        ? safety.unsafe ? safety.reason : undefined
        : redactText(session.safetyNote);
      return { ...session, command, args, ...(safetyNote === undefined ? {} : { safetyNote }) };
    }),
  }]));
}

async function readDesktopStateFile(
  filePath: string,
  onWarning: PersistedDesktopStateStoreOptions["onWarning"],
): Promise<DesktopStateReadResult> {
  const current = await readDesktopStateCopy(filePath).catch((error: unknown) => {
    onWarning?.("Failed to read desktop state.", error);
    throw new Error("Failed to read desktop state.", { cause: error });
  });
  if ("invalid" in current) await quarantineDesktopStateFile(filePath, current.invalid, current.cause, onWarning);
  if (!("parsed" in current)) {
    const previous = await readDesktopStateCopy(previousSavePath(filePath)).catch(() => ({ missing: true as const }));
    if ("parsed" in previous) {
      onWarning?.("Opened the previous save of desktop state.", undefined);
      return { state: normalizeDesktopState(previous.parsed), rewrite: true };
    }
    // shortcut: a reset to defaults reaches only onWarning (the console); show it once the renderer has a startup notice.
    return { state: cloneDesktopState(DEFAULT_DESKTOP_STATE), rewrite: false };
  }

  const { parsed } = current;
  const normalized = normalizeDesktopState(parsed);
  const normalizedFile = { version: DESKTOP_STATE_VERSION, ...normalized, stagedPlans: redactStagedPlansForDisk(normalized) };
  return {
    state: normalized,
    rewrite: JSON.stringify(parsed) !== JSON.stringify(normalizedFile),
  };
}

async function readDesktopStateCopy(
  filePath: string,
): Promise<{ parsed: Record<string, unknown> } | { missing: true } | { invalid: string; cause: unknown }> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { missing: true };
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return { invalid: "Failed to parse desktop state; preserved invalid file.", cause: error };
  }
  if (!isRecord(parsed) || parsed.version !== DESKTOP_STATE_VERSION) {
    return { invalid: "Unsupported desktop state version; preserved invalid file.", cause: parsed };
  }
  return { parsed };
}

/** The state file as the save before the last one left it, opened when the state file is torn or missing. */
function previousSavePath(filePath: string): string {
  return `${filePath}.bak`;
}

async function quarantineDesktopStateFile(
  filePath: string,
  message: string,
  cause: unknown,
  onWarning: PersistedDesktopStateStoreOptions["onWarning"],
): Promise<void> {
  const extension = path.extname(filePath);
  const quarantinePath = path.join(
    path.dirname(filePath),
    `${path.basename(filePath, extension)}.invalid-${Date.now()}${extension}`,
  );

  try {
    await rename(filePath, quarantinePath);
  } catch (error) {
    onWarning?.("Failed to preserve invalid desktop state.", error);
    throw new Error("Failed to preserve invalid desktop state.", { cause: error });
  }

  onWarning?.(message, cause);
}

/** Older copies of the state file: the previous save and quarantined invalid files. */
export async function removeDesktopStateCopies(filePath: string): Promise<void> {
  await rm(previousSavePath(filePath), { force: true });
  const directory = path.dirname(filePath);
  const extension = path.extname(filePath);
  const prefix = `${path.basename(filePath, extension)}.invalid-`;
  const names = await readdir(directory).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  });
  await Promise.all(names
    .filter((name) => name.startsWith(prefix)
      && name.endsWith(extension)
      && /^\d+$/.test(name.slice(prefix.length, name.length - extension.length)))
    .map((name) => rm(path.join(directory, name), { force: true })));
}

async function writeDesktopStateFile(filePath: string, state: DesktopStateSnapshot, keepPrevious: boolean): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });

  const fileState: DesktopStateFile = {
    version: DESKTOP_STATE_VERSION,
    ...cloneDesktopState(state),
  };
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(fileState, null, 2)}\n`, { encoding: "utf8", flush: true });
    await rename(filePath, previousSavePath(filePath)).catch((error: unknown) => {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    });
    await rename(temporaryPath, filePath);
    if (!keepPrevious) await rm(previousSavePath(filePath), { force: true });
  } catch (error) {
    // The copy holds scrollback and commands, which Clear saved transcripts would not reach.
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Copies that saves left unfinished, cut short by a quit or a crash. Alfred holds a single-instance lock before it
 * opens its state, so no other process is writing one.
 */
async function removeUnfinishedSaves(filePath: string): Promise<void> {
  const directory = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.`;
  const names = await readdir(directory).catch(() => []);
  await Promise.all(names
    .filter((name) => name.startsWith(prefix) && name.endsWith(".tmp"))
    .map((name) => rm(path.join(directory, name), { force: true }).catch(() => undefined)));
}

function cloneDesktopState(state: DesktopStateSnapshot): DesktopStateSnapshot {
  return {
    workspaces: state.workspaces.map((workspace) => ({
      ...workspace,
      ...(workspace.missionBrief ? { missionBrief: cloneMissionBrief(workspace.missionBrief) } : {}),
    })),
    activeWorkspaceId: state.activeWorkspaceId,
    viewStateByWorkspace: Object.fromEntries(
      Object.entries(state.viewStateByWorkspace).map(([workspaceId, viewState]) => [workspaceId, { ...viewState }]),
    ),
    ...(state.railWidth === undefined ? {} : { railWidth: state.railWidth }),
    stagedPlans: Object.fromEntries(Object.entries(state.stagedPlans).map(([id, plan]) => [id, cloneStagedPlan(plan)])),
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

function cloneStagedPlan(plan: AlfredStagedPlanSnapshot): AlfredStagedPlanSnapshot {
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
  return value === "command_missing" || value === "cwd_missing" || value === "cwd_outside_workspace" || value === "no_workspace";
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
    value === "prompt" ||
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
    return {
      type: "command",
      command: value.command,
      ...(typeof value.description === "string" ? { description: value.description } : {}),
    };
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
