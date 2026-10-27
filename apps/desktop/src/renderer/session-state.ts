import type { AgentKind, AlfredLaunchPreflight, AlfredPlanSession, AlfredStagedPlanSnapshot } from "../shared/alfred-ipc";
import {
  appendActivityEvent,
  type SessionActivityEvent,
  type SessionActivityInput,
} from "../shared/session-activity";
import type {
  TerminalAgentSignal,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalExitEvent,
  PersistedTerminalSessionSnapshot,
  TerminalSessionSnapshot,
  TerminalSessionId,
  TerminalSessionIsolation,
  TerminalResumeTarget,
} from "../shared/terminal-ipc";
import { normalizeSessionTitle, titleFromPrompt } from "../shared/session-title";

export type SessionTile = {
  id: string;
  runtimeId?: TerminalSessionId;
  title: string;
  workspaceId: string;
  workspaceRootFingerprint?: string;
  cwd: string;
  isolation?: TerminalSessionIsolation;
  branchName?: string;
  baseCwd?: string;
  createdAt?: number;
  source: "manual" | "alfred";
  stage: "staged" | "live";
  stagedReviewStatus?: "checking" | "edited";
  runtimeStatus?: "starting" | "live" | "exited" | "error" | "restored" | "unavailable";
  command?: string;
  args?: string[];
  resumeTarget?: TerminalResumeTarget;
  resumeMode?: "exact" | "latest";
  agentKind?: AgentKind;
  detectedAgentKind?: Extract<AgentKind, "codex" | "claude"> | undefined;
  safetyNote?: string;
  launchPreflight?: AlfredLaunchPreflight;
  initialBuffer?: string;
  activityEvents?: SessionActivityEvent[];
  lastActivityAt?: number;
  lastOutputAt?: number;
  /** Reported by the agent itself (hooks or terminal notifications). */
  agentSignal?: TerminalAgentSignal;
  /** True while a program other than the shell holds the foreground (plain terminals only). */
  shellBusy?: boolean;
  /** You have sent this session a message (the main process saw Enter). */
  promptSubmitted?: boolean;
  /** Started as a worker of this session ("New worker" on its rail row). */
  parentSessionId?: string;
};

export type { SessionActivityEvent, SessionActivityEventKind, SessionActivityInput } from "../shared/session-activity";

const MANUAL_SESSION_PREFIX = "manual-";
const ALFRED_SESSION_PREFIX = "alfred-";
const MAX_ACTIVITY_EVENTS = 40;
// Titles Alfred gives, which a detected agent or the first prompt may replace: "zsh", "Codex 2". Builds before
// 2026-10-20 wrote "Manual · zsh 3" and "Codex · session 3", which a main process still running can hand over.
// ponytail: a session you named exactly "Codex" or "zsh" reads as generated too.
const GENERATED_TERMINAL_TITLE = /^(?:(?:zsh|Codex|Claude)(?: (\d+))?|(?:Manual · zsh|Codex · session|Claude · session) (\d+))$/;

export function isGeneratedSessionTitle(title: string): boolean {
  return GENERATED_TERMINAL_TITLE.test(title);
}

export function generatedTitleForDetectedAgent(
  sessions: SessionTile[],
  session: Pick<SessionTile, "id" | "title" | "workspaceId">,
  kind: TerminalDataEvent["foregroundAgentKind"],
): string {
  if (!kind || !GENERATED_TERMINAL_TITLE.test(session.title)) return session.title;
  const base = kind === "codex" ? "Codex" : "Claude";
  if (new RegExp(`^${base}(?: \\d+)?$`).test(session.title)) return session.title;
  return nextGeneratedTitle(sessions.filter((other) => other.id !== session.id), session.workspaceId, base);
}

type SessionTitleFallbackInput = {
  agentKind?: AgentKind;
  command?: string;
};

function fallbackSessionTitle({ agentKind, command }: SessionTitleFallbackInput): string {
  if (agentKind === "codex" || command === "codex") return "Codex";
  if (agentKind === "claude" || command === "claude") return "Claude";
  return "Terminal";
}

