import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { AlertTriangle, Check, Ellipsis, Pencil, Play, RotateCcw, SquareTerminal, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
} from "react";
import { getDesktopTerminalApi } from "../desktop-api";
import {
  canRelaunchRestoredSession,
  isGeneratedSessionTitle,
  sessionInstanceKey,
  type SessionTile,
} from "../session-state";
import { isRestartable, sessionState, type LocalTerminalStatus } from "../session-status";
import { sessionAgeLabel, sessionAgeTitle } from "../session-time";
import { sessionTileKind, tileKindMeta } from "../tile-kind";
import { TileKindIcon } from "../tile-kind-icon";
import type { AgentKind } from "../../shared/alfred-ipc";
import type { WorkspaceRootStatus } from "../../shared/workspace-ipc";
import type {
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionId,
  TerminalSessionSnapshot,
} from "../../shared/terminal-ipc";
import { shortenPath } from "../path-display";
import { sessionRelaunchSafety } from "../relaunch-safety";
import { restoredSessionActionLabel, restoredSessionActionTitle } from "../restored-session-action";
import { sessionPresentationTitle } from "../../shared/session-presentation";
import { isWorkSession } from "../session-scope";
import { pathsReferToSameLocation } from "../workspace-path-matching";
import { normalizeSessionTitle, stripTerminalControlSequencesWithRemainder } from "../../shared/session-title";
import { ghosttyVesperTerminalProfile } from "../terminal-visual-profile";
import { ChromeMenu, type ChromeMenuItem } from "./ChromeMenu";
import { SessionStack } from "./SessionStack";
import { SessionStatusGlyph } from "./SessionStatusGlyph";
import { WorktreeDiffPanel, type WorktreeDiffCloseReason } from "./WorktreeDiffPanel";
import type { WorktreeDiffView } from "../worktree-diff";

const MIN_TERMINAL_FIT_HEIGHT = 48;
const MIN_TERMINAL_FIT_WIDTH = 80;
const MAX_CAPTURED_AGENT_INPUT = 512;

type AgentTitleInputCapture = {
  buffer: string;
  title?: string;
  terminalControlCarry?: string;
};

function captureAgentTitleInput(state: AgentTitleInputCapture, data: string): AgentTitleInputCapture {
  // ponytail: mirrors ordinary typing/backspace only; prefer runtime thread metadata if agents expose it later.
  let nextBuffer = state.buffer;
  const stripped = stripTerminalControlSequencesWithRemainder(`${state.terminalControlCarry ?? ""}${data}`);
  const visibleData = stripped.text;

  for (const character of visibleData) {
    if (character === "\r" || character === "\n") {
      const title = normalizeSessionTitle(nextBuffer);
      return title ? { buffer: "", title } : { buffer: "" };
    }
    if (character === "\x7f" || character === "\b") {
      nextBuffer = nextBuffer.slice(0, -1);
      continue;
    }
    if (character === "\x03" || character === "\x15") {
      nextBuffer = "";
      continue;
    }
    if (character >= " ") {
      nextBuffer = `${nextBuffer}${character}`.slice(-MAX_CAPTURED_AGENT_INPUT);
    }
  }

  return {
    buffer: nextBuffer,
    ...(stripped.remainder ? { terminalControlCarry: stripped.remainder } : {}),
  };
}

export type WorktreeActionKind = "review" | "apply";
export type TerminalStartAttempt = { readonly workspaceId: string };

