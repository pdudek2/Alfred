import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Pencil, Play, RotateCcw, SquareTerminal, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { getDesktopTerminalApi, getDesktopWorkspaceApi } from "../desktop-api";
import type { TileLayout } from "../layout-state";
import { isLaunchBlocked, sessionInstanceKey, type SessionTile } from "../session-state";
import { StagedTilePreview } from "../staged-tile";
import { terminalSessionDisplayStatus, type LocalTerminalStatus } from "../session-status";
import { sessionAgeLabel, sessionAgeTitle } from "../session-time";
import { sessionTileKind, tileKindMeta } from "../tile-kind";
import { TileKindIcon } from "../tile-kind-icon";
import type { ArrangePointerMode, ArrangePreview, WorkMode } from "../terminal-desk-types";
import type { AgentKind } from "../../shared/alfred-ipc";
import type {
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalSessionId,
  TerminalSessionSnapshot,
} from "../../shared/terminal-ipc";
import { shortenPath } from "../path-display";
import { recoveryHeadline } from "../recovery-display";
import { sessionRelaunchSafety } from "../relaunch-safety";
import { restoredSessionActionLabel, restoredSessionActionTitle } from "../restored-session-action";
import { normalizeSessionTitle } from "../../shared/session-title";
import { ghosttyVesperTerminalProfile } from "../terminal-visual-profile";
import { SessionStatusGlyph } from "./SessionStatusGlyph";

const ARRANGE_GRID_ROW_HEIGHT = 84;
const MIN_TERMINAL_FIT_HEIGHT = 48;
const MIN_TERMINAL_FIT_WIDTH = 80;

export type WorktreeActionKind = "review" | "apply";