function normalizedSessionTitleWithFallback(title: string, fallback: SessionTitleFallbackInput): string {
  return normalizeSessionTitle(title) || fallbackSessionTitle(fallback);
}

export function createInitialSessions(cwd: string, workspaceId = "A"): SessionTile[] {
  return [createManualSession(1, cwd, workspaceId, SHELL_TITLE)];
}

export function addManualSession(
  sessions: SessionTile[],
  cwd: string,
  workspaceId = "A",
  parentSessionId?: string,
  reservedIds: Iterable<string> = [],
): SessionTile[] {
  const nextIndex = nextManualSessionIndex(sessions, reservedIds);
  const session = createManualSession(nextIndex, cwd, workspaceId, nextGeneratedTitle(sessions, workspaceId, SHELL_TITLE));
  return [...sessions, parentSessionId ? { ...session, parentSessionId } : session];
}

export function addAgentSession(
  sessions: SessionTile[],
  kind: Extract<AgentKind, "claude" | "codex">,
  cwd: string,
  workspaceId = "A",
  isolation: TerminalSessionIsolation = "shared",
  prompt = "",
  parentSessionId?: string,
  reservedIds: Iterable<string> = [],
): SessionTile[] {
  const nextIndex = nextPrefixedSessionIndex(sessions, `${kind}-`, reservedIds);
  // A first prompt names the session; without one it keeps a generated title until you type one.
  const title = titleFromPrompt(prompt) || nextGeneratedTitle(sessions, workspaceId, kind === "codex" ? "Codex" : "Claude");
  return [
    ...sessions,
    {
      id: `${kind}-${nextIndex}`,
      title,
      workspaceId,
      cwd,
      source: "manual",
      stage: "live",
      runtimeStatus: "starting",
      agentKind: kind,
      command: kind,
      args: prompt ? ["--", prompt] : [],
      isolation,
      ...(parentSessionId ? { parentSessionId } : {}),
    },
  ];
}

export function closeSession(sessions: SessionTile[], sessionId: string): SessionTile[] {
  // Its workers run on as sessions of their own, so a later session under its id does not get them.
  return sessions.flatMap((session) => {
    if (session.id === sessionId) return [];
    if (session.parentSessionId !== sessionId) return [session];
    const { parentSessionId: _parentSessionId, ...released } = session;
    return [released];
  });
}

export function sessionInstanceKey(
  session: Pick<
    SessionTile,
    "baseCwd" | "branchName" | "createdAt" | "id" | "runtimeId"
  >,
): string {
  return [
    session.id,
    session.runtimeId ?? "",
    session.createdAt ?? "",
    session.branchName ?? "",
    session.baseCwd ?? "",
  ].join("\u001f");
}

export function renameSession(sessions: SessionTile[], sessionId: string, title: string): SessionTile[] {
  const normalizedTitle = normalizeSessionTitle(title);
  if (!normalizedTitle) return sessions;

  return sessions.map((session) => session.id === sessionId ? { ...session, title: normalizedTitle } : session);
}

export function attachRuntimeSession(
  sessions: SessionTile[],
  tileId: string,
  runtime: TerminalCreateResult,
): SessionTile[] {
  return sessions.map((session) => {
    if (session.id !== tileId) return session;
    const {
      createdAt: _createdAt,
      initialBuffer: _initialBuffer,
      launchPreflight: _launchPreflight,
      lastOutputAt: _lastOutputAt,
      ...attachedSession
    } = session;

    const exitedBeforeAttachStatus = session.runtimeId === runtime.id
      && (session.runtimeStatus === "exited" || session.runtimeStatus === "error")
      ? session.runtimeStatus
      : null;
    return {
      ...attachedSession,
      runtimeId: runtime.id,
      runtimeStatus: exitedBeforeAttachStatus ?? "live",
      title: normalizeSessionTitle(runtime.title) || session.title,
      cwd: runtime.cwd,
      ...(runtime.isolation === undefined ? {} : { isolation: runtime.isolation }),
      ...(runtime.branchName === undefined ? {} : { branchName: runtime.branchName }),
      ...(runtime.baseCwd === undefined ? {} : { baseCwd: runtime.baseCwd }),
      ...(runtime.createdAt === undefined ? {} : { createdAt: runtime.createdAt }),
      ...(runtime.command === undefined ? {} : { command: runtime.command }),
      ...(runtime.args === undefined ? {} : { args: runtime.args }),
      ...(runtime.resumeTarget === undefined ? {} : { resumeTarget: runtime.resumeTarget }),
      ...(runtime.agentKind === undefined ? {} : { agentKind: runtime.agentKind }),
      ...(runtime.workspaceId === undefined ? {} : { workspaceId: runtime.workspaceId }),
    };
  });
}

