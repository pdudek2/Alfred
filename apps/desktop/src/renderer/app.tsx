import { Command, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDesktopAlfredApi, getDesktopLayoutApi, getDesktopTerminalApi } from "./desktop-api";
import { ComposerBar } from "./composer";
import { AlfredControlRail } from "./components/AlfredControlRail";
import { AlfredMark } from "./components/AlfredMark";
import { CommandPalette } from "./components/CommandPalette";
import { TerminalDesk } from "./components/TerminalDesk";
import { WorkspaceRail, type WorkspaceRailWorkspace } from "./components/WorkspaceRail";
import {
  applyLayoutPreset,
  ensureTileLayouts,
  moveTileLayout,
  resizeTileLayout,
  type LayoutPreset,
  type TileLayout,
} from "./layout-state";
import {
  canRequestPlan,
  errored,
  idle,
  isThinking,
  thinking,
  type AlfredStatus,
  type SquadPlan,
} from "./alfred-state";
import {
  addManualSession,
  addStagedSessions,
  attachRuntimeSession,
  approveAllStaged,
  approveStaged,
  closeSession,
  createInitialSessions,
  hydrateStagedPlanSessions,
  hydrateLiveTerminalSessions,
  markSessionStartFailed,
  rejectAllStaged,
  rejectStaged,
  type SessionTile,
} from "./session-state";
import type { WorkMode } from "./terminal-desk-types";
import type { AlfredRuntimeStatus, AlfredStagedPlanSnapshot, AlfredStagedSession } from "../shared/alfred-ipc";
import type { TerminalCreateResult } from "../shared/terminal-ipc";
import "@xterm/xterm/css/xterm.css";

type Workspace = WorkspaceRailWorkspace;

const DEFAULT_WORKSPACE_ID = "A";
const DEFAULT_WORKSPACE: Workspace = { id: DEFAULT_WORKSPACE_ID, label: "Alfred", shortLabel: "A" };
const DEFAULT_WORKSPACES: Workspace[] = [DEFAULT_WORKSPACE];

