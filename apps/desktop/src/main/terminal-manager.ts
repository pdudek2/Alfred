import { BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactText, redactUnknown } from "@alfred/schema";
import {
  appendActivityEvent,
  classifyTerminalOutputChunk,
  type SessionActivityEvent,
  type SessionActivityPayload,
  type TerminalOutputActivityChunkResult,
  type TerminalOutputActivityStreamState,
} from "../shared/session-activity.js";
import { normalizeAgentCommand } from "../shared/agent-command.js";
import { scratchWorkspacePath } from "./codex-scratch.js";
import {
  terminalChannels,
  type PersistedTerminalSessionSnapshot,
  type TerminalCreateRequest,
  type TerminalCreateResult,
  type TerminalForgetRequest,
  type TerminalExitEvent,
  type TerminalKillRequest,
  type TerminalListResult,
  type TerminalRenameRequest,
  type TerminalResizeRequest,
  type TerminalSessionSnapshot,
  type TerminalSessionId,
  type TerminalSessionSource,
  type TerminalSnapshotRequest,
  type TerminalSnapshotResult,
  type TerminalWriteRequest,
  type TerminalWorktreeApplyRequest,
  type TerminalWorktreeApplyResult,
  type TerminalWorktreeDiffRequest,
  type TerminalWorktreeDiffResult,
} from "../shared/terminal-ipc.js";
import { checkSafety } from "./alfred-safety.js";
import {
  applyAgentWorktreePatch as defaultApplyAgentWorktreePatch,
  cleanupAgentWorktree as defaultCleanupAgentWorktree,
  inspectAgentWorktree as defaultInspectAgentWorktree,
  isSafeAgentWorktreeCleanupRequest,
  prepareAgentWorktree as defaultPrepareAgentWorktree,
  type AgentWorktreeCleanupRequest,
  type AgentWorktreeResult,
} from "./git-worktree.js";
import type { DesktopPrivacySettings, PersistedDesktopStateStore } from "./persisted-desktop-state.js";
import { canonicalWorkspacePath, isAllowedWorkspacePath } from "./workspace-path.js";

type PtyProcess = import("node-pty").IPty;
type NodePtyModule = typeof import("node-pty");
type ApplyAgentWorktreePatch = typeof defaultApplyAgentWorktreePatch;
type CleanupAgentWorktree = typeof defaultCleanupAgentWorktree;
type InspectAgentWorktree = typeof defaultInspectAgentWorktree;
type WorktreeOperationSession = {
  baseCwd?: string | undefined;
  branchName?: string | undefined;
  cwd?: string | undefined;
  isolation?: TerminalCreateResult["isolation"] | undefined;
};
type TerminalIpcOptions = {
  allowedCwdRoots?: () => Promise<string[]>;
  applyAgentWorktreePatch?: ApplyAgentWorktreePatch;
  cleanupAgentWorktree?: typeof defaultCleanupAgentWorktree;
  inspectAgentWorktree?: InspectAgentWorktree;
  isStagedCommandAllowed?: (request: Pick<TerminalCreateRequest, "args" | "clientId" | "command">) => Promise<boolean>;
  launchTicketTtlMs?: number;
  loadNodePty?: () => Promise<NodePtyModule>;
  managedWorktreeRootPath?: string;
  prepareAgentWorktree?: typeof defaultPrepareAgentWorktree;
  requireLaunchTickets?: boolean;
  scratchRootPath?: string;
};

type LaunchTicket = {
  expiresAt: number;
  fingerprint: string;
  restoredClientId?: string;
};

type TerminalSession = {
  id: TerminalSessionId;
  clientId?: string;
  title: string;
  source: TerminalSessionSource;
  agentKind?: TerminalCreateResult["agentKind"];
  workspaceId?: string;
  cwd: string;
  isolation?: TerminalCreateResult["isolation"];
  branchName?: string;
  baseCwd?: string;
  createdAt: number;
  shell: string;
  command?: string;
  args?: string[];
  resumeTarget?: TerminalCreateResult["resumeTarget"];
  buffer: string;
  activityEvents?: SessionActivityEvent[];
  activityStream: TerminalOutputActivityStreamState;
  lastActivityAt?: number;
  lastOutputAt?: number;
  pty: PtyProcess;
  // PTY lifetime is app-scoped; BrowserWindows may close and reattach later.
  window?: BrowserWindow;
  ownerWindowId: number;
};

const sessions = new Map<TerminalSessionId, TerminalSession>();
const restoredSessionSnapshots = new Map<string, PersistedTerminalSessionSnapshot>();
const forgottenClientIds = new Set<string>();
const require = createRequire(import.meta.url);
const NODE_PTY_HELPER_MODE = 0o755;
const MAX_BUFFER_LENGTH = 200_000;
const MAX_PERSISTED_BUFFER_LENGTH = 80_000;
let persistedStateStore: PersistedDesktopStateStore | null = null;
let persistenceHydrated = false;
let persistenceHydration: Promise<void> | null = null;
let persistenceHydrationMutations: Set<string> | null = null;
let persistenceGeneration = 0;
let persistDebounceMs = 250;
let persistTimer: NodeJS.Timeout | null = null;

export function configureTerminalPersistence(
  store: PersistedDesktopStateStore,
  options: { debounceMs?: number } = {},
): void {
  persistedStateStore = store;
  persistenceHydrated = false;
  persistenceHydration = null;
  persistenceHydrationMutations = null;
  persistenceGeneration += 1;
  restoredSessionSnapshots.clear();
  forgottenClientIds.clear();
  persistDebounceMs = options.debounceMs ?? 250;
}