export function markSessionStartFailed(sessions: SessionTile[], tileId: string): SessionTile[] {
  return sessions.map((session) => {
    if (session.id !== tileId) return session;
    if (session.runtimeStatus === "starting" && !session.runtimeId && session.initialBuffer) {
      return { ...session, runtimeStatus: "restored" };
    }
    const { launchPreflight: _launchPreflight, ...retryableSession } = session;
    const nextStage = session.source === "alfred" && !session.runtimeId ? "staged" : session.stage;
    return { ...retryableSession, stage: nextStage, runtimeStatus: "error" };
  });
}

export function markSessionUnavailable(sessions: SessionTile[], tileId: string): SessionTile[] {
  return sessions.map((session) => {
    if (session.id !== tileId) return session;
    if (session.runtimeStatus === "unavailable") return session;
    const { launchPreflight: _launchPreflight, runtimeId: _runtimeId, ...unavailableSession } = session;
    return { ...unavailableSession, runtimeStatus: "unavailable" };
  });
}

export function markSessionExited(
  sessions: SessionTile[],
  runtimeId: TerminalSessionId,
  exitCode = 0,
  clientId?: string,
): SessionTile[] {
  const runtimeStatus = exitCode === 0 ? "exited" : "error";
  return sessions.map((session) =>
    terminalEventMatchesSession(session, {
      id: runtimeId,
      ...(clientId === undefined ? {} : { clientId }),
    })
      ? { ...session, runtimeId, runtimeStatus }
      : session,
  );
}

export function restartSession(sessions: SessionTile[], sessionId: string): SessionTile[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const {
      initialBuffer: _initialBuffer,
      lastOutputAt: _lastOutputAt,
      runtimeId: _runtimeId,
      createdAt: _createdAt,
      // What the ended process reported; the new one reports its own.
      agentSignal: _agentSignal,
      detectedAgentKind: _detectedAgentKind,
      promptSubmitted: _promptSubmitted,
      shellBusy: _shellBusy,
      ...restartableSession
    } = session;
    // An agent that named its conversation goes back to it; one that ended before that starts as it was launched.
    const agentKind = restoredAgentKind(session);
    const resume = agentKind && session.resumeTarget?.agentKind === agentKind ? resumeLaunchForRestoredAgent(session) : {};
    return { ...restartableSession, ...resume, runtimeStatus: "starting" };
  });
}

export function canRelaunchRestoredSession(
  session: Pick<
    SessionTile,
    "agentKind" | "command" | "cwd" | "runtimeStatus" | "source"
  >,
): boolean {
  if (session.runtimeStatus !== "restored" || !session.cwd) return false;
  if (session.agentKind === "codex" || session.agentKind === "claude") {
    return session.command === session.agentKind;
  }
  if (session.source === "manual" && !session.agentKind) return true;
  return Boolean(session.command);
}

export function relaunchRestoredSession(sessions: SessionTile[], sessionId: string): SessionTile[] {
  return sessions.map((session) => {
    if (session.id !== sessionId || !canRelaunchRestoredSession(session)) return session;
    const {
      runtimeId: _runtimeId,
      ...relaunchableSession
    } = session;
    return { ...relaunchableSession, ...resumeLaunchForRestoredAgent(session), runtimeStatus: "starting" };
  });
}