export function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(DEFAULT_WORKSPACES);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(DEFAULT_WORKSPACE_ID);
  const [arrangeMode, setArrangeMode] = useState<boolean>(false);
  const [workModesByWorkspace, setWorkModesByWorkspace] = useState<Record<string, WorkMode>>({
    [DEFAULT_WORKSPACE_ID]: "desk",
  });
  const [tileLayoutsByWorkspace, setTileLayoutsByWorkspace] = useState<Record<string, Record<string, TileLayout>>>({});
  const [terminalSessions, setTerminalSessions] = useState<SessionTile[]>([]);
  const [alfredStatus, setAlfredStatus] = useState<AlfredStatus>(idle());
  const [pendingPlan, setPendingPlan] = useState<SquadPlan | null>(null);
  const [composerValue, setComposerValue] = useState<string>("");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [commandQuery, setCommandQuery] = useState<string>("");
  const [armedUnsafeSessionIds, setArmedUnsafeSessionIds] = useState<Set<string>>(() => new Set());
  const [runtimeStatus, setRuntimeStatus] = useState<AlfredRuntimeStatus | null>(null);
  const closingSessionIdsRef = useRef<Set<string>>(new Set());
  const startingSessionIdsRef = useRef<Set<string>>(new Set());
  const shortcutModifier = navigator.platform.includes("Mac") ? "Cmd" : "Ctrl";
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? DEFAULT_WORKSPACE;
  const activeWorkMode = workModesByWorkspace[activeWorkspace.id] ?? "desk";
  const activeSessions = terminalSessions.filter((session) => session.workspaceId === activeWorkspace.id);
  const activePendingPlan = pendingPlan?.workspaceId === activeWorkspace.id ? pendingPlan : null;
  const stagedCount = activeSessions.filter((s) => s.stage === "staged").length;
  const globalStagedCount = terminalSessions.filter((s) => s.stage === "staged").length;
  const unsafeStagedCount = activeSessions.filter((s) => s.stage === "staged" && s.safetyNote).length;
  const liveAlfredCount = activeSessions.filter((s) => s.stage === "live" && s.source === "alfred").length;
  const alfredExpanded = alfredStatus.kind !== "idle" || activePendingPlan !== null;
  const stagedWorkspaceLabel =
    pendingPlan && pendingPlan.workspaceId !== activeWorkspace.id
      ? workspaces.find((workspace) => workspace.id === pendingPlan.workspaceId)?.label ?? "another workspace"
      : undefined;
  const composerBlockedReason =
    globalStagedCount > 0
      ? stagedWorkspaceLabel
        ? `Review staged items in ${stagedWorkspaceLabel} workspace first.`
        : "Resolve the current Alfred plan before asking for another."
      : runtimeStatus && !runtimeStatus.openRouterConfigured
        ? "Set OPENROUTER_API_KEY in repo .env to use Alfred."
        : undefined;

  const handleAddManualSession = useCallback(() => {
    setTerminalSessions((sessions) => addManualSession(sessions, "", activeWorkspace.id));
  }, [activeWorkspace.id]);

  const handleAddWorkspace = useCallback(() => {
    setWorkspaces((current) => {
      const index = current.length + 1;
      const workspace: Workspace = {
        id: `W${index}`,
        label: `Workspace ${index}`,
        shortLabel: `W${index}`,
      };
      setActiveWorkspaceId(workspace.id);
      setTerminalSessions((sessions) => addManualSession(sessions, "", workspace.id));
      return [...current, workspace];
    });
  }, []);

  const handleToggleArrangeMode = useCallback(() => {
    setArrangeMode((enabled) => !enabled);
  }, []);

  const handleApplyLayoutPreset = useCallback((preset: LayoutPreset) => {
    const layoutApi = getDesktopLayoutApi();
    setTileLayoutsByWorkspace((current) => {
      const workspaceLayouts = applyLayoutPreset(activeSessions, preset);
      void layoutApi?.setWorkspaceLayout({ workspaceId: activeWorkspace.id, layouts: workspaceLayouts });
      return {
        ...current,
        [activeWorkspace.id]: workspaceLayouts,
      };
    });
  }, [activeSessions, activeWorkspace.id]);

  const handleApplyWorkMode = useCallback((mode: WorkMode) => {
    const preset: LayoutPreset = mode === "focus" ? "focus" : mode === "split" ? "two-up" : "grid";

    setWorkModesByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: mode,
    }));
    handleApplyLayoutPreset(preset);
  }, [activeWorkspace.id, handleApplyLayoutPreset]);

  const handleMoveTile = useCallback((tileId: string, deltaCol: number, deltaRow: number) => {
    const layoutApi = getDesktopLayoutApi();
    setTileLayoutsByWorkspace((current) => {
      const workspaceLayouts = moveTileLayout(
        ensureTileLayouts(activeSessions, current[activeWorkspace.id] ?? {}),
        tileId,
        deltaCol,
        deltaRow,
      );
      void layoutApi?.setWorkspaceLayout({ workspaceId: activeWorkspace.id, layouts: workspaceLayouts });
      return {
        ...current,
        [activeWorkspace.id]: workspaceLayouts,
      };
    });
  }, [activeSessions, activeWorkspace.id]);

  const handleResizeTile = useCallback((tileId: string, deltaColSpan: number, deltaRowSpan: number) => {
    const layoutApi = getDesktopLayoutApi();
    setTileLayoutsByWorkspace((current) => {
      const workspaceLayouts = resizeTileLayout(
        ensureTileLayouts(activeSessions, current[activeWorkspace.id] ?? {}),
        tileId,
        deltaColSpan,
        deltaRowSpan,
      );
      void layoutApi?.setWorkspaceLayout({ workspaceId: activeWorkspace.id, layouts: workspaceLayouts });
      return {
        ...current,
        [activeWorkspace.id]: workspaceLayouts,
      };
    });
  }, [activeSessions, activeWorkspace.id]);

  const refreshLiveSessions = useCallback(async () => {
    const terminalApi = getDesktopTerminalApi();
    if (!terminalApi) return;

    const terminalResult = await terminalApi.list();
    const liveSessions = hydrateLiveTerminalSessions(terminalResult.sessions).filter(
      (session) => !closingSessionIdsRef.current.has(session.id),
    );
    setWorkspaces((current) => ensureWorkspacesForSessions(current, liveSessions));
    setTerminalSessions((sessions) => mergeLiveSessions(sessions, liveSessions));
  }, []);

  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
    void refreshLiveSessions();
  }, [refreshLiveSessions]);

  const handleCloseSession = useCallback((sessionId: string) => {
    const terminalApi = getDesktopTerminalApi();
    closingSessionIdsRef.current.add(sessionId);

    setTerminalSessions((sessions) => {
      const session = sessions.find((item) => item.id === sessionId);
      if (session?.runtimeId) {
        terminalApi?.kill({ id: session.runtimeId });
        window.setTimeout(() => closingSessionIdsRef.current.delete(sessionId), 5_000);
      } else {
        closingSessionIdsRef.current.delete(sessionId);
      }
      return closeSession(sessions, sessionId);
    });
  }, []);

  const handleRuntimeSessionStarting = useCallback((tileId: string): boolean => {
    if (startingSessionIdsRef.current.has(tileId)) {
      return false;
    }

    startingSessionIdsRef.current.add(tileId);
    return true;
  }, []);

  const handleRuntimeSessionReady = useCallback((tileId: string, runtime: TerminalCreateResult) => {
    const terminalApi = getDesktopTerminalApi();
    const alfredApi = getDesktopAlfredApi();

    if (closingSessionIdsRef.current.has(tileId)) {
      terminalApi?.kill({ id: runtime.id });
      closingSessionIdsRef.current.delete(tileId);
      return;
    }

    startingSessionIdsRef.current.delete(tileId);
    setTerminalSessions((sessions) => attachRuntimeSession(sessions, tileId, runtime.id));
    if (runtime.source === "alfred") {
      void alfredApi?.resolveStagedPlan({ sessionIds: [tileId] });
      setPendingPlan((plan) => {
        if (!plan) return plan;
        const remaining = plan.sessionIds.filter((id) => id !== tileId);
        return remaining.length === 0 ? null : { ...plan, sessionIds: remaining };
      });
    }
  }, []);

  const handleRuntimeSessionFailed = useCallback((tileId: string) => {
    startingSessionIdsRef.current.delete(tileId);
    setTerminalSessions((sessions) => markSessionStartFailed(sessions, tileId));
  }, []);

  const handleSubmitPrompt = useCallback(async () => {
    const prompt = composerValue.trim();
    if (!prompt) return;
    if (!canRequestPlan(alfredStatus, globalStagedCount)) return;
    const alfredApi = getDesktopAlfredApi();
    if (!alfredApi) {
      setAlfredStatus(errored({ code: "network", message: "Alfred runtime is unavailable. Open the desktop app." }));
      return;
    }
    setAlfredStatus(thinking());
    const response = await alfredApi.requestPlan({ prompt });
    if (!response.ok) {
      setAlfredStatus(errored(response.error));
      return;
    }
    setAlfredStatus(idle());
    setComposerValue("");
    setTerminalSessions((sessions) => {
      const before = sessions;
      const after = addStagedSessions(before, response.plan.sessions, "", activeWorkspace.id);
      const stagedPlan = createStagedPlanSnapshot({
        ...(response.plan.name === undefined ? {} : { name: response.plan.name }),
        prompt,
        sessions: after.slice(before.length),
      });
      setPendingPlan(
        stagedPlan
          ? {
              id: stagedPlan.id,
              ...(stagedPlan.name === undefined ? {} : { name: stagedPlan.name }),
              prompt: stagedPlan.prompt,
              sessionIds: stagedPlan.sessions.map((session) => session.id),
              workspaceId: activeWorkspace.id,
            }
          : null,
      );
      if (stagedPlan) {
        void alfredApi.setStagedPlan(stagedPlan);
      } else {
        void alfredApi.clearStagedPlan();
      }
      return after;
    });
  }, [activeWorkspace.id, alfredStatus, composerValue, globalStagedCount]);

  const handleApproveTile = useCallback((tileId: string) => {
    const tile = terminalSessions.find((session) => session.id === tileId);
    if (tile?.safetyNote && !armedUnsafeSessionIds.has(tileId)) {
      setArmedUnsafeSessionIds((ids) => new Set(ids).add(tileId));
      return;
    }

    setArmedUnsafeSessionIds((ids) => {
      if (!ids.has(tileId)) return ids;
      const next = new Set(ids);
      next.delete(tileId);
      return next;
    });
    setTerminalSessions((sessions) => approveStaged(sessions, tileId));
  }, [armedUnsafeSessionIds, terminalSessions]);

  const handleRejectTile = useCallback((tileId: string) => {
    const alfredApi = getDesktopAlfredApi();
    setArmedUnsafeSessionIds((ids) => {
      if (!ids.has(tileId)) return ids;
      const next = new Set(ids);
      next.delete(tileId);
      return next;
    });
    setTerminalSessions((sessions) => rejectStaged(sessions, tileId));
    setPendingPlan((plan) => {
      if (!plan) return plan;
      const remaining = plan.sessionIds.filter((id) => id !== tileId);
      void alfredApi?.resolveStagedPlan({ sessionIds: [tileId] });
      return remaining.length === 0 ? null : { ...plan, sessionIds: remaining };
    });
  }, []);

  const handleApproveAll = useCallback(() => {
    setArmedUnsafeSessionIds(new Set());
    setTerminalSessions((sessions) => approveAllStaged(sessions, activeWorkspace.id));
  }, [activeWorkspace.id]);

  const handleRejectAll = useCallback(() => {
    const alfredApi = getDesktopAlfredApi();
    setArmedUnsafeSessionIds(new Set());
    setTerminalSessions((sessions) => rejectAllStaged(sessions, activeWorkspace.id));
    setPendingPlan(null);
    void alfredApi?.clearStagedPlan();
  }, [activeWorkspace.id]);

  const handleDismissError = useCallback(() => {
    setAlfredStatus(idle());
  }, []);

  const handleOpenCommandPalette = useCallback(() => {
    setCommandQuery("");
    setCommandPaletteOpen(true);
  }, []);

  const handleCloseCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
    setCommandQuery("");
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) {
        const index = Number.parseInt(event.key, 10) - 1;
        const workspace = workspaces[index];
        if (workspace) {
          event.preventDefault();
          handleSelectWorkspace(workspace.id);
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandQuery("");
        setCommandPaletteOpen((open) => !open);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "t") {
        event.preventDefault();
        handleAddManualSession();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleAddManualSession, handleSelectWorkspace, workspaces]);

  useEffect(() => {
    const terminalApi = getDesktopTerminalApi();
    const alfredApi = getDesktopAlfredApi();
    const layoutApi = getDesktopLayoutApi();
    let cancelled = false;

    if (!terminalApi) {
      setTerminalSessions(createInitialSessions(""));
      return;
    }

    Promise.all([
      terminalApi.list(),
      alfredApi?.getStagedPlan().catch(() => ({ plan: null })) ?? Promise.resolve({ plan: null }),
      alfredApi?.getRuntimeStatus().catch(() => null) ?? Promise.resolve(null),
      layoutApi?.getLayouts().catch(() => ({ layoutsByWorkspace: {} })) ?? Promise.resolve({ layoutsByWorkspace: {} }),
    ])
      .then(([terminalResult, stagedPlanResult, runtimeStatusResult, layoutResult]) => {
        if (cancelled) return;
        setRuntimeStatus(runtimeStatusResult);
        setTileLayoutsByWorkspace(layoutResult.layoutsByWorkspace);
        const liveSessions =
          terminalResult.sessions.length > 0
            ? hydrateLiveTerminalSessions(terminalResult.sessions)
            : createInitialSessions("");
        const liveClientIds = new Set(
          terminalResult.sessions.map((session) => session.clientId).filter((id): id is string => Boolean(id)),
        );
        const stagedSessions = hydrateStagedPlanSessions(stagedPlanResult.plan, "").filter(
          (session) => !liveClientIds.has(session.id),
        );
        const alreadyLiveStagedIds =
          stagedPlanResult.plan?.sessions
            .map((session) => session.id)
            .filter((id) => liveClientIds.has(id)) ?? [];
        if (alreadyLiveStagedIds.length > 0) {
          void alfredApi?.resolveStagedPlan({ sessionIds: alreadyLiveStagedIds });
        }
        const hydratedSessions = [...liveSessions, ...stagedSessions];
        setWorkspaces((current) => ensureWorkspacesForSessions(current, hydratedSessions));
        setTerminalSessions(hydratedSessions);
        setPendingPlan(toSquadPlan({ plan: stagedPlanResult.plan, omittedSessionIds: alreadyLiveStagedIds }));
      })
      .catch(() => {
        if (!cancelled) setTerminalSessions(createInitialSessions(""));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="agent-space-shell">
      <section
        className={`desktop-frame ${shortcutModifier === "Cmd" ? "mac-frame" : ""}`}
        aria-label="Alfred Agent Space desktop shell"
      >
        <div className="mission-bar">
          <div className="mission-name">
            <AlfredMark label={activeWorkspace.shortLabel} />
            <div>
              <strong>{activeWorkspace.label} workspace</strong>
              <span>{activeSessions.length} tile{activeSessions.length === 1 ? "" : "s"} · local desk</span>
            </div>
          </div>
          <div className="mission-actions" aria-label="terminal actions">
            <button
              className={`arrange-button ${arrangeMode ? "active" : ""}`}
              type="button"
              aria-pressed={arrangeMode}
              onClick={handleToggleArrangeMode}
              title="Arrange layout"
            >
              Arrange
            </button>
            <button
              className="command-palette-button"
              type="button"
              aria-label="Open command palette"
              onClick={handleOpenCommandPalette}
              title="Command palette"
            >
              <Command size={15} />
              <span>{shortcutModifier} K</span>
            </button>
            <button
              className="new-terminal-button"
              type="button"
              aria-label="New terminal"
              onClick={handleAddManualSession}
              title="New terminal"
            >
              <Plus size={17} />
              <span>New terminal</span>
            </button>
          </div>
        </div>

        <div className={`workspace-layout ${alfredExpanded ? "alfred-expanded" : "alfred-compact"}`}>
          <WorkspaceRail
            activeWorkspaceId={activeWorkspace.id}
            sessions={terminalSessions}
            workspaces={workspaces}
            onAddWorkspace={handleAddWorkspace}
            onSelectWorkspace={handleSelectWorkspace}
          />
          <TerminalDesk
            arrangeMode={arrangeMode}
            armedUnsafeSessionIds={armedUnsafeSessionIds}
            layouts={ensureTileLayouts(activeSessions, tileLayoutsByWorkspace[activeWorkspace.id] ?? {})}
            pendingPlan={activePendingPlan}
            sessions={activeSessions}
            shortcutModifier={shortcutModifier}
            safeStagedCount={Math.max(0, stagedCount - unsafeStagedCount)}
            unsafeStagedCount={unsafeStagedCount}
            workMode={activeWorkMode}
            onCloseSession={handleCloseSession}
            onApplyLayoutPreset={handleApplyLayoutPreset}
            onApplyWorkMode={handleApplyWorkMode}
            onApproveAll={handleApproveAll}
            onMoveTile={handleMoveTile}
            onRejectAll={handleRejectAll}
            onRuntimeSessionFailed={handleRuntimeSessionFailed}
            onRuntimeSessionReady={handleRuntimeSessionReady}
            onRuntimeSessionStarting={handleRuntimeSessionStarting}
            onApproveTile={handleApproveTile}
            onRejectTile={handleRejectTile}
            onResizeTile={handleResizeTile}
          />
          <AlfredControlRail
            status={alfredStatus}
            pendingPlan={activePendingPlan}
            stagedCount={stagedCount}
            unsafeStagedCount={unsafeStagedCount}
            liveAlfredCount={liveAlfredCount}
            onDismissError={handleDismissError}
          />
        </div>
        <ComposerBar
          blockedReason={composerBlockedReason}
          value={composerValue}
          thinking={isThinking(alfredStatus)}
          workspaceName={activeWorkspace.label === "Alfred" ? "this workspace" : activeWorkspace.label}
          onChange={setComposerValue}
          onSubmit={handleSubmitPrompt}
        />
        {commandPaletteOpen && (
          <CommandPalette
            activeWorkMode={activeWorkMode}
            arrangeMode={arrangeMode}
            pendingPlan={activePendingPlan}
            query={commandQuery}
            safeStagedCount={Math.max(0, stagedCount - unsafeStagedCount)}
            shortcutModifier={shortcutModifier}
            unsafeStagedCount={unsafeStagedCount}
            onAddManualSession={handleAddManualSession}
            onApplyWorkMode={handleApplyWorkMode}
            onApproveAll={handleApproveAll}
            onChangeQuery={setCommandQuery}
            onClose={handleCloseCommandPalette}
            onRejectAll={handleRejectAll}
            onToggleArrange={handleToggleArrangeMode}
          />
        )}
      </section>
    </main>
  );
}

function createStagedPlanSnapshot({
  name,
  prompt,
  sessions,
}: {
  name?: string;
  prompt: string;
  sessions: SessionTile[];
}): AlfredStagedPlanSnapshot | null {
  if (sessions.length === 0) return null;
  const planSessions: AlfredStagedSession[] = sessions.map((session) => ({
    id: session.id,
    kind: session.agentKind ?? "shell",
    title: session.title,
    workspaceId: session.workspaceId,
    ...(session.cwd === "" ? {} : { cwd: session.cwd }),
    command: session.command ?? "",
    args: session.args ?? [],
    ...(session.safetyNote === undefined ? {} : { safetyNote: session.safetyNote }),
  }));

  return {
    id: crypto.randomUUID(),
    ...(name === undefined ? {} : { name }),
    prompt,
    sessions: planSessions,
  };
}

function toSquadPlan({
  defaultWorkspaceId = DEFAULT_WORKSPACE_ID,
  omittedSessionIds = [],
  plan,
}: {
  defaultWorkspaceId?: string;
  omittedSessionIds?: string[];
  plan: AlfredStagedPlanSnapshot | null;
}): SquadPlan | null {
  if (!plan || plan.sessions.length === 0) return null;
  const omitted = new Set(omittedSessionIds);
  const sessionIds = plan.sessions.map((session) => session.id).filter((id) => !omitted.has(id));
  if (sessionIds.length === 0) return null;
  return {
    id: plan.id,
    ...(plan.name === undefined ? {} : { name: plan.name }),
    prompt: plan.prompt,
    sessionIds,
    workspaceId: plan.sessions.find((session) => session.workspaceId)?.workspaceId ?? defaultWorkspaceId,
  };
}

function ensureWorkspacesForSessions(workspaces: Workspace[], sessions: SessionTile[]): Workspace[] {
  const existingIds = new Set(workspaces.map((workspace) => workspace.id));
  const additions: Workspace[] = [];

  for (const session of sessions) {
    if (existingIds.has(session.workspaceId)) continue;
    existingIds.add(session.workspaceId);
    additions.push({
      id: session.workspaceId,
      label: `Workspace ${session.workspaceId}`,
      shortLabel: session.workspaceId,
    });
  }

  return additions.length === 0 ? workspaces : [...workspaces, ...additions];
}

function mergeLiveSessions(sessions: SessionTile[], liveSessions: SessionTile[]): SessionTile[] {
  const liveById = new Map(liveSessions.map((session) => [session.id, session]));
  const existingIds = new Set(sessions.map((session) => session.id));
  const merged = sessions.map((session) => liveById.get(session.id) ?? session);
  const additions = liveSessions.filter((session) => !existingIds.has(session.id));

  return [...merged, ...additions];
}
