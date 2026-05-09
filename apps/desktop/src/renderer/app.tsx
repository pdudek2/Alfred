import { Command, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDesktopAlfredApi, getDesktopLayoutApi, getDesktopTerminalApi, getDesktopWorkspaceApi } from "./desktop-api";
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
  addAgentSession,
  addManualSession,
  addStagedSessions,
  appendSessionActivity,
  attachRuntimeSession,
  approveAllStaged,
  approveStaged,
  closeSession,
  createInitialSessions,
  hydrateStagedPlanSessions,
  hydrateLiveTerminalSessions,
  hydratePersistedTerminalSessions,
  markSessionExited,
  markSessionStartFailed,
  recordSessionOutputActivity,
  rejectAllStaged,
  rejectStaged,
  relaunchRestoredSession,
  restartSession,
  type SessionTile,
} from "./session-state";
import { terminalSessionDisplayStatus } from "./session-status";
import type { WorkMode } from "./terminal-desk-types";
import { workspaceSessionSummary } from "./workspace-session-summary";
import type {
  AgentKind,
  AlfredRuntimeStatus,
  AlfredStagedPlanSnapshot,
  AlfredStagedSession,
  AlfredWorkspaceContext,
} from "../shared/alfred-ipc";
import type { TerminalCreateResult } from "../shared/terminal-ipc";
import type { WorkspaceStateSnapshot } from "../shared/workspace-ipc";
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
  const [selectedSessionIdsByWorkspace, setSelectedSessionIdsByWorkspace] = useState<Record<string, string>>({});
  const [alfredStatus, setAlfredStatus] = useState<AlfredStatus>(idle());
  const [pendingPlan, setPendingPlan] = useState<SquadPlan | null>(null);
  const [composerValue, setComposerValue] = useState<string>("");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [commandQuery, setCommandQuery] = useState<string>("");
  const [armedUnsafeSessionIds, setArmedUnsafeSessionIds] = useState<Set<string>>(() => new Set());
  const [runtimeStatus, setRuntimeStatus] = useState<AlfredRuntimeStatus | null>(null);
  const closingSessionIdsRef = useRef<Set<string>>(new Set());
  const startingSessionIdsRef = useRef<Set<string>>(new Set());
  const workspaceStateHydratedRef = useRef<boolean>(false);
  const shortcutModifier = navigator.platform.includes("Mac") ? "Cmd" : "Ctrl";
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? DEFAULT_WORKSPACE;
  const activeWorkMode = workModesByWorkspace[activeWorkspace.id] ?? "desk";
  const activeSessions = terminalSessions.filter((session) => session.workspaceId === activeWorkspace.id);
  const activeSelectedSessionId = selectedSessionIdsByWorkspace[activeWorkspace.id] ?? null;
  const activeSelectedSession =
    activeSessions.find((session) => session.id === activeSelectedSessionId) ?? activeSessions[0] ?? null;
  const activePendingPlan = pendingPlan?.workspaceId === activeWorkspace.id ? pendingPlan : null;
  const canCloseActiveWorkspace =
    activeWorkspace.id !== DEFAULT_WORKSPACE_ID && workspaces.length > 1 && activeSessions.length === 0;
  const activeRecoverableSessions = activeSessions.filter((session) =>
    session.runtimeStatus === "restored" || session.runtimeStatus === "exited" || session.runtimeStatus === "error",
  );
  const activeStagedSessions = orderStagedSessions(activeSessions, activePendingPlan);
  const stagedCount = activeSessions.filter((s) => s.stage === "staged").length;
  const globalStagedCount = terminalSessions.filter((s) => s.stage === "staged").length;
  const unsafeStagedCount = activeSessions.filter((s) => s.stage === "staged" && s.safetyNote).length;
  const liveAlfredCount = activeSessions.filter((s) => s.stage === "live" && s.source === "alfred").length;
  const alfredExpanded = alfredStatus.kind !== "idle" || activePendingPlan !== null || activeRecoverableSessions.length > 0;
  const stagedWorkspaceLabel =
    pendingPlan && pendingPlan.workspaceId !== activeWorkspace.id
      ? workspaces.find((workspace) => workspace.id === pendingPlan.workspaceId)?.label ?? "another workspace"
      : undefined;
  const stagedWorkspaceId =
    pendingPlan && pendingPlan.workspaceId !== activeWorkspace.id ? pendingPlan.workspaceId : null;
  const composerBlockedReason =
    globalStagedCount > 0
      ? stagedWorkspaceLabel
        ? `Review staged items in ${stagedWorkspaceLabel} workspace first.`
        : "Resolve the current Alfred plan before asking for another."
      : runtimeStatus && !runtimeStatus.openRouterConfigured
        ? "Set OPENROUTER_API_KEY in repo .env to use Alfred."
        : undefined;

  const handleAddManualSession = useCallback(() => {
    setTerminalSessions((sessions) => addManualSession(sessions, activeWorkspace.rootPath ?? "", activeWorkspace.id));
  }, [activeWorkspace.id, activeWorkspace.rootPath]);

  const handleAddAgentSession = useCallback((kind: Extract<AgentKind, "claude" | "codex">) => {
    setTerminalSessions((sessions) =>
      addAgentSession(sessions, kind, activeWorkspace.rootPath ?? "", activeWorkspace.id),
    );
  }, [activeWorkspace.id, activeWorkspace.rootPath]);

  const handleAddWorkspace = useCallback(async () => {
    const workspaceApi = getDesktopWorkspaceApi();
    if (workspaceApi) {
      const previousWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
      const snapshot = await workspaceApi.createWorkspaceFromFolder();
      const workspace = snapshot.workspaces.find((item) => item.id === snapshot.activeWorkspaceId);

      setWorkspaces(snapshot.workspaces);
      setActiveWorkspaceId(snapshot.activeWorkspaceId);
      if (workspace && !previousWorkspaceIds.has(workspace.id)) {
        setTerminalSessions((sessions) => addManualSession(sessions, workspace.rootPath ?? "", workspace.id));
      }
      return;
    }

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
  }, [workspaces]);

  const handleCloseActiveWorkspace = useCallback(() => {
    if (!canCloseActiveWorkspace) return;

    const remainingWorkspaces = workspaces.filter((workspace) => workspace.id !== activeWorkspace.id);
    const nextActiveWorkspaceId =
      remainingWorkspaces.find((workspace) => workspace.id === DEFAULT_WORKSPACE_ID)?.id ??
      remainingWorkspaces[0]?.id ??
      DEFAULT_WORKSPACE_ID;
    const workspaceApi = getDesktopWorkspaceApi();

    setWorkspaces(remainingWorkspaces);
    setActiveWorkspaceId(nextActiveWorkspaceId);
    setTileLayoutsByWorkspace((current) => omitWorkspaceRecord(current, activeWorkspace.id));
    setWorkModesByWorkspace((current) => omitWorkspaceRecord(current, activeWorkspace.id));
    setSelectedSessionIdsByWorkspace((current) => omitWorkspaceRecord(current, activeWorkspace.id));
    void workspaceApi?.setWorkspaceState({
      workspaces: remainingWorkspaces,
      activeWorkspaceId: nextActiveWorkspaceId,
    });
  }, [activeWorkspace.id, canCloseActiveWorkspace, workspaces]);

  const handleToggleArrangeMode = useCallback(() => {
    setArrangeMode((enabled) => !enabled);
  }, []);

  const handleApplyLayoutPreset = useCallback((preset: LayoutPreset, selectedSessionId = activeSelectedSessionId) => {
    const layoutApi = getDesktopLayoutApi();
    setTileLayoutsByWorkspace((current) => {
      const workspaceLayouts = applyLayoutPreset(activeSessions, preset, selectedSessionId);
      void layoutApi?.setWorkspaceLayout({ workspaceId: activeWorkspace.id, layouts: workspaceLayouts });
      return {
        ...current,
        [activeWorkspace.id]: workspaceLayouts,
      };
    });
  }, [activeSessions, activeWorkspace.id]);

  const handleApplyWorkMode = useCallback((mode: WorkMode, selectedSessionId = activeSelectedSessionId) => {
    const preset: LayoutPreset = mode === "focus" ? "focus" : mode === "split" ? "two-up" : "grid";
    const layoutApi = getDesktopLayoutApi();

    setWorkModesByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: mode,
    }));
    void layoutApi?.setWorkspaceViewState({
      workspaceId: activeWorkspace.id,
      viewState: {
        workMode: mode,
        ...(selectedSessionId === null ? {} : { selectedSessionId }),
      },
    });
    handleApplyLayoutPreset(preset, selectedSessionId);
  }, [activeSelectedSessionId, activeWorkspace.id, handleApplyLayoutPreset]);

  const handleSelectSession = useCallback((sessionId: string) => {
    const layoutApi = getDesktopLayoutApi();
    setSelectedSessionIdsByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: sessionId,
    }));
    void layoutApi?.setWorkspaceViewState({
      workspaceId: activeWorkspace.id,
      viewState: { workMode: activeWorkMode, selectedSessionId: sessionId },
    });
  }, [activeWorkMode, activeWorkspace.id]);

  const handleFocusSession = useCallback((sessionId: string) => {
    setSelectedSessionIdsByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: sessionId,
    }));
    handleApplyWorkMode("focus", sessionId);
  }, [activeWorkspace.id, handleApplyWorkMode]);

  const handleFocusSessionByDelta = useCallback((delta: number) => {
    if (activeSessions.length === 0) return;
    const currentIndex = Math.max(
      0,
      activeSessions.findIndex((session) => session.id === activeSelectedSessionId),
    );
    const nextIndex = (currentIndex + delta + activeSessions.length) % activeSessions.length;
    const nextSession = activeSessions[nextIndex];
    if (nextSession) {
      handleFocusSession(nextSession.id);
    }
  }, [activeSelectedSessionId, activeSessions, handleFocusSession]);

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

  useEffect(() => {
    setSelectedSessionIdsByWorkspace((current) => {
      const currentId = current[activeWorkspace.id];
      if (activeSessions.length === 0) {
        if (!currentId) return current;
        const next = { ...current };
        delete next[activeWorkspace.id];
        return next;
      }
      if (currentId && activeSessions.some((session) => session.id === currentId)) {
        return current;
      }
      return {
        ...current,
        [activeWorkspace.id]: activeSessions[0]?.id ?? "",
      };
    });
  }, [activeSessions, activeWorkspace.id]);

  const handleCloseSession = useCallback((sessionId: string) => {
    const terminalApi = getDesktopTerminalApi();
    closingSessionIdsRef.current.add(sessionId);

    setTerminalSessions((sessions) => {
      const session = sessions.find((item) => item.id === sessionId);
      if (session?.runtimeStatus === "restored" || session?.runtimeStatus === "exited" || session?.runtimeStatus === "error") {
        terminalApi?.forget({ clientId: session.id });
        if (session.runtimeId) {
          terminalApi?.kill({ id: session.runtimeId });
        }
        closingSessionIdsRef.current.delete(sessionId);
      } else if (session?.runtimeId) {
        terminalApi?.kill({ id: session.runtimeId });
        window.setTimeout(() => closingSessionIdsRef.current.delete(sessionId), 5_000);
      } else {
        closingSessionIdsRef.current.delete(sessionId);
      }
      return closeSession(sessions, sessionId);
    });
  }, []);

  const handleContinueRestoredSession = useCallback((sessionId: string) => {
    setTerminalSessions((sessions) => {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session || session.runtimeStatus !== "restored") return sessions;
      return appendSessionActivity(relaunchRestoredSession(sessions, sessionId), sessionId, {
        kind: "lifecycle",
        title: "Relaunching session",
        detail: "Alfred is starting a fresh process from this saved transcript.",
      });
    });
  }, []);

  const handleRestartSession = useCallback((sessionId: string) => {
    setTerminalSessions((sessions) => {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session || (session.runtimeStatus !== "exited" && session.runtimeStatus !== "error")) return sessions;
      return appendSessionActivity(restartSession(sessions, sessionId), sessionId, {
        kind: "lifecycle",
        title: "Restarting session",
        detail: "Alfred is starting a fresh process in this tile.",
      });
    });
  }, []);

  const handleCloseSelectedSession = useCallback(() => {
    if (!activeSelectedSession) return;
    handleCloseSession(activeSelectedSession.id);
  }, [activeSelectedSession, handleCloseSession]);

  const handleCloseRecoverableSessions = useCallback(() => {
    for (const session of activeRecoverableSessions) {
      handleCloseSession(session.id);
    }
  }, [activeRecoverableSessions, handleCloseSession]);

  const handleContinueRecoverableSessions = useCallback(() => {
    for (const session of activeRecoverableSessions) {
      if (session.runtimeStatus === "restored") {
        handleContinueRestoredSession(session.id);
      } else if (session.runtimeStatus === "exited" || session.runtimeStatus === "error") {
        handleRestartSession(session.id);
      }
    }
  }, [activeRecoverableSessions, handleContinueRestoredSession, handleRestartSession]);

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
    setTerminalSessions((sessions) =>
      appendSessionActivity(attachRuntimeSession(sessions, tileId, runtime), tileId, {
        kind: "lifecycle",
        title: "Session attached",
        detail: `${runtime.shell} is running in ${runtime.cwd || "the workspace"}.`,
      }),
    );
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
    setTerminalSessions((sessions) =>
      appendSessionActivity(markSessionStartFailed(sessions, tileId), tileId, {
        kind: "error",
        title: "Start failed",
        detail: "The runtime could not create this terminal.",
      }),
    );
  }, []);

  const handleRuntimeSessionExited = useCallback((runtimeId: TerminalCreateResult["id"]) => {
    setTerminalSessions((sessions) => {
      const session = sessions.find((item) => item.runtimeId === runtimeId);
      const next = markSessionExited(sessions, runtimeId);
      if (!session) return next;
      return appendSessionActivity(next, session.id, {
        kind: "lifecycle",
        title: "Process exited",
        detail: "The terminal process ended; scrollback remains available.",
      });
    });
  }, []);

  const handleRuntimeSessionOutput = useCallback((runtimeId: TerminalCreateResult["id"], data: string) => {
    setTerminalSessions((sessions) => recordSessionOutputActivity(sessions, runtimeId, data));
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
    const response = await alfredApi.requestPlan({
      prompt,
      workspace: workspacePlanContext(activeWorkspace, activeSessions),
    });
    if (!response.ok) {
      setAlfredStatus(errored(response.error));
      return;
    }
    setAlfredStatus(idle());
    setComposerValue("");
    setTerminalSessions((sessions) => {
      const before = sessions;
      const after = addStagedSessions(before, response.plan.sessions, activeWorkspace.rootPath ?? "", activeWorkspace.id);
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
  }, [activeSessions, activeWorkspace, alfredStatus, composerValue, globalStagedCount]);

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
    setTerminalSessions((sessions) =>
      appendSessionActivity(approveStaged(sessions, tileId), tileId, {
        kind: "approval",
        title: "Approved for launch",
        detail: "The staged command was released to the terminal runtime.",
      }),
    );
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
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "w") {
        event.preventDefault();
        handleCloseSelectedSession();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "BracketRight") {
        event.preventDefault();
        handleFocusSessionByDelta(1);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "BracketLeft") {
        event.preventDefault();
        handleFocusSessionByDelta(-1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleAddManualSession, handleCloseSelectedSession, handleFocusSessionByDelta, handleSelectWorkspace, workspaces]);

  useEffect(() => {
    const terminalApi = getDesktopTerminalApi();
    const alfredApi = getDesktopAlfredApi();
    const layoutApi = getDesktopLayoutApi();
    const workspaceApi = getDesktopWorkspaceApi();
    let cancelled = false;

    if (!terminalApi) {
      setTerminalSessions(createInitialSessions(""));
      return;
    }

    Promise.all([
      terminalApi.list(),
      alfredApi?.getStagedPlan().catch(() => ({ plan: null })) ?? Promise.resolve({ plan: null }),
      alfredApi?.getRuntimeStatus().catch(() => null) ?? Promise.resolve(null),
      layoutApi?.getLayouts().catch(() => ({ layoutsByWorkspace: {}, viewStateByWorkspace: {} })) ??
        Promise.resolve({ layoutsByWorkspace: {}, viewStateByWorkspace: {} }),
      workspaceApi?.getWorkspaceState().catch(() => null) ?? Promise.resolve(null),
    ])
      .then(([terminalResult, stagedPlanResult, runtimeStatusResult, layoutResult, workspaceStateResult]) => {
        if (cancelled) return;
        setRuntimeStatus(runtimeStatusResult);
        setTileLayoutsByWorkspace(layoutResult.layoutsByWorkspace);
        setWorkModesByWorkspace({
          [DEFAULT_WORKSPACE_ID]: "desk",
          ...Object.fromEntries(
            Object.entries(layoutResult.viewStateByWorkspace).flatMap(([workspaceId, viewState]) =>
              viewState.workMode ? [[workspaceId, viewState.workMode]] : [],
            ),
          ),
        });
        setSelectedSessionIdsByWorkspace(
          Object.fromEntries(
            Object.entries(layoutResult.viewStateByWorkspace).flatMap(([workspaceId, viewState]) =>
              viewState.selectedSessionId ? [[workspaceId, viewState.selectedSessionId]] : [],
            ),
          ),
        );
        if (workspaceStateResult) {
          setWorkspaces(workspaceStateResult.workspaces);
          setActiveWorkspaceId(workspaceStateResult.activeWorkspaceId);
        }
        const liveSessions = hydrateLiveTerminalSessions(terminalResult.sessions);
        const liveClientIds = new Set(
          terminalResult.sessions.map((session) => session.clientId).filter((id): id is string => Boolean(id)),
        );
        const restoredSessions = hydratePersistedTerminalSessions(terminalResult.restoredSessions ?? []).filter(
          (session) => !liveClientIds.has(session.id),
        );
        const stagedSessions = hydrateStagedPlanSessions(
          stagedPlanResult.plan,
          workspaceRootPath(workspaceStateResult, workspaceStateResult?.activeWorkspaceId ?? DEFAULT_WORKSPACE_ID),
        ).filter(
          (session) => !liveClientIds.has(session.id),
        );
        const alreadyLiveStagedIds =
          stagedPlanResult.plan?.sessions
            .map((session) => session.id)
            .filter((id) => liveClientIds.has(id)) ?? [];
        if (alreadyLiveStagedIds.length > 0) {
          void alfredApi?.resolveStagedPlan({ sessionIds: alreadyLiveStagedIds });
        }
        const hydratedSessions =
          liveSessions.length + restoredSessions.length + stagedSessions.length > 0
            ? [...liveSessions, ...restoredSessions, ...stagedSessions]
            : createInitialSessions(
                workspaceRootPath(workspaceStateResult, workspaceStateResult?.activeWorkspaceId ?? DEFAULT_WORKSPACE_ID),
                workspaceStateResult?.activeWorkspaceId ?? DEFAULT_WORKSPACE_ID,
              );
        setWorkspaces((current) =>
          ensureWorkspacesForSessions(workspaceStateResult?.workspaces ?? current, hydratedSessions),
        );
        setTerminalSessions(hydratedSessions);
        setPendingPlan(toSquadPlan({ plan: stagedPlanResult.plan, omittedSessionIds: alreadyLiveStagedIds }));
        workspaceStateHydratedRef.current = true;
      })
      .catch(() => {
        if (!cancelled) {
          setTerminalSessions(createInitialSessions(""));
          workspaceStateHydratedRef.current = true;
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!workspaceStateHydratedRef.current) return;
    const workspaceApi = getDesktopWorkspaceApi();
    if (!workspaceApi) return;

    const snapshot: WorkspaceStateSnapshot = {
      workspaces,
      activeWorkspaceId,
    };
    void workspaceApi.setWorkspaceState(snapshot);
  }, [activeWorkspaceId, workspaces]);

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
              <span>
                {activeSessions.length} tile{activeSessions.length === 1 ? "" : "s"} ·{" "}
                {workspaceSessionSummary(activeSessions)} ·{" "}
                {workspaceDetail(activeWorkspace)}
              </span>
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
            <div className="agent-launch-buttons" aria-label="agent launchers">
              <button
                className="agent-launch-button codex"
                type="button"
                aria-label="Start Codex"
                onClick={() => handleAddAgentSession("codex")}
                title="Start Codex in this workspace"
              >
                <span className="tool-dot codex" />
                <span>Codex</span>
              </button>
              <button
                className="agent-launch-button claude"
                type="button"
                aria-label="Start Claude"
                onClick={() => handleAddAgentSession("claude")}
                title="Start Claude in this workspace"
              >
                <span className="tool-dot claude" />
                <span>Claude</span>
              </button>
            </div>
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
          <div className="orchestrator-surface">
            <TerminalDesk
              arrangeMode={arrangeMode}
              armedUnsafeSessionIds={armedUnsafeSessionIds}
              layouts={ensureTileLayouts(activeSessions, tileLayoutsByWorkspace[activeWorkspace.id] ?? {})}
              pendingPlan={activePendingPlan}
              recoverableSessions={activeRecoverableSessions}
              selectedSessionId={activeSelectedSessionId}
              sessions={activeSessions}
              shortcutModifier={shortcutModifier}
              unsafeStagedCount={unsafeStagedCount}
              workMode={activeWorkMode}
              workspaceGitBranch={activeWorkspace.gitBranch}
              workspaceLabel={activeWorkspace.label}
              workspaceRootPath={activeWorkspace.rootPath}
              onAddAgentSession={handleAddAgentSession}
              onAddManualSession={handleAddManualSession}
              onCloseSession={handleCloseSession}
              onCloseRecoverableSessions={handleCloseRecoverableSessions}
              onContinueRestoredSession={handleContinueRestoredSession}
              onContinueRecoverableSessions={handleContinueRecoverableSessions}
              onRestartSession={handleRestartSession}
              onApplyLayoutPreset={handleApplyLayoutPreset}
              onApplyWorkMode={handleApplyWorkMode}
              onMoveTile={handleMoveTile}
              onRuntimeSessionFailed={handleRuntimeSessionFailed}
              onRuntimeSessionExited={handleRuntimeSessionExited}
              onRuntimeSessionOutput={handleRuntimeSessionOutput}
              onRuntimeSessionReady={handleRuntimeSessionReady}
              onRuntimeSessionStarting={handleRuntimeSessionStarting}
              onFocusSession={handleFocusSession}
              onSelectSession={handleSelectSession}
              onApproveTile={handleApproveTile}
              onRejectTile={handleRejectTile}
              onResizeTile={handleResizeTile}
            />
          </div>
          <AlfredControlRail
            armedUnsafeSessionIds={armedUnsafeSessionIds}
            status={alfredStatus}
            pendingPlan={activePendingPlan}
            recoverableSessions={activeRecoverableSessions}
            selectedSessionId={activeSelectedSessionId}
            stagedSessions={activeStagedSessions}
            stagedCount={stagedCount}
            unsafeStagedCount={unsafeStagedCount}
            liveAlfredCount={liveAlfredCount}
            onApproveAll={handleApproveAll}
            onApproveTile={handleApproveTile}
            onCloseRecoverableSessions={handleCloseRecoverableSessions}
            onCloseSession={handleCloseSession}
            onContinueRecoverableSessions={handleContinueRecoverableSessions}
            onContinueRestoredSession={handleContinueRestoredSession}
            onDismissError={handleDismissError}
            onFocusSession={handleFocusSession}
            onRejectAll={handleRejectAll}
            onRejectTile={handleRejectTile}
            onRestartSession={handleRestartSession}
          />
        </div>
        <ComposerBar
          blockedActionLabel={stagedWorkspaceId && stagedWorkspaceLabel ? `Open ${stagedWorkspaceLabel}` : undefined}
          blockedReason={composerBlockedReason}
          value={composerValue}
          thinking={isThinking(alfredStatus)}
          workspaceName={activeWorkspace.label === "Alfred" ? "this workspace" : activeWorkspace.label}
          onBlockedAction={stagedWorkspaceId ? () => handleSelectWorkspace(stagedWorkspaceId) : undefined}
          onChange={setComposerValue}
          onSubmit={handleSubmitPrompt}
        />
        {commandPaletteOpen && (
          <CommandPalette
            activeWorkspaceId={activeWorkspace.id}
            activeWorkMode={activeWorkMode}
            arrangeMode={arrangeMode}
            pendingPlan={activePendingPlan}
            query={commandQuery}
            recoverableSessions={activeRecoverableSessions}
            safeStagedCount={Math.max(0, stagedCount - unsafeStagedCount)}
            selectedSessionId={activeSelectedSessionId}
            sessions={activeSessions}
            shortcutModifier={shortcutModifier}
            unsafeStagedCount={unsafeStagedCount}
            workspaces={workspaces}
            canCloseWorkspace={canCloseActiveWorkspace}
            onAddAgentSession={handleAddAgentSession}
            onAddManualSession={handleAddManualSession}
            onAddWorkspace={handleAddWorkspace}
            onApplyWorkMode={handleApplyWorkMode}
            onApproveAll={handleApproveAll}
            onChangeQuery={setCommandQuery}
            onCloseRecoverableSessions={handleCloseRecoverableSessions}
            onClose={handleCloseCommandPalette}
            onCloseSession={handleCloseSession}
            onCloseWorkspace={handleCloseActiveWorkspace}
            onContinueRecoverableSessions={handleContinueRecoverableSessions}
            onFocusSession={handleFocusSession}
            onFocusNextSession={() => handleFocusSessionByDelta(1)}
            onFocusPreviousSession={() => handleFocusSessionByDelta(-1)}
            onRejectAll={handleRejectAll}
            onRestartSession={handleRestartSession}
            onSelectWorkspace={handleSelectWorkspace}
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

function workspaceRootPath(state: WorkspaceStateSnapshot | null, workspaceId: string): string {
  return state?.workspaces.find((workspace) => workspace.id === workspaceId)?.rootPath ?? "";
}

function omitWorkspaceRecord<T>(record: Record<string, T>, workspaceId: string): Record<string, T> {
  if (!(workspaceId in record)) return record;
  const next = { ...record };
  delete next[workspaceId];
  return next;
}

function workspacePlanContext(workspace: Workspace, sessions: SessionTile[]): AlfredWorkspaceContext {
  return {
    id: workspace.id,
    label: workspace.label,
    ...(workspace.rootPath === undefined ? {} : { rootPath: workspace.rootPath }),
    ...(workspace.gitBranch === undefined ? {} : { gitBranch: workspace.gitBranch }),
    ...(sessions.length === 0
      ? {}
      : {
          sessions: sessions.slice(0, 8).map((session) => {
            const command = [session.command, ...(session.args ?? [])].filter(Boolean).join(" ");
            return {
              title: session.title,
              kind: session.agentKind ?? "shell",
              status: terminalSessionDisplayStatus(session).label,
              ...(session.cwd ? { cwd: session.cwd } : {}),
              ...(command ? { command } : {}),
            };
          }),
        }),
  };
}

function shortenPath(value: string): string {
  const parts = value.split("/");
  if (parts.length <= 3) return value;
  return `…/${parts.slice(-2).join("/")}`;
}

function workspaceDetail(workspace: Workspace): string {
  const location = workspace.rootPath ? shortenPath(workspace.rootPath) : "local desk";
  return workspace.gitBranch ? `${location} · ${workspace.gitBranch}` : location;
}

function mergeLiveSessions(sessions: SessionTile[], liveSessions: SessionTile[]): SessionTile[] {
  const liveById = new Map(liveSessions.map((session) => [session.id, session]));
  const existingIds = new Set(sessions.map((session) => session.id));
  const merged = sessions.map((session) => liveById.get(session.id) ?? session);
  const additions = liveSessions.filter((session) => !existingIds.has(session.id));

  return [...merged, ...additions];
}

function orderStagedSessions(sessions: SessionTile[], plan: SquadPlan | null): SessionTile[] {
  const plannedOrder = new Map((plan?.sessionIds ?? []).map((id, index) => [id, index]));
  return sessions
    .filter((session) => session.stage === "staged")
    .sort((a, b) => {
      const safetyDelta = Number(Boolean(b.safetyNote)) - Number(Boolean(a.safetyNote));
      if (safetyDelta !== 0) return safetyDelta;
      return (plannedOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (plannedOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER);
    });
}