export function resetTerminalPersistenceForTests(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistedStateStore = null;
  persistenceHydrated = false;
  persistenceHydration = null;
  persistenceHydrationMutations = null;
  persistenceGeneration += 1;
  restoredSessionSnapshots.clear();
  forgottenClientIds.clear();
  persistDebounceMs = 250;
}

export function registerTerminalIpc(options: TerminalIpcOptions = {}): void {
  const launchTickets = new Map<string, LaunchTicket>();
  const restoredLaunchReservations = new Map<string, string>();
  const clientIdsInFlight = new Set<string>();

  ipcMain.handle(terminalChannels.list, async (event): Promise<TerminalListResult> => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window) {
      return { sessions: [] };
    }

    await hydratePersistedTerminalSessions();
    const visibleSessions = [...sessions.values()].filter((session) => canAttachToWindow(session, window));
    const liveClientIds = new Set(
      visibleSessions.map((session) => session.clientId).filter((clientId): clientId is string => Boolean(clientId)),
    );

    for (const session of visibleSessions) {
      attachSessionWindow(session, window);
    }

    return {
      sessions: visibleSessions.map(toSnapshot),
      restoredSessions: [...restoredSessionSnapshots.values()].filter(
        (session) => !liveClientIds.has(session.clientId),
      ),
    };
  });

  ipcMain.handle(
    terminalChannels.snapshot,
    async (event, request: TerminalSnapshotRequest): Promise<TerminalSnapshotResult> => {
      const session = getOwnedSession(event.sender, request.id);
      return session ? toSnapshot(session) : null;
    },
  );

  ipcMain.handle(
    terminalChannels.prepareLaunch,
    async (_event, request: TerminalCreateRequest) => {
      const safeRequest = validateTerminalCreateRequest(request);
      const isPersistedRestoredLaunch = await validateTerminalCommandApproval(safeRequest, options.isStagedCommandAllowed, {
        allowPersistedRestoredLaunch: true,
      });
      await resolveValidatedTerminalCwd(safeRequest, options);
      const launchTicketId = randomUUID();
      const expiresAt = Date.now() + (options.launchTicketTtlMs ?? 2 * 60 * 1000);
      const ticket: LaunchTicket = {
        expiresAt,
        fingerprint: launchFingerprint(safeRequest, options),
        ...(isPersistedRestoredLaunch && safeRequest.clientId
          ? { restoredClientId: safeRequest.clientId }
          : {}),
      };
      if (ticket.restoredClientId) {
        const previousTicketId = restoredLaunchReservations.get(ticket.restoredClientId);
        if (previousTicketId) {
          launchTickets.delete(previousTicketId);
        }
        restoredLaunchReservations.set(ticket.restoredClientId, launchTicketId);
      }
      launchTickets.set(launchTicketId, ticket);
      return { launchTicketId, expiresAt };
    },
  );

  ipcMain.handle(
    terminalChannels.create,
    async (event, request: TerminalCreateRequest): Promise<TerminalCreateResult> => {
      const window = BrowserWindow.fromWebContents(event.sender);

      if (!window) {
        throw new Error("Terminal session requires an owning window.");
      }

      const safeRequest = validateTerminalCreateRequest(request);
      const requiresLaunchTicket = Boolean(options.requireLaunchTickets && requestRequiresLaunchTicket(safeRequest));
      if (requiresLaunchTicket) {
        consumeLaunchTicket(
          safeRequest,
          launchTickets,
          restoredLaunchReservations,
          options,
        );
      }
      const reservedClientId = safeRequest.clientId;
      if (reservedClientId) {
        if (clientIdsInFlight.has(reservedClientId) || findLiveSessionByClientId(reservedClientId)) {
          throw new Error("Terminal client id is already active.");
        }
        clientIdsInFlight.add(reservedClientId);
      }
      try {
        if (!requiresLaunchTicket) {
          await validateTerminalCommandApproval(safeRequest, options.isStagedCommandAllowed);
        }
      } catch (error) {
        if (reservedClientId) clientIdsInFlight.delete(reservedClientId);
        throw error;
      }
      let session: TerminalSession;
      try {
        const canonicalCwd = await resolveValidatedTerminalCwd(safeRequest, options);
        const launchCwd = await resolveLaunchCwd(
          safeRequest,
          options.prepareAgentWorktree ?? defaultPrepareAgentWorktree,
          {
            ...terminalWorktreeOptions(options),
            ...(options.scratchRootPath === undefined ? {} : { scratchRootPath: options.scratchRootPath }),
          },
          canonicalCwd,
        );
        const cwd = typeof launchCwd === "string" ? launchCwd : launchCwd.cwd;
        await ensureScratchCwdExists(cwd, options.scratchRootPath);
        const nodePty = await (options.loadNodePty ?? loadNodePty)();
        const resolved = resolveCommand(safeRequest);
        const id = randomUUID();
        const metadata = sessionMetadata(id, safeRequest, launchCwd, resolved.command, Date.now());
        const pty = nodePty.spawn(resolved.command, resolved.args, {
          name: "xterm-256color",
          cols: normalizeDimension(request.cols, 80),
          rows: normalizeDimension(request.rows, 24),
          cwd,
          env: {
            ...process.env,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
          },
        });
        session = {
          ...metadata,
          buffer: "",
          activityEvents: [],
          activityStream: { carry: "" },
          ownerWindowId: window.id,
          pty,
          window,
        };

        sessions.set(id, session);
      } catch (error) {
        if (reservedClientId) clientIdsInFlight.delete(reservedClientId);
        throw error;
      }
      if (reservedClientId) clientIdsInFlight.delete(reservedClientId);
      if (session.clientId) {
        forgottenClientIds.delete(session.clientId);
      }
      rememberSessionSnapshot(session);

      session.pty.onData((data) => {
        const now = Date.now();
        appendToBuffer(session, data);
        session.lastOutputAt = now;
        const activities = recordOutputActivity(session, data, now);
        rememberSessionSnapshot(session);
        sendToSessionWindow(session, terminalChannels.data, {
          id: session.id,
          ...(session.clientId === undefined ? {} : { clientId: session.clientId }),
          data,
          activities,
        });
      });

      session.pty.onExit(({ exitCode, signal }) => {
        recordSessionActivity(session, {
          kind: "lifecycle",
          title: "Process exited",
          detail: `The terminal process exited with code ${exitCode}.`,
        });
        rememberSessionSnapshot(session);
        disposeSession(session.id);
        const identity = {
          id: session.id,
          ...(session.clientId === undefined ? {} : { clientId: session.clientId }),
        };
        const payload: TerminalExitEvent = signal === undefined
          ? { ...identity, exitCode }
          : { ...identity, exitCode, signal };
        sendToSessionWindow(session, terminalChannels.exit, payload);
      });

      return toCreateResult(session);
    },
  );

  ipcMain.on(terminalChannels.write, (event, request: TerminalWriteRequest) => {
    const session = getOwnedSession(event.sender, request.id);
    session?.pty.write(request.data);
  });

  ipcMain.on(terminalChannels.resize, (event, request: TerminalResizeRequest) => {
    const session = getOwnedSession(event.sender, request.id);
    session?.pty.resize(normalizeDimension(request.cols, 80), normalizeDimension(request.rows, 24));
  });

  ipcMain.on(terminalChannels.kill, (event, request: TerminalKillRequest) => {
    if (getOwnedSession(event.sender, request.id)) {
      killSession(request.id, {
        ...(request.cleanupWorktree
          ? {
              cleanupAgentWorktree: options.cleanupAgentWorktree ?? defaultCleanupAgentWorktree,
              ...terminalWorktreeOptions(options),
            }
          : {}),
        forgetSnapshot: true,
      });
    }
  });

  ipcMain.on(terminalChannels.forget, (event, request: TerminalForgetRequest) => {
    const liveSession = findLiveSessionByClientId(request.clientId);
    if (liveSession) {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || !canAttachToWindow(liveSession, window)) {
        return;
      }
      return;
    }

    const session = restoredSessionSnapshots.get(request.clientId);
    forgetPersistedSession(request.clientId);
    if (request.cleanupWorktree) {
      cleanupSessionWorktree(session, options.cleanupAgentWorktree ?? defaultCleanupAgentWorktree, {
        force: true,
        ...terminalWorktreeOptions(options),
      });
    }
  });

  ipcMain.handle(terminalChannels.rename, async (event, request: TerminalRenameRequest): Promise<void> => {
    const title = normalizedSessionTitle(request.title);
    if (!title) {
      throw new Error("Session title is required.");
    }

    const window = BrowserWindow.fromWebContents(event.sender);
    const liveSession = [...sessions.values()].find(
      (session) => session.clientId === request.clientId && (!window || canAttachToWindow(session, window)),
    );

    if (liveSession) {
      liveSession.title = title;
      rememberSessionSnapshot(liveSession);
      return;
    }

    const restoredSession = restoredSessionSnapshots.get(request.clientId);
    if (restoredSession) {
      restoredSessionSnapshots.set(request.clientId, { ...restoredSession, title });
      scheduleTerminalPersistence();
    }
  });

  ipcMain.handle(
    terminalChannels.worktreeDiff,
    async (event, request: TerminalWorktreeDiffRequest): Promise<TerminalWorktreeDiffResult> => {
      const operation = await worktreeOperationRequest(event.sender, request?.clientId, options);
      if (!operation.ok) {
        return { ok: false, error: operation.error };
      }

      try {
        const result = await (options.inspectAgentWorktree ?? defaultInspectAgentWorktree)(
          operation.request,
          operation.options,
        );
        return { ok: true, ...result };
      } catch (error: unknown) {
        return { ok: false, error: terminalErrorMessage(error) };
      }
    },
  );

  ipcMain.handle(
    terminalChannels.worktreeApply,
    async (event, request: TerminalWorktreeApplyRequest): Promise<TerminalWorktreeApplyResult> => {
      const operation = await worktreeOperationRequest(event.sender, request?.clientId, options);
      if (!operation.ok) {
        return { ok: false, error: operation.error, needsManualReview: true };
      }

      try {
        const result = await (options.applyAgentWorktreePatch ?? defaultApplyAgentWorktreePatch)(
          operation.request,
          operation.options,
        );
        return { ok: true, appliedFiles: result.appliedFiles };
      } catch (error: unknown) {
        return { ok: false, error: terminalErrorMessage(error), needsManualReview: true };
      }
    },
  );
}