type TerminalDeskProps = {
  activeWorkspaceId: string;
  arrangeMode: boolean;
  layouts: Record<string, TileLayout>;
  collapsedSessionIds: Set<string>;
  recoverableSessions: SessionTile[];
  armedRecoverySessionIds: Set<string>;
  selectedSessionId: string | null;
  sessions: SessionTile[];
  workMode: WorkMode;
  worktreeActionPending: Record<string, WorktreeActionKind | undefined>;
  workspaceGitBranch?: string | undefined;
  workspaceLabel: string;
  workspaceRootPath?: string | undefined;
  onBindWorkspace: () => void;
  onAddAgentSession: (kind: Extract<AgentKind, "claude" | "codex">) => void;
  onAddManualSession: () => void;
  onApplyWorktree: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onContinueRestoredSession: (sessionId: string) => void;
  onOpenInbox: () => void;
  onRestartSession: (sessionId: string) => void;
  onApplyWorkMode: (mode: WorkMode) => void;
  onMoveTile: (tileId: string, deltaCol: number, deltaRow: number) => void;
  onRuntimeSessionFailed: (tileId: string, reason?: string) => void;
  onRuntimeSessionExited: (runtimeId: TerminalSessionId, exitCode: number) => void;
  onRuntimeSessionOutput: (event: TerminalDataEvent) => void;
  onRuntimeSessionReplayBuffer: (sessionId: string, runtimeId: TerminalSessionId, buffer: string) => void;
  onRuntimeSessionSnapshot: (sessionId: string, snapshot: TerminalSessionSnapshot) => void;
  onRuntimeSessionReady: (tileId: string, runtime: TerminalCreateResult) => void;
  onRuntimeSessionStarting: (tileId: string) => boolean;
  onRuntimeSessionUnavailable: (tileId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onFocusSession: (sessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onApproveTile: (tileId: string) => void;
  onRejectTile: (tileId: string) => void;
  onResizeTile: (tileId: string, deltaColSpan: number, deltaRowSpan: number) => void;
  onReviewWorktree: (sessionId: string) => void;
  onToggleCollapseSession: (sessionId: string) => void;
};

export function TerminalDesk({
  activeWorkspaceId,
  arrangeMode,
  layouts,
  collapsedSessionIds,
  recoverableSessions,
  armedRecoverySessionIds,
  selectedSessionId,
  sessions,
  workMode,
  worktreeActionPending,
  workspaceGitBranch,
  workspaceLabel,
  workspaceRootPath,
  onBindWorkspace,
  onAddAgentSession,
  onAddManualSession,
  onApplyWorktree,
  onCloseSession,
  onContinueRestoredSession,
  onOpenInbox,
  onRestartSession,
  onApplyWorkMode,
  onMoveTile,
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
  onApproveTile,
  onRejectTile,
  onResizeTile,
  onReviewWorktree,
  onToggleCollapseSession,
}: TerminalDeskProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [arrangePreview, setArrangePreview] = useState<ArrangePreview | null>(null);
  const activeSessions = sessions.filter((session) => session.workspaceId === activeWorkspaceId);
  const activeLayouts = layouts;
  const selectedSession = selectedSessionForDesk(activeSessions, selectedSessionId);
  const focusSession = workMode === "focus"
    ? selectedSession ?? focusedSession(activeSessions, activeLayouts) ?? activeSessions[0] ?? null
    : null;
  const splitSessions = workMode === "split"
    ? splitSessionsForDesk(activeSessions, selectedSessionId, activeLayouts)
    : activeSessions;
  const visibleSessions = arrangeMode ? activeSessions : focusSession ? [focusSession] : splitSessions;
  const renderedSessions = sessions.filter(
    (session) => session.stage === "live" || session.workspaceId === activeWorkspaceId,
  );
  const visibleSessionIds = new Set(visibleSessions.map((session) => session.id));
  const inspectedSession = focusSession ?? selectedSession ?? visibleSessions[0] ?? null;
  const blockedStagedSession =
    inspectedSession?.stage === "staged" && isLaunchBlocked(inspectedSession) ? inspectedSession : null;
  const showSplitEmptyState = workMode === "split" && activeSessions.length > 0 && visibleSessions.length < 2;
  const gridDensity =
    workMode === "split" ? "split" : visibleSessions.length <= 1 ? "single" : visibleSessions.length === 2 ? "split" : "dense";
  const showLayoutControls = arrangeMode;

  useEffect(() => {
    if (workMode !== "focus") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onApplyWorkMode("desk");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onApplyWorkMode, workMode]);

  const handleFocusSession = useCallback(
    (sessionId: string) => {
      if (!arrangeMode) {
        onFocusSession(sessionId);
        return;
      }
      onSelectSession(sessionId);
    },
    [arrangeMode, onFocusSession, onSelectSession],
  );
  const handleSelectSession = useCallback((sessionId: string) => onSelectSession(sessionId), [onSelectSession]);
  const handleOpenExternalTerminal = useCallback(async (cwd: string) => {
    const result = await getDesktopWorkspaceApi()?.openExternalTerminal({ cwd });
    if (!result?.ok) {
      throw new Error(result?.error ?? "Workspace runtime is unavailable.");
    }
  }, []);
  const handleGridWheelCapture = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.deltaY === 0) return;
    const column = event.currentTarget;
    if (column.scrollHeight <= column.clientHeight) return;

    const target = event.target instanceof Element ? event.target : null;
    const xtermHost = target?.closest(".xterm-host");
    const viewport = xtermHost?.querySelector(".xterm-viewport");
    if (!(viewport instanceof HTMLElement)) return;

    const direction = Math.sign(event.deltaY);
    const terminalCanScroll =
      direction > 0
        ? viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1
        : viewport.scrollTop > 1;
    if (terminalCanScroll) return;

    const columnCanScroll =
      direction > 0
        ? column.scrollTop + column.clientHeight < column.scrollHeight - 1
        : column.scrollTop > 1;
    if (!columnCanScroll) return;

    column.scrollTop += event.deltaY;
    event.preventDefault();
  }, []);
  const startPointerArrange = useCallback(
    (tileId: string, mode: ArrangePointerMode, event: ReactPointerEvent<HTMLElement>) => {
      if (!arrangeMode) return;
      if (mode === "move" && (event.target as HTMLElement).closest("button")) return;
      const grid = gridRef.current;
      const layout = layouts[tileId];
      if (!grid || !layout) return;

      event.preventDefault();
      const rect = grid.getBoundingClientRect();
      const colWidth = rect.width > 0 ? rect.width / 12 : 80;
      const startX = event.clientX;
      const startY = event.clientY;
      let finalDeltaCol = 0;
      let finalDeltaRow = 0;

      setArrangePreview({
        tileId,
        mode,
        offsetX: 0,
        offsetY: 0,
        deltaCol: 0,
        deltaRow: 0,
      });
      document.body.classList.add("arranging-pointer");

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const offsetX = moveEvent.clientX - startX;
        const offsetY = moveEvent.clientY - startY;
        finalDeltaCol = Math.round(offsetX / colWidth);
        finalDeltaRow = Math.round(offsetY / ARRANGE_GRID_ROW_HEIGHT);
        setArrangePreview({
          tileId,
          mode,
          offsetX,
          offsetY,
          deltaCol: finalDeltaCol,
          deltaRow: finalDeltaRow,
        });
      };

      const stopPointerArrange = (commit: boolean) => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", commitPointerArrange);
        window.removeEventListener("pointercancel", cancelPointerArrange);
        document.body.classList.remove("arranging-pointer");
        setArrangePreview(null);

        if (!commit) return;
        if (finalDeltaCol === 0 && finalDeltaRow === 0) return;

        if (mode === "move") {
          onMoveTile(tileId, finalDeltaCol, finalDeltaRow);
        } else {
          onResizeTile(tileId, finalDeltaCol, finalDeltaRow);
        }
      };
      const commitPointerArrange = () => stopPointerArrange(true);
      const cancelPointerArrange = () => stopPointerArrange(false);

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", commitPointerArrange);
      window.addEventListener("pointercancel", cancelPointerArrange);
    },
    [arrangeMode, layouts, onMoveTile, onResizeTile],
  );

  return (
    <section
      className={`terminal-stage ${showLayoutControls ? "" : "headerless"} ${arrangeMode ? "arranging" : ""} mode-${workMode}`}
      aria-label="terminals"
    >
      {showLayoutControls && (
        <header className="terminal-stage-header">
          <div className="layout-controls" aria-label="layout controls">
            {arrangeMode && (
              <>
                <span className="arrange-mode-label">Arrange mode</span>
                <span className="arrange-hint">drag header · resize corner</span>
              </>
            )}
          </div>
        </header>
      )}
      <div className="terminal-stage-body">
        <div className="terminal-grid-column" onWheelCapture={handleGridWheelCapture}>
          {recoverableSessions.length > 0 && (
            <RecoveryWorkspaceStrip
              sessions={recoverableSessions}
              onOpenInbox={onOpenInbox}
            />
          )}
          {blockedStagedSession && (
            <BlockedStagedLaunchDetails
              session={blockedStagedSession}
              onReviewDetails={() => handleFocusSession(blockedStagedSession.id)}
            />
          )}
          {focusSession && isReviewableIsolatedCheckout(focusSession) && (
            <WorktreeActionStrip
              pendingAction={worktreeActionPending[sessionInstanceKey(focusSession)]}
              session={focusSession}
              onApplyWorktree={onApplyWorktree}
              onReviewWorktree={onReviewWorktree}
            />
          )}
          <div
            className={`terminal-grid ${arrangeMode ? "arranging" : "laid-out"} ${gridDensity}`}
            data-testid="terminal-grid"
            ref={gridRef}
          >
          {activeSessions.length === 0 && (
            <EmptyWorkspaceState
              onAddAgentSession={onAddAgentSession}
              onAddManualSession={onAddManualSession}
              onBindWorkspace={onBindWorkspace}
              workspaceGitBranch={workspaceGitBranch}
              workspaceLabel={workspaceLabel}
              workspaceRootPath={workspaceRootPath}
            />
          )}
          {renderedSessions.map((session) => {
            const workspaceHidden = session.workspaceId !== activeWorkspaceId;
            const layoutHidden = !workspaceHidden && !arrangeMode && Boolean(
              (focusSession && session.id !== focusSession.id) ||
                (workMode === "split" && !visibleSessionIds.has(session.id)),
            );
            return session.stage === "live" ? (
              <ManualTerminalTile
                arrangeMode={arrangeMode}
                cwd={session.cwd}
                createdAt={session.createdAt}
                key={session.id}
                layout={layouts[session.id]}
                preview={arrangePreview?.tileId === session.id ? arrangePreview : undefined}
                sessionKey={session.id}
                runtimeId={session.runtimeId}
                runtimeStatus={session.runtimeStatus}
                relaunchArmed={armedRecoverySessionIds.has(session.id)}
                workspaceId={session.workspaceId}
                title={session.title}
                layoutHidden={layoutHidden}
                workspaceHidden={workspaceHidden}
                source={session.source}
                agentKind={session.agentKind}
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
                collapsed={collapsedSessionIds.has(session.id)}
                selected={inspectedSession?.id === session.id}
                showHeader={
                  arrangeMode ||
                  workMode !== "focus" ||
                  focusSession?.id !== session.id
                }
                onClose={() => onCloseSession(session.id)}
                onContinueRestoredSession={() => onContinueRestoredSession(session.id)}
                onRestartSession={() => onRestartSession(session.id)}
                onFocusSession={() => handleFocusSession(session.id)}
                onSelectSession={() => handleSelectSession(session.id)}
                onPointerMoveStart={(event) => startPointerArrange(session.id, "move", event)}
                onPointerResizeStart={(event) => startPointerArrange(session.id, "resize", event)}
                onRuntimeSessionFailed={onRuntimeSessionFailed}
                onRuntimeSessionExited={onRuntimeSessionExited}
                onRuntimeSessionOutput={onRuntimeSessionOutput}
                onRuntimeSessionReplayBuffer={onRuntimeSessionReplayBuffer}
                onRuntimeSessionSnapshot={onRuntimeSessionSnapshot}
                onRuntimeSessionReady={onRuntimeSessionReady}
                onRuntimeSessionStarting={onRuntimeSessionStarting}
                onRuntimeSessionUnavailable={onRuntimeSessionUnavailable}
                onOpenExternalTerminal={handleOpenExternalTerminal}
                onRenameSession={onRenameSession}
                onToggleCollapse={() => onToggleCollapseSession(session.id)}
              />
            ) : (
              <StagedTilePreview
                focusHidden={layoutHidden}
                key={session.id}
                layout={layouts[session.id]}
                preview={arrangePreview?.tileId === session.id ? arrangePreview : undefined}
                tile={session}
                selected={inspectedSession?.id === session.id}
                onFocusSession={() => handleFocusSession(session.id)}
                onSelectSession={() => handleSelectSession(session.id)}
                onApprove={onApproveTile}
                onPointerMoveStart={(event) => startPointerArrange(session.id, "move", event)}
                onReject={onRejectTile}
                onPointerResizeStart={(event) => startPointerArrange(session.id, "resize", event)}
                arrangeMode={arrangeMode}
              />
            );
          })}
          {showSplitEmptyState && (
            <SplitModeEmptyState
              onAddManualSession={onAddManualSession}
              onApplyWorkMode={onApplyWorkMode}
              workspaceLabel={workspaceLabel}
            />
          )}
          </div>
        </div>
      </div>
    </section>
  );
}