export function hydrateLiveTerminalSessions(snapshots: TerminalSessionSnapshot[]): SessionTile[] {
  return snapshots.map((snapshot) => ({
    id: snapshot.clientId ?? `runtime-${snapshot.id}`,
    runtimeId: snapshot.id,
    title: normalizedSessionTitleWithFallback(snapshot.title, snapshot),
    workspaceId: snapshot.workspaceId ?? "A",
    cwd: snapshot.cwd,
    ...(snapshot.workspaceRootFingerprint === undefined
      ? {}
      : { workspaceRootFingerprint: snapshot.workspaceRootFingerprint }),
    ...(snapshot.isolation === undefined ? {} : { isolation: snapshot.isolation }),
    ...(snapshot.branchName === undefined ? {} : { branchName: snapshot.branchName }),
    ...(snapshot.baseCwd === undefined ? {} : { baseCwd: snapshot.baseCwd }),
    ...(snapshot.createdAt === undefined ? {} : { createdAt: snapshot.createdAt }),
    source: snapshot.source,
    stage: "live",
    runtimeStatus: "live",
    ...(snapshot.command === undefined ? {} : { command: snapshot.command }),
    ...(snapshot.args === undefined ? {} : { args: snapshot.args }),
    ...(snapshot.resumeTarget === undefined ? {} : { resumeTarget: snapshot.resumeTarget }),
    ...(snapshot.agentKind === undefined ? {} : { agentKind: snapshot.agentKind }),
    ...(snapshot.foregroundAgentKind === undefined ? {} : { detectedAgentKind: snapshot.foregroundAgentKind }),
    ...(snapshot.agentSignal === undefined ? {} : { agentSignal: snapshot.agentSignal }),
    ...(snapshot.shellBusy === undefined ? {} : { shellBusy: snapshot.shellBusy }),
    ...(snapshot.promptSubmitted ? { promptSubmitted: true } : {}),
    ...(snapshot.parentClientId === undefined ? {} : { parentSessionId: snapshot.parentClientId }),
    ...(snapshot.activityEvents === undefined ? {} : { activityEvents: snapshot.activityEvents }),
    ...(snapshot.lastActivityAt === undefined ? {} : { lastActivityAt: snapshot.lastActivityAt }),
    ...(snapshot.lastOutputAt === undefined ? {} : { lastOutputAt: snapshot.lastOutputAt }),
    initialBuffer: snapshot.buffer,
  }));
}

export function hydratePersistedTerminalSessions(snapshots: PersistedTerminalSessionSnapshot[]): SessionTile[] {
  return snapshots.map((snapshot) => ({
    id: snapshot.clientId,
    title: normalizedSessionTitleWithFallback(snapshot.title, snapshot),
    workspaceId: snapshot.workspaceId ?? "A",
    cwd: snapshot.cwd ?? "",
    ...(snapshot.workspaceRootFingerprint === undefined
      ? {}
      : { workspaceRootFingerprint: snapshot.workspaceRootFingerprint }),
    ...(snapshot.isolation === undefined ? {} : { isolation: snapshot.isolation }),
    ...(snapshot.branchName === undefined ? {} : { branchName: snapshot.branchName }),
    ...(snapshot.baseCwd === undefined ? {} : { baseCwd: snapshot.baseCwd }),
    ...(snapshot.createdAt === undefined ? {} : { createdAt: snapshot.createdAt }),
    source: snapshot.source,
    stage: "live",
    runtimeStatus: "restored",
    ...(snapshot.command === undefined ? {} : { command: snapshot.command }),
    ...(snapshot.args === undefined ? {} : { args: snapshot.args }),
    ...(snapshot.resumeTarget === undefined ? {} : { resumeTarget: snapshot.resumeTarget }),
    ...(snapshot.agentKind === undefined ? {} : { agentKind: snapshot.agentKind }),
    ...resumeModeForRestoredAgent(snapshot),
    ...(snapshot.parentClientId === undefined ? {} : { parentSessionId: snapshot.parentClientId }),
    ...(snapshot.activityEvents === undefined ? {} : { activityEvents: snapshot.activityEvents }),
    ...(snapshot.lastActivityAt === undefined ? {} : { lastActivityAt: snapshot.lastActivityAt }),
    ...(snapshot.lastOutputAt === undefined ? {} : { lastOutputAt: snapshot.lastOutputAt }),
    initialBuffer: snapshot.buffer ?? "",
  }));
}