export function killAllTerminalSessions(): void {
  for (const id of sessions.keys()) {
    killSession(id, { forgetSnapshot: false });
  }
}

export async function flushTerminalPersistence(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }

  await persistTerminalSnapshots();
}

export function getTerminalSessionCount(): number {
  return sessions.size;
}

export function clearTerminalSavedDataInMemory(): number {
  const clearedClientIds = new Set<string>();

  for (const [clientId, snapshot] of restoredSessionSnapshots) {
    if (snapshot.buffer || snapshot.activityEvents?.length || snapshot.lastActivityAt || snapshot.lastOutputAt) {
      clearedClientIds.add(clientId);
    }
    const { activityEvents: _activityEvents, lastActivityAt: _lastActivityAt, lastOutputAt: _lastOutputAt, ...rest } = snapshot;
    restoredSessionSnapshots.set(clientId, { ...rest, buffer: "" });
  }

  for (const session of sessions.values()) {
    if (!session.clientId) continue;
    if (session.buffer || session.activityEvents?.length || session.lastActivityAt || session.lastOutputAt) {
      clearedClientIds.add(session.clientId);
    }
    session.buffer = "";
    delete session.activityEvents;
    delete session.lastActivityAt;
    delete session.lastOutputAt;
    const snapshot = toPersistedSnapshot(session);
    if (snapshot) {
      restoredSessionSnapshots.set(snapshot.clientId, snapshot);
    }
  }

  return clearedClientIds.size;
}