function BlockedStagedLaunchDetails({
  session,
  onReviewDetails,
}: {
  session: SessionTile;
  onReviewDetails: () => void;
}) {
  const detail = blockedLaunchDetail(session);

  return (
    <section
      className="terminal-action-strip"
      role="note"
      aria-label={`Blocked launch details for ${session.title}`}
    >
      <AlertTriangle size={14} aria-hidden="true" />
      <span>
        <strong>Cannot launch yet</strong>: {detail}
      </span>
      <button type="button" onClick={onReviewDetails}>
        Review details
      </button>
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

function RecoveryWorkspaceStrip({ sessions, onOpenInbox }: { sessions: SessionTile[]; onOpenInbox: () => void }) {
  return (
    <section className="recovery-workspace-strip" aria-label="Session recovery">
      <RotateCcw size={13} aria-hidden="true" />
      <p>
        <strong>{recoveryHeadline(sessions)}</strong>
        <span aria-hidden="true"> · </span>
        <button type="button" className="recovery-inbox-link" onClick={onOpenInbox}>
          Review in Inbox
        </button>
      </p>
    </section>
  );
}

function SplitModeEmptyState({
  onAddManualSession,
  onApplyWorkMode,
  workspaceLabel,
}: {
  onAddManualSession: () => void;
  onApplyWorkMode: (mode: WorkMode) => void;
  workspaceLabel: string;
}) {
  return (
    <aside className="split-empty-state" role="status" aria-label="Split mode needs another session">
      <div>
        <span>split slot</span>
        <strong>Create another terminal to fill this split</strong>
        <p>
          {workspaceLabel} has one visible tile. Create a second terminal for this side, or return to the
          full grid when you want the whole surface.
        </p>
      </div>
      <div className="split-empty-actions">
        <button type="button" onClick={onAddManualSession}>
          New terminal
        </button>
        <button type="button" onClick={() => onApplyWorkMode("desk")}>
          Back to grid
        </button>
      </div>
    </aside>
  );
}

function EmptyWorkspaceState({
  onAddAgentSession,
  onAddManualSession,
  onBindWorkspace,
  workspaceGitBranch,
  workspaceLabel,
  workspaceRootPath,
}: {
  onAddAgentSession: (kind: Extract<AgentKind, "claude" | "codex">) => void;
  onAddManualSession: () => void;
  onBindWorkspace: () => void;
  workspaceGitBranch?: string | undefined;
  workspaceLabel: string;
  workspaceRootPath?: string | undefined;
}) {
  const bound = Boolean(workspaceRootPath);

  return (
    <div className="terminal-empty-state" role="status" aria-label="Empty workspace">
      <div>
        <span>{bound ? "Workspace ready" : "Scratch workspace ready"}</span>
        <strong>{workspaceLabel}</strong>
        <p>{workspaceHomeCopy(workspaceRootPath, workspaceGitBranch)}</p>
      </div>
      <dl className="terminal-empty-facts" aria-label="workspace details">
        <div>
          <dt>folder</dt>
          <dd>{workspaceRootPath ? shortenPath(workspaceRootPath) : "local desk"}</dd>
        </div>
        <div>
          <dt>branch</dt>
          <dd>{workspaceGitBranch ?? "not detected"}</dd>
        </div>
      </dl>
      <div className="terminal-empty-actions" aria-label="empty workspace actions">
        <button type="button" className="terminal-empty-primary-action" onClick={onAddManualSession}>
          New terminal
        </button>
        <div className="terminal-empty-secondary-actions" role="group" aria-label="secondary empty workspace actions">
          <button type="button" onClick={() => onAddAgentSession("codex")}>
            Start Codex
          </button>
          <button type="button" onClick={() => onAddAgentSession("claude")}>
            Start Claude
          </button>
          {!bound && (
            <button type="button" onClick={onBindWorkspace}>
              Bind folder
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function workspaceHomeCopy(rootPath: string | undefined, gitBranch: string | undefined): string {
  if (rootPath && gitBranch) {
    return `Start a terminal in ${shortenPath(rootPath)} on ${gitBranch}.`;
  }

  if (rootPath) {
    return `Start a terminal in ${shortenPath(rootPath)}.`;
  }

  return "Start in the scratch desk, or bind a folder for project context.";
}

function blockedLaunchDetail(session: Pick<SessionTile, "launchPreflight" | "safetyNote">): string {
  const safetyNote = session.safetyNote?.trim();
  if (safetyNote) return safetyNote;
  if (session.launchPreflight?.status === "blocked") return session.launchPreflight.reason;
  return "Preflight failed.";
}

function relaunchButtonLabel(action: "relaunch" | "restart", unsafe: boolean, armed: boolean): string {
  if (!unsafe) return action === "relaunch" ? "Relaunch" : "Restart";
  if (armed) return action === "relaunch" ? "Confirm relaunch" : "Confirm restart";
  return action === "relaunch" ? "Review relaunch" : "Review restart";
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
  arrangeMode,
  cwd,
  createdAt,
  agentKind,
  isolation,
  branchName,
  baseCwd,
  launchPreflight,
  activityEvents,
  initialBuffer,
  lastOutputAt,
  layout,
  preview,
  relaunchArmed,
  collapsed,
  onClose,
  onContinueRestoredSession,
  onRestartSession,
  onFocusSession,
  onSelectSession,
  onPointerMoveStart,
  onPointerResizeStart,
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
  onToggleCollapse,
  selected,
  showHeader,
  runtimeId,
  runtimeStatus,
  sessionKey,
  source,
  workspaceId,
  title,
  layoutHidden = false,
  workspaceHidden,
  command,
  args,
  resumeTarget,
  resumeMode,
}: {
  arrangeMode: boolean;
  cwd: string;
  createdAt?: number | undefined;
  agentKind?: SessionTile["agentKind"];
  isolation?: SessionTile["isolation"] | undefined;
  branchName?: string | undefined;
  baseCwd?: string | undefined;
  launchPreflight?: SessionTile["launchPreflight"];
  activityEvents?: SessionTile["activityEvents"];
  initialBuffer?: string | undefined;
  lastOutputAt?: number | undefined;
  layout?: TileLayout | undefined;
  preview?: ArrangePreview | undefined;
  relaunchArmed: boolean;
  collapsed: boolean;
  onClose: () => void;
  onContinueRestoredSession: () => void;
  onRestartSession: () => void;
  onFocusSession: () => void;
  onSelectSession: () => void;
  onPointerMoveStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onRuntimeSessionFailed: (tileId: string, reason?: string) => void;
  onRuntimeSessionExited: (runtimeId: TerminalSessionId, exitCode: number) => void;
  onRuntimeSessionOutput: (event: TerminalDataEvent) => void;
  onRuntimeSessionReplayBuffer: (sessionId: string, runtimeId: TerminalSessionId, buffer: string) => void;
  onRuntimeSessionSnapshot: (sessionId: string, snapshot: TerminalSessionSnapshot) => void;
  onRuntimeSessionReady: (tileId: string, runtime: TerminalCreateResult) => void;
  onRuntimeSessionStarting: (tileId: string) => boolean;
  onRuntimeSessionUnavailable: (tileId: string) => void;
  onOpenExternalTerminal: (cwd: string) => Promise<void>;
  onRenameSession: (sessionId: string, title: string) => void;
  onToggleCollapse: () => void;
  selected: boolean;
  showHeader: boolean;
  runtimeId?: TerminalSessionId | undefined;
  runtimeStatus?: SessionTile["runtimeStatus"] | undefined;
  sessionKey: string;
  source: SessionTile["source"];
  workspaceId: string;
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
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastResizeRef = useRef<{ id: TerminalSessionId; cols: number; rows: number } | null>(null);
  const sessionIdRef = useRef<TerminalSessionId | null>(null);
  const [status, setStatus] = useState<LocalTerminalStatus>("connecting");
  const statusRef = useRef<LocalTerminalStatus>("connecting");
  const fitAndResizeRef = useRef<(() => boolean) | null>(null);
  const scheduleRepaintRef = useRef<((passes?: number) => void) | null>(null);
  const tileHidden = workspaceHidden || layoutHidden;
  const previousTileHiddenRef = useRef(tileHidden);
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
  const kind = sessionTileKind({ agentKind, source });
  const kindMeta = tileKindMeta(kind);
  const displayClock = useStatusClock(createdAt ?? lastOutputAt);
  const restoredTranscript = runtimeStatus === "restored" && !runtimeId;
  const tileStatus = restoredTranscript ? "restored" : status;
  const displaySession = {
    stage: "live",
    ...(runtimeStatus === undefined ? {} : { runtimeStatus }),
    ...(lastOutputAt === undefined ? {} : { lastOutputAt }),
    ...(activityEvents === undefined ? {} : { activityEvents }),
  } satisfies Parameters<typeof terminalSessionDisplayStatus>[0];
  const displayStatus = terminalSessionDisplayStatus(displaySession, tileStatus, displayClock);
  const statusSession = {
    ...(runtimeStatus === undefined ? {} : { runtimeStatus }),
  } satisfies Pick<SessionTile, "runtimeStatus">;
  const statusLabel = terminalStatusLabel(statusSession, tileStatus);
  const restartable = displayStatus.kind === "done" || displayStatus.kind === "error";
  const discardableSession = displayStatus.kind === "restored" || restartable;
  const existingCheckoutMetadata = isReusableIsolatedCheckoutMetadata({ isolation, branchName, baseCwd });
  const isolatedCheckout = isIsolatedCheckout({ isolation, branchName, baseCwd });
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
  const externalTerminalCwd = resolvedCwd || cwd;
  const worktreeRecoverySession = discardableSession && isolatedCheckout;
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

  useEffect(() => {
    const container = containerRef.current;
    const terminalApi = getDesktopTerminalApi();
    let disposed = false;
    const metadata = runtimeMetadataRef.current;

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

    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

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
      fitAddonRef.current = null;
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

    if (!terminal) {
      return;
    }

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
            : "This terminal failed to start. Use Restart to create a fresh runtime.",
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
      if (event.id === sessionIdRef.current) {
        if (snapshotHandshakePending) {
          snapshotHandshakeOutput += event.data;
        } else {
          writeAndRepaint(event.data);
        }
        runtimeCallbacksRef.current.onRuntimeSessionOutput(event);
      }
    });
    const removeExitListener = terminalApi.onExit((event) => {
      if (event.id === sessionIdRef.current) {
        runtimeCallbacksRef.current.onRuntimeSessionExited(event.id, event.exitCode);
        setTileStatus(event.exitCode === 0 ? "exited" : "error");
        terminal.writeln("");
        terminal.writeln(`[process exited with code ${event.exitCode}]`);
        scheduleRepaint();
      }
    });
    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;

      if (sessionId) {
        terminalApi.write({ id: sessionId, data });
      }
    });

    if (runtimeId) {
      sessionIdRef.current = runtimeId;
      setTileStatus("ready");
      snapshotHandshakePending = true;
      void terminalApi
        .snapshot({ id: runtimeId })
        .then((snapshot) => {
          if (disposed) return;
          snapshotHandshakePending = false;
          if (!snapshot) {
            const fallbackBuffer = mergeTerminalReplayBuffer(metadata.initialBuffer, snapshotHandshakeOutput);
            if (fallbackBuffer) {
              runtimeCallbacksRef.current.onRuntimeSessionReplayBuffer(sessionKey, runtimeId, fallbackBuffer);
              writeAndRepaint(fallbackBuffer);
            }
            return;
          }

          const replayBuffer = mergeTerminalReplayBuffer(snapshot.buffer, snapshotHandshakeOutput);
          runtimeCallbacksRef.current.onRuntimeSessionSnapshot(sessionKey, { ...snapshot, buffer: replayBuffer });
          if (replayBuffer) {
            writeAndRepaint(replayBuffer);
          }
        })
        .catch(() => {
          snapshotHandshakePending = false;
          if (!disposed) {
            const fallbackBuffer = mergeTerminalReplayBuffer(metadata.initialBuffer, snapshotHandshakeOutput);
            if (fallbackBuffer) {
              runtimeCallbacksRef.current.onRuntimeSessionReplayBuffer(sessionKey, runtimeId, fallbackBuffer);
              writeAndRepaint(fallbackBuffer);
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

    if (!callbacks.onRuntimeSessionStarting(sessionKey)) {
      terminal.writeln("Terminal start is already in progress...");
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
        runtimeCallbacksRef.current.onRuntimeSessionReady(sessionKey, session);

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
        runtimeCallbacksRef.current.onRuntimeSessionFailed(sessionKey, reason);
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
  }, [runtimeBindingKey, runtimeId, sessionKey, setTileStatus]);

  useEffect(() => {
    if (!selected || status !== "ready") return;
    terminalRef.current?.focus();
  }, [selected, status]);

  return (
    <article
      className={`terminal-tile manual real-terminal kind-${kindMeta.className} ${tileStatus} session-${displayStatus.kind} ${selected ? "selected" : ""} ${workspaceHidden ? "workspace-hidden" : ""} ${layoutHidden ? "focus-hidden" : ""} ${collapsed ? "collapsed" : ""} ${arrangeMode ? "arranging" : ""} ${showHeader ? "" : "chrome-headerless"} ${preview ? `is-${preview.mode === "move" ? "dragging" : "resizing"}` : ""}`}
      data-testid={workspaceHidden ? "background-terminal-tile" : "terminal-tile"}
      data-session-id={sessionKey}
      aria-label={latestActivity ? `${title}, ${latestActivity.title}: ${latestActivity.detail}` : title}
      aria-hidden={workspaceHidden || layoutHidden ? "true" : undefined}
      inert={workspaceHidden || undefined}
      style={gridStyle(layout, preview)}
      tabIndex={workspaceHidden || layoutHidden ? -1 : 0}
      onFocus={(event) => {
        if (focusEnteredTile(event)) onSelectSession();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onFocusSession();
        }
      }}
    >
      {showHeader && (
        <header
          className={`tile-header terminal-tile-header ${arrangeMode ? "drag-handle" : ""}`}
          onClick={!arrangeMode ? onSelectSession : undefined}
          onDoubleClick={!arrangeMode ? onFocusSession : undefined}
          onPointerDown={arrangeMode ? onPointerMoveStart : undefined}
        >
        <div className="tile-title">
          <span className={`tool-dot ${kindMeta.className}`} />
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
            <small title={sessionLocationTitle} aria-label={`${sessionLocationMetaLabel} ${sessionLocationTitle}`}>
              <span className="session-location-meta">{sessionLocationMetaLabel}</span>
              <span className="session-location-value">{sessionLocationLabel}</span>
            </small>
          </div>
        </div>
        {latestActivity && (
          <div className={`tile-activity activity-${latestActivity.kind}`} title={latestActivity.detail}>
            <span>{activityKindLabel(latestActivity.kind)}</span>
            <strong>{latestActivity.title}</strong>
            <small>{latestActivity.detail}</small>
          </div>
        )}
        {arrangeMode && <span className="arrange-handle" aria-hidden="true" />}
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
              {tileStatus === "restored" && (
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
                  aria-label={`${relaunchButtonLabel("restart", relaunchNeedsReview, relaunchArmed)} ${title}`}
                  onClick={onRestartSession}
                  onPointerDown={(event) => event.stopPropagation()}
                  title={relaunchNeedsReview ? relaunchSafety.reason : "Restart this session"}
                >
                  {relaunchNeedsReview ? <AlertTriangle size={13} /> : <RotateCcw size={13} />}
                  <span>{relaunchButtonLabel("restart", relaunchNeedsReview, relaunchArmed)}</span>
                </button>
              )}
            </div>
          )}
          <div className="tile-action-group tile-utility-actions">
            <button
              type="button"
              className="collapse-session-button"
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
              onClick={onToggleCollapse}
              onPointerDown={(event) => event.stopPropagation()}
              title={collapsed ? "Expand terminal body" : "Collapse terminal body"}
            >
              {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
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
              onClick={() => {
                setRenameDraft(title);
                setRenaming(true);
              }}
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
        </div>
        </header>
      )}
      <div
        className="xterm-host"
        data-testid={workspaceHidden ? "background-xterm-host" : "xterm-host"}
        data-session-id={sessionKey}
        ref={containerRef}
      />
      {arrangeMode && (
        <button
          className="tile-resize-handle"
          type="button"
          aria-label={`Resize ${title}`}
          onPointerDown={onPointerResizeStart}
        />
      )}
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
}: {
  isolation?: SessionTile["isolation"] | undefined;
  branchName?: string | undefined;
  baseCwd?: string | undefined;
}): boolean {
  if (isolation === "shared") return false;
  return hasIsolatedCheckoutMetadata({ branchName, baseCwd }) || isolation === "worktree";
}

function isReviewableIsolatedCheckout(session: Pick<SessionTile, "baseCwd" | "branchName" | "isolation">): boolean {
  if (session.isolation === "shared") return false;
  return hasIsolatedCheckoutMetadata(session);
}

function isReusableIsolatedCheckoutMetadata({
  isolation,
  branchName,
  baseCwd,
}: {
  isolation?: SessionTile["isolation"] | undefined;
  branchName?: string | undefined;
  baseCwd?: string | undefined;
}): boolean {
  if (isolation === "shared") return false;
  return hasIsolatedCheckoutMetadata({ branchName, baseCwd });
}

function hasIsolatedCheckoutMetadata({
  branchName,
  baseCwd,
}: {
  branchName?: string | undefined;
  baseCwd?: string | undefined;
}): boolean {
  return Boolean(branchName && baseCwd);
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

function terminalStatusKind(
  session: Pick<SessionTile, "runtimeStatus">,
  localStatus: LocalTerminalStatus,
): string {
  if (localStatus === "error" || session.runtimeStatus === "error") return "error";
  if (localStatus === "restored" || session.runtimeStatus === "restored") return "restored";
  if (localStatus === "connecting" || session.runtimeStatus === "starting") return "starting";
  if (localStatus === "exited" || session.runtimeStatus === "exited") return "exited";
  if (localStatus === "browser" || session.runtimeStatus === "unavailable") return "unavailable";
  return "running";
}

function terminalStatusLabel(
  session: Pick<SessionTile, "runtimeStatus">,
  localStatus: LocalTerminalStatus,
): string {
  switch (terminalStatusKind(session, localStatus)) {
    case "running":
    case "ready":
      return "running";
    case "starting":
      return "starting";
    case "restored":
      return "restored";
    case "exited":
      return "exited";
    case "error":
      return "needs review";
    default:
      return terminalStatusKind(session, localStatus);
  }
}

function focusedSession(sessions: SessionTile[], layouts: Record<string, TileLayout>): SessionTile | null {
  let best: { session: SessionTile; area: number } | null = null;
  for (const session of sessions) {
    if (session.stage !== "live") continue;
    const layout = layouts[session.id];
    if (!layout) continue;
    const area = layout.colSpan * layout.rowSpan;
    if (!best || area > best.area) best = { session, area };
  }
  return best?.session ?? null;
}

function splitSessionsForDesk(
  sessions: SessionTile[],
  selectedSessionId: string | null,
  layouts: Record<string, TileLayout>,
): SessionTile[] {
  if (sessions.length <= 2) return sessions;

  const defaultVisible = sessions.slice(0, 2);
  if (!selectedSessionId || defaultVisible.some((session) => session.id === selectedSessionId)) {
    return defaultVisible;
  }

  const primary = selectedSessionForDesk(sessions, selectedSessionId) ?? focusedSession(sessions, layouts) ?? sessions[0] ?? null;
  if (!primary) return [];

  const secondary = sessions.find((session) => session.id !== primary.id) ?? null;
  return secondary ? [primary, secondary] : [primary];
}

function selectedSessionForDesk(sessions: SessionTile[], selectedSessionId: string | null): SessionTile | null {
  return sessions.find((session) => session.id === selectedSessionId) ?? null;
}

function gridStyle(layout: TileLayout | undefined, preview?: ArrangePreview | undefined): CSSProperties | undefined {
  if (!layout) return undefined;
  const style: CSSProperties & Record<string, string | number> = {
    gridColumn: `${layout.col} / span ${layout.colSpan}`,
    gridRow: `${layout.row} / span ${layout.rowSpan}`,
  };

  if (preview) {
    style["--arrange-x"] = `${preview.offsetX}px`;
    style["--arrange-y"] = `${preview.offsetY}px`;
    style["--arrange-cols"] = String(preview.deltaCol);
    style["--arrange-rows"] = String(preview.deltaRow);
  }

  if (preview?.mode === "move") {
    style.transform = `translate3d(${preview.offsetX}px, ${preview.offsetY}px, 0)`;
    style.zIndex = 6;
  }

  return style;
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