export function hydrateStagedPlanSessions(
  plan: AlfredStagedPlanSnapshot | null,
  defaultCwd: string,
): SessionTile[] {
  if (!plan) return [];
  return plan.sessions.map((session) => {
    const isolation = plannedSessionIsolation(session.kind, session.launchPreflight, planSessionIsolation(session));
    return {
      id: session.id,
      title: normalizedSessionTitleWithFallback(session.title, session),
      workspaceId: plan.workspaceId,
      cwd: session.cwd ?? defaultCwd,
      source: "alfred",
      stage: "staged",
      command: session.command,
      args: session.args,
      agentKind: session.kind,
      ...(isolation === undefined ? {} : { isolation }),
      ...(session.safetyNote === undefined ? {} : { safetyNote: session.safetyNote }),
      ...(session.launchPreflight === undefined ? {} : { launchPreflight: cloneLaunchPreflight(session.launchPreflight) }),
    };
  });
}

function resumeLaunchForRestoredAgent(
  session: Pick<SessionTile, "agentKind" | "args" | "command" | "resumeTarget">,
): Pick<SessionTile, "command" | "args" | "resumeMode"> {
  const agentKind = restoredAgentKind(session);

  if (agentKind === "codex") {
    const flags = modelAndEffortArgs("codex", session.args);
    if (session.resumeTarget?.agentKind === "codex") {
      return { command: "codex", args: ["resume", ...flags, session.resumeTarget.sessionId], resumeMode: "exact" };
    }
    return { command: "codex", args: ["resume", ...flags, "--last"], resumeMode: "latest" };
  }

  if (agentKind === "claude") {
    const flags = modelAndEffortArgs("claude", session.args);
    if (session.resumeTarget?.agentKind === "claude") {
      return { command: "claude", args: [...flags, "--resume", session.resumeTarget.sessionId], resumeMode: "exact" };
    }
    return { command: "claude", args: [...flags, "--continue"], resumeMode: "latest" };
  }

  return {};
}

/** The model and effort a session was launched with (a worker's, say), so its resume runs on the same ones. */
function modelAndEffortArgs(agentKind: "claude" | "codex", args: string[] = []): string[] {
  const flags: string[] = [];
  for (let index = 0; index < args.length - 1; index += 1) {
    const [flag, value] = [args[index]!, args[index + 1]!];
    if (flag === "--") break;
    const kept = agentKind === "claude"
      ? flag === "--model" || flag === "--effort"
      : flag === "-m" || flag === "--model" || (flag === "-c" && value.startsWith("model_reasoning_effort="));
    if (kept) {
      flags.push(flag, value);
      index += 1;
    }
  }
  return flags;
}

function resumeModeForRestoredAgent(
  session: Pick<
    PersistedTerminalSessionSnapshot,
    "agentKind" | "command" | "cwd" | "resumeTarget" | "source"
  >,
): Pick<SessionTile, "resumeMode"> {
  if (!canRelaunchRestoredSession({
    cwd: session.cwd ?? "",
    runtimeStatus: "restored",
    source: session.source,
    ...(session.agentKind === undefined ? {} : { agentKind: session.agentKind }),
    ...(session.command === undefined ? {} : { command: session.command }),
  })) return {};
  const agentKind = restoredAgentKind(session);
  if (agentKind !== "codex" && agentKind !== "claude") return {};
  return { resumeMode: session.resumeTarget?.agentKind === agentKind ? "exact" : "latest" };
}

function restoredAgentKind(
  session: Pick<SessionTile, "agentKind" | "command">,
): AgentKind | undefined {
  return session.agentKind ?? (session.command === "codex" || session.command === "claude" ? session.command : undefined);
}

