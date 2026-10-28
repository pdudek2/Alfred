import { isTrustedIpcRecipient, trustedIpc } from "./trusted-ipc.js";
import { redactText } from "@alfred/schema";
import { BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  appendActivityEvent,
  classifyTerminalOutputChunk,
  runtimeBlockerReason,
  type SessionActivityEvent,
  type TerminalOutputActivityChunkResult,
  type TerminalOutputActivityStreamState,
} from "../shared/session-activity.js";
import { normalizeAgentCommand } from "../shared/agent-command.js";
import { normalizeSessionTitle } from "../shared/session-title.js";
import { createCodexImageIndex } from "./codex-images.js";
import { scratchWorkspacePath } from "./codex-scratch.js";
import {
  terminalChannels,
  type PersistedTerminalSessionSnapshot,
  type TerminalAgentSignal,
  type TerminalCodexImagesRequest,
  type TerminalCodexImagesResult,
  type TerminalCreateRequest,
  type TerminalCreateResult,
  type TerminalForgetRequest,
  type TerminalForgetResult,
  type TerminalForegroundAgentKind,
  type TerminalExitEvent,
  type TerminalKillRequest,
  type TerminalListResult,
  type TerminalReconcileRequest,
  type TerminalReconcileResult,
  type TerminalRenameRequest,
  type TerminalResumeTarget,
  type TerminalResizeRequest,
  type TerminalSessionSnapshot,
  type TerminalSessionId,
  type TerminalSessionSource,
  type TerminalSnapshotRequest,
  type TerminalSnapshotResult,
  type TerminalWriteRequest,
  type TerminalWorkerReply,
  type TerminalWorkerRequest,
  type TerminalWorktreeApplyRequest,
  type TerminalWorktreeApplyResult,
  type TerminalWorktreeDiffRequest,
  type TerminalWorktreeDiffResult,
} from "../shared/terminal-ipc.js";
import {
  CODEX_LAUNCH_ARGS,
  isTerminalReport,
  isShellProcess,
  parseOsc9,
  signalFromOsc9,
  type AgentSignalBridge,
  type AgentSignalUpdate,
} from "./agent-signals.js";
import type { AgentEventLog } from "./agent-events.js";
import { checkSafety } from "./alfred-safety.js";
import {
  applyAgentWorktreePatch as defaultApplyAgentWorktreePatch,
  cleanupAgentWorktree as defaultCleanupAgentWorktree,
  gitRepositoryRoot,
  inspectAgentWorktree as defaultInspectAgentWorktree,
  isSafeAgentWorktreeCleanupRequest,
  prepareAgentWorktree as defaultPrepareAgentWorktree,
  workspaceRootFingerprint,
  type AgentWorktreeCleanupRequest,
  type AgentWorktreeResult,
} from "./git-worktree.js";
import {
  DEFAULT_PRIVACY_SETTINGS,
  MAX_PERSISTED_TERMINAL_SCROLLBACK_LENGTH,
  SCROLLBACK_REDACTION_MARGIN,
  sanitizePersistedTerminalSession,
  type DesktopPrivacySettings,
  type PersistedDesktopStateStore,
} from "./persisted-desktop-state.js";
import { canonicalWorkspacePath, isAllowedWorkspacePath } from "./workspace-path.js";
import {
  alfredNotice,
  createWorkerTools,
  workerState,
  WorkerToolError,
  type WorkerHost,
  type WorkerRecord,
  type WorkerStartRequest,
} from "./worker-tools.js";

type PtyProcess = import("node-pty").IPty;
type NodePtyModule = typeof import("node-pty");
type ApplyAgentWorktreePatch = typeof defaultApplyAgentWorktreePatch;
type InspectAgentWorktree = typeof defaultInspectAgentWorktree;
type WorktreeOperationSession = {
  baseCwd?: string | undefined;
  branchName?: string | undefined;
  cwd?: string | undefined;
  isolation?: TerminalCreateResult["isolation"] | undefined;
  workspaceId?: string | undefined;
  workspaceRootFingerprint?: string | undefined;
};
type WorktreeOperation = Extract<Awaited<ReturnType<typeof worktreeOperationRequest>>, { ok: true }>;
type TerminalIpcOptions = {
  /** Where Claude and Codex send the events Alfred keeps on record. */
  agentEvents?: AgentEventLog | null;
  /** Hooks and notifications that let Claude and Codex report their own state. */
  agentSignals?: AgentSignalBridge | null;
  allowedCwdRoots?: () => Promise<string[]>;
  /** Variables Alfred loaded for itself (repo .env); never inherited by terminal sessions. */
  appOnlyEnvKeys?: ReadonlySet<string>;
  applyAgentWorktreePatch?: ApplyAgentWorktreePatch;
  cleanupAgentWorktree?: typeof defaultCleanupAgentWorktree;
  inspectAgentWorktree?: InspectAgentWorktree;
  /** The command line of the process in the foreground of a shell's terminal, from the shell's pid. */
  inspectForegroundCommand?: (shellPid: number) => Promise<string | undefined>;
  foregroundCommandDelayMs?: number;
  isStagedCommandAllowed?: (request: Pick<TerminalCreateRequest, "args" | "clientId" | "command">) => Promise<boolean>;
  launchTicketTtlMs?: number;
  loadNodePty?: () => Promise<NodePtyModule>;
  managedWorktreeRootPath?: string;
  prepareAgentWorktree?: typeof defaultPrepareAgentWorktree;
  resolveWorkspaceRoot?: (workspaceId: string) => Promise<string | undefined>;
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
  workspaceRootFingerprint?: string;
  cwd: string;
  isolation?: TerminalCreateResult["isolation"];
  branchName?: string;
  baseCwd?: string;
  createdAt: number;
  shell: string;
  command?: string;
  args?: string[];
  resumeTarget?: TerminalCreateResult["resumeTarget"];
  parentClientId?: string;
  buffer: string;
  activityEvents?: SessionActivityEvent[];
  activityStream: TerminalOutputActivityStreamState;
  commandInput: string;
  agentSignal?: TerminalAgentSignal | undefined;
  /** The agent's transcript, as its last hook named it. */
  transcriptPath?: string;
  oscCarry: string;
  shellBusy?: boolean | undefined;
  /** The program holding a plain shell's foreground as a title ("pnpm dev"), once it has held it a while. */
  foregroundCommand?: string | undefined;
  /** The foreground process whose command line is being read, so each one is read once. */
  commandProbeProcess?: string | undefined;
  /** You have sent this session a message: input that ended with Enter. */
  promptSubmitted?: boolean | undefined;
  /** A hook has reported from this session, so its history comes from hooks rather than from its screen. */
  hooksLive?: boolean | undefined;
  /** Turn marks an orchestrator reads this session by, as its worker (worker-tools.ts). */
  lastPromptSeq?: number | undefined;
  lastTurnEndSeq?: number | undefined;
  lastAnswer?: string | undefined;
  /** You typed into this session since its last turn ended: a draft Alfred's Enter must not send. */
  typedSinceTurnEnd?: boolean | undefined;
  /** Its orchestrator stopped it, so its end is no news to wake that orchestrator with. */
  stoppedByOrchestrator?: boolean | undefined;
  foregroundAgentKind?: TerminalForegroundAgentKind | undefined;
  submittedAgentKind?: TerminalForegroundAgentKind | undefined;
  /** The foreground process last asked about, so each one is asked about once. */
  probedProcess?: string | undefined;
  lastActivityAt?: number;
  lastOutputAt?: number;
  persistLaunchData: boolean;
  pty: PtyProcess;
  /** Settles when the process has exited. */
  ptyExited?: Promise<void>;
  // PTY lifetime is app-scoped; BrowserWindows may close and reattach later.
  window?: BrowserWindow;
  ownerWindowId: number;
};

type RecentTerminalExit = {
  event: TerminalExitEvent;
  ownerWindowId: number;
  snapshot: TerminalSessionSnapshot;
};