function sessionMetadata(
  id: TerminalSessionId,
  request: TerminalCreateRequest,
  launchCwd: string | AgentWorktreeResult,
  shell: string,
  createdAt: number,
): TerminalCreateResult & { createdAt: number } {
  const cwd = typeof launchCwd === "string" ? launchCwd : launchCwd.cwd;
  const worktree = typeof launchCwd === "string" ? null : launchCwd;
  const isolation = worktree ? "worktree" : normalizedSharedIsolation(request);

  return {
    id,
    ...(request.clientId === undefined ? {} : { clientId: request.clientId }),
    title: request.title ?? defaultSessionTitle(request.source ?? "manual", shell),
    source: request.source ?? "manual",
    ...(request.agentKind === undefined ? {} : { agentKind: request.agentKind }),
    ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
    cwd,
    ...(isolation === undefined ? {} : { isolation }),
    ...(worktree?.branchName === undefined ? {} : { branchName: worktree.branchName }),
    ...(worktree?.baseCwd === undefined ? {} : { baseCwd: worktree.baseCwd }),
    createdAt,
    shell,
    ...(request.command === undefined ? {} : { command: request.command }),
    ...(request.args === undefined ? {} : { args: request.args }),
    ...(request.resumeTarget === undefined ? {} : { resumeTarget: { ...request.resumeTarget } }),
  };
}

function normalizedSharedIsolation(request: TerminalCreateRequest): TerminalCreateRequest["isolation"] | undefined {
  if (request.isolation === "shared") return "shared";
  if (request.isolation === "worktree" && !isCodingAgentKind(request.agentKind)) return "shared";
  return undefined;
}

function toCreateResult(session: TerminalSession): TerminalCreateResult {
  return {
    id: session.id,
    ...(session.clientId === undefined ? {} : { clientId: session.clientId }),
    title: session.title,
    source: session.source,
    ...(session.agentKind === undefined ? {} : { agentKind: session.agentKind }),
    ...(session.workspaceId === undefined ? {} : { workspaceId: session.workspaceId }),
    cwd: session.cwd,
    ...(session.isolation === undefined ? {} : { isolation: session.isolation }),
    ...(session.branchName === undefined ? {} : { branchName: session.branchName }),
    ...(session.baseCwd === undefined ? {} : { baseCwd: session.baseCwd }),
    createdAt: session.createdAt,
    shell: session.shell,
    ...(session.command === undefined ? {} : { command: session.command }),
    ...(session.args === undefined ? {} : { args: session.args }),
    ...(session.resumeTarget === undefined ? {} : { resumeTarget: { ...session.resumeTarget } }),
  };
}

function toSnapshot(session: TerminalSession): TerminalSessionSnapshot {
  return {
    ...toCreateResult(session),
    buffer: session.buffer,
    ...(session.activityEvents === undefined ? {} : { activityEvents: cloneActivityEvents(session.activityEvents) }),
    ...(session.lastActivityAt === undefined ? {} : { lastActivityAt: session.lastActivityAt }),
    ...(session.lastOutputAt === undefined ? {} : { lastOutputAt: session.lastOutputAt }),
  };
}

function appendToBuffer(session: TerminalSession, data: string): void {
  session.buffer += data;

  if (session.buffer.length > MAX_BUFFER_LENGTH) {
    session.buffer = session.buffer.slice(-MAX_BUFFER_LENGTH);
  }
}

async function hydratePersistedTerminalSessions(): Promise<void> {
  if (persistenceHydrated || !persistedStateStore) {
    return;
  }
  if (persistenceHydration) {
    return persistenceHydration;
  }

  const store = persistedStateStore;
  const generation = persistenceGeneration;
  const hydrationMutations = new Set<string>();
  persistenceHydrationMutations = hydrationMutations;
  const hydration = (async () => {
    const state = await store.getState();
    if (persistedStateStore !== store || persistenceGeneration !== generation) return;

    const locallyRemembered = new Map(
      [...restoredSessionSnapshots].filter(([clientId]) => hydrationMutations.has(clientId)),
    );
    restoredSessionSnapshots.clear();
    for (const session of state.restoredTerminalSessions) {
      if (forgottenClientIds.has(session.clientId) || locallyRemembered.has(session.clientId)) continue;
      restoredSessionSnapshots.set(session.clientId, clonePersistedSession(session));
    }
    for (const [clientId, session] of locallyRemembered) {
      restoredSessionSnapshots.set(clientId, session);
    }
    persistenceHydrated = true;
  })();
  persistenceHydration = hydration;
  try {
    await hydration;
  } finally {
    if (persistenceHydration === hydration) {
      persistenceHydration = null;
      persistenceHydrationMutations = null;
    }
  }
}

function rememberSessionSnapshot(session: TerminalSession): void {
  const snapshot = toPersistedSnapshot(session);
  if (!snapshot) return;
  if (forgottenClientIds.has(snapshot.clientId)) return;

  persistenceHydrationMutations?.add(snapshot.clientId);
  restoredSessionSnapshots.set(snapshot.clientId, snapshot);
  scheduleTerminalPersistence();
}