function plannedSessionIsolation(
  kind: AgentKind,
  launchPreflight: AlfredLaunchPreflight | undefined,
  explicitIsolation?: TerminalSessionIsolation,
): TerminalSessionIsolation | undefined {
  if (launchPreflight?.status === "ready") return launchPreflight.isolation;
  if (explicitIsolation) return explicitIsolation;
  return kind === "codex" || kind === "claude" ? "shared" : undefined;
}

function planSessionIsolation(session: AlfredPlanSession): TerminalSessionIsolation | undefined {
  return session.isolation;
}

// ponytail: names the shell zsh whatever $SHELL is, as titles always have; the created session's resolved shell
// would name bash or fish, with a rename so the next list does not bring "zsh" back.
const SHELL_TITLE = "zsh";

/**
 * The title on its own for the first in the project, then "zsh 2", "zsh 3"; ids are numbered apart from titles.
 * Only sessions that run count: a number tells sessions side by side apart, and an asleep one is not beside it.
 */
function nextGeneratedTitle(sessions: SessionTile[], workspaceId: string, base: string): string {
  let highest = 0;
  for (const session of sessions) {
    if (session.workspaceId !== workspaceId || session.runtimeStatus === "restored") continue;
    const match = new RegExp(`^${base}(?: (\\d+))?$`).exec(session.title);
    if (match) highest = Math.max(highest, match[1] ? Number(match[1]) : 1);
  }
  return highest === 0 ? base : `${base} ${highest + 1}`;
}

function createManualSession(index: number, cwd: string, workspaceId: string, title: string): SessionTile {
  return {
    id: `${MANUAL_SESSION_PREFIX}${index}`,
    title,
    workspaceId,
    cwd,
    source: "manual",
    stage: "live",
    runtimeStatus: "starting",
  };
}

function nextManualSessionIndex(sessions: SessionTile[], reservedIds: Iterable<string> = []): number {
  return nextPrefixedSessionIndex(sessions, MANUAL_SESSION_PREFIX, reservedIds);
}

/** Reserved ids belong to sessions still closing: the close would also end a new session under the same id. */
function nextPrefixedSessionIndex(sessions: SessionTile[], prefix: string, reservedIds: Iterable<string> = []): number {
  const usedIndexes = [...sessions.map((session) => session.id), ...reservedIds].map((id) => {
    if (!id.startsWith(prefix)) return 0;
    const index = Number.parseInt(id.slice(prefix.length), 10);
    return Number.isInteger(index) ? index : 0;
  });

  return Math.max(0, ...usedIndexes) + 1;
}

export function addStagedSessions(
  sessions: SessionTile[],
  planSessions: AlfredPlanSession[],
  defaultCwd: string,
  workspaceId = "A",
  reservedIds: Iterable<string> = [],
): SessionTile[] {
  let nextIndex = nextPrefixedSessionIndex(sessions, ALFRED_SESSION_PREFIX, reservedIds);
  const staged: SessionTile[] = planSessions.map((session) => {
    const isolation = plannedSessionIsolation(session.kind, session.launchPreflight, planSessionIsolation(session));
    const tile: SessionTile = {
      id: `${ALFRED_SESSION_PREFIX}${nextIndex}`,
      title: normalizedSessionTitleWithFallback(session.title, session),
      workspaceId,
      cwd: session.cwd ?? defaultCwd,
      source: "alfred",
      stage: "staged",
      command: session.command,
      args: session.args,
      agentKind: session.kind,
      ...(isolation === undefined ? {} : { isolation }),
      ...(session.safetyNote === undefined ? {} : { safetyNote: session.safetyNote }),
      ...(session.launchPreflight === undefined ? {} : { launchPreflight: cloneLaunchPreflight(session.launchPreflight) }),
    };
    nextIndex += 1;
    return tile;
  });
  return [...sessions, ...staged];
}