const sessions = new Map<TerminalSessionId, TerminalSession>();
const restoredSessionSnapshots = new Map<string, PersistedTerminalSessionSnapshot>();
const forgottenClientIds = new Set<string>();
const recentTerminalExits = new Map<TerminalSessionId, RecentTerminalExit>();
// Spawned PTYs whose exit has not reached JS yet, including ones already removed from `sessions`.
// node-pty reports exit through a ThreadSafeFunction; if that call lands while Electron tears
// down Node, node-addon-api cannot throw into JS and aborts the process (uncaught Napi::Error).
const pendingPtyExits = new Set<Promise<void>>();
const require = createRequire(import.meta.url);
const NODE_PTY_HELPER_MODE = 0o755;
const MAX_BUFFER_LENGTH = 200_000;
// What saving gets: the tail it keeps and the margin redaction reads before it.
const MAX_PERSISTED_BUFFER_LENGTH = MAX_PERSISTED_TERMINAL_SCROLLBACK_LENGTH + SCROLLBACK_REDACTION_MARGIN;
const MAX_RECENT_TERMINAL_EXITS = 64;
/** How long discarding a running checkout waits for its agent to exit before the folder goes anyway. */
const LIVE_CHECKOUT_STOP_WAIT_MS = 5_000;
/** More sent messages than a terminal's scrollback can show. */
const MAX_CODEX_VISIBLE_MESSAGES = 1_000;
let persistedStateStore: PersistedDesktopStateStore | null = null;
let persistenceHydrated = false;
let persistenceHydration: Promise<void> | null = null;
let persistenceHydrationMutations: Map<string, number> | null = null;
let persistenceGeneration = 0;
let persistDebounceMs = 250;
let persistTimer: NodeJS.Timeout | null = null;
let effectivePrivacySettings: DesktopPrivacySettings = { ...DEFAULT_PRIVACY_SETTINGS };
let privacyClearGeneration = 0;
let explicitPrivacyPolicy: { clearLaunchData: boolean } | null = null;
/** One counter for every worker's prompts and turn ends, so they order even within one millisecond. */
let turnSeq = 0;
const workerListeners = new Set<() => void>();
/** Workers whose terminal ended or has not started yet, so their orchestrator still sees them. */
const offstageWorkers = new Map<string, WorkerRecord & { parentClientId: string; since: number }>();
const MAX_OFFSTAGE_WORKERS = 64;
/** A worker the window added but whose terminal never started stops counting after this. */
const WORKER_START_GRACE_MS = 2 * 60 * 1000;
const WORKER_REPLY_TIMEOUT_MS = 10_000;
/** Claude Code and Codex read an Enter that arrives with a paste as part of it; a separate one sends the message. */
const PASTE_SUBMIT_DELAY_MS = 150;
/** Workers an orchestrator started with its tools; only these wake it. */
const toolStartedWorkers = new Set<string>();
type WorkerNews = { title: string; ended: boolean };
/** What each orchestrator has not been told yet about its workers, by worker. */
const pendingWakes = new Map<string, Map<string, WorkerNews>>();
const wakeTimers = new Map<string, NodeJS.Timeout>();
/** Workers that finish close together reach their orchestrator in one message. */
const WAKE_BATCH_MS = 2_000;
/** A program that holds a shell's foreground this long names it; `ls` or `git status` names nothing. */
let foregroundCommandDelayMs = 1_000;
let inspectShellForeground: (shellPid: number) => Promise<string | undefined> = inspectForegroundCommand;

export function configureTerminalPersistence(
  store: PersistedDesktopStateStore,
  options: { debounceMs?: number } = {},
): void {
  persistedStateStore = store;
  persistenceHydrated = false;
  persistenceHydration = null;
  persistenceHydrationMutations = null;
  persistenceGeneration += 1;
  privacyClearGeneration += 1;
  effectivePrivacySettings = { ...DEFAULT_PRIVACY_SETTINGS };
  explicitPrivacyPolicy = null;
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
  privacyClearGeneration += 1;
  effectivePrivacySettings = { ...DEFAULT_PRIVACY_SETTINGS };
  explicitPrivacyPolicy = null;
  restoredSessionSnapshots.clear();
  forgottenClientIds.clear();
  recentTerminalExits.clear();
  pendingPtyExits.clear();
  offstageWorkers.clear();
  workerListeners.clear();
  toolStartedWorkers.clear();
  pendingWakes.clear();
  for (const timer of wakeTimers.values()) clearTimeout(timer);
  wakeTimers.clear();
  persistDebounceMs = 250;
}