function forgetPersistedSession(clientId: string): void {
  if (!clientId) return;
  persistenceHydrationMutations?.add(clientId);
  forgottenClientIds.add(clientId);
  restoredSessionSnapshots.delete(clientId);
  scheduleTerminalPersistence();
}

function cleanupSessionWorktree(
  session:
    | {
        baseCwd?: string | undefined;
        branchName?: string | undefined;
        cwd?: string | undefined;
        isolation?: TerminalCreateResult["isolation"] | undefined;
      }
    | null
    | undefined,
  cleanupAgentWorktree: CleanupAgentWorktree,
  options: { force?: boolean; managedWorktreeRootPath?: string } = {},
): void {
  if (!hasIsolatedWorktreeMetadata(session)) return;
  const cleanupRequest = {
    baseCwd: session.baseCwd,
    branchName: session.branchName,
    ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
    ...(options.force ? { force: true } : {}),
  };
  const cleanupOptions = {
    ...(options.managedWorktreeRootPath === undefined ? {} : { worktreeStoreRoot: options.managedWorktreeRootPath }),
  };
  if (!isSafeAgentWorktreeCleanupRequest(cleanupRequest, cleanupOptions)) return;

  void cleanupAgentWorktree(cleanupRequest, cleanupOptions).catch(() => undefined);
}

async function worktreeOperationRequest(
  sender: Electron.WebContents,
  clientId: string | undefined,
  options: Pick<TerminalIpcOptions, "managedWorktreeRootPath">,
): Promise<
  | {
      ok: true;
      request: AgentWorktreeCleanupRequest;
      options: { worktreeStoreRoot?: string };
    }
  | { ok: false; error: string }
> {
  if (!clientId?.trim()) {
    return { ok: false, error: "Session id is required." };
  }

  await hydratePersistedTerminalSessions();
  const session = findSessionForWorktreeOperation(sender, clientId);
  if (!session) {
    return { ok: false, error: "Session not found." };
  }
  if (session.isolation === "shared" || (!session.baseCwd && !session.branchName)) {
    return { ok: false, error: "Session is not an isolated checkout." };
  }
  if (!hasIsolatedWorktreeMetadata(session)) {
    return { ok: false, error: "Isolated checkout metadata is incomplete." };
  }

  const cleanupOptions = worktreeStoreOptions(options);
  const cleanupRequest: AgentWorktreeCleanupRequest = {
    baseCwd: session.baseCwd,
    branchName: session.branchName,
  };
  if (session.cwd !== undefined) {
    cleanupRequest.cwd = session.cwd;
  }
  if (!isSafeAgentWorktreeCleanupRequest(cleanupRequest, cleanupOptions)) {
    return { ok: false, error: "Isolated checkout metadata is not safe." };
  }

  return {
    ok: true,
    request: cleanupRequest,
    options: cleanupOptions,
  };
}

function findSessionForWorktreeOperation(
  sender: Electron.WebContents,
  clientId: string,
): WorktreeOperationSession | null {
  const window = BrowserWindow.fromWebContents(sender);
  const liveSession = findLiveSessionByClientId(clientId);
  if (liveSession) {
    if (!window || !canAttachToWindow(liveSession, window)) return null;
    attachSessionWindow(liveSession, window);
    return toWorktreeOperationSession(liveSession);
  }

  const restoredSession = restoredSessionSnapshots.get(clientId);
  return restoredSession ? toWorktreeOperationSession(restoredSession) : null;
}

function findLiveSessionByClientId(clientId: string): TerminalSession | undefined {
  return [...sessions.values()].find((session) => session.clientId === clientId);
}

function toWorktreeOperationSession(session: WorktreeOperationSession): WorktreeOperationSession {
  return {
    ...(session.baseCwd === undefined ? {} : { baseCwd: session.baseCwd }),
    ...(session.branchName === undefined ? {} : { branchName: session.branchName }),
    ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
    ...(session.isolation === undefined ? {} : { isolation: session.isolation }),
  };
}

function hasIsolatedWorktreeMetadata(
  session:
    | {
        baseCwd?: string | undefined;
        branchName?: string | undefined;
        isolation?: TerminalCreateResult["isolation"] | undefined;
      }
    | null
    | undefined,
): session is {
  baseCwd: string;
  branchName: string;
  cwd?: string | undefined;
  isolation?: TerminalCreateResult["isolation"] | undefined;
} {
  if (session?.isolation === "shared") return false;
  return Boolean(session?.baseCwd && session.branchName);
}

function toPersistedSnapshot(session: TerminalSession): PersistedTerminalSessionSnapshot | null {
  if (!session.clientId) return null;
  return {
    clientId: session.clientId,
    title: session.title,
    source: session.source,
    ...(session.agentKind === undefined ? {} : { agentKind: session.agentKind }),
    ...(session.workspaceId === undefined ? {} : { workspaceId: session.workspaceId }),
    cwd: session.cwd,
    ...(session.isolation === undefined ? {} : { isolation: session.isolation }),
    ...(session.branchName === undefined ? {} : { branchName: session.branchName }),
    ...(session.baseCwd === undefined ? {} : { baseCwd: session.baseCwd }),
    createdAt: session.createdAt,
    shell: session.shell,
    ...(session.command === undefined ? {} : { command: session.command }),
    ...(session.args === undefined ? {} : { args: [...session.args] }),
    ...(session.resumeTarget === undefined ? {} : { resumeTarget: { ...session.resumeTarget } }),
    buffer: tailBuffer(session.buffer, MAX_PERSISTED_BUFFER_LENGTH),
    ...(session.activityEvents === undefined ? {} : { activityEvents: cloneActivityEvents(session.activityEvents) }),
    ...(session.lastActivityAt === undefined ? {} : { lastActivityAt: session.lastActivityAt }),
    ...(session.lastOutputAt === undefined ? {} : { lastOutputAt: session.lastOutputAt }),
  };
}