export function approveStaged(sessions: SessionTile[], tileId: string): SessionTile[] {
  return sessions.map((session) =>
    session.id === tileId && session.stage === "staged" && isLaunchableStagedSession(session)
      ? { ...session, stage: "live", runtimeStatus: "starting" }
      : session,
  );
}

export function rejectStaged(sessions: SessionTile[], tileId: string): SessionTile[] {
  return sessions.filter((session) => !(session.id === tileId && session.stage === "staged"));
}

export function isLaunchBlocked(session: Pick<SessionTile, "launchPreflight" | "safetyNote">): boolean {
  return Boolean(session.safetyNote) || session.launchPreflight?.status === "blocked";
}

export function isLaunchableStagedSession(
  session: Pick<SessionTile, "launchPreflight" | "stagedReviewStatus">,
): boolean {
  return session.stagedReviewStatus !== "checking" && !isLaunchBlocked(session);
}

function cloneLaunchPreflight(preflight: AlfredLaunchPreflight): AlfredLaunchPreflight {
  return { ...preflight };
}

export function appendSessionActivity(
  sessions: SessionTile[],
  sessionId: string,
  activity: SessionActivityInput,
  now = Date.now(),
): SessionTile[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const result = appendActivityEvent(session.activityEvents, session.id, activity, now, MAX_ACTIVITY_EVENTS);
    return {
      ...session,
      lastActivityAt: result.lastActivityAt,
      activityEvents: result.events,
    };
  });
}

export function recordSessionOutputActivity(
  sessions: SessionTile[],
  event: TerminalDataEvent,
  now = Date.now(),
): SessionTile[] {
  const session = sessions.find((item) => terminalEventMatchesSession(item, event));
  if (!session) return sessions;
  return sessions.map((item) => {
    if (item.id !== session.id) return item;

    const previousEvents = item.activityEvents ?? [];
    const eventIds = new Set(previousEvents.map((activity) => activity.id));
    const acceptedEvents = event.activities.filter((activity) => {
      if (eventIds.has(activity.id)) return false;
      eventIds.add(activity.id);
      return true;
    });
    const activityEvents = [...previousEvents, ...acceptedEvents].slice(-MAX_ACTIVITY_EVENTS);
    const acceptedLastActivityAt = acceptedEvents.reduce<number | undefined>(
      (latest, activity) => latest === undefined ? activity.at : Math.max(latest, activity.at),
      undefined,
    );
    const lastActivityAt = acceptedLastActivityAt === undefined
      ? item.lastActivityAt
      : Math.max(item.lastActivityAt ?? acceptedLastActivityAt, acceptedLastActivityAt);
    const outputAt = event.at ?? acceptedLastActivityAt ?? now;
    const { agentSignal: _previousSignal, ...withoutSignal } = item;
    const agentSignal = event.agentSignal === undefined ? item.agentSignal : event.agentSignal;

    return {
      ...withoutSignal,
      title: generatedTitleForDetectedAgent(sessions, item, event.foregroundAgentKind),
      detectedAgentKind: event.foregroundAgentKind,
      // Signal-only events (empty data) are not terminal output.
      ...(event.data === "" ? {} : { lastOutputAt: Math.max(item.lastOutputAt ?? outputAt, outputAt) }),
      ...(agentSignal == null ? {} : { agentSignal }),
      ...(event.shellBusy === undefined ? (item.shellBusy === undefined ? {} : { shellBusy: item.shellBusy }) : { shellBusy: event.shellBusy }),
      ...(event.promptSubmitted ? { promptSubmitted: true } : {}),
      ...(event.resumeTarget ? { resumeTarget: event.resumeTarget } : {}),
      ...(activityEvents.length === 0 ? {} : { activityEvents }),
      ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
    };
  });
}

export function terminalEventMatchesSession(
  session: Pick<SessionTile, "id" | "runtimeId">,
  event: Pick<TerminalDataEvent | TerminalExitEvent, "clientId" | "id">,
): boolean {
  return session.runtimeId !== undefined
    ? session.runtimeId === event.id
    : event.clientId !== undefined && session.id === event.clientId;
}