export function registerTerminalIpc(options: TerminalIpcOptions = {}): void {
  foregroundCommandDelayMs = options.foregroundCommandDelayMs ?? 1_000;
  inspectShellForeground = options.inspectForegroundCommand ?? inspectForegroundCommand;
  const launchTickets = new Map<string, LaunchTicket>();
  const restoredLaunchReservations = new Map<string, string>();
  const clientIdsInFlight = new Set<string>();
  const clientIdsBeingForgotten = new Set<string>();
  const launchPreparationsInFlight = new Map<string, number>();

  const codexImages = createCodexImageIndex();

  options.agentSignals?.setListener((sessionId, update, transcriptPath, conversationId) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    if (transcriptPath) session.transcriptPath = transcriptPath;
    session.hooksLive = true;
    const resumeTarget = newConversation(session, conversationId);
    if (resumeTarget) session.resumeTarget = resumeTarget;
    const applied = applyAgentSignal(session, update, "hook", Date.now());
    sendSignalUpdate(session, { activities: applied.activities, agentSignal: applied.signal, ...(resumeTarget ? { resumeTarget } : {}) });
    if (resumeTarget) rememberSessionSnapshot(session);
  });

  const workerReplies = new Map<string, (reply: TerminalWorkerReply) => void>();
  trustedIpc.on(terminalChannels.workerReply, (_event, reply: TerminalWorkerReply) => {
    if (typeof reply?.requestId === "string") workerReplies.get(reply.requestId)?.(reply);
  });
  const workerHost: WorkerHost = {
    caller: (sessionId) => {
      const session = sessions.get(sessionId);
      return session?.clientId
        ? {
            clientId: session.clientId,
            title: session.title,
            isAgent: isAgentSession(session),
            isWorker: session.parentClientId !== undefined,
          }
        : undefined;
    },
    workersOf,
    startWorker: (parentClientId, request) => requestWorker(parentClientId, request, workerReplies),
    send: (clientId, text) => {
      const session = findLiveSessionByClientId(clientId);
      if (!session) throw new WorkerToolError("The worker has ended.");
      // Pasted after the user's half-typed message, it would reach the worker as one message with theirs.
      if (session.typedSinceTurnEnd) {
        throw new WorkerToolError(
          "The user is typing in this worker's terminal. Wait for its turn to end with wait_for_worker, or ask the user.",
        );
      }
      typeIntoAgent(session, text);
    },
    stop: stopWorker,
    markSeen: (parentClientId, workerClientIds) => {
      const news = pendingWakes.get(parentClientId);
      for (const id of workerClientIds) news?.delete(id);
      if (news?.size === 0) pendingWakes.delete(parentClientId);
    },
    onChange: (listener) => {
      workerListeners.add(listener);
      return () => workerListeners.delete(listener);
    },
  };
  options.agentSignals?.setToolHandler(createWorkerTools(workerHost).call);

  // Codex shows a sent image as an unlinked [Image #1]; its rollout says which file that is.
  trustedIpc.handle(
    terminalChannels.codexImages,
    async (event, request: TerminalCodexImagesRequest): Promise<TerminalCodexImagesResult> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const session = [...sessions.values()].find(
        (candidate) => candidate.clientId === request?.clientId && window !== null && canAttachToWindow(candidate, window),
      );
      const { messages, index } = request ?? {};
      const validRequest = Array.isArray(messages)
        && messages.length <= MAX_CODEX_VISIBLE_MESSAGES
        && messages.every((message) => typeof message === "string")
        && Number.isInteger(index)
        && index >= 0
        && index < messages.length;
      if (!session?.transcriptPath || !isCodexSession(session) || !validRequest) return { images: {} };
      return { images: await codexImages.imagesFor(session.transcriptPath, messages, index) };
    },
  );

  trustedIpc.handle(terminalChannels.list, async (event): Promise<TerminalListResult> => {
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

  trustedIpc.handle(
    terminalChannels.snapshot,
    async (event, request: TerminalSnapshotRequest): Promise<TerminalSnapshotResult> => {
      const session = getOwnedSession(event.sender, request.id);
      if (session) return toSnapshot(session);

      const window = BrowserWindow.fromWebContents(event.sender);
      const recentExit = recentTerminalExits.get(request.id);
      if (!window || !recentExit || !canAttachOwnerToWindow(recentExit.ownerWindowId, window)) return null;
      recentExit.ownerWindowId = window.id;
      return recentExit.snapshot;
    },
  );

  trustedIpc.handle(
    terminalChannels.reconcile,
    async (event, request: TerminalReconcileRequest): Promise<TerminalReconcileResult> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return { state: "missing" };

      const session = sessions.get(request.id);
      if (
        session
        && canAttachToWindow(session, window)
        && (!request.clientId || request.clientId === session.clientId)
      ) {
        attachSessionWindow(session, window);
        return { state: "running", snapshot: toSnapshot(session) };
      }

      const recentExit = recentTerminalExits.get(request.id);
      if (
        !recentExit
        || !canAttachOwnerToWindow(recentExit.ownerWindowId, window)
        || (request.clientId && request.clientId !== recentExit.event.clientId)
      ) {
        return { state: "missing" };
      }
      recentExit.ownerWindowId = window.id;
      return {
        state: "exited",
        snapshot: recentExit.snapshot,
        event: recentExit.event,
      };
    },
  );

  trustedIpc.handle(
    terminalChannels.prepareLaunch,
    async (_event, request: TerminalCreateRequest) => {
      const safeRequest = validateTerminalCreateRequest(request);
      const preparedClientId = safeRequest.clientId;
      if (preparedClientId) {
        if (clientIdsBeingForgotten.has(preparedClientId)) {
          throw new Error("Session lifecycle operation is already in progress.");
        }
        launchPreparationsInFlight.set(
          preparedClientId,
          (launchPreparationsInFlight.get(preparedClientId) ?? 0) + 1,
        );
      }
      try {
        const isPersistedRestoredLaunch = await validateTerminalCommandApproval(
          safeRequest,
          options.isStagedCommandAllowed,
          { allowPersistedRestoredLaunch: true },
        );
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
      } finally {
        if (preparedClientId) {
          const remaining = (launchPreparationsInFlight.get(preparedClientId) ?? 1) - 1;
          if (remaining > 0) {
            launchPreparationsInFlight.set(preparedClientId, remaining);
          } else {
            launchPreparationsInFlight.delete(preparedClientId);
          }
        }
      }
    },
  );

  trustedIpc.handle(
    terminalChannels.create,
    async (event, request: TerminalCreateRequest): Promise<TerminalCreateResult> => {
      const window = BrowserWindow.fromWebContents(event.sender);

      if (!window) {
        throw new Error("Terminal session requires an owning window.");
      }

      const safeRequest = validateTerminalCreateRequest(request);
      const reservedClientId = safeRequest.clientId;
      if (reservedClientId && clientIdsBeingForgotten.has(reservedClientId)) {
        throw new Error("Session lifecycle operation is already in progress.");
      }
      void hydratePersistedTerminalSessions();
      const launchClearGeneration = privacyClearGeneration;
      const launchStartedWithPersistence =
        effectivePrivacySettings.terminalScrollbackRetention !== "off";
      const requiresLaunchTicket = Boolean(options.requireLaunchTickets && requestRequiresLaunchTicket(safeRequest));
      if (requiresLaunchTicket) {
        consumeLaunchTicket(
          safeRequest,
          launchTickets,
          restoredLaunchReservations,
          options,
        );
      }
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
      let createdWorktree: AgentWorktreeResult | null = null;
      try {
        const canonicalCwd = await resolveValidatedTerminalCwd(safeRequest, options);
        const restoredSnapshot = safeRequest.clientId && restoredSessionSnapshots.has(safeRequest.clientId)
          ? await matchingPersistedRestoredSnapshot(safeRequest)
          : null;
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
        // Only a checkout created by this attempt is ours to remove; a reused one holds earlier work.
        const reusedCheckout = Boolean(safeRequest.baseCwd && safeRequest.branchName);
        if (typeof launchCwd !== "string" && !reusedCheckout) createdWorktree = launchCwd;
        await ensureScratchCwdExists(cwd, options.scratchRootPath);
        const nodePty = await (options.loadNodePty ?? loadNodePty)();
        const resolved = resolveCommand(safeRequest);
        const id = randomUUID();
        const metadata = sessionMetadata(id, safeRequest, launchCwd, resolved.command, Date.now());
        const launchArgs = [
          ...(options.agentSignals
            ? options.agentSignals.launchArgs(safeRequest.command, {
              id,
              worker: parentClientId(safeRequest.parentClientId) !== undefined,
            })
            : safeRequest.command === "codex" ? CODEX_LAUNCH_ARGS : []),
          ...(options.agentEvents?.launchArgs({ id, clientId: safeRequest.clientId }, safeRequest.command) ?? []),
        ];
        const pty = nodePty.spawn(resolved.command, [...launchArgs, ...resolved.args], {
          name: "xterm-256color",
          cols: normalizeDimension(request.cols, 80),
          rows: normalizeDimension(request.rows, 24),
          cwd,
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(([key]) => !options.appOnlyEnvKeys?.has(key)),
            ),
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            // xterm.js renders OSC 8 links. Claude Code links a sent [Image #N] to its file only when told so.
            FORCE_HYPERLINK: "1",
            ...options.agentSignals?.env(id, safeRequest.command),
            ...options.agentEvents?.env({ id, clientId: safeRequest.clientId }, safeRequest.command),
          },
        });
        session = {
          ...metadata,
          buffer: restoredSnapshot?.buffer ?? "",
          activityEvents: [],
          activityStream: { carry: "" },
          commandInput: "",
          oscCarry: "",
          ownerWindowId: window.id,
          persistLaunchData: launchStartedWithPersistence
            && launchClearGeneration === privacyClearGeneration
            && effectivePrivacySettings.terminalScrollbackRetention !== "off",
          pty,
          window,
        };

        sessions.set(id, session);
        if (session.clientId && offstageWorkers.get(session.clientId)?.turn.exited === false) {
          offstageWorkers.delete(session.clientId);
        }
      } catch (error) {
        if (reservedClientId) clientIdsInFlight.delete(reservedClientId);
        if (createdWorktree) {
          await (options.cleanupAgentWorktree ?? defaultCleanupAgentWorktree)(
            {
              baseCwd: createdWorktree.baseCwd,
              branchName: createdWorktree.branchName,
              cwd: createdWorktree.cwd,
              force: true,
            },
            options.managedWorktreeRootPath === undefined ? {} : { worktreeStoreRoot: options.managedWorktreeRootPath },
          ).catch((cleanupError: unknown) => {
            console.warn("Failed to remove the checkout of a terminal that did not start.", cleanupError);
          });
        }
        throw error;
      }
      if (reservedClientId) clientIdsInFlight.delete(reservedClientId);
      if (session.clientId) {
        forgottenClientIds.delete(session.clientId);
      }
      rememberSessionSnapshot(session);

      session.pty.onData((data) => {
        const now = Date.now();
        const activeAgentKind = updateForegroundAgentKind(session);
        probeForegroundAgent(session, options.inspectForegroundCommand ?? inspectForegroundCommand);
        appendToBuffer(session, data);
        session.lastOutputAt = now;
        const activities = recordOutputActivity(session, data, now, screenIsHistory(session) ? "all" : "blockers");
        let agentSignal: TerminalAgentSignal | undefined;
        if (isCodexSession(session)) {
          const osc = parseOsc9(session.oscCarry, data);
          session.oscCarry = osc.carry;
          for (const message of osc.messages) {
            const update = signalFromOsc9(message);
            // A notification that repeats the hook's state is dropped: the hook's signal outlasts your typing.
            const repeatsHook = session.agentSignal?.source === "hook" && session.agentSignal.state === update?.state;
            if (update && !repeatsHook) {
              const applied = applyAgentSignal(session, update, "osc9", now);
              agentSignal = applied.signal;
              activities.push(...applied.activities);
            }
          }
        }
        const shellBusy = updateShellBusy(session);
        if (effectivePrivacySettings.terminalScrollbackRetention === "off") {
          session.persistLaunchData = false;
          clearSessionReplayData(session);
        }
        rememberSessionSnapshot(session);
        sendToSessionWindow(session, terminalChannels.data, {
          id: session.id,
          ...(session.clientId === undefined ? {} : { clientId: session.clientId }),
          data,
          at: now,
          ...(activeAgentKind === undefined ? {} : { foregroundAgentKind: activeAgentKind }),
          activities,
          ...(agentSignal === undefined ? {} : { agentSignal }),
          ...(shellBusy === undefined ? {} : { shellBusy }),
        });
      });

      let reportPtyExit = () => {};
      const ptyExit = new Promise<void>((resolve) => {
        reportPtyExit = resolve;
      });
      pendingPtyExits.add(ptyExit);
      session.ptyExited = ptyExit;
      session.pty.onExit(({ exitCode, signal }) => {
        pendingPtyExits.delete(ptyExit);
        reportPtyExit();
        if (!sessions.has(session.id)) return;
        const identity = {
          id: session.id,
          ...(session.clientId === undefined ? {} : { clientId: session.clientId }),
        };
        const payload: TerminalExitEvent = signal === undefined
          ? { ...identity, exitCode }
          : { ...identity, exitCode, signal };
        recordSessionActivity(session, {
          kind: "lifecycle",
          title: "Process exited",
          detail: `The terminal process exited with code ${exitCode}.`,
        });
        rememberSessionSnapshot(session);
        const recentExit = {
          event: payload,
          ownerWindowId: session.ownerWindowId,
          snapshot: toSnapshot(session),
        };
        if (effectivePrivacySettings.terminalScrollbackRetention === "off") scrubExitedSnapshot(recentExit);
        rememberEndedWorker(session);
        recentTerminalExits.set(session.id, recentExit);
        while (recentTerminalExits.size > MAX_RECENT_TERMINAL_EXITS) {
          const oldestId = recentTerminalExits.keys().next().value;
          if (!oldestId) break;
          recentTerminalExits.delete(oldestId);
        }
        disposeSession(session.id);
        sendToSessionWindow(session, terminalChannels.exit, payload);
      });

      return {
        ...toCreateResult(session),
        ...(createdWorktree?.uncommittedFiles ? { uncommittedFiles: createdWorktree.uncommittedFiles } : {}),
      };
    },
  );

  trustedIpc.on(terminalChannels.write, (event, request: TerminalWriteRequest) => {
    if (typeof request?.data !== "string") return;
    const session = getOwnedSession(event.sender, request.id);
    if (!session) return;
    const input = consumeAgentCommandInput(session.commandInput, request.data);
    session.commandInput = input.buffer;
    if (input.submitted) session.submittedAgentKind = input.agentKind;
    session.pty.write(request.data);
    // Moving the mouse over or clicking into a waiting Codex terminal sends mouse and focus reports; only your own
    // input answers it.
    if (!isTerminalReport(request.data)) {
      session.typedSinceTurnEnd = true;
      const cleared = clearWaitingSignal(session);
      const answered = answerApproval(session);
      // Until Enter sends your first message, an agent waits for it, whatever it draws.
      // ponytail: Enter inside pasted text counts too.
      const submitted = !session.promptSubmitted && request.data.includes("\r");
      if (submitted) session.promptSubmitted = true;
      // Without hooks, your Enter is the only sign a turn started; with them, an Enter that starts nothing must not count.
      const startedTurn = !session.hooksLive && isAgentSession(session) && request.data.includes("\r");
      if (startedTurn) session.lastPromptSeq = ++turnSeq;
      if (cleared || startedTurn) notifyWorkers();
      if (cleared || answered || submitted) {
        sendSignalUpdate(session, {
          ...(cleared ? { agentSignal: null } : {}),
          ...(answered ? { activities: [answered] } : {}),
          ...(submitted ? { promptSubmitted: true } : {}),
        });
      }
    }
    scheduleShellBusySample(session);
  });

  trustedIpc.on(terminalChannels.resize, (event, request: TerminalResizeRequest) => {
    const session = getOwnedSession(event.sender, request.id);
    session?.pty.resize(normalizeDimension(request.cols, 80), normalizeDimension(request.rows, 24));
  });

  trustedIpc.on(terminalChannels.kill, (event, request: TerminalKillRequest) => {
    if (getOwnedSession(event.sender, request.id)) {
      killSession(request.id, "close");
    }
  });

  trustedIpc.handle(terminalChannels.forget, async (event, request: TerminalForgetRequest): Promise<TerminalForgetResult> => {
    if (!request?.clientId?.trim()) {
      return { ok: false, error: "Session id is required." };
    }
    const reservedLaunchTicketId = restoredLaunchReservations.get(request.clientId);
    if (
      reservedLaunchTicketId
      && (launchTickets.get(reservedLaunchTicketId)?.expiresAt ?? 0) < Date.now()
    ) {
      restoredLaunchReservations.delete(request.clientId);
      launchTickets.delete(reservedLaunchTicketId);
    }
    if (
      clientIdsBeingForgotten.has(request.clientId)
      || clientIdsInFlight.has(request.clientId)
      || launchPreparationsInFlight.has(request.clientId)
      || restoredLaunchReservations.has(request.clientId)
    ) {
      return { ok: false, error: "Session lifecycle operation is already in progress." };
    }

    clientIdsBeingForgotten.add(request.clientId);
    let session: PersistedTerminalSessionSnapshot | undefined;
    try {
      await hydratePersistedTerminalSessions();
      const liveSession = findLiveSessionByClientId(request.clientId);
      let stoppedCheckout: WorktreeOperation | null = null;
      if (liveSession) {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || !canAttachToWindow(liveSession, window)) {
          return { ok: false, error: "Session not found." };
        }
        if (request.cleanupWorktree !== true || !isIsolatedWorktreeSession(liveSession)) {
          return { ok: false, error: "Close the live session before discarding its checkout." };
        }
        // A running checkout is resolved while its session is live; then its agent stops before the folder goes.
        const operation = await worktreeOperationRequest(event.sender, request.clientId, options);
        if (!operation.ok) {
          return operation;
        }
        stoppedCheckout = operation;
        const exited = liveSession.ptyExited;
        killSession(liveSession.id, "close");
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, LIVE_CHECKOUT_STOP_WAIT_MS))]);
      }

      session = restoredSessionSnapshots.get(request.clientId);
      const window = BrowserWindow.fromWebContents(event.sender);
      const recentExit = [...recentTerminalExits.values()].find((exit) => exit.event.clientId === request.clientId);
      if (!stoppedCheckout && !session && (!recentExit || !window || !canAttachOwnerToWindow(recentExit.ownerWindowId, window))) {
        return { ok: false, error: "Session not found." };
      }

      const isolatedWorktree = stoppedCheckout !== null || (session && isIsolatedWorktreeSession(session));
      if (isolatedWorktree && request.cleanupWorktree !== true) {
        return { ok: false, error: "Discarding an isolated checkout requires worktree cleanup." };
      }
      if (isolatedWorktree) {
        const operation = stoppedCheckout ?? await worktreeOperationRequest(event.sender, request.clientId, options);
        if (!operation.ok) {
          return operation;
        }
        await (options.cleanupAgentWorktree ?? defaultCleanupAgentWorktree)(
          { ...operation.request, force: true },
          operation.options,
        );
      }
      forgetPersistedSession(request.clientId);
      releaseWorkers(request.clientId);
      await flushTerminalPersistence();
      for (const [id, exit] of recentTerminalExits) {
        if (exit.event.clientId === request.clientId) recentTerminalExits.delete(id);
      }
      return { ok: true };
    } catch (error: unknown) {
      const originalError = terminalErrorMessage(error);
      if (session) {
        forgottenClientIds.delete(request.clientId);
        restoredSessionSnapshots.set(request.clientId, session);
        try {
          await persistTerminalSnapshots();
        } catch {
          // The store retains this reconciled snapshot as its next retry intent.
        }
      }
      return { ok: false, error: originalError };
    } finally {
      clientIdsBeingForgotten.delete(request.clientId);
    }
  });

  trustedIpc.handle(terminalChannels.rename, async (event, request: TerminalRenameRequest): Promise<void> => {
    const title = normalizeSessionTitle(request.title);
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

  trustedIpc.handle(
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

  trustedIpc.handle(
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
        return { ok: true, appliedFiles: result.appliedFiles, ...(result.alreadyApplied ? { alreadyApplied: true } : {}) };
      } catch (error: unknown) {
        return { ok: false, error: terminalErrorMessage(error), needsManualReview: true };
      }
    },
  );
}