function scheduleTerminalPersistence(): void {
  if (!persistedStateStore) return;

  if (persistDebounceMs <= 0) {
    void persistTerminalSnapshots();
    return;
  }

  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistTerminalSnapshots();
  }, persistDebounceMs);
}

async function persistTerminalSnapshots(): Promise<void> {
  const store = persistedStateStore;
  if (!store) return;

  await store.updateState((current) => {
    const restoredTerminalSessions = [...restoredSessionSnapshots.values()].map((session) =>
      preparePersistedSessionForPrivacy(session, current.privacySettings),
    );
    return {
      ...current,
      restoredTerminalSessions,
    };
  });
}

function clonePersistedSession(session: PersistedTerminalSessionSnapshot): PersistedTerminalSessionSnapshot {
  return {
    ...session,
    ...(session.args === undefined ? {} : { args: [...session.args] }),
    ...(session.resumeTarget === undefined ? {} : { resumeTarget: { ...session.resumeTarget } }),
    ...(session.activityEvents === undefined ? {} : { activityEvents: cloneActivityEvents(session.activityEvents) }),
  };
}

function recordOutputActivity(
  session: TerminalSession,
  data: string,
  now = Date.now(),
): SessionActivityEvent[] {
  const result: TerminalOutputActivityChunkResult = classifyTerminalOutputChunk(session.activityStream, data);
  session.activityStream = result.state;
  return result.activities.flatMap((activity) => {
    const event = recordSessionActivity(session, activity, now);
    return event ? [event] : [];
  });
}

function recordSessionActivity(
  session: TerminalSession,
  activity: Parameters<typeof appendActivityEvent>[2],
  now = Date.now(),
): SessionActivityEvent | null {
  const previousEvents = session.activityEvents;
  const result = appendActivityEvent(previousEvents, session.clientId ?? session.id, activity, now);
  session.activityEvents = result.events;
  session.lastActivityAt = result.lastActivityAt;
  return result.events === previousEvents ? null : (result.events.at(-1) ?? null);
}

function cloneActivityEvents(events: SessionActivityEvent[]): SessionActivityEvent[] {
  return events.map((event) => ({
    ...event,
    ...(event.payload === undefined ? {} : { payload: { ...event.payload } }),
  }));
}

function preparePersistedSessionForPrivacy(
  session: PersistedTerminalSessionSnapshot,
  privacySettings: DesktopPrivacySettings,
): PersistedTerminalSessionSnapshot {
  const { activityEvents: _activityEvents, ...baseSession } = clonePersistedSession(session);
  const redactedBase = {
    ...baseSession,
    title: redactText(baseSession.title),
  };

  if (privacySettings.terminalScrollbackRetention === "off") {
    return {
      ...redactedBase,
      buffer: "",
    };
  }

  return {
    ...redactedBase,
    buffer: redactText(tailBuffer(session.buffer, MAX_PERSISTED_BUFFER_LENGTH)),
    ...(session.activityEvents === undefined ? {} : { activityEvents: redactActivityEvents(session.activityEvents) }),
  };
}

function redactActivityEvents(events: SessionActivityEvent[]): SessionActivityEvent[] {
  return events.map((event) => ({
    ...event,
    title: redactText(event.title),
    detail: redactText(event.detail),
    ...(event.payload === undefined
      ? {}
      : { payload: redactUnknown(event.payload) as SessionActivityPayload }),
  }));
}

function tailBuffer(buffer: string, maxLength: number): string {
  return buffer.length > maxLength ? buffer.slice(-maxLength) : buffer;
}

function attachSessionWindow(session: TerminalSession, window: BrowserWindow): void {
  if (!window.isDestroyed()) {
    session.window = window;
    session.ownerWindowId = window.id;
  }
}

function getOwnedSession(sender: Electron.WebContents, sessionId: TerminalSessionId): TerminalSession | undefined {
  const window = BrowserWindow.fromWebContents(sender);
  const session = sessions.get(sessionId);

  if (!window || !session || !canAttachToWindow(session, window)) {
    return undefined;
  }

  attachSessionWindow(session, window);
  return session;
}

function canAttachToWindow(session: TerminalSession, window: BrowserWindow): boolean {
  return session.ownerWindowId === window.id || !hasLiveWindow(session.ownerWindowId);
}

function hasLiveWindow(windowId: number): boolean {
  return BrowserWindow.getAllWindows().some((window) => window.id === windowId && !window.isDestroyed());
}

function sendToSessionWindow(session: TerminalSession, channel: string, payload: unknown): void {
  if (!session.window || session.window.isDestroyed()) {
    return;
  }

  session.window.webContents.send(channel, payload);
}

function defaultSessionTitle(source: TerminalSessionSource, shell: string): string {
  return source === "alfred" ? shell : "Manual terminal";
}

function normalizedSessionTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

function killSession(
  id: TerminalSessionId,
  options: {
    cleanupAgentWorktree?: CleanupAgentWorktree;
    forgetSnapshot: boolean;
    managedWorktreeRootPath?: string;
  },
): void {
  const session = sessions.get(id);

  if (!session) {
    return;
  }

  sessions.delete(id);
  if (options.forgetSnapshot && session.clientId) {
    forgetPersistedSession(session.clientId);
    if (options.cleanupAgentWorktree) {
      cleanupSessionWorktree(session, options.cleanupAgentWorktree, {
        force: true,
        ...terminalWorktreeOptions(options),
      });
    }
  } else if (!options.forgetSnapshot) {
    recordSessionActivity(session, {
      kind: "lifecycle",
      title: "Stopped on quit",
      detail: "Alfred stopped this terminal while quitting.",
    });
    rememberSessionSnapshot(session);
  }
  session.pty.kill();
}

