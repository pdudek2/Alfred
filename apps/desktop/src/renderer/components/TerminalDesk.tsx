import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { AlertTriangle, Check, Pencil, Play, RotateCcw, SquareTerminal, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getDesktopTerminalApi, getDesktopWorkspaceApi } from "../desktop-api";
import type { LayoutPreset, TileLayout } from "../layout-state";
import type { SessionTile } from "../session-state";
import { StagedTilePreview } from "../staged-tile";
import { terminalSessionDisplayStatus, type LocalTerminalStatus } from "../session-status";
import { sessionAgeLabel, sessionAgeTitle } from "../session-time";
import { sessionTileKind, tileKindMeta } from "../tile-kind";
import { TileKindIcon } from "../tile-kind-icon";
import type { ArrangePointerMode, ArrangePreview, WorkMode } from "../terminal-desk-types";
import type { AgentKind, AlfredStagedSessionPatch } from "../../shared/alfred-ipc";
import type { TerminalCreateRequest, TerminalCreateResult, TerminalSessionId } from "../../shared/terminal-ipc";
import { AgentTimelinePanel } from "./AgentTimelinePanel";
import { shortenPath } from "../path-display";
import { recoveryHeadline, recoverySummary } from "../recovery-display";
import { sessionRelaunchSafety } from "../relaunch-safety";
import { normalizeSessionTitle } from "../../shared/session-title";

const ARRANGE_GRID_ROW_HEIGHT = 84;