export function killAllTerminalSessions(): void {
  for (const id of sessions.keys()) {
    killSession(id, "quit");
  }
}

/** Resolves once every spawned PTY has reported its exit to JS, or after `timeoutMs`. */
export async function waitForTerminalExits(timeoutMs: number): Promise<void> {
  if (pendingPtyExits.size === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(pendingPtyExits),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
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

/** Whether Alfred writes terminal data to disk now; the agent event log follows the same setting. */
export function savesTerminalData(): boolean {
  return effectivePrivacySettings.terminalScrollbackRetention !== "off";
}

export function applyTerminalPrivacyPolicyInMemory(
  privacySettings: DesktopPrivacySettings,
  clearLaunchData = false,
  changed = new Set<string>(),
): number {
  effectivePrivacySettings = { ...privacySettings };
  const clearsLaunchData =
    clearLaunchData || privacySettings.terminalScrollbackRetention === "off";
  explicitPrivacyPolicy = {
    clearLaunchData: Boolean(explicitPrivacyPolicy?.clearLaunchData || clearsLaunchData),
  };
  if (clearsLaunchData) {
    privacyClearGeneration += 1;
  }

  for (const [clientId, snapshot] of restoredSessionSnapshots) {
    const sanitized = sanitizePersistedTerminalSession(snapshot, privacySettings, clearLaunchData);
    if (JSON.stringify(snapshot) !== JSON.stringify(sanitized)) changed.add(clientId);
    if (sanitized) restoredSessionSnapshots.set(clientId, sanitized);
    else restoredSessionSnapshots.delete(clientId);
  }

  if (clearsLaunchData) {
    disableLiveSessionPersistence(changed);
  }

  scheduleTerminalPersistence();
  return changed.size;
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
    title: normalizeSessionTitle(request.title ?? "") || defaultSessionTitle(request.source ?? "manual", shell),
    source: request.source ?? "manual",
    ...(request.agentKind === undefined ? {} : { agentKind: request.agentKind }),
    ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
    ...(worktree?.baseCwd === undefined
      ? {}
      : { workspaceRootFingerprint: workspaceRootFingerprint(worktree.baseCwd) }),
    cwd,
    ...(isolation === undefined ? {} : { isolation }),
    ...(worktree?.branchName === undefined ? {} : { branchName: worktree.branchName }),
    ...(worktree?.baseCwd === undefined ? {} : { baseCwd: worktree.baseCwd }),
    createdAt,
    shell,
    ...(request.command === undefined ? {} : { command: request.command }),
    ...(request.args === undefined ? {} : { args: request.args }),
    ...(request.resumeTarget === undefined ? {} : { resumeTarget: { ...request.resumeTarget } }),
    ...(parentClientId(request.parentClientId) ?? {}),
  };
}

// The renderer names the parent; keep it only when it is a plausible client id.
function parentClientId(value: unknown): { parentClientId: string } | undefined {
  const clientId = clientIdValue(value);
  return clientId === undefined ? undefined : { parentClientId: clientId };
}

function clientIdValue(value: unknown): string | undefined {
  return typeof value === "string" && /^[\w.-]{1,128}$/.test(value) ? value : undefined;
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
    ...(session.workspaceRootFingerprint === undefined
      ? {}
      : { workspaceRootFingerprint: session.workspaceRootFingerprint }),
    cwd: session.cwd,
    ...(session.isolation === undefined ? {} : { isolation: session.isolation }),
    ...(session.branchName === undefined ? {} : { branchName: session.branchName }),
    ...(session.baseCwd === undefined ? {} : { baseCwd: session.baseCwd }),
    createdAt: session.createdAt,
    shell: session.shell,
    ...(session.command === undefined ? {} : { command: session.command }),
    ...(session.args === undefined ? {} : { args: session.args }),
    ...(session.resumeTarget === undefined ? {} : { resumeTarget: { ...session.resumeTarget } }),
    ...(session.parentClientId === undefined ? {} : { parentClientId: session.parentClientId }),
  };
}