type TerminalDeskProps = {
  activeWorkspaceId: string;
  armedRecoverySessionIds: Set<string>;
  /** Asleep conversations as History counts them (one per lineage). */
  asleepCount: number;
  selectedSessionId: string | null;
  sessions: SessionTile[];
  /** Details or Preview takes the stack's column while open, so the focused terminal keeps a usable width. */
  stackHidden: boolean;
  surfaceActive: boolean;
  terminalFocusRequestKey: number;
  worktreeActionPending: Record<string, WorktreeActionKind | undefined>;
  worktreeDiffReturnFocus: HTMLElement | null;
  worktreeDiffView: WorktreeDiffView | null;
  workspaceLabel: string;
  workspaceRootPath?: string | undefined;
  workspaceRootStatus?: WorkspaceRootStatus | undefined;
  onBindWorkspace: () => void;
  onAddAgentSession: (kind: Extract<AgentKind, "claude" | "codex">) => void;
  onAddManualSession: () => void;
  onOpenPlan?: (() => void) | undefined;
  onApplyWorktree: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onCloseWorktreeDiff: () => void;
  onContinueRestoredSession: (sessionId: string) => void;
  onOpenAsleep: () => void;
  onOpenExternalTerminal: (cwd: string) => Promise<boolean>;
  onOpenHistory: () => void;
  onRestartSession: (sessionId: string) => void;
  onRuntimeSessionFailed: (tileId: string, attempt: TerminalStartAttempt, reason?: string) => void;
  onRuntimeSessionExited: (event: TerminalExitEvent) => void;
  onRuntimeSessionOutput: (event: TerminalDataEvent) => void;
  onRuntimeSessionReplayBuffer: (sessionId: string, runtimeId: TerminalSessionId, buffer: string) => void;
  onRuntimeSessionSnapshot: (sessionId: string, snapshot: TerminalSessionSnapshot) => void;
  onRuntimeSessionReady: (tileId: string, attempt: TerminalStartAttempt, runtime: TerminalCreateResult) => void;
  onRuntimeSessionStarting: (tileId: string, attempt: TerminalStartAttempt) => boolean;
  onRuntimeSessionUnavailable: (tileId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onFocusSession: (sessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onReviewWorktree: (sessionId: string) => void;
  planLine?: ReactNode;
};

export function TerminalDesk({
  activeWorkspaceId,
  armedRecoverySessionIds,
  asleepCount,
  selectedSessionId,
  sessions,
  stackHidden,
  surfaceActive,
  terminalFocusRequestKey,
  worktreeActionPending,
  worktreeDiffReturnFocus,
  worktreeDiffView,
  workspaceLabel,
  workspaceRootPath,
  workspaceRootStatus,
  onBindWorkspace,
  onAddAgentSession,
  onOpenPlan,
  onAddManualSession,
  onApplyWorktree,
  onCloseSession,
  onCloseWorktreeDiff,
  onContinueRestoredSession,
  onOpenAsleep,
  onOpenExternalTerminal,
  onOpenHistory,
  onRestartSession,
  onRuntimeSessionFailed,
  onRuntimeSessionExited,
  onRuntimeSessionOutput,
  onRuntimeSessionReplayBuffer,
  onRuntimeSessionSnapshot,
  onRuntimeSessionReady,
  onRuntimeSessionStarting,
  onRuntimeSessionUnavailable,
  onRenameSession,
  onFocusSession,
  onSelectSession,
  onReviewWorktree,
  planLine,
}: TerminalDeskProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gridColumnRef = useRef<HTMLDivElement | null>(null);
  const closeDiffFocusRef = useRef<{
    fallback: HTMLElement | null;
    reason: WorktreeDiffCloseReason;
    returnFocus: HTMLElement | null;
  } | null>(null);
  const activeSessions = sessions.filter(
    (session) => session.workspaceId === activeWorkspaceId && isWorkSession(session),
  );
  const asleepSessions = sessions.filter(
    (session) => session.workspaceId === activeWorkspaceId && session.runtimeStatus === "restored",
  );
  const workspaceUnavailable = workspaceRootStatus === "missing";
  // Drafts live on the plan line, not on the deck.
  const liveSessions = activeSessions.filter((session) => session.stage === "live");
  const hasDrafts = !workspaceUnavailable && activeSessions.some((session) => session.stage === "staged");
  const draftSelected = activeSessions.some((session) => session.id === selectedSessionId && session.stage === "staged");
  // One focused terminal; the rest wait in the stack. Focus follows the selection only, never runtime events.
  const focusSession = liveSessions.find((session) => session.id === selectedSessionId) ?? liveSessions[0] ?? null;
  const stackSessions = liveSessions.filter((session) => session.id !== focusSession?.id);
  const renderedSessions = sessions.filter((session) => isWorkSession(session) && session.stage === "live");
  // A draft opened in Details must not hand the selection (and terminal focus) to a live tile.
  const inspectedSession = draftSelected ? null : focusSession;

  useEffect(() => {
    const column = gridColumnRef.current;
    if (!column) return;

    const handleWheel = (event: WheelEvent) => {
      const scrollbarWidth = Math.max(8, column.offsetWidth - column.clientWidth);
      if (event.clientX < column.getBoundingClientRect().right - scrollbarWidth) event.preventDefault();
    };
    column.addEventListener("wheel", handleWheel, { passive: false });
    return () => column.removeEventListener("wheel", handleWheel);
  }, []);

  const handleCloseDiff = useCallback((reason: WorktreeDiffCloseReason) => {
    const targetSessionId = worktreeDiffView?.sessionId ?? focusSession?.id;
    const tiles = Array.from(gridRef.current?.querySelectorAll<HTMLElement>("[data-session-id]") ?? []);
    const tile = tiles.find((candidate) => candidate.dataset.sessionId === targetSessionId)
      ?? tiles.find((candidate) => candidate.dataset.sessionId === focusSession?.id)
      ?? tiles[0];
    closeDiffFocusRef.current = {
      fallback: tile ?? null,
      reason,
      returnFocus: worktreeDiffReturnFocus,
    };
    onCloseWorktreeDiff();
  }, [focusSession?.id, onCloseWorktreeDiff, worktreeDiffReturnFocus, worktreeDiffView?.sessionId]);

  useEffect(() => {
    if (worktreeDiffView || !closeDiffFocusRef.current) return;
    const { fallback, reason, returnFocus } = closeDiffFocusRef.current;
    closeDiffFocusRef.current = null;
    const frame = requestAnimationFrame(() => {
      const inertOwner = returnFocus?.closest("[inert]");
      if (
        reason === "button"
        && returnFocus?.isConnected
        && (!inertOwner || inertOwner === gridColumnRef.current)
      ) {
        returnFocus.focus();
        return;
      }
      fallback?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [worktreeDiffView]);

  return (
    <section className="terminal-stage headerless" aria-label="terminals">
      <div className="terminal-stage-body">
        <div
          ref={gridColumnRef}
          className={`terminal-grid-column ${worktreeDiffView ? "worktree-diff-hidden" : ""}`}
          aria-hidden={worktreeDiffView ? "true" : undefined}
          inert={worktreeDiffView ? true : undefined}
        >
          {focusSession && isReviewableIsolatedCheckout(focusSession) && (
            <WorktreeActionStrip
              pendingAction={worktreeActionPending[sessionInstanceKey(focusSession)]}
              session={focusSession}
              onApplyWorktree={onApplyWorktree}
              onReviewWorktree={onReviewWorktree}
            />
          )}
          {hasDrafts && planLine}
          <div className="terminal-grid" data-testid="terminal-grid" ref={gridRef}>
          {liveSessions.length === 0 && (
            <EmptyWorkspaceState
              armedSessionIds={armedRecoverySessionIds}
              asleepSessions={asleepSessions}
              hasDrafts={hasDrafts}
              onOpenPlan={onOpenPlan}
              onAddAgentSession={onAddAgentSession}
              onAddManualSession={onAddManualSession}
              onBindWorkspace={onBindWorkspace}
              onOpenHistory={onOpenHistory}
              onResumeSession={onContinueRestoredSession}
              workspaceLabel={workspaceLabel}
              workspaceRootPath={workspaceRootPath}
              workspaceRootStatus={workspaceRootStatus}
            />
          )}
          {renderedSessions.map((session) => {
            // Every live terminal stays mounted; switching focus or project only hides it.
            const workspaceHidden = session.workspaceId !== activeWorkspaceId;
            const layoutHidden = !workspaceHidden && session.id !== focusSession?.id;
            return (
              <ManualTerminalTile
                cwd={session.cwd}
                createdAt={session.createdAt}
                key={session.id}
                sessionKey={session.id}
                runtimeId={session.runtimeId}
                runtimeStatus={session.runtimeStatus}
                relaunchArmed={armedRecoverySessionIds.has(session.id)}
                workspaceId={session.workspaceId}
                workspaceRootPath={workspaceRootPath}
                workspaceRootFingerprint={session.workspaceRootFingerprint}
                title={session.title}
                layoutHidden={layoutHidden}
                workspaceHidden={workspaceHidden}
                source={session.source}
                agentKind={session.agentKind}
                detectedAgentKind={session.detectedAgentKind}
                isolation={session.isolation}
                branchName={session.branchName}
                baseCwd={session.baseCwd}
                launchPreflight={session.launchPreflight}
                command={session.command}
                args={session.args}
                resumeTarget={session.resumeTarget}
                resumeMode={session.resumeMode}
                initialBuffer={session.initialBuffer}
                activityEvents={session.activityEvents}
                lastOutputAt={session.lastOutputAt}
                agentSignal={session.agentSignal}
                shellBusy={session.shellBusy}
                selected={inspectedSession?.id === session.id}
                surfaceActive={surfaceActive && !worktreeDiffView}
                terminalFocusRequestKey={terminalFocusRequestKey}
                onClose={() => onCloseSession(session.id)}
                onContinueRestoredSession={() => onContinueRestoredSession(session.id)}
                onRestartSession={() => onRestartSession(session.id)}
                onSelectSession={() => onSelectSession(session.id)}
                onRuntimeSessionFailed={onRuntimeSessionFailed}
                onRuntimeSessionExited={onRuntimeSessionExited}
                onRuntimeSessionOutput={onRuntimeSessionOutput}
                onRuntimeSessionReplayBuffer={onRuntimeSessionReplayBuffer}
                onRuntimeSessionSnapshot={onRuntimeSessionSnapshot}
                onRuntimeSessionReady={onRuntimeSessionReady}
                onRuntimeSessionStarting={onRuntimeSessionStarting}
                onRuntimeSessionUnavailable={onRuntimeSessionUnavailable}
                onOpenExternalTerminal={onOpenExternalTerminal}
                onRenameSession={onRenameSession}
              />
            );
          })}
          </div>
        </div>
        {focusSession && !stackHidden && !worktreeDiffView && (
          <SessionStack
            asleepCount={asleepCount}
            sessions={stackSessions}
            workspaceLabel={workspaceLabel}
            onFocusSession={onFocusSession}
            onOpenAsleep={onOpenAsleep}
          />
        )}
        {worktreeDiffView && (
          <WorktreeDiffPanel view={worktreeDiffView} onClose={handleCloseDiff} />
        )}
      </div>
    </section>
  );
}

function WorktreeActionStrip({
  pendingAction,
  session,
  onApplyWorktree,
  onReviewWorktree,
}: {
  pendingAction?: WorktreeActionKind | undefined;
  session: SessionTile;
  onApplyWorktree: (sessionId: string) => void;
  onReviewWorktree: (sessionId: string) => void;
}) {
  const disabled = pendingAction !== undefined;
  return (
    <div
      className="terminal-action-strip"
      role="toolbar"
      aria-label={`checkout actions for ${session.title}`}
    >
      <button type="button" disabled={disabled} onClick={() => onReviewWorktree(session.id)}>
        {pendingAction === "review" ? "Reviewing..." : "Review diff"}
      </button>
      <button type="button" disabled={disabled} onClick={() => onApplyWorktree(session.id)}>
        {pendingAction === "apply" ? "Applying..." : "Apply to project"}
      </button>
    </div>
  );
}

const ASLEEP_ROW_LIMIT = 5;

function EmptyWorkspaceState({
  armedSessionIds,
  asleepSessions,
  hasDrafts,
  onAddAgentSession,
  onOpenHistory,
  onOpenPlan,
  onAddManualSession,
  onBindWorkspace,
  onResumeSession,
  workspaceLabel,
  workspaceRootPath,
  workspaceRootStatus,
}: {
  armedSessionIds: Set<string>;
  asleepSessions: SessionTile[];
  hasDrafts: boolean;
  onAddAgentSession: (kind: Extract<AgentKind, "claude" | "codex">) => void;
  onAddManualSession: () => void;
  onOpenHistory: () => void;
  onOpenPlan?: (() => void) | undefined;
  onBindWorkspace: () => void;
  onResumeSession: (sessionId: string) => void;
  workspaceLabel: string;
  workspaceRootPath?: string | undefined;
  workspaceRootStatus?: WorkspaceRootStatus | undefined;
}) {
  const bound = Boolean(workspaceRootPath);
  const missing = workspaceRootStatus === "missing";
  const asleep = missing ? [] : [...asleepSessions].sort((a, b) => asleepSessionAt(b) - asleepSessionAt(a));
  const shownAsleep = asleep.slice(0, ASLEEP_ROW_LIMIT);
  const hiddenAsleepCount = asleep.length - shownAsleep.length;
  const copy = missing
    ? `Folder unavailable${workspaceRootPath ? `: ${shortenPath(workspaceRootPath)}` : ""}. Choose the folder again. Draft work stays parked until you reconnect this project.`
    : hasDrafts
      ? "Launch the plan above, or start a session in this project."
      : asleep.length > 0
        ? "Start a session in this project, or pick up where you left off."
        : bound
          ? "Start a session in this project."
          : "Start a session here, or choose a project folder when repository context matters.";

  return (
    <div
      className="terminal-empty-state"
      role="status"
      aria-label={missing ? "Unavailable project folder" : "Empty project"}
    >
      <div className="terminal-empty-copy">
        <strong>{missing ? `Reconnect ${workspaceLabel}` : "Nothing is running"}</strong>
        <p>{copy}</p>
      </div>
      <div className="terminal-empty-actions" role="group" aria-label="New session">
        {missing ? (
          <button type="button" className="terminal-empty-primary-action" onClick={onBindWorkspace}>
            Choose folder
          </button>
        ) : (
          <>
            <button
              type="button"
              className="terminal-empty-primary-action"
              onClick={() => onAddAgentSession("codex")}
            >
              Codex
            </button>
            <button type="button" onClick={() => onAddAgentSession("claude")}>
              Claude
            </button>
            <button type="button" onClick={onAddManualSession}>
              Terminal
            </button>
            {onOpenPlan && <button type="button" onClick={onOpenPlan}>Plan with Alfred</button>}
            {!bound && (
              <button type="button" onClick={onBindWorkspace}>
                Choose folder
              </button>
            )}
          </>
        )}
      </div>
      {shownAsleep.length > 0 && (
        <section className="terminal-empty-asleep" aria-label="Asleep sessions">
          <h3>Asleep</h3>
          <ul>
            {shownAsleep.map((session) => {
              const kindLabel = asleepSessionKindLabel(session);
              const title = sessionPresentationTitle(session.title, `${kindLabel} session`);
              const age = sessionAgeLabel(asleepSessionAt(session) || undefined);
              const safety = sessionRelaunchSafety(session);
              const armed = armedSessionIds.has(session.id);
              const actionLabel = restoredSessionActionLabel(session, !safety.safe, armed);
              return (
                <li key={session.id}>
                  <SessionStatusGlyph kind="asleep" label="Asleep" />
                  <span className="terminal-empty-asleep-title">{title}</span>
                  <span className="terminal-empty-asleep-meta">
                    {age ? `${kindLabel}, ${age === "now" ? "just now" : `${age} ago`}` : kindLabel}
                  </span>
                  {canRelaunchRestoredSession(session) && (
                    <button
                      type="button"
                      aria-label={`${actionLabel}: ${title}`}
                      title={safety.safe ? restoredSessionActionTitle(session) : safety.reason}
                      onClick={() => onResumeSession(session.id)}
                    >
                      {actionLabel}
                    </button>
                  )}
                  {!safety.safe && armed && (
                    <small className="terminal-empty-asleep-warning">{`Review before resuming: ${safety.reason}.`}</small>
                  )}
                </li>
              );
            })}
          </ul>
          {hiddenAsleepCount > 0 && (
            <button type="button" className="terminal-empty-asleep-more" onClick={onOpenHistory}>
              {`${hiddenAsleepCount} more in History`}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

// Not lastActivityAt: arming a resume logs activity, and the row must not jump.
function asleepSessionAt(session: SessionTile): number {
  return session.lastOutputAt ?? session.createdAt ?? 0;
}

function asleepSessionKindLabel(session: SessionTile): string {
  if (session.agentKind === "codex" || session.command === "codex") return "Codex";
  if (session.agentKind === "claude" || session.command === "claude") return "Claude";
  return "Terminal";
}

function resumeButtonLabel(unsafe: boolean, armed: boolean): string {
  if (!unsafe) return "Resume";
  return armed ? "Confirm resume" : "Review resume";
}

type RestoredSessionButtonSession = {
  agentKind?: SessionTile["agentKind"] | undefined;
  args?: string[] | undefined;
  command?: string | undefined;
  resumeMode?: SessionTile["resumeMode"] | undefined;
  resumeTarget?: SessionTile["resumeTarget"] | undefined;
};

function restoredSessionButtonLabel(
  session: RestoredSessionButtonSession,
  unsafe: boolean,
  armed: boolean,
): string {
  const codexAgent = session.agentKind === "codex" || session.command === "codex";
  if (!codexAgent) return restoredSessionActionLabel(session, unsafe, armed);

  const conversation = codexResumeModeForLabel(session) === "latest" ? "latest Codex conversation" : "this Codex conversation";
  if (!unsafe) return `Resume ${conversation}`;
  return armed ? `Confirm resume ${conversation}` : `Review resume ${conversation}`;
}

function restoredSessionButtonTitle(session: RestoredSessionButtonSession): string {
  const codexAgent = session.agentKind === "codex" || session.command === "codex";
  if (!codexAgent) return restoredSessionActionTitle(session);

  return codexResumeModeForLabel(session) === "latest"
    ? "Resume latest Codex conversation"
    : "Resume this Codex conversation";
}

function codexResumeModeForLabel(session: RestoredSessionButtonSession): "exact" | "latest" {
  return session.resumeMode ?? (session.resumeTarget?.agentKind === "codex" ? "exact" : "latest");
}

function terminalHostHasStableGeometry(container: HTMLElement): boolean {
  if (!container.isConnected) return false;
  const rect = container.getBoundingClientRect();
  return rect.width >= MIN_TERMINAL_FIT_WIDTH && rect.height >= MIN_TERMINAL_FIT_HEIGHT;
}

function usableTerminalDimensions(dimensions: { cols: number; rows: number } | undefined): dimensions is {
  cols: number;
  rows: number;
} {
  return Boolean(
    dimensions &&
      Number.isFinite(dimensions.cols) &&
      Number.isFinite(dimensions.rows) &&
      dimensions.cols >= 2 &&
      dimensions.rows >= 1,
  );
}

function ManualTerminalTile({
  cwd,
  createdAt,
  agentKind,
  detectedAgentKind,
  isolation,
  branchName,
  baseCwd,
  launchPreflight,
  activityEvents,
  initialBuffer,
  lastOutputAt,
  agentSignal,
  shellBusy,
  relaunchArmed,
  onClose,
  onContinueRestoredSession,
  onRestartSession,
  onSelectSession,
  onRuntimeSessionFailed,
  onRuntimeSessionExited,
  onRuntimeSessionOutput,
  onRuntimeSessionReplayBuffer,
  onRuntimeSessionSnapshot,
  onRuntimeSessionReady,
  onRuntimeSessionStarting,
  onRuntimeSessionUnavailable,
  onOpenExternalTerminal,
  onRenameSession,
  selected,
  surfaceActive,
  terminalFocusRequestKey,
  runtimeId,
  runtimeStatus,
  sessionKey,
  source,
  workspaceId,
  workspaceRootPath,
  workspaceRootFingerprint,
  title,
  layoutHidden = false,
  workspaceHidden,
  command,
  args,
  resumeTarget,
  resumeMode,
}: {
  cwd: string;
  createdAt?: number | undefined;
  agentKind?: SessionTile["agentKind"];
  detectedAgentKind?: SessionTile["detectedAgentKind"];
  isolation?: SessionTile["isolation"] | undefined;
  branchName?: string | undefined;
  baseCwd?: string | undefined;
  launchPreflight?: SessionTile["launchPreflight"];
  activityEvents?: SessionTile["activityEvents"];
  initialBuffer?: string | undefined;
  lastOutputAt?: number | undefined;
  agentSignal?: SessionTile["agentSignal"] | undefined;
  shellBusy?: boolean | undefined;
  relaunchArmed: boolean;
  onClose: () => void;
  onContinueRestoredSession: () => void;
  onRestartSession: () => void;
  onSelectSession: () => void;
  onRuntimeSessionFailed: (tileId: string, attempt: TerminalStartAttempt, reason?: string) => void;
  onRuntimeSessionExited: (event: TerminalExitEvent) => void;
  onRuntimeSessionOutput: (event: TerminalDataEvent) => void;
  onRuntimeSessionReplayBuffer: (sessionId: string, runtimeId: TerminalSessionId, buffer: string) => void;
  onRuntimeSessionSnapshot: (sessionId: string, snapshot: TerminalSessionSnapshot) => void;
  onRuntimeSessionReady: (tileId: string, attempt: TerminalStartAttempt, runtime: TerminalCreateResult) => void;
  onRuntimeSessionStarting: (tileId: string, attempt: TerminalStartAttempt) => boolean;
  onRuntimeSessionUnavailable: (tileId: string) => void;
  onOpenExternalTerminal: (cwd: string) => Promise<boolean>;
  onRenameSession: (sessionId: string, title: string) => void;
  selected: boolean;
  surfaceActive: boolean;
  terminalFocusRequestKey: number;
  runtimeId?: TerminalSessionId | undefined;
  runtimeStatus?: SessionTile["runtimeStatus"] | undefined;
  sessionKey: string;
  source: SessionTile["source"];
  workspaceId: string;
  workspaceRootPath?: string | undefined;
  workspaceRootFingerprint?: string | undefined;
  title: string;
  layoutHidden?: boolean;
  workspaceHidden: boolean;
  command?: string | undefined;
  args?: string[] | undefined;
  resumeTarget?: SessionTile["resumeTarget"] | undefined;
  resumeMode?: SessionTile["resumeMode"] | undefined;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const agentTitleInputRef = useRef<AgentTitleInputCapture>({ buffer: "" });
  const lastResizeRef = useRef<{ id: TerminalSessionId; cols: number; rows: number } | null>(null);
  const sessionIdRef = useRef<TerminalSessionId | null>(null);
  const [status, setStatus] = useState<LocalTerminalStatus>("connecting");
  const statusRef = useRef<LocalTerminalStatus>("connecting");
  const fitAndResizeRef = useRef<(() => boolean) | null>(null);
  const scheduleRepaintRef = useRef<((passes?: number) => void) | null>(null);
  const tileHidden = workspaceHidden || layoutHidden;
  const previousTileHiddenRef = useRef(tileHidden);
  const previousSurfaceActiveRef = useRef(surfaceActive);
  const writeAndRepaintRef = useRef<((data: string) => void) | null>(null);
  useEffect(() => {
    const wasHidden = previousTileHiddenRef.current;
    previousTileHiddenRef.current = tileHidden;
    if (wasHidden && !tileHidden) {
      scheduleRepaintRef.current?.(3);
    }
  }, [tileHidden]);
  const [resolvedCwd, setResolvedCwd] = useState<string>(cwd);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(title);
  const kind = sessionTileKind({ agentKind, detectedAgentKind, source });
  const kindMeta = tileKindMeta(kind);
  const displayClock = useStatusClock(createdAt ?? lastOutputAt);
  const restoredTranscript = runtimeStatus === "restored" && !runtimeId;
  const tileStatus = restoredTranscript ? "restored" : status;
  const displaySession = {
    stage: "live",
    ...(agentKind === undefined ? {} : { agentKind }),
    ...(detectedAgentKind === undefined ? {} : { detectedAgentKind }),
    ...(command === undefined ? {} : { command }),
    ...(runtimeStatus === undefined ? {} : { runtimeStatus }),
    ...(lastOutputAt === undefined ? {} : { lastOutputAt }),
    ...(agentSignal === undefined ? {} : { agentSignal }),
    ...(shellBusy === undefined ? {} : { shellBusy }),
    ...(activityEvents === undefined ? {} : { activityEvents }),
  } satisfies Parameters<typeof sessionState>[0];
  const displayStatus = sessionState(displaySession, tileStatus, displayClock);
  const statusLabel = displayStatus.label;
  const restartable = isRestartable(displayStatus);
  const discardableSession = displayStatus.kind === "asleep" || restartable;
  const existingCheckoutMetadata = isReusableIsolatedCheckoutMetadata({
    isolation,
    branchName,
    baseCwd,
    workspaceId,
    workspaceRootFingerprint,
  });
  const isolatedCheckout = isIsolatedCheckout({
    isolation,
    branchName,
    baseCwd,
    workspaceId,
    workspaceRootFingerprint,
  });
  const relaunchCapable = canRelaunchRestoredSession({
    cwd,
    source,
    ...(agentKind === undefined ? {} : { agentKind }),
    ...(command === undefined ? {} : { command }),
    ...(runtimeStatus === undefined ? {} : { runtimeStatus }),
  });
  const relaunchSafety = sessionRelaunchSafety({
    source,
    ...(agentKind === undefined ? {} : { agentKind }),
    ...(args === undefined ? {} : { args }),
    ...(command === undefined ? {} : { command }),
  });
  const relaunchNeedsReview = !relaunchSafety.safe;
  const restoredActionSession = { agentKind, args, command, resumeMode, resumeTarget };
  const restoredActionLabel = restoredSessionButtonLabel(
    restoredActionSession,
    relaunchNeedsReview,
    relaunchArmed,
  );
  const latestActivity = latestVisibleActivity(activityEvents);
  const ageLabel = sessionAgeLabel(createdAt, displayClock);
  const sessionLocationLabel = isolatedCheckout ? "isolated worktree" : (resolvedCwd ? shortenPath(resolvedCwd) : "runtime cwd");
  const sessionLocationMetaLabel = isolatedCheckout ? "worktree" : "cwd";
  const sessionLocationTitle = isolatedCheckout
    ? branchName
      ? baseCwd
        ? `${branchName} · isolated from ${baseCwd}`
        : `${branchName} · isolated worktree`
      : baseCwd
        ? `isolated worktree from ${baseCwd}`
        : "isolated worktree"
    : resolvedCwd ?? "runtime cwd";
  const locationMatchesWorkspaceRoot = pathsReferToSameLocation(cwd, workspaceRootPath)
    && pathsReferToSameLocation(resolvedCwd, workspaceRootPath);
  const showSessionLocation = isolatedCheckout || !locationMatchesWorkspaceRoot;
  const externalTerminalCwd = resolvedCwd || cwd;
  const worktreeRecoverySession = discardableSession && isolatedCheckout;
  const recoveryOnly = tileStatus === "restored" && worktreeRecoverySession && !relaunchCapable;
  const closeActionLabel = discardableSession ? (worktreeRecoverySession ? "Discard checkout" : "Discard") : "Close";
  const closeActionTitle = discardableSession
    ? worktreeRecoverySession
      ? "Discard this isolated checkout"
      : "Discard this recovery item"
    : "Close terminal";
  const runtimeBindingKey = runtimeId
    ?? (runtimeStatus === "starting" || runtimeStatus === "restored" ? runtimeStatus : "inactive");
  const runtimeMetadataRef = useRef({
    cwd,
    title,
    source,
    workspaceId,
    agentKind,
    detectedAgentKind,
    isolation,
    branchName,
    baseCwd,
    existingCheckoutMetadata,
    launchPreflight,
    command,
    args,
    resumeTarget,
    initialBuffer,
    runtimeStatus,
    restoredTranscript,
  });
  const runtimeCallbacksRef = useRef({
    onRuntimeSessionFailed,
    onRuntimeSessionExited,
    onRuntimeSessionOutput,
    onRuntimeSessionReplayBuffer,
    onRuntimeSessionSnapshot,
    onRuntimeSessionReady,
    onRuntimeSessionStarting,
    onRuntimeSessionUnavailable,
  });
  const setTileStatus = useCallback((nextStatus: LocalTerminalStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  useEffect(() => {
    if (!renaming) {
      setRenameDraft(title);
    }
  }, [renaming, title]);

  useEffect(() => {
    runtimeMetadataRef.current = {
      cwd,
      title,
      source,
      workspaceId,
      agentKind,
      detectedAgentKind,
      isolation,
      branchName,
      baseCwd,
      existingCheckoutMetadata,
      launchPreflight,
      command,
      args,
      resumeTarget,
      initialBuffer,
      runtimeStatus,
      restoredTranscript,
    };
    setResolvedCwd(cwd);
  }, [
    cwd,
    title,
    source,
    workspaceId,
    agentKind,
    detectedAgentKind,
    isolation,
    branchName,
    baseCwd,
    existingCheckoutMetadata,
    launchPreflight,
    command,
    args,
    resumeTarget,
    initialBuffer,
    runtimeStatus,
    restoredTranscript,
  ]);

  useEffect(() => {
    runtimeCallbacksRef.current = {
      onRuntimeSessionFailed,
      onRuntimeSessionExited,
      onRuntimeSessionOutput,
      onRuntimeSessionReplayBuffer,
      onRuntimeSessionSnapshot,
      onRuntimeSessionReady,
      onRuntimeSessionStarting,
      onRuntimeSessionUnavailable,
    };
  }, [
    onRuntimeSessionFailed,
    onRuntimeSessionExited,
    onRuntimeSessionOutput,
    onRuntimeSessionReplayBuffer,
    onRuntimeSessionSnapshot,
    onRuntimeSessionReady,
    onRuntimeSessionStarting,
    onRuntimeSessionUnavailable,
  ]);

  const submitRename = () => {
    const nextTitle = normalizeSessionTitle(renameDraft);
    if (nextTitle) {
      onRenameSession(sessionKey, nextTitle);
    }
    setRenaming(false);
  };
  const beginRename = () => {
    setRenameDraft(title);
    setRenaming(true);
  };
  const compactActionItems: ChromeMenuItem[] = [
    ...(externalTerminalCwd
      ? [{
          id: "external-terminal",
          label: "Open in external terminal",
          detail: shortenPath(externalTerminalCwd),
          run: () => void onOpenExternalTerminal(externalTerminalCwd),
        } satisfies ChromeMenuItem]
      : []),
    { id: "rename", label: "Rename session", run: beginRename },
    { id: "close", label: closeActionLabel, detail: closeActionTitle, run: onClose },
  ];

  useEffect(() => {
    const container = containerRef.current;
    const terminalApi = getDesktopTerminalApi();
    let disposed = false;
    const metadata = runtimeMetadataRef.current;
    agentTitleInputRef.current = { buffer: "" };

    if (!container) {
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: ghosttyVesperTerminalProfile.cursorBlink,
      cursorStyle: ghosttyVesperTerminalProfile.cursorStyle,
      disableStdin: metadata.restoredTranscript || !terminalApi,
      fontFamily: ghosttyVesperTerminalProfile.fontFamily,
      fontSize: ghosttyVesperTerminalProfile.fontSize,
      lineHeight: ghosttyVesperTerminalProfile.lineHeight,
      theme: ghosttyVesperTerminalProfile.theme,
    });
    const fitAddon = new FitAddon();

    const terminalCanScroll = (direction: number) => {
      const buffer = terminal.buffer.active;
      return direction > 0 ? buffer.viewportY < buffer.baseY : buffer.viewportY > 0;
    };

    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.attachCustomWheelEventHandler((event) => {
      if (event.deltaY === 0) return true;

      const direction = Math.sign(event.deltaY);
      if (terminalCanScroll(direction)) {
        terminal.scrollLines(direction * Math.max(1, Math.round(Math.abs(event.deltaY) / 40)));
      }

      event.preventDefault();
      event.stopPropagation();
      return false;
    });
    terminalRef.current = terminal;

    const fitAndResize = () => {
      if (!terminalHostHasStableGeometry(container)) return false;
      const proposedDimensions = fitAddon.proposeDimensions();
      if (!usableTerminalDimensions(proposedDimensions)) return false;

      fitAddon.fit();
      const sessionId = sessionIdRef.current;

      if (
        sessionId &&
        terminalApi &&
        (lastResizeRef.current?.id !== sessionId ||
          lastResizeRef.current.cols !== terminal.cols ||
          lastResizeRef.current.rows !== terminal.rows)
      ) {
        terminalApi.resize({ id: sessionId, cols: terminal.cols, rows: terminal.rows });
        lastResizeRef.current = { id: sessionId, cols: terminal.cols, rows: terminal.rows };
      }
      return true;
    };
    const repaintTerminal = () => {
      if (!fitAndResize()) return;
      const refresh = (terminal as { refresh?: (start: number, end: number) => void }).refresh;
      refresh?.call(terminal, 0, Math.max(0, terminal.rows - 1));
    };
    const scheduleRepaint = (passes = 2) => {
      requestAnimationFrame(() => {
        if (disposed) return;
        repaintTerminal();
        if (passes > 1) scheduleRepaint(passes - 1);
      });
    };
    const writeAndRepaint = (data: string) => {
      terminal.write(data, () => {
        if (disposed) return;
        scheduleRepaint();
      });
      scheduleRepaint();
    };
    const resizeObserver = new ResizeObserver(() => scheduleRepaint());
    fitAndResizeRef.current = fitAndResize;
    scheduleRepaintRef.current = scheduleRepaint;
    writeAndRepaintRef.current = writeAndRepaint;

    resizeObserver.observe(container);
    scheduleRepaint();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      fitAndResizeRef.current = null;
      scheduleRepaintRef.current = null;
      writeAndRepaintRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [sessionKey]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const terminalApi = getDesktopTerminalApi();
    const metadata = runtimeMetadataRef.current;
    const callbacks = runtimeCallbacksRef.current;
    let disposed = false;
    const writeAndRepaint = (data: string) => {
      const writer = writeAndRepaintRef.current;
      if (writer) {
        writer(data);
        return;
      }
      terminal?.write(data);
    };
    const scheduleRepaint = () => scheduleRepaintRef.current?.();
    const fitAndResize = () => fitAndResizeRef.current?.() ?? false;
    let snapshotHandshakePending = false;
    let snapshotHandshakeOutput = "";
    let exitObserved = false;

    if (!terminal) {
      return;
    }
    const replaceAndRepaint = (data: string) => {
      terminal.reset();
      writeAndRepaint(data);
    };

    sessionIdRef.current = runtimeId ?? null;
    terminal.options.disableStdin = metadata.restoredTranscript || !terminalApi;

    if (metadata.restoredTranscript) {
      setTileStatus("restored");
      if (metadata.initialBuffer) {
        writeAndRepaint(metadata.initialBuffer);
      }
      return () => {
        disposed = true;
      };
    }

    if (!runtimeId && (metadata.runtimeStatus === "error" || metadata.runtimeStatus === "exited")) {
      const previousStatus = statusRef.current;
      const nextStatus = metadata.runtimeStatus === "exited" ? "exited" : "error";
      setTileStatus(nextStatus);
      if (metadata.initialBuffer) {
        writeAndRepaint(metadata.initialBuffer);
      } else if (previousStatus !== nextStatus) {
        terminal.writeln(
          metadata.runtimeStatus === "exited"
            ? "This terminal process has ended."
            : "This terminal failed to start. Use Resume to create a fresh runtime.",
        );
        scheduleRepaint();
      }
      return () => {
        disposed = true;
      };
    }

    if (!terminalApi) {
      if (metadata.runtimeStatus !== "unavailable") {
        callbacks.onRuntimeSessionUnavailable(sessionKey);
      }
      const wasBrowser = statusRef.current === "browser";
      setTileStatus("browser");
      if (!wasBrowser) {
        terminal.writeln("Terminal unavailable outside Electron.");
        terminal.writeln("Open Alfred Desktop to attach a real local PTY.");
        terminal.writeln("Dev fallback: pnpm --filter @alfred/desktop dev:electron");
        scheduleRepaint();
      }
      return () => {
        disposed = true;
      };
    }

    const removeDataListener = terminalApi.onData((event) => {
      const resolvedRuntimeId = sessionIdRef.current;
      if (resolvedRuntimeId ? event.id === resolvedRuntimeId : event.clientId === sessionKey) {
        if (event.data === "") {
          // Signal-only event: state changed without terminal output.
        } else if (snapshotHandshakePending) {
          snapshotHandshakeOutput += event.data;
        } else {
          writeAndRepaint(event.data);
        }
        runtimeCallbacksRef.current.onRuntimeSessionOutput(event);
      }
    });
    const reportExit = (event: TerminalExitEvent) => {
      exitObserved = true;
      runtimeCallbacksRef.current.onRuntimeSessionExited(event);
      setTileStatus(event.exitCode === 0 ? "exited" : "error");
      terminal.writeln("");
      terminal.writeln(`[process exited with code ${event.exitCode}]`);
      scheduleRepaint();
    };
    const removeExitListener = terminalApi.onExit((event) => {
      const resolvedRuntimeId = sessionIdRef.current;
      if (resolvedRuntimeId ? event.id === resolvedRuntimeId : event.clientId === sessionKey) {
        reportExit(event);
      }
    });
    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      const currentMetadata = runtimeMetadataRef.current;
      const currentAgentKind = currentMetadata.detectedAgentKind ?? currentMetadata.agentKind;

      if (
        (currentAgentKind === "codex" || currentAgentKind === "claude")
        && isGeneratedSessionTitle(currentMetadata.title)
      ) {
        const capture = captureAgentTitleInput(agentTitleInputRef.current, data);
        agentTitleInputRef.current = capture;
        if (capture.title) {
          currentMetadata.title = capture.title;
          onRenameSession(sessionKey, capture.title);
        }
      } else {
        agentTitleInputRef.current = { buffer: "" };
      }

      if (sessionId) {
        terminalApi.write({ id: sessionId, data });
      }
    });

    if (runtimeId) {
      sessionIdRef.current = runtimeId;
      setTileStatus("ready");
      snapshotHandshakePending = true;
      void terminalApi
        .reconcile({ id: runtimeId, clientId: sessionKey })
        .then((result) => {
          if (disposed) return;
          snapshotHandshakePending = false;
          if (result.state === "missing") {
            const fallbackBuffer = mergeTerminalReplayBuffer(metadata.initialBuffer, snapshotHandshakeOutput);
            if (fallbackBuffer) {
              runtimeCallbacksRef.current.onRuntimeSessionReplayBuffer(sessionKey, runtimeId, fallbackBuffer);
              replaceAndRepaint(fallbackBuffer);
            }
            return;
          }

          const snapshot = result.snapshot;
          const replayBuffer = mergeTerminalReplayBuffer(snapshot.buffer, snapshotHandshakeOutput);
          runtimeCallbacksRef.current.onRuntimeSessionSnapshot(sessionKey, { ...snapshot, buffer: replayBuffer });
          if (replayBuffer) {
            replaceAndRepaint(replayBuffer);
          }
          if (result.state === "exited" && !exitObserved) {
            reportExit(result.event);
          }
        })
        .catch(() => {
          snapshotHandshakePending = false;
          if (!disposed) {
            const fallbackBuffer = mergeTerminalReplayBuffer(metadata.initialBuffer, snapshotHandshakeOutput);
            if (fallbackBuffer) {
              runtimeCallbacksRef.current.onRuntimeSessionReplayBuffer(sessionKey, runtimeId, fallbackBuffer);
              replaceAndRepaint(fallbackBuffer);
            }
          }
        });
      scheduleRepaint();

      return () => {
        disposed = true;
        inputDisposable.dispose();
        removeDataListener();
        removeExitListener();
      };
    }

    setTileStatus("connecting");

    if (metadata.runtimeStatus !== "starting") {
      return () => {
        disposed = true;
        inputDisposable.dispose();
        removeDataListener();
        removeExitListener();
      };
    }

    const attempt: TerminalStartAttempt = { workspaceId: metadata.workspaceId };
    if (!callbacks.onRuntimeSessionStarting(sessionKey, attempt)) {
      return () => {
        disposed = true;
        inputDisposable.dispose();
        removeDataListener();
        removeExitListener();
      };
    }

    const baseRequest: TerminalCreateRequest = {
      cols: terminal.cols,
      rows: terminal.rows,
      clientId: sessionKey,
      title: metadata.title,
      source: metadata.source,
      workspaceId: metadata.workspaceId,
    };
    if (metadata.agentKind) baseRequest.agentKind = metadata.agentKind;
    if (metadata.cwd) baseRequest.cwd = metadata.cwd;
    if (metadata.existingCheckoutMetadata) {
      baseRequest.isolation = "worktree";
      if (metadata.branchName) baseRequest.branchName = metadata.branchName;
      if (metadata.baseCwd) baseRequest.baseCwd = metadata.baseCwd;
    } else if (!metadata.branchName && metadata.launchPreflight?.status === "ready" && metadata.launchPreflight.isolation === "worktree") {
      baseRequest.isolation = "worktree";
      if (metadata.launchPreflight.branchName) baseRequest.branchName = metadata.launchPreflight.branchName;
    } else if (metadata.isolation) {
      baseRequest.isolation = metadata.isolation;
    }
    if (metadata.command) {
      baseRequest.command = metadata.command;
      baseRequest.args = metadata.args ?? [];
    }
    if (metadata.resumeTarget) {
      baseRequest.resumeTarget = metadata.resumeTarget;
    }
    const createTerminalSession = metadata.command
      ? terminalApi.prepareLaunch(baseRequest).then((prepared) =>
          terminalApi.create({ ...baseRequest, launchTicketId: prepared.launchTicketId }),
        )
      : terminalApi.create(baseRequest);

    createTerminalSession
      .then((session) => {
        runtimeCallbacksRef.current.onRuntimeSessionReady(sessionKey, attempt, session);

        if (disposed) {
          return;
        }

        sessionIdRef.current = session.id;
        setResolvedCwd(session.cwd);
        setTileStatus("ready");
        fitAndResize();
      })
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        runtimeCallbacksRef.current.onRuntimeSessionFailed(sessionKey, attempt, reason);
        if (disposed) {
          return;
        }

        setTileStatus("error");
        terminal.writeln("Failed to start manual terminal.");
        terminal.writeln(reason);
        scheduleRepaint();
      });

    return () => {
      disposed = true;
      inputDisposable.dispose();
      removeDataListener();
      removeExitListener();
    };
  }, [onRenameSession, runtimeBindingKey, runtimeId, sessionKey, setTileStatus]);

  useEffect(() => {
    const wasSurfaceActive = previousSurfaceActiveRef.current;
    previousSurfaceActiveRef.current = surfaceActive;
    if (!surfaceActive) return;
    if (!wasSurfaceActive) {
      scheduleRepaintRef.current?.(3);
    }
    if (selected && status === "ready") {
      terminalRef.current?.focus();
    }
  }, [selected, status, surfaceActive, terminalFocusRequestKey]);

  return (
    <article
      className={`terminal-tile manual real-terminal kind-${kindMeta.className} ${tileStatus} session-${displayStatus.kind} ${selected ? "selected" : ""} ${workspaceHidden ? "workspace-hidden" : ""} ${layoutHidden ? "focus-hidden" : ""}`}
      data-testid={workspaceHidden ? "background-terminal-tile" : "terminal-tile"}
      data-session-id={sessionKey}
      aria-label={latestActivity ? `${title}, ${latestActivity.title}: ${latestActivity.detail}` : title}
      aria-hidden={workspaceHidden || layoutHidden ? "true" : undefined}
      inert={workspaceHidden || layoutHidden ? true : undefined}
      tabIndex={workspaceHidden || layoutHidden ? -1 : 0}
      onFocus={(event) => {
        if (focusEnteredTile(event)) onSelectSession();
      }}
    >
      <header
          className="tile-header terminal-tile-header"
          tabIndex={-1}
          onClick={onSelectSession}
        >
          <div className="tile-title">
            <span className={`tile-kind-mark ${kindMeta.className}`} title={kindMeta.label} aria-label={kindMeta.label}>
              <TileKindIcon kind={kind} size={14} />
            </span>
            <div>
            {renaming ? (
              <form
                className="session-rename-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitRename();
                }}
              >
                <input
                  aria-label={`Rename ${title}`}
                  value={renameDraft}
                  maxLength={80}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.stopPropagation();
                      submitRename();
                      return;
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      setRenameDraft(title);
                      setRenaming(false);
                    }
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  autoFocus
                />
                <button
                  type="submit"
                  aria-label={`Save title for ${title}`}
                  disabled={!renameDraft.trim()}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <Check size={12} />
                </button>
              </form>
            ) : (
              <b>{title}</b>
            )}
            {showSessionLocation && (
              <small title={sessionLocationTitle} aria-label={`${sessionLocationMetaLabel} ${sessionLocationTitle}`}>
                <span className="session-location-meta">{sessionLocationMetaLabel}</span>
                <span className="session-location-value">{sessionLocationLabel}</span>
              </small>
            )}
          </div>
        </div>
        {latestActivity && (
          <div className={`tile-activity activity-${latestActivity.kind}`} title={latestActivity.detail}>
            <span>{activityKindLabel(latestActivity.kind)}</span>
            <strong>{latestActivity.title}</strong>
            <small>{latestActivity.detail}</small>
          </div>
        )}
        <div className="tile-actions">
          <div className="tile-action-group tile-status-group">
            {ageLabel && (
              <span className="tile-age" title={sessionAgeTitle(createdAt)}>
                {ageLabel}
              </span>
            )}
            <span className={`terminal-status-label tone-${kindMeta.className}`} aria-label={`status ${statusLabel}`}>
              <SessionStatusGlyph kind={displayStatus.kind} label={statusLabel} />
              <span className="terminal-status-text">{statusLabel}</span>
            </span>
          </div>
          {(tileStatus === "restored" || restartable) && (
            <div className="tile-action-group tile-primary-actions">
              {tileStatus === "restored" && relaunchCapable && (
                <button
                  type="button"
                  className={`continue-button ${relaunchNeedsReview ? "unsafe" : ""} ${relaunchArmed ? "armed" : ""}`}
                  aria-label={`${restoredActionLabel} ${title}`}
                  onClick={onContinueRestoredSession}
                  onPointerDown={(event) => event.stopPropagation()}
                  title={relaunchNeedsReview
                    ? relaunchSafety.reason
                    : restoredSessionButtonTitle(restoredActionSession)}
                >
                  {relaunchNeedsReview ? <AlertTriangle size={13} /> : <Play size={13} />}
                  <span>{restoredActionLabel}</span>
                </button>
              )}
              {restartable && (
                <button
                  type="button"
                  className={`continue-button ${relaunchNeedsReview ? "unsafe" : ""} ${relaunchArmed ? "armed" : ""}`}
                  aria-label={`${resumeButtonLabel(relaunchNeedsReview, relaunchArmed)} ${title}`}
                  onClick={onRestartSession}
                  onPointerDown={(event) => event.stopPropagation()}
                  title={relaunchNeedsReview ? relaunchSafety.reason : "Resume this session"}
                >
                  {relaunchNeedsReview ? <AlertTriangle size={13} /> : <RotateCcw size={13} />}
                  <span>{resumeButtonLabel(relaunchNeedsReview, relaunchArmed)}</span>
                </button>
              )}
            </div>
          )}
          <div className="tile-action-group tile-utility-actions">
            {externalTerminalCwd && (
              <button
                type="button"
                className="handoff-button"
                aria-label={`Open ${title} in external terminal`}
                onClick={() => void onOpenExternalTerminal(externalTerminalCwd)}
                onPointerDown={(event) => event.stopPropagation()}
                title={`Open in external terminal: ${shortenPath(externalTerminalCwd)}`}
              >
                <SquareTerminal size={14} />
              </button>
            )}
            <button
              type="button"
              className="rename-session-button"
              aria-label={`Rename ${title}`}
              onClick={beginRename}
              onPointerDown={(event) => event.stopPropagation()}
              title="Rename session"
            >
              <Pencil size={13} />
            </button>
          </div>
          <div className="tile-action-group tile-danger-actions">
            <button
              type="button"
              className={discardableSession ? "discard-session-button" : undefined}
              aria-label={`${closeActionLabel} ${title}`}
              onClick={onClose}
              onPointerDown={(event) => event.stopPropagation()}
              title={closeActionTitle}
            >
              <X size={14} />
              {discardableSession && <span>{closeActionLabel}</span>}
            </button>
          </div>
          <div className="tile-action-group tile-overflow-menu">
            <ChromeMenu
              label={`More actions for ${title}`}
              title={`${title} actions`}
              items={compactActionItems}
            >
              <Ellipsis size={14} />
            </ChromeMenu>
          </div>
        </div>
        </header>
      {recoveryOnly && (
        <div className="terminal-action-strip" role="note">
          Launch details were cleared for privacy. Your isolated checkout is still available.
        </div>
      )}
      <div
        className="xterm-host"
        data-testid={workspaceHidden ? "background-xterm-host" : "xterm-host"}
        data-session-id={sessionKey}
        ref={containerRef}
      />
    </article>
  );
}

function latestVisibleActivity(events: SessionTile["activityEvents"] | undefined): NonNullable<SessionTile["activityEvents"]>[number] | null {
  const latest = events?.at(-1);
  if (!latest || latest.kind === "lifecycle" || latest.kind === "output") return null;
  return latest;
}

function mergeTerminalReplayBuffer(baseBuffer: string | undefined, pendingOutput: string): string {
  const stableBaseBuffer = baseBuffer ?? "";
  if (!pendingOutput) return stableBaseBuffer;
  if (!stableBaseBuffer) return pendingOutput;
  if (stableBaseBuffer.endsWith(pendingOutput)) return stableBaseBuffer;

  const maxOverlap = Math.min(stableBaseBuffer.length, pendingOutput.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (stableBaseBuffer.endsWith(pendingOutput.slice(0, overlap))) {
      return `${stableBaseBuffer}${pendingOutput.slice(overlap)}`;
    }
  }

  return `${stableBaseBuffer}${pendingOutput}`;
}

function isIsolatedCheckout({
  isolation,
  branchName,
  baseCwd,
  workspaceId,
  workspaceRootFingerprint,
}: {
  isolation?: SessionTile["isolation"] | undefined;
  branchName?: string | undefined;
  baseCwd?: string | undefined;
  workspaceId?: string | undefined;
  workspaceRootFingerprint?: string | undefined;
}): boolean {
  if (isolation === "shared") return false;
  return hasIsolatedCheckoutMetadata({
    branchName,
    baseCwd,
    workspaceId,
    workspaceRootFingerprint,
  }) || isolation === "worktree";
}

function isReviewableIsolatedCheckout(
  session: Pick<
    SessionTile,
    "baseCwd" | "branchName" | "isolation" | "workspaceId" | "workspaceRootFingerprint"
  >,
): boolean {
  if (session.isolation === "shared") return false;
  return hasIsolatedCheckoutMetadata(session);
}

function isReusableIsolatedCheckoutMetadata({
  isolation,
  branchName,
  baseCwd,
  workspaceId,
  workspaceRootFingerprint,
}: {
  isolation?: SessionTile["isolation"] | undefined;
  branchName?: string | undefined;
  baseCwd?: string | undefined;
  workspaceId?: string | undefined;
  workspaceRootFingerprint?: string | undefined;
}): boolean {
  if (isolation === "shared") return false;
  return hasIsolatedCheckoutMetadata({
    branchName,
    baseCwd,
    workspaceId,
    workspaceRootFingerprint,
  });
}

function hasIsolatedCheckoutMetadata({
  branchName,
  baseCwd,
  workspaceId,
  workspaceRootFingerprint,
}: {
  branchName?: string | undefined;
  baseCwd?: string | undefined;
  workspaceId?: string | undefined;
  workspaceRootFingerprint?: string | undefined;
}): boolean {
  return Boolean(
    branchName
    && (baseCwd || (workspaceId && workspaceRootFingerprint)),
  );
}

function activityKindLabel(kind: NonNullable<SessionTile["activityEvents"]>[number]["kind"]): string {
  switch (kind) {
    case "approval":
      return "ask";
    case "command":
      return "cmd";
    case "error":
      return "err";
    case "file":
      return "file";
    case "plan":
      return "plan";
    case "tool":
      return "tool";
    case "warning":
      return "warn";
    case "lifecycle":
      return "state";
    case "output":
      return "out";
  }
}

function focusEnteredTile(event: ReactFocusEvent<HTMLElement>): boolean {
  const relatedTarget = event.relatedTarget;
  return !(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget);
}

function useStatusClock(lastOutputAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (lastOutputAt === undefined) return;

    const intervalId = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [lastOutputAt]);

  return now;
}