function disposeSession(id: TerminalSessionId): void {
  const session = sessions.get(id);

  if (!session) {
    return;
  }

  sessions.delete(id);
}

async function loadNodePty(): Promise<NodePtyModule> {
  const nodePtyIndexPath = require.resolve("node-pty/lib/index.js");

  await ensureNodePtySpawnHelperExecutable(nodePtyIndexPath);

  const moduleUrl = pathToFileURL(nodePtyIndexPath).href;
  return import(moduleUrl) as Promise<NodePtyModule>;
}

async function ensureNodePtySpawnHelperExecutable(nodePtyIndexPath: string): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }

  const helperPath = path.resolve(
    path.dirname(nodePtyIndexPath),
    `../prebuilds/darwin-${process.arch}/spawn-helper`,
  );

  try {
    await chmod(helperPath, NODE_PTY_HELPER_MODE);
  } catch (error: unknown) {
    throw new Error(
      `Unable to prepare node-pty spawn helper at ${helperPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function resolveCommand(request: TerminalCreateRequest): { command: string; args: string[] } {
  if (request.command) {
    return { command: request.command, args: request.args ?? [] };
  }
  return resolveShell();
}

function validateTerminalCreateRequest(request: TerminalCreateRequest): TerminalCreateRequest {
  if (!isRecord(request)) {
    throw new Error("Invalid terminal create request.");
  }

  const command = typeof request.command === "string" ? request.command.trim() : "";
  if (request.command !== undefined && !command) {
    throw new Error("Terminal command is required.");
  }
  if (request.args !== undefined && !Array.isArray(request.args)) {
    throw new Error("Terminal args must be an array.");
  }

  const args = request.args?.map((arg) => {
    if (typeof arg !== "string") {
      throw new Error("Terminal args must be strings.");
    }
    return arg;
  });

  const requestWithValidatedFields: TerminalCreateRequest = {
    ...request,
    ...(command ? { command } : {}),
    ...(args === undefined ? {} : { args }),
  };
  const normalizedRequest = command
    ? normalizeAgentCommand({ ...requestWithValidatedFields, command })
    : requestWithValidatedFields;

  if (normalizedRequest.command) {
    const safety = checkSafety(normalizedRequest.command, normalizedRequest.args ?? []);
    if (safety.unsafe) {
      throw new Error(`Terminal command blocked: ${safety.reason}.`);
    }
  }

  return normalizedRequest;
}

async function validateTerminalCommandApproval(
  request: TerminalCreateRequest,
  isStagedCommandAllowed: TerminalIpcOptions["isStagedCommandAllowed"],
  options: { allowPersistedRestoredLaunch?: boolean } = {},
): Promise<boolean> {
  if (!request.command) return false;

  if (isTrustedAgentLaunch(request)) return false;
  if (!isStagedCommandAllowed) return false;

  if (request.source === "alfred" && await isStagedCommandAllowed?.(request)) {
    return false;
  }
  if (options.allowPersistedRestoredLaunch && await isExactPersistedRestoredLaunch(request)) {
    return true;
  }

  throw new Error("Terminal command is not approved for launch.");
}

async function isExactPersistedRestoredLaunch(request: TerminalCreateRequest): Promise<boolean> {
  if (request.source !== "manual" || !request.clientId || !request.command) return false;
  await hydratePersistedTerminalSessions();
  if (findLiveSessionByClientId(request.clientId)) return false;

  const snapshot = restoredSessionSnapshots.get(request.clientId);
  if (snapshot?.source !== "manual" || snapshot.command !== request.command) return false;

  const requestedArgs = request.args ?? [];
  const persistedArgs = snapshot.args ?? [];
  return requestedArgs.length === persistedArgs.length
    && requestedArgs.every((arg, index) => arg === persistedArgs[index]);
}

function isTrustedAgentLaunch(request: TerminalCreateRequest): boolean {
  if (request.agentKind !== "codex" && request.agentKind !== "claude") return false;
  if (request.command !== request.agentKind) return false;
  return true;
}

async function resolveValidatedTerminalCwd(
  request: TerminalCreateRequest,
  options: Pick<TerminalIpcOptions, "allowedCwdRoots" | "scratchRootPath">,
): Promise<string> {
  const resolvedCwd = resolveTerminalCwd(request.cwd, options.scratchRootPath, request.workspaceId);
  const roots = options.allowedCwdRoots ? await options.allowedCwdRoots() : [];
  const canonicalCwd = await canonicalWorkspacePath(resolvedCwd);
  const allowed = await isAllowedWorkspacePath(canonicalCwd, roots);

  if (!allowed) {
    throw new Error("Terminal cwd is outside registered workspaces.");
  }

  return canonicalCwd;
}

async function resolveLaunchCwd(
  request: TerminalCreateRequest,
  prepareAgentWorktree: typeof defaultPrepareAgentWorktree,
  options: { managedWorktreeRootPath?: string; scratchRootPath?: string } = {},
  validatedCwd?: string,
): Promise<string | AgentWorktreeResult> {
  const cwd = validatedCwd ?? resolveTerminalCwd(request.cwd, options.scratchRootPath, request.workspaceId);

  if (request.isolation !== "worktree" || !isCodingAgentKind(request.agentKind)) {
    return cwd;
  }

  if (request.baseCwd && request.branchName) {
    if (!isSafeAgentWorktreeCleanupRequest({
      baseCwd: request.baseCwd,
      branchName: request.branchName,
      cwd,
    }, {
      ...(options.managedWorktreeRootPath === undefined ? {} : { worktreeStoreRoot: options.managedWorktreeRootPath }),
    })) {
      throw new Error("Terminal isolated checkout metadata is not safe to reuse.");
    }

    return {
      baseCwd: path.resolve(request.baseCwd),
      branchName: request.branchName,
      cwd,
    };
  }

  return prepareAgentWorktree({
    ...(request.agentKind === undefined ? {} : { agentKind: request.agentKind }),
    ...(request.branchName === undefined ? {} : { branchName: request.branchName }),
    ...(request.clientId === undefined ? {} : { clientId: request.clientId }),
    cwd,
  }, {
    ...(options.managedWorktreeRootPath === undefined ? {} : { worktreeStoreRoot: options.managedWorktreeRootPath }),
  });
}

function isCodingAgentKind(agentKind: TerminalCreateRequest["agentKind"]): boolean {
  return agentKind === "codex" || agentKind === "claude";
}

function terminalWorktreeOptions(options: Pick<TerminalIpcOptions, "managedWorktreeRootPath">): {
  managedWorktreeRootPath?: string;
} {
  return options.managedWorktreeRootPath === undefined ? {} : { managedWorktreeRootPath: options.managedWorktreeRootPath };
}

function worktreeStoreOptions(options: Pick<TerminalIpcOptions, "managedWorktreeRootPath">): {
  worktreeStoreRoot?: string;
} {
  return options.managedWorktreeRootPath === undefined ? {} : { worktreeStoreRoot: options.managedWorktreeRootPath };
}

function resolveShell(): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return { command: process.env.COMSPEC ?? "powershell.exe", args: [] };
  }

  return { command: process.env.SHELL ?? "/bin/zsh", args: ["-l"] };
}

function requestRequiresLaunchTicket(request: TerminalCreateRequest): boolean {
  return Boolean(request.command);
}

function consumeLaunchTicket(
  request: TerminalCreateRequest,
  launchTickets: Map<string, LaunchTicket>,
  restoredLaunchReservations: Map<string, string>,
  options: Pick<TerminalIpcOptions, "scratchRootPath">,
): LaunchTicket {
  if (!request.launchTicketId) {
    throw new Error("Terminal launch ticket is required.");
  }

  const launchTicketId = request.launchTicketId;
  const ticket = launchTickets.get(launchTicketId);
  launchTickets.delete(request.launchTicketId);
  if (!ticket || ticket.expiresAt < Date.now()) {
    throw new Error("Terminal launch ticket is invalid or expired.");
  }

  if (ticket.fingerprint !== launchFingerprint(request, options)) {
    clearRestoredLaunchReservation(ticket, launchTicketId, restoredLaunchReservations);
    throw new Error("Terminal launch ticket does not match this request.");
  }

  if (ticket.restoredClientId) {
    const isCurrentReservation = restoredLaunchReservations.get(ticket.restoredClientId) === launchTicketId;
    if (!isCurrentReservation
      || findLiveSessionByClientId(ticket.restoredClientId)) {
      clearRestoredLaunchReservation(ticket, launchTicketId, restoredLaunchReservations);
      throw new Error("Terminal launch ticket is invalid or expired.");
    }
    restoredLaunchReservations.delete(ticket.restoredClientId);
  }
  return ticket;
}

function clearRestoredLaunchReservation(
  ticket: LaunchTicket,
  launchTicketId: string,
  restoredLaunchReservations: Map<string, string>,
): void {
  if (ticket.restoredClientId && restoredLaunchReservations.get(ticket.restoredClientId) === launchTicketId) {
    restoredLaunchReservations.delete(ticket.restoredClientId);
  }
}

function launchFingerprint(request: TerminalCreateRequest, options: Pick<TerminalIpcOptions, "scratchRootPath">): string {
  return JSON.stringify({
    agentKind: request.agentKind ?? null,
    args: request.args ?? [],
    baseCwd: request.baseCwd ? path.resolve(request.baseCwd) : null,
    branchName: request.branchName ?? null,
    clientId: request.clientId ?? null,
    command: request.command ?? null,
    cwd: resolveTerminalCwd(request.cwd, options.scratchRootPath, request.workspaceId),
    isolation: request.isolation ?? null,
    source: request.source ?? "manual",
    workspaceId: request.workspaceId ?? null,
  });
}

function resolveTerminalCwd(cwd: string | undefined, scratchRootPath?: string, workspaceId?: string): string {
  if (!cwd?.trim()) {
    return defaultScratchCwd(scratchRootPath, workspaceId);
  }

  return path.resolve(cwd);
}

function defaultScratchCwd(scratchRootPath?: string, workspaceId?: string): string {
  if (scratchRootPath?.trim()) {
    return scratchWorkspacePath(scratchRootPath, workspaceId);
  }

  const configured = process.env.ALFRED_DESKTOP_WORKSPACE_CWD?.trim();
  if (configured) return path.resolve(configured);

  const desktop = path.join(os.homedir(), "Desktop");
  return existsSync(desktop) ? desktop : os.homedir();
}

async function ensureScratchCwdExists(cwd: string, scratchRootPath?: string): Promise<void> {
  if (!scratchRootPath?.trim()) return;

  const resolvedScratchRoot = await canonicalWorkspacePath(scratchRootPath);
  const resolvedCwd = await canonicalWorkspacePath(cwd);
  const relative = path.relative(resolvedScratchRoot, resolvedCwd);
  if (resolvedCwd !== resolvedScratchRoot && (relative.startsWith("..") || path.isAbsolute(relative))) {
    return;
  }

  await mkdir(resolvedCwd, { recursive: true });
}

function normalizeDimension(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 && value < 1000 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function terminalErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}