function toSnapshot(session: TerminalSession): TerminalSessionSnapshot {
  const activeAgentKind = updateForegroundAgentKind(session);
  return {
    ...toCreateResult(session),
    buffer: session.buffer,
    ...(activeAgentKind === undefined ? {} : { foregroundAgentKind: activeAgentKind }),
    ...(session.agentSignal === undefined ? {} : { agentSignal: session.agentSignal }),
    ...(session.shellBusy === undefined ? {} : { shellBusy: session.shellBusy }),
    ...(session.foregroundCommand === undefined ? {} : { foregroundCommand: session.foregroundCommand }),
    ...(session.promptSubmitted ? { promptSubmitted: true } : {}),
    ...(session.activityEvents === undefined ? {} : { activityEvents: cloneActivityEvents(session.activityEvents) }),
    ...(session.lastActivityAt === undefined ? {} : { lastActivityAt: session.lastActivityAt }),
    ...(session.lastOutputAt === undefined ? {} : { lastOutputAt: session.lastOutputAt }),
  };
}

function updateForegroundAgentKind(session: TerminalSession): TerminalForegroundAgentKind | undefined {
  try {
    const executable = path.basename(session.pty.process.trim().split(/\s+/, 1)[0] ?? "").toLowerCase();
    const shellExecutable = path.basename(session.shell).toLowerCase();
    if (/^codex(?:$|[-_])/.test(executable)) session.foregroundAgentKind = "codex";
    else if (/^claude(?:$|[-_])/.test(executable)) session.foregroundAgentKind = "claude";
    else if (executable !== shellExecutable && session.submittedAgentKind) {
      session.foregroundAgentKind = session.submittedAgentKind;
    } else if (
      executable === shellExecutable
      && session.foregroundAgentKind !== undefined
    ) {
      session.foregroundAgentKind = undefined;
      session.submittedAgentKind = undefined;
    }
  } catch {
    // A PTY may disappear between output and process inspection.
  }
  return session.foregroundAgentKind;
}

/**
 * A command recalled with ↑ or completed with Tab never shows its name in what was typed, and Codex runs as "node":
 * ask the system once per foreground process what it runs.
 */
function probeForegroundAgent(
  session: TerminalSession,
  inspect: (shellPid: number) => Promise<string | undefined>,
): void {
  if (session.command !== undefined || session.foregroundAgentKind || process.platform === "win32") return;
  let executable: string;
  try {
    executable = path.basename(session.pty.process.trim().split(/\s+/, 1)[0] ?? "").toLowerCase();
  } catch {
    return;
  }
  if (executable === path.basename(session.shell).toLowerCase()) {
    session.probedProcess = undefined;
    return;
  }
  if (session.probedProcess === executable) return;
  session.probedProcess = executable;
  void inspect(session.pty.pid).then((command) => {
    const kind = agentKindFromCommand(command);
    if (!kind || !sessions.has(session.id) || session.probedProcess !== executable) return;
    // Held like a typed agent until the shell is back in the foreground.
    session.submittedAgentKind = kind;
    session.foregroundAgentKind = kind;
    sendSignalUpdate(session, {});
  }, () => {});
}

const execFileAsync = promisify(execFile);

/** macOS and Linux ps: the foreground process group of the shell's terminal, then its leader's command line. */
async function inspectForegroundCommand(shellPid: number): Promise<string | undefined> {
  const { stdout: group } = await execFileAsync("ps", ["-o", "tpgid=", "-p", String(shellPid)]);
  const leader = Number(group.trim());
  if (!Number.isInteger(leader) || leader <= 0) return undefined;
  const { stdout } = await execFileAsync("ps", ["-o", "args=", "-p", String(leader)]);
  return stdout.trim() || undefined;
}

const SCRIPT_INTERPRETER = /^(?:node|bun|deno|python[\d.]*)$/;

/** The program, or the script an interpreter runs; never a file the program was given ("vim codex-notes.md"). */
function agentKindFromCommand(command: string | undefined): TerminalForegroundAgentKind | undefined {
  const [program = "", script = ""] = (command ?? "").trim().split(/\s+/);
  const programName = path.basename(program).toLowerCase();
  for (const name of SCRIPT_INTERPRETER.test(programName) ? [path.basename(script).toLowerCase()] : [programName]) {
    if (/^codex(?:$|[-_.])/.test(name)) return "codex";
    if (/^claude(?:$|[-_.])/.test(name)) return "claude";
  }
  return undefined;
}

/** "pnpm dev" for "node /opt/homebrew/bin/pnpm dev": the program by its name, or the installed script an interpreter runs. */
function commandTitle(command: string): string {
  const [program = "", ...rest] = command.trim().split(/\s+/);
  const programName = path.basename(program);
  const script = rest[0] ?? "";
  // A script you named yourself ("node serve.js") stays as you typed it.
  return SCRIPT_INTERPRETER.test(programName.toLowerCase()) && path.isAbsolute(script)
    ? [path.basename(script), ...rest.slice(1)].join(" ")
    : [programName, ...rest].join(" ");
}

/** Names a shell after the program in its foreground once that program has held it for a while. */
function probeForegroundCommand(session: TerminalSession, foreground: string): void {
  session.commandProbeProcess = foreground;
  const current = () => sessions.get(session.id) === session && session.commandProbeProcess === foreground
    && !session.foregroundAgentKind;
  setTimeout(() => {
    if (!current()) return;
    void inspectShellForeground(session.pty.pid).then((command) => {
      if (!command || !current() || agentKindFromCommand(command)) return;
      // A title reaches more places than the terminal does (the planner's prompt among them), so secrets stay out.
      session.foregroundCommand = redactText(commandTitle(command));
      sendSignalUpdate(session, { foregroundCommand: session.foregroundCommand });
    }, () => {});
  }, foregroundCommandDelayMs).unref();
}

function consumeAgentCommandInput(buffer: string, data: string): {
  agentKind?: TerminalForegroundAgentKind | undefined;
  buffer: string;
  submitted: boolean;
} {
  let nextBuffer = buffer;
  let agentKind: TerminalForegroundAgentKind | undefined;
  let submitted = false;

  for (const character of data) {
    if (character === "\r" || character === "\n") {
      const command = nextBuffer.trim().split(/\s+/, 1)[0];
      agentKind = command === "codex" || command === "claude" ? command : undefined;
      nextBuffer = "";
      submitted = true;
    } else if (character === "\x7f") {
      nextBuffer = nextBuffer.slice(0, -1);
    } else if (character === "\x15") {
      nextBuffer = "";
    } else if (character >= " ") {
      nextBuffer += character;
    }
  }

  return { agentKind, buffer: nextBuffer, submitted };
}

function appendToBuffer(session: TerminalSession, data: string): void {
  session.buffer += data;

  if (session.buffer.length > MAX_BUFFER_LENGTH) {
    session.buffer = session.buffer.slice(-MAX_BUFFER_LENGTH);
  }
}

function clearSessionReplayData(session: TerminalSession): void {
  session.buffer = "";
  delete session.activityEvents;
  delete session.lastActivityAt;
  delete session.lastOutputAt;
}

// Keeps only what the renderer needs to show that the process ended.
function scrubExitedSnapshot(exit: RecentTerminalExit): void {
  const { args: _args, activityEvents: _events, lastActivityAt: _activity, lastOutputAt: _output, ...rest } =
    exit.snapshot;
  exit.snapshot = { ...rest, buffer: "" };
}