type TerminalDeskProps = {
  arrangeMode: boolean;
  armedUnsafeSessionIds: Set<string>;
  layouts: Record<string, TileLayout>;
  recoverableSessions: SessionTile[];
  relaunchArmedSessionIds: Set<string>;
  selectedSessionId: string | null;
  sessions: SessionTile[];
  shortcutModifier: string;
  workMode: WorkMode;
  workspaceGitBranch?: string | undefined;
  workspaceLabel: string;
  workspaceRootPath?: string | undefined;
  onBindWorkspace: () => void;
  onAddAgentSession: (kind: Extract<AgentKind, "claude" | "codex">) => void;
  onAddManualSession: () => void;
  onCloseSession: (sessionId: string) => void;
  onContinueRestoredSession: (sessionId: string) => void;
  onRestartSession: (sessionId: string) => void;
  onApplyLayoutPreset: (preset: LayoutPreset) => void;
  onApplyWorkMode: (mode: WorkMode) => void;
  onMoveTile: (tileId: string, deltaCol: number, deltaRow: number) => void;
  onRuntimeSessionFailed: (tileId: string) => void;
  onRuntimeSessionExited: (runtimeId: TerminalSessionId) => void;
  onRuntimeSessionOutput: (runtimeId: TerminalSessionId, data: string) => void;
  onRuntimeSessionReady: (tileId: string, runtime: TerminalCreateResult) => void;
  onRuntimeSessionStarting: (tileId: string) => boolean;
  onRuntimeSessionUnavailable: (tileId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onFocusSession: (sessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onApproveTile: (tileId: string) => void;
  onRejectTile: (tileId: string) => void;
  onResizeTile: (tileId: string, deltaColSpan: number, deltaRowSpan: number) => void;
  onUpdateStagedSession: (sessionId: string, patch: AlfredStagedSessionPatch) => Promise<void>;
};

export function TerminalDesk({
  arrangeMode,
  armedUnsafeSessionIds,
  layouts,
  recoverableSessions,
  relaunchArmedSessionIds,
  selectedSessionId,
  sessions,
  shortcutModifier,
  workMode,
  workspaceGitBranch,
  workspaceLabel,
  workspaceRootPath,
  onBindWorkspace,
  onAddAgentSession,
  onAddManualSession,
  onCloseSession,
  onContinueRestoredSession,
  onRestartSession,
  onApplyLayoutPreset,
  onApplyWorkMode,
  onMoveTile,
  onRuntimeSessionFailed,
  onRuntimeSessionExited,
  onRuntimeSessionOutput,
  onRuntimeSessionReady,
  onRuntimeSessionStarting,
  onRuntimeSessionUnavailable,
  onRenameSession,
  onFocusSession,
  onSelectSession,
  onApproveTile,
  onRejectTile,
  onResizeTile,
  onUpdateStagedSession,
}: TerminalDeskProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [arrangePreview, setArrangePreview] = useState<ArrangePreview | null>(null);
  const selectedSession = selectedSessionForDesk(sessions, selectedSessionId);
  const focusSession = workMode === "focus"
    ? selectedSession ?? focusedSession(sessions, layouts) ?? sessions[0] ?? null
    : null;
  const splitSessions = workMode === "split"
    ? splitSessionsForDesk(sessions, selectedSessionId, layouts)
    : sessions;
  const visibleSessions = focusSession ? [focusSession] : splitSessions;
  const inspectedSession = focusSession ?? selectedSession ?? visibleSessions[0] ?? null;
  const showSplitEmptyState = workMode === "split" && sessions.length > 0 && visibleSessions.length < 2;
  const gridDensity =
    workMode === "split" ? "split" : visibleSessions.length <= 1 ? "single" : visibleSessions.length === 2 ? "split" : "dense";

  useEffect(() => {
    if (workMode !== "focus") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
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
  const handleSendSessionInput = useCallback((runtimeId: TerminalSessionId, data: string) => {
    getDesktopTerminalApi()?.write({ id: runtimeId, data });
  }, []);
  const handleCopyActivityText = useCallback(async (value: string) => {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard is unavailable.");
    }
    await navigator.clipboard.writeText(value);
  }, []);
  const handleRevealActivityFile = useCallback(async (filePath: string, cwd: string) => {
    const result = await getDesktopWorkspaceApi()?.revealPath({ cwd, path: filePath });
    if (!result?.ok) {
      throw new Error(result?.error ?? "Workspace runtime is unavailable.");
    }
  }, []);
  const handleOpenExternalTerminal = useCallback(async (cwd: string) => {
    const result = await getDesktopWorkspaceApi()?.openExternalTerminal({ cwd });
    if (!result?.ok) {
      throw new Error(result?.error ?? "Workspace runtime is unavailable.");
    }
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
    <section className={`terminal-stage ${arrangeMode ? "arranging" : ""} mode-${workMode}`} aria-label="terminals">
      <header className="terminal-stage-header">
        <div>
          <strong>Desk</strong>
          <span>
            {sessions.length} tile{sessions.length === 1 ? "" : "s"} · {sessions.filter((s) => s.stage === "staged").length} staged
          </span>
        </div>
        <div className="layout-controls" aria-label="layout controls">
          {arrangeMode && (
            <>
              <button type="button" onClick={() => onApplyLayoutPreset("focus")}>
                Full
              </button>
              <button type="button" onClick={() => onApplyLayoutPreset("two-up")}>
                Split
              </button>
              <button type="button" onClick={() => onApplyLayoutPreset("grid")}>
                Tiled
              </button>
              <span className="arrange-hint">drag header · resize corner</span>
            </>
          )}
          {!arrangeMode && sessions.length > 0 && (
            <div className="work-mode-control" aria-label="work mode">
              <button
                type="button"
                className={workMode === "focus" ? "active" : ""}
                aria-pressed={workMode === "focus"}
                onClick={() => onApplyWorkMode("focus")}
              >
                Focus
              </button>
              <button
                type="button"
                className={workMode === "split" ? "active" : ""}
                aria-pressed={workMode === "split"}
                onClick={() => onApplyWorkMode("split")}
              >
                Split
              </button>
              <button
                type="button"
                className={workMode === "desk" ? "active" : ""}
                aria-pressed={workMode === "desk"}
                onClick={() => onApplyWorkMode("desk")}
              >
                Desk
              </button>
            </div>
          )}
          <kbd>{shortcutModifier} T</kbd>
        </div>
      </header>
      <div className="terminal-stage-body">
        <div className="terminal-grid-column">
          {recoverableSessions.length > 0 && (
            <RecoveryWorkspaceStrip
              sessions={recoverableSessions}
            />
          )}
          {focusSession && sessions.length > 1 && (
            <FocusSessionStrip
              activeSessionId={focusSession.id}
              sessions={sessions}
              onFocusSession={onFocusSession}
            />
          )}
          <div className={`terminal-grid ${arrangeMode ? "arranging" : "laid-out"} ${gridDensity}`} ref={gridRef}>
          {sessions.length === 0 && (
            <EmptyWorkspaceState
              onAddAgentSession={onAddAgentSession}
              onAddManualSession={onAddManualSession}
              onBindWorkspace={onBindWorkspace}
              workspaceGitBranch={workspaceGitBranch}
              workspaceLabel={workspaceLabel}
              workspaceRootPath={workspaceRootPath}
            />
          )}
          {visibleSessions.map((session) =>
            session.stage === "live" ? (
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
                relaunchArmed={relaunchArmedSessionIds.has(session.id)}
                workspaceId={session.workspaceId}
                title={session.title}
                source={session.source}
                agentKind={session.agentKind}
                isolation={session.isolation}
                branchName={session.branchName}
                baseCwd={session.baseCwd}
                launchPreflight={session.launchPreflight}
                command={session.command}
                args={session.args}
                initialBuffer={session.initialBuffer}
                activityEvents={session.activityEvents}
                lastOutputAt={session.lastOutputAt}
                selected={inspectedSession?.id === session.id}
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
                onRuntimeSessionReady={onRuntimeSessionReady}
                onRuntimeSessionStarting={onRuntimeSessionStarting}
                onRuntimeSessionUnavailable={onRuntimeSessionUnavailable}
                onOpenExternalTerminal={handleOpenExternalTerminal}
                onRenameSession={onRenameSession}
              />
            ) : (
              <StagedTilePreview
                armed={armedUnsafeSessionIds.has(session.id)}
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
            ),
          )}
          {showSplitEmptyState && (
            <SplitModeEmptyState
              onAddManualSession={onAddManualSession}
              onApplyWorkMode={onApplyWorkMode}
              workspaceLabel={workspaceLabel}
            />
          )}
          </div>
        </div>
        {workMode === "focus" && (
          <AgentTimelinePanel
            session={focusSession}
            onCopyActivityText={handleCopyActivityText}
            onOpenExternalTerminal={handleOpenExternalTerminal}
            onRevealActivityFile={handleRevealActivityFile}
            onSendInput={handleSendSessionInput}
            onUpdateStagedSession={onUpdateStagedSession}
          />
        )}
      </div>
    </section>
  );
}

function RecoveryWorkspaceStrip({ sessions }: { sessions: SessionTile[] }) {
  return (
    <section className="recovery-workspace-strip" aria-label="Session recovery">
      <div>
        <span>Recovery</span>
        <strong>{recoveryHeadline(sessions)}</strong>
        <p>{recoverySummary(sessions) || "Saved transcript available"}</p>
      </div>
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
          full desk when you want the whole surface.
        </p>
      </div>
      <div className="split-empty-actions">
        <button type="button" onClick={onAddManualSession}>
          New terminal
        </button>
        <button type="button" onClick={() => onApplyWorkMode("desk")}>
          Back to desk
        </button>
      </div>
    </aside>
  );
}

function FocusSessionStrip({
  activeSessionId,
  sessions,
  onFocusSession,
}: {
  activeSessionId: string;
  sessions: SessionTile[];
  onFocusSession: (sessionId: string) => void;
}) {
  return (
    <div className="focus-session-strip" role="toolbar" aria-label="focus session switcher">
      {sessions.map((session) => {
        const kind = sessionTileKind(session);
        const kindMeta = tileKindMeta(kind);
        const active = session.id === activeSessionId;

        return (
          <button
            type="button"
            key={session.id}
            className={active ? "active" : ""}
            aria-pressed={active}
            aria-label={`Focus ${session.title}`}
            onClick={() => onFocusSession(session.id)}
          >
            <span className={`tool-dot ${kindMeta.className}`} />
            <span>{session.title}</span>
          </button>
        );
      })}
    </div>
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
        <button type="button" onClick={onAddManualSession}>
          New terminal
        </button>
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
  );
}

function workspaceHomeCopy(rootPath: string | undefined, gitBranch: string | undefined): string {
  if (rootPath && gitBranch) {
    return `Bound to ${shortenPath(rootPath)} on ${gitBranch}. Start a session when you are ready.`;
  }

  if (rootPath) {
    return `Bound to ${shortenPath(rootPath)}. Start a session when you are ready.`;
  }

  return "No project folder is bound yet. Start in the scratch desk, or bind a folder when you want project context.";
}

function relaunchButtonLabel(action: "relaunch" | "restart", unsafe: boolean, armed: boolean): string {
  if (!unsafe) return action === "relaunch" ? "Relaunch" : "Restart";
  if (armed) return action === "relaunch" ? "Confirm relaunch" : "Confirm restart";
  return action === "relaunch" ? "Review relaunch" : "Review restart";
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
  onRuntimeSessionReady,
  onRuntimeSessionStarting,
  onRuntimeSessionUnavailable,
  onOpenExternalTerminal,
  onRenameSession,
  selected,
  runtimeId,
  runtimeStatus,
  sessionKey,
  source,
  workspaceId,
  title,
  command,
  args,
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
  onClose: () => void;
  onContinueRestoredSession: () => void;
  onRestartSession: () => void;
  onFocusSession: () => void;
  onSelectSession: () => void;
  onPointerMoveStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onRuntimeSessionFailed: (tileId: string) => void;
  onRuntimeSessionExited: (runtimeId: TerminalSessionId) => void;
  onRuntimeSessionOutput: (runtimeId: TerminalSessionId, data: string) => void;
  onRuntimeSessionReady: (tileId: string, runtime: TerminalCreateResult) => void;
  onRuntimeSessionStarting: (tileId: string) => boolean;
  onRuntimeSessionUnavailable: (tileId: string) => void;
  onOpenExternalTerminal: (cwd: string) => Promise<void>;
  onRenameSession: (sessionId: string, title: string) => void;
  selected: boolean;
  runtimeId?: TerminalSessionId | undefined;
  runtimeStatus?: SessionTile["runtimeStatus"] | undefined;
  sessionKey: string;
  source: SessionTile["source"];
  workspaceId: string;
  title: string;
  command?: string | undefined;
  args?: string[] | undefined;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<TerminalSessionId | null>(null);
  const [status, setStatus] = useState<LocalTerminalStatus>("connecting");
  const [resolvedCwd, setResolvedCwd] = useState<string>(cwd);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(title);
  const kind = sessionTileKind({ agentKind, source });
  const kindMeta = tileKindMeta(kind);
  const displayClock = useStatusClock(createdAt ?? lastOutputAt);
  const displaySession = {
    stage: "live",
    ...(runtimeStatus === undefined ? {} : { runtimeStatus }),
    ...(lastOutputAt === undefined ? {} : { lastOutputAt }),
    ...(activityEvents === undefined ? {} : { activityEvents }),
  } satisfies Parameters<typeof terminalSessionDisplayStatus>[0];
  const displayStatus = terminalSessionDisplayStatus(displaySession, status, displayClock);
  const restartable = displayStatus.kind === "done" || displayStatus.kind === "error";
  const discardableSession = displayStatus.kind === "restored" || restartable;
  const relaunchSafety = sessionRelaunchSafety({
    source,
    ...(agentKind === undefined ? {} : { agentKind }),
    ...(args === undefined ? {} : { args }),
    ...(command === undefined ? {} : { command }),
  });
  const relaunchNeedsReview = !relaunchSafety.safe;
  const latestActivity = latestVisibleActivity(activityEvents);
  const ageLabel = sessionAgeLabel(createdAt, displayClock);
  const sessionLocationLabel = branchName ? "isolated worktree" : (resolvedCwd ? shortenPath(resolvedCwd) : "runtime cwd");
  const sessionLocationTitle = branchName
    ? baseCwd
      ? `${branchName} · isolated from ${baseCwd}`
      : `${branchName} · isolated worktree`
    : resolvedCwd ?? "runtime cwd";
  const externalTerminalCwd = resolvedCwd || cwd;

  useEffect(() => {
    if (!renaming) {
      setRenameDraft(title);
    }
  }, [renaming, title]);

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

    if (!container) {
      return;
    }

    sessionIdRef.current = runtimeId ?? null;
    setResolvedCwd(cwd);
    setStatus("connecting");
    const restoredTranscript = runtimeStatus === "restored" && !runtimeId;

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      disableStdin: restoredTranscript || !terminalApi,
      fontFamily: '"Berkeley Mono", "JetBrains Mono", "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.32,
      theme: {
        background: "#050807",
        foreground: "#ded8c8",
        cursor: "#fff4d8",
        cursorAccent: "#050807",
        selectionBackground: "#29494d",
        selectionForeground: "#fff8e9",
        black: "#050807",
        blue: "#48b9d6",
        brightBlack: "#8a8171",
        brightBlue: "#88dcf2",
        brightCyan: "#9eeaf2",
        brightGreen: "#b5f0be",
        brightMagenta: "#d0c6ff",
        brightRed: "#ff9d92",
        brightWhite: "#fff8e9",
        brightYellow: "#ffe08a",
        cyan: "#56d4df",
        green: "#7ce08f",
        magenta: "#b7a1ff",
        red: "#ef8173",
        white: "#f2eadc",
        yellow: "#e0b84e",
      },
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const fitAndResize = () => {
      fitAddon.fit();
      const sessionId = sessionIdRef.current;

      if (sessionId && terminalApi) {
        terminalApi.resize({ id: sessionId, cols: terminal.cols, rows: terminal.rows });
      }
    };

    requestAnimationFrame(fitAndResize);

    if (restoredTranscript) {
      setStatus("restored");
      if (initialBuffer) {
        terminal.write(initialBuffer);
      }
      return () => {
        terminal.dispose();
      };
    }

    if (!terminalApi) {
      if (runtimeStatus !== "unavailable") {
        onRuntimeSessionUnavailable(sessionKey);
      }
      setStatus("browser");
      terminal.writeln("Terminal unavailable outside Electron.");
      terminal.writeln("Open Alfred Desktop to attach a real local PTY.");
      terminal.writeln("Dev fallback: pnpm --filter @alfred/desktop dev:electron");
      return () => {
        terminal.dispose();
      };
    }

    const removeDataListener = terminalApi.onData((event) => {
      if (event.id === sessionIdRef.current) {
        terminal.write(event.data);
        onRuntimeSessionOutput(event.id, event.data);
      }
    });
    const removeExitListener = terminalApi.onExit((event) => {
      if (event.id === sessionIdRef.current) {
        onRuntimeSessionExited(event.id);
        setStatus("exited");
        terminal.writeln("");
        terminal.writeln(`[process exited with code ${event.exitCode}]`);
      }
    });
    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;

      if (sessionId) {
        terminalApi.write({ id: sessionId, data });
      }
    });
    const resizeObserver = new ResizeObserver(fitAndResize);

    resizeObserver.observe(container);

    if (runtimeId) {
      sessionIdRef.current = runtimeId;
      setStatus("ready");
      if (initialBuffer) {
        terminal.write(initialBuffer);
      }
      requestAnimationFrame(fitAndResize);
      terminal.focus();

      return () => {
        disposed = true;
        resizeObserver.disconnect();
        inputDisposable.dispose();
        removeDataListener();
        removeExitListener();
        terminal.dispose();
      };
    }

    if (!onRuntimeSessionStarting(sessionKey)) {
      terminal.writeln("Terminal start is already in progress...");
      return () => {
        disposed = true;
        resizeObserver.disconnect();
        inputDisposable.dispose();
        removeDataListener();
        removeExitListener();
        terminal.dispose();
      };
    }

    const baseRequest: TerminalCreateRequest = {
      cols: terminal.cols,
      rows: terminal.rows,
      clientId: sessionKey,
      title,
      source,
      workspaceId,
    };
    if (agentKind) baseRequest.agentKind = agentKind;
    if (cwd) baseRequest.cwd = cwd;
    if (isolation === "worktree" && !branchName) baseRequest.isolation = "worktree";
    if (!branchName && launchPreflight?.status === "ready" && launchPreflight.isolation === "worktree") {
      baseRequest.isolation = "worktree";
      if (launchPreflight.branchName) baseRequest.branchName = launchPreflight.branchName;
    }
    if (command) {
      baseRequest.command = command;
      baseRequest.args = args ?? [];
    }
    terminalApi
      .create(baseRequest)
      .then((session) => {
        onRuntimeSessionReady(sessionKey, session);

        if (disposed) {
          return;
        }

        sessionIdRef.current = session.id;
        setResolvedCwd(session.cwd);
        setStatus("ready");
        fitAndResize();
        terminal.focus();
      })
      .catch((error: unknown) => {
        onRuntimeSessionFailed(sessionKey);
        if (disposed) {
          return;
        }

        setStatus("error");
        terminal.writeln("Failed to start manual terminal.");
        terminal.writeln(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      inputDisposable.dispose();
      removeDataListener();
      removeExitListener();

      terminal.dispose();
    };
  }, [
    cwd,
    sessionKey,
    title,
    source,
    workspaceId,
    agentKind,
    isolation,
    branchName,
    launchPreflight,
    command,
    args,
    initialBuffer,
    runtimeId,
    runtimeStatus,
    onRuntimeSessionFailed,
    onRuntimeSessionExited,
    onRuntimeSessionOutput,
    onRuntimeSessionReady,
    onRuntimeSessionStarting,
    onRuntimeSessionUnavailable,
  ]);

  return (
    <article
      className={`terminal-tile manual real-terminal kind-${kindMeta.className} ${status} session-${displayStatus.kind} ${selected ? "selected" : ""} ${arrangeMode ? "arranging" : ""} ${preview ? `is-${preview.mode === "move" ? "dragging" : "resizing"}` : ""}`}
      aria-label={latestActivity ? `${title}, ${latestActivity.title}: ${latestActivity.detail}` : title}
      style={gridStyle(layout, preview)}
      tabIndex={0}
      onFocus={onSelectSession}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onFocusSession();
        }
      }}
    >
      <header
        className={`tile-header ${arrangeMode ? "drag-handle" : ""}`}
        onClick={!arrangeMode ? onSelectSession : undefined}
        onDoubleClick={!arrangeMode ? onFocusSession : undefined}
        onPointerDown={arrangeMode ? onPointerMoveStart : undefined}
      >
        <div className="tile-title">
          <span className={`tool-dot ${kindMeta.className}`} />
          <span className={`tile-kind-mark ${kindMeta.className}`} title={kindMeta.label}>
            <TileKindIcon kind={kind} />
            <span>{kindMeta.shortLabel}</span>
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
            <small title={sessionLocationTitle}>
              {kindMeta.label} · {sessionLocationLabel}
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
        <div className="tile-actions">
          {ageLabel && (
            <span className="tile-age" title={sessionAgeTitle(createdAt)}>
              {ageLabel}
            </span>
          )}
          <span className={`tile-status status-${displayStatus.kind}`}>{displayStatus.label}</span>
          {status === "restored" && (
            <button
              type="button"
              className={`continue-button ${relaunchNeedsReview ? "unsafe" : ""} ${relaunchArmed ? "armed" : ""}`}
              aria-label={`${relaunchButtonLabel("relaunch", relaunchNeedsReview, relaunchArmed)} ${title}`}
              onClick={onContinueRestoredSession}
              onPointerDown={(event) => event.stopPropagation()}
              title={relaunchNeedsReview ? relaunchSafety.reason : "Relaunch this saved session"}
            >
              {relaunchNeedsReview ? <AlertTriangle size={13} /> : <Play size={13} />}
              <span>{relaunchButtonLabel("relaunch", relaunchNeedsReview, relaunchArmed)}</span>
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
          <button
            type="button"
            className={discardableSession ? "discard-session-button" : undefined}
            aria-label={discardableSession ? `Discard ${title}` : `Close ${title}`}
            onClick={onClose}
            onPointerDown={(event) => event.stopPropagation()}
            title={discardableSession ? "Discard this recovery item" : "Close terminal"}
          >
            <X size={14} />
            {discardableSession && <span>Discard</span>}
          </button>
        </div>
      </header>
      <div className="xterm-host" ref={containerRef} />
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