function disableLiveSessionPersistence(changed?: Set<string>): void {
  for (const exit of recentTerminalExits.values()) scrubExitedSnapshot(exit);
  for (const session of sessions.values()) {
    if (!session.clientId) continue;
    session.persistLaunchData = false;
    clearSessionReplayData(session);
    changed?.add(session.clientId);
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
  const clearGeneration = privacyClearGeneration;
  const hydrationMutations = new Map(
    [...restoredSessionSnapshots.keys()].map(
      (clientId): [string, number] => [clientId, privacyClearGeneration],
    ),
  );
  persistenceHydrationMutations = hydrationMutations;
  const hydration = (async () => {
    const state = await store.getState();
    if (persistedStateStore !== store || persistenceGeneration !== generation) return;
    if (!explicitPrivacyPolicy) {
      const learnedRetentionOff =
        effectivePrivacySettings.terminalScrollbackRetention !== "off"
        && state.privacySettings.terminalScrollbackRetention === "off";
      effectivePrivacySettings = { ...state.privacySettings };
      if (learnedRetentionOff) {
        privacyClearGeneration += 1;
        disableLiveSessionPersistence();
      }
    }
    const clearLaunchData =
      explicitPrivacyPolicy?.clearLaunchData || privacyClearGeneration !== clearGeneration;
    const sanitizeHydratedSessions =
      clearLaunchData || effectivePrivacySettings.terminalScrollbackRetention === "off";

    const locallyRemembered = new Map(
      [...restoredSessionSnapshots].filter(([clientId]) => hydrationMutations.has(clientId)),
    );
    restoredSessionSnapshots.clear();
    for (const session of state.restoredTerminalSessions) {
      if (forgottenClientIds.has(session.clientId) || locallyRemembered.has(session.clientId)) continue;
      const sanitized = sanitizeHydratedSessions
        ? sanitizePersistedTerminalSession(session, effectivePrivacySettings, clearLaunchData)
        : session;
      if (sanitized) restoredSessionSnapshots.set(session.clientId, clonePersistedSession(sanitized));
    }
    for (const [clientId, session] of locallyRemembered) {
      const crossedClear =
        (hydrationMutations.get(clientId) ?? clearGeneration) < privacyClearGeneration;
      const sanitizeLocalSession =
        crossedClear || effectivePrivacySettings.terminalScrollbackRetention === "off";
      const sanitized = sanitizeLocalSession
        ? sanitizePersistedTerminalSession(session, effectivePrivacySettings, crossedClear)
        : session;
      if (sanitized) restoredSessionSnapshots.set(clientId, sanitized);
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

  persistenceHydrationMutations?.set(snapshot.clientId, privacyClearGeneration);
  restoredSessionSnapshots.set(snapshot.clientId, snapshot);
  scheduleTerminalPersistence();
}

function forgetPersistedSession(clientId: string): void {
  if (!clientId) return;
  persistenceHydrationMutations?.set(clientId, privacyClearGeneration);
  forgottenClientIds.add(clientId);
  restoredSessionSnapshots.delete(clientId);
}

async function worktreeOperationRequest(
  sender: Electron.WebContents,
  clientId: string | undefined,
  options: Pick<TerminalIpcOptions, "managedWorktreeRootPath" | "resolveWorkspaceRoot">,
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
  const projectRoot = session.workspaceId && session.workspaceRootFingerprint
    ? await options.resolveWorkspaceRoot?.(session.workspaceId)
    : session.baseCwd;
  // A project can be a folder inside its repository, as in a monorepo. The checkout was made from the repository's
  // root, which its fingerprint names; a folder outside any repository is compared as it is.
  const baseCwd = projectRoot && session.workspaceRootFingerprint
    ? (await gitRepositoryRoot(projectRoot)) ?? projectRoot
    : projectRoot;
  if (!baseCwd) {
    return { ok: false, error: "Reattach the original project before managing this checkout." };
  }
  if (
    session.workspaceRootFingerprint
    && workspaceRootFingerprint(baseCwd) !== session.workspaceRootFingerprint
  ) {
    return {
      ok: false,
      error: "This workspace points to a different project. Reattach the original project first.",
    };
  }
  if (!session.branchName) {
    return { ok: false, error: "Isolated checkout metadata is incomplete." };
  }

  const cleanupOptions = worktreeStoreOptions(options);
  const cleanupRequest: AgentWorktreeCleanupRequest = {
    baseCwd,
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
    ...(session.workspaceId === undefined ? {} : { workspaceId: session.workspaceId }),
    ...(session.workspaceRootFingerprint === undefined
      ? {}
      : { workspaceRootFingerprint: session.workspaceRootFingerprint }),
  };
}

function isIsolatedWorktreeSession(
  session: WorktreeOperationSession | null | undefined,
): boolean {
  if (!session || session.isolation === "shared") return false;
  return session.isolation === "worktree"
    || Boolean(session.branchName && (session.baseCwd || (session.workspaceId && session.workspaceRootFingerprint)));
}

function toPersistedSnapshot(session: TerminalSession): PersistedTerminalSessionSnapshot | null {
  if (!session.clientId) return null;
  const agentKind = session.agentKind ?? session.foregroundAgentKind;
  const command = session.command ?? agentKind;
  const args = session.args ?? (command ? [] : undefined);
  const snapshot: PersistedTerminalSessionSnapshot = {
    clientId: session.clientId,
    title: session.title,
    source: session.source,
    ...(agentKind === undefined ? {} : { agentKind }),
    ...(session.workspaceId === undefined ? {} : { workspaceId: session.workspaceId }),
    ...(session.workspaceRootFingerprint === undefined
      ? {}
      : { workspaceRootFingerprint: session.workspaceRootFingerprint }),
    cwd: session.cwd,
    ...(session.isolation === undefined ? {} : { isolation: session.isolation }),
    ...(session.branchName === undefined ? {} : { branchName: session.branchName }),
    ...(session.baseCwd === undefined ? {} : { baseCwd: session.baseCwd }),
    createdAt: session.createdAt,
    shell: session.shell,
    ...(command === undefined ? {} : { command }),
    ...(args === undefined ? {} : { args: [...args] }),
    ...(session.resumeTarget === undefined ? {} : { resumeTarget: { ...session.resumeTarget } }),
    ...(session.parentClientId === undefined ? {} : { parentClientId: session.parentClientId }),
    buffer: tailBuffer(session.buffer, MAX_PERSISTED_BUFFER_LENGTH),
    ...(session.activityEvents === undefined ? {} : { activityEvents: cloneActivityEvents(session.activityEvents) }),
    ...(session.lastActivityAt === undefined ? {} : { lastActivityAt: session.lastActivityAt }),
    ...(session.lastOutputAt === undefined ? {} : { lastOutputAt: session.lastOutputAt }),
  };
  if (session.persistLaunchData) return snapshot;

  const identity = sanitizePersistedTerminalSession(snapshot, {
    terminalScrollbackRetention: "redactedTail",
  }, true);
  if (!identity) return null;
  return {
    ...identity,
    buffer: session.buffer,
    ...(snapshot.activityEvents === undefined ? {} : { activityEvents: snapshot.activityEvents }),
    ...(snapshot.lastActivityAt === undefined ? {} : { lastActivityAt: snapshot.lastActivityAt }),
    ...(snapshot.lastOutputAt === undefined ? {} : { lastOutputAt: snapshot.lastOutputAt }),
  };
}

function scheduleTerminalPersistence(): void {
  if (!persistedStateStore) return;

  if (persistDebounceMs <= 0) {
    persistTerminalSnapshotsInBackground();
    return;
  }

  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistTerminalSnapshotsInBackground();
  }, persistDebounceMs);
}

function persistTerminalSnapshotsInBackground(): void {
  void persistTerminalSnapshots().catch((error: unknown) => {
    console.warn("Failed to persist terminal snapshots in background.", error);
  });
}

async function persistTerminalSnapshots(): Promise<void> {
  const store = persistedStateStore;
  if (!store) return;

  await hydratePersistedTerminalSessions();
  if (persistedStateStore !== store) return;

  await store.updateState((current) => {
    const restoredTerminalSessions = [...restoredSessionSnapshots.values()].flatMap((session) => {
      const sanitized = sanitizePersistedTerminalSession(session, current.privacySettings);
      return sanitized ? [sanitized] : [];
    });
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

/**
 * An agent's screen is redrawn, not appended to: scrolling back through its transcript, a resize or a resumed
 * conversation draws old tool lines again. Its history therefore comes from hooks once they report, and before
 * your first message nothing it draws is new. Shells, and agents without hooks after that, have only their screen.
 */
function screenIsHistory(session: TerminalSession): boolean {
  if (session.hooksLive) return false;
  const agent = isCodingAgentKind(session.agentKind) || session.command === "claude" || session.command === "codex";
  return !agent || session.promptSubmitted === true;
}

function recordOutputActivity(
  session: TerminalSession,
  data: string,
  now = Date.now(),
  // A blocker such as "Not logged in" comes through no hook, and it is why the session needs you.
  scope: "all" | "blockers" = "all",
): SessionActivityEvent[] {
  const result: TerminalOutputActivityChunkResult = classifyTerminalOutputChunk(session.activityStream, data);
  session.activityStream = result.state;
  return result.activities.flatMap((activity) => {
    if (scope === "blockers" && !runtimeBlockerReason(activity)) return [];
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
  return canAttachOwnerToWindow(session.ownerWindowId, window);
}

function canAttachOwnerToWindow(ownerWindowId: number, window: BrowserWindow): boolean {
  return ownerWindowId === window.id || !hasLiveWindow(ownerWindowId);
}

function hasLiveWindow(windowId: number): boolean {
  return BrowserWindow.getAllWindows().some((window) => window.id === windowId && !window.isDestroyed());
}

function sendToSessionWindow(session: TerminalSession, channel: string, payload: unknown): void {
  if (!session.window || session.window.isDestroyed() || !isTrustedIpcRecipient(session.window.webContents)) {
    return;
  }

  session.window.webContents.send(channel, payload);
}

function defaultSessionTitle(source: TerminalSessionSource, shell: string): string {
  return source === "alfred" ? shell : "Manual terminal";
}

function killSession(
  id: TerminalSessionId,
  reason: "close" | "quit",
): void {
  const session = sessions.get(id);

  if (!session) {
    return;
  }

  sessions.delete(id);
  rememberEndedWorker(session);
  recordSessionActivity(session, reason === "close"
    ? {
        kind: "lifecycle",
        title: "Closed by user",
        detail: "This terminal was closed. Its recovery snapshot is still available.",
      }
    : {
        kind: "lifecycle",
        title: "Stopped on quit",
        detail: "Alfred stopped this terminal while quitting.",
      });
  rememberSessionSnapshot(session);
  // On quit its workers stay its own, for after the restart.
  if (reason === "close") releaseWorkers(session.clientId);
  session.pty.kill();
}

/**
 * Closing an orchestrator ends its hold on its workers: they run on as sessions of their own, and a later session under
 * its id starts with none of them or their news.
 */
function releaseWorkers(parentClientId: string | undefined): void {
  if (!parentClientId) return;
  clearTimeout(wakeTimers.get(parentClientId));
  wakeTimers.delete(parentClientId);
  pendingWakes.delete(parentClientId);
  for (const [clientId, worker] of offstageWorkers) {
    if (worker.parentClientId === parentClientId) offstageWorkers.delete(clientId);
  }
  for (const session of sessions.values()) {
    if (session.parentClientId !== parentClientId) continue;
    delete session.parentClientId;
    rememberSessionSnapshot(session);
  }
  let releasedAsleep = false;
  for (const snapshot of restoredSessionSnapshots.values()) {
    if (snapshot.parentClientId !== parentClientId) continue;
    const { parentClientId: _parentClientId, ...released } = snapshot;
    persistenceHydrationMutations?.set(snapshot.clientId, privacyClearGeneration);
    restoredSessionSnapshots.set(snapshot.clientId, released);
    releasedAsleep = true;
  }
  if (releasedAsleep) scheduleTerminalPersistence();
  notifyWorkers();
}

function notifyWorkers(): void {
  for (const listener of [...workerListeners]) listener();
}

function isAgentSession(session: TerminalSession): boolean {
  return isCodingAgentKind(session.agentKind) || session.command === "claude" || session.command === "codex";
}

function workerRecord(session: TerminalSession, exited = false): WorkerRecord {
  return {
    clientId: session.clientId ?? session.id,
    title: session.title,
    agent: session.agentKind ?? session.command ?? "terminal",
    turn: {
      lastPrompt: session.lastPromptSeq ?? 0,
      lastTurnEnd: session.lastTurnEndSeq ?? 0,
      waitingApproval: session.agentSignal?.state === "needs-you",
      exited,
    },
    lastAnswer: session.lastAnswer,
    activityEvents: session.activityEvents ?? [],
  };
}

function rememberEndedWorker(session: TerminalSession): void {
  if (!session.parentClientId || !session.clientId) return;
  offstageWorkers.delete(session.clientId);
  offstageWorkers.set(session.clientId, { ...workerRecord(session, true), parentClientId: session.parentClientId, since: Date.now() });
  while (offstageWorkers.size > MAX_OFFSTAGE_WORKERS) {
    const oldest = offstageWorkers.keys().next().value;
    if (oldest === undefined) break;
    offstageWorkers.delete(oldest);
  }
  if (!session.stoppedByOrchestrator) queueWake(session, true);
  notifyWorkers();
}

/** Keeps the news for the worker's orchestrator; a worker you started yourself is not its news. */
function queueWake(worker: TerminalSession, ended: boolean): void {
  if (!worker.clientId || !worker.parentClientId || !toolStartedWorkers.has(worker.clientId)) return;
  const news = pendingWakes.get(worker.parentClientId) ?? new Map<string, WorkerNews>();
  news.set(worker.clientId, { title: worker.title, ended });
  pendingWakes.set(worker.parentClientId, news);
  scheduleWake(worker.parentClientId);
}

function scheduleWake(parentClientId: string): void {
  clearTimeout(wakeTimers.get(parentClientId));
  wakeTimers.set(parentClientId, setTimeout(() => {
    wakeTimers.delete(parentClientId);
    deliverWake(parentClientId);
  }, WAKE_BATCH_MS).unref());
}

/**
 * Tells an orchestrator that waits for the user what its workers did, so it need not wait for them itself. Only when
 * its hooks say it waits for a message, and you have not started typing one: the news then waits for its next turn end.
 */
function deliverWake(parentClientId: string): void {
  const news = pendingWakes.get(parentClientId);
  if (!news?.size) return;
  const orchestrator = findLiveSessionByClientId(parentClientId);
  if (!orchestrator) {
    pendingWakes.delete(parentClientId);
    return;
  }
  const waitsForMessage = orchestrator.hooksLive && workerState(workerRecord(orchestrator).turn) === "your turn";
  if (!waitsForMessage || orchestrator.typedSinceTurnEnd) return;
  pendingWakes.delete(parentClientId);
  typeIntoAgent(orchestrator, alfredNotice(wakeText(news)));
}

/**
 * Which workers changed, never what they wrote: a worker's answer under Alfred's label would read as Alfred's own word,
 * so the orchestrator reads it with read_worker, as a tool result.
 */
function wakeText(news: Map<string, WorkerNews>): string {
  const items = [...news.entries()];
  const [onlyId, only] = items.length === 1 ? items[0]! : [];
  const head = only
    ? `your worker ${JSON.stringify(only.title)} (${onlyId}) ${only.ended ? "has ended" : "finished its turn"}.`
    : `${items.length} of your workers changed.`;
  const lines = items.length === 1
    ? []
    : items.map(([id, item]) => `- ${JSON.stringify(item.title)} (${id}) ${item.ended ? "ended" : "finished its turn"}.`);
  return [head, ...lines, "Read their answers with read_worker; send_to_worker gives a worker its next message."].join("\n");
}

function stopWorker(clientId: string): void {
  const session = findLiveSessionByClientId(clientId);
  if (!session) throw new WorkerToolError("The worker has already ended.");
  session.stoppedByOrchestrator = true;
  recordSessionActivity(session, {
    kind: "lifecycle",
    title: "Stopped by its orchestrator",
    detail: "Its orchestrator stopped this worker. Its files stay as they are.",
  });
  // The exit is reported like any other, so the window shows it ended.
  session.pty.kill();
}

function workersOf(parentClientId: string): WorkerRecord[] {
  const live = [...sessions.values()].filter((session) => session.clientId && session.parentClientId === parentClientId);
  const liveIds = new Set(live.map((session) => session.clientId));
  const now = Date.now();
  const offstage = [...offstageWorkers.values()].filter((worker) =>
    worker.parentClientId === parentClientId
    && !liveIds.has(worker.clientId)
    && (worker.turn.exited || now - worker.since < WORKER_START_GRACE_MS));
  return [
    ...live.map((session) => workerRecord(session)),
    ...offstage.map(({ parentClientId: _parent, since: _since, ...worker }) => worker),
  ];
}

/** Asks the orchestrator's window to add the worker under it; the window starts its terminal like any other. */
async function requestWorker(
  parentClientId: string,
  request: WorkerStartRequest,
  replies: Map<string, (reply: TerminalWorkerReply) => void>,
): Promise<{ clientId: string; title: string }> {
  const parent = findLiveSessionByClientId(parentClientId);
  if (!parent?.window || parent.window.isDestroyed()) {
    throw new WorkerToolError("Alfred has no open window for this session, so it cannot add a worker.");
  }
  const requestId = randomUUID();
  const reply = await new Promise<TerminalWorkerReply>((resolve, reject) => {
    const timer = setTimeout(() => {
      replies.delete(requestId);
      reject(new WorkerToolError("Alfred's window did not answer in time. Check list_workers before starting another worker."));
    }, WORKER_REPLY_TIMEOUT_MS);
    replies.set(requestId, (answer) => {
      clearTimeout(timer);
      replies.delete(requestId);
      resolve(answer);
    });
    const payload: TerminalWorkerRequest = { requestId, parentClientId, ...request };
    sendToSessionWindow(parent, terminalChannels.workerRequest, payload);
  });
  if ("error" in reply) throw new WorkerToolError(typeof reply.error === "string" ? reply.error : "Alfred could not add the worker.");
  const clientId = clientIdValue(reply.clientId);
  if (!clientId || clientId === parentClientId) throw new WorkerToolError("Alfred could not add the worker.");
  const title = typeof reply.title === "string" && reply.title.trim() ? reply.title.trim() : clientId;
  toolStartedWorkers.add(clientId);
  offstageWorkers.set(clientId, {
    clientId,
    title,
    agent: request.agent,
    turn: { lastPrompt: 0, lastTurnEnd: 0, waitingApproval: false, exited: false },
    activityEvents: [],
    parentClientId,
    since: Date.now(),
  });
  notifyWorkers();
  return { clientId, title };
}

/** Pastes text into an agent's terminal and presses Enter: an orchestrator's message to its worker, or Alfred's news. */
function typeIntoAgent(session: TerminalSession, message: string): void {
  // Only hooks say for sure that the agent waits for a message rather than shows an approval menu, where Enter would answer.
  if (!session.hooksLive) {
    throw new WorkerToolError(
      "Alfred cannot tell when this worker waits for a message, because it does not run Alfred's hooks. The user can trust them in its terminal (/hooks in Codex).",
    );
  }
  // The message is typed into another agent's terminal: no control sequence may end the paste early or press keys.
  // eslint-disable-next-line no-control-regex
  const text = message.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
  session.pty.write(`\x1b[200~${text}\x1b[201~`);
  setTimeout(() => {
    if (sessions.get(session.id) === session && session.agentSignal?.state !== "needs-you") session.pty.write("\r");
  }, PASTE_SUBMIT_DELAY_MS).unref();
  session.lastPromptSeq = ++turnSeq;
  session.typedSinceTurnEnd = false;
  if (!session.promptSubmitted) {
    session.promptSubmitted = true;
    sendSignalUpdate(session, { promptSubmitted: true });
  }
  notifyWorkers();
}

/** The conversation an agent's hook names, when it is not the one this session already resumes. */
function newConversation(session: TerminalSession, conversationId: string | undefined): TerminalResumeTarget | undefined {
  const agentKind = session.command === "claude" || session.command === "codex" ? session.command : undefined;
  if (!conversationId || !agentKind) return undefined;
  if (session.resumeTarget?.agentKind === agentKind && session.resumeTarget.sessionId === conversationId) return undefined;
  return { agentKind, sessionId: conversationId, source: "agent-hook" };
}

function isCodexSession(session: TerminalSession): boolean {
  return session.command === "codex" || session.agentKind === "codex" || session.foregroundAgentKind === "codex";
}

function applyAgentSignal(
  session: TerminalSession,
  update: AgentSignalUpdate,
  source: TerminalAgentSignal["source"],
  now: number,
): { activities: SessionActivityEvent[]; signal: TerminalAgentSignal } {
  const signal: TerminalAgentSignal = {
    state: update.state,
    source,
    at: now,
    ...(update.detail === undefined ? {} : { detail: update.detail }),
  };
  session.agentSignal = signal;
  if (update.state === "working") session.lastPromptSeq = ++turnSeq;
  if (update.state === "your-turn") {
    session.lastTurnEndSeq = ++turnSeq;
    session.lastAnswer = update.answer ?? update.detail;
    session.typedSinceTurnEnd = false;
    queueWake(session, false);
    // Its own turn just ended: news that waited for it can go now.
    if (session.clientId && pendingWakes.get(session.clientId)?.size) scheduleWake(session.clientId);
  }
  notifyWorkers();
  const activity = update.state === "needs-you"
    ? recordSessionActivity(session, {
        kind: "approval",
        title: "Waiting for approval",
        detail: update.detail ?? "Waiting for approval",
        payload: { type: "approval", prompt: update.detail ?? "Waiting for approval" },
      }, now)
    // The answer a turn ended with replaces the approval it asked for on the session's rail row.
    // ponytail: hooks only; a Codex notification's turn-end preview would repeat the same answer next to it.
    : update.state === "your-turn" && source === "hook" && update.detail
      ? recordSessionActivity(session, { kind: "output", title: "Turn finished", detail: update.detail }, now)
      : null;
  const reported = update.activity ? recordSessionActivity(session, update.activity, now) : null;
  return { activities: [activity, reported].filter((event): event is SessionActivityEvent => event !== null), signal };
}

/** Your answer resolves an approval; a Codex notification also ends when you type. Claude's Stop stays until its next hook. */
function clearWaitingSignal(session: TerminalSession): boolean {
  const signal = session.agentSignal;
  if (!signal || (signal.state !== "needs-you" && signal.source !== "osc9")) return false;
  session.agentSignal = undefined;
  return true;
}

/**
 * Your input settles the prompt the session last asked, so the quiet after a declined prompt does not read as one still
 * waiting. Details leaves this event out, as it does every lifecycle event it does not name.
 */
function answerApproval(session: TerminalSession): SessionActivityEvent | null {
  if (session.activityEvents?.at(-1)?.kind !== "approval") return null;
  return recordSessionActivity(session, { kind: "lifecycle", title: "Prompt answered", detail: "You answered in the terminal." });
}

function sendSignalUpdate(
  session: TerminalSession,
  update: {
    activities?: SessionActivityEvent[];
    agentSignal?: TerminalAgentSignal | null;
    shellBusy?: boolean;
    foregroundCommand?: string;
    promptSubmitted?: true;
    resumeTarget?: TerminalResumeTarget;
  },
): void {
  sendToSessionWindow(session, terminalChannels.data, {
    id: session.id,
    ...(session.clientId === undefined ? {} : { clientId: session.clientId }),
    data: "",
    // The renderer reads a missing kind as "no agent here", as on output.
    ...(session.foregroundAgentKind === undefined ? {} : { foregroundAgentKind: session.foregroundAgentKind }),
    activities: update.activities ?? [],
    ...(update.agentSignal === undefined ? {} : { agentSignal: update.agentSignal }),
    ...(update.shellBusy === undefined ? {} : { shellBusy: update.shellBusy }),
    ...(update.foregroundCommand === undefined ? {} : { foregroundCommand: update.foregroundCommand }),
    ...(update.promptSubmitted ? { promptSubmitted: true } : {}),
    ...(update.resumeTarget ? { resumeTarget: update.resumeTarget } : {}),
  });
}

/** Returns the new value only when it changed. Windows and agent sessions do not sample. */
function updateShellBusy(session: TerminalSession): boolean | undefined {
  if (session.command !== undefined || process.platform === "win32") return undefined;
  try {
    const foreground = session.pty.process;
    const busy = !isShellProcess(foreground);
    if (busy && foreground !== session.commandProbeProcess) probeForegroundCommand(session, foreground);
    // Back at the prompt the shell goes by its own name; the renderer reads that from shellBusy false.
    if (!busy) {
      session.foregroundCommand = undefined;
      session.commandProbeProcess = undefined;
    }
    if (busy === session.shellBusy) return undefined;
    session.shellBusy = busy;
    return busy;
  } catch {
    return undefined; // The PTY may disappear between input and inspection.
  }
}

function scheduleShellBusySample(session: TerminalSession): void {
  if (session.command !== undefined || process.platform === "win32") return;
  setTimeout(() => {
    if (sessions.get(session.id) !== session) return;
    const shellBusy = updateShellBusy(session);
    if (shellBusy !== undefined) sendSignalUpdate(session, { shellBusy });
  }, 150).unref();
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
  if (!request.command) return false;
  const snapshot = await matchingPersistedRestoredSnapshot(request);
  if (!snapshot || snapshot.command !== request.command) return false;

  const requestedArgs = request.args ?? [];
  const persistedArgs = snapshot.args ?? [];
  return requestedArgs.length === persistedArgs.length
    && requestedArgs.every((arg, index) => arg === persistedArgs[index]);
}

async function matchingPersistedRestoredSnapshot(
  request: TerminalCreateRequest,
): Promise<PersistedTerminalSessionSnapshot | null> {
  if (!request.clientId || !request.cwd) return null;
  await hydratePersistedTerminalSessions();
  if (findLiveSessionByClientId(request.clientId)) return null;

  const snapshot = restoredSessionSnapshots.get(request.clientId);
  if (!snapshot?.cwd || snapshot.source !== request.source) return null;
  if ((snapshot.workspaceId ?? "A") !== (request.workspaceId ?? "A")) return null;
  if ((snapshot.isolation ?? "shared") !== (request.isolation ?? "shared")) return null;
  if (snapshot.branchName !== request.branchName || snapshot.baseCwd !== request.baseCwd) return null;

  const [snapshotCwd, requestCwd] = await Promise.all([
    canonicalWorkspacePath(snapshot.cwd),
    canonicalWorkspacePath(request.cwd),
  ]);
  return snapshotCwd === requestCwd ? snapshot : null;
}

async function isExactPersistedRestoredCwd(request: TerminalCreateRequest): Promise<boolean> {
  const snapshot = await matchingPersistedRestoredSnapshot(request);
  if (!snapshot) return false;

  if (!request.command) {
    return !snapshot.command
      && request.agentKind === undefined
      && snapshot.agentKind === undefined
      && (request.args?.length ?? 0) === 0
      && request.resumeTarget === undefined;
  }

  const requestedArgs = request.args ?? [];
  const persistedArgs = snapshot.args ?? [];
  if (
    snapshot.command === request.command
    && requestedArgs.length === persistedArgs.length
    && requestedArgs.every((arg, index) => arg === persistedArgs[index])
  ) {
    return true;
  }

  if (snapshot.agentKind === "codex" && request.agentKind === "codex" && request.command === "codex") {
    if (snapshot.resumeTarget?.agentKind === "codex") {
      return request.resumeTarget?.agentKind === "codex"
        && request.resumeTarget.sessionId === snapshot.resumeTarget.sessionId
        && requestedArgs.length === 2
        && requestedArgs[0] === "resume"
        && requestedArgs[1] === snapshot.resumeTarget.sessionId;
    }
    return requestedArgs.length === 2 && requestedArgs[0] === "resume" && requestedArgs[1] === "--last";
  }

  if (snapshot.agentKind !== "claude" || request.agentKind !== "claude" || request.command !== "claude") return false;
  if (snapshot.resumeTarget?.agentKind === "claude") {
    return request.resumeTarget?.agentKind === "claude"
      && request.resumeTarget.sessionId === snapshot.resumeTarget.sessionId
      && requestedArgs.length === 2
      && requestedArgs[0] === "--resume"
      && requestedArgs[1] === snapshot.resumeTarget.sessionId;
  }
  return requestedArgs.length === 1 && requestedArgs[0] === "--continue";
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

  if (!allowed && !await isExactPersistedRestoredCwd(request)) {
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
