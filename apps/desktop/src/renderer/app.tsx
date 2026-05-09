import { ChevronDown, Command, FolderOpen, ListChecks, Plus, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { getDesktopAlfredApi, getDesktopLayoutApi, getDesktopTerminalApi, getDesktopWorkspaceApi } from "./desktop-api";
import { ComposerBar } from "./composer";
import { AlfredControlRail } from "./components/AlfredControlRail";
import { AlfredMark } from "./components/AlfredMark";
import { CommandPalette } from "./components/CommandPalette";
import { ReviewQueuePanel } from "./components/ReviewQueuePanel";
import { TerminalDesk } from "./components/TerminalDesk";
import { WorkspacePreviewPanel } from "./components/WorkspacePreviewPanel";
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
  isLaunchBlocked,
  recordSessionOutputActivity,
  rejectAllStaged,
  rejectStaged,
  relaunchRestoredSession,
  restartSession,
  type SessionTile,
} from "./session-state";
import { terminalSessionDisplayStatus } from "./session-status";
import { recordPreviewUrlsFromText, type PreviewUrlCandidate } from "./preview-state";
import type { WorkMode } from "./terminal-desk-types";
import { workspaceAttention, workspaceReviewQueue, type WorkspaceReviewItem } from "./workspace-attention";
import { workspaceSessionSummary } from "./workspace-session-summary";
import type {
  AgentKind,
  AlfredRuntimeStatus,
  AlfredStagedSessionPatch,
  AlfredStagedPlanSnapshot,
  AlfredStagedSession,
  AlfredWorkspaceContext,
} from "../shared/alfred-ipc";
import type { TerminalCreateResult } from "../shared/terminal-ipc";
import type { WorkspaceMissionBrief, WorkspaceStateSnapshot } from "../shared/workspace-ipc";
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
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState<boolean>(false);
  const [workspaceRenameDraft, setWorkspaceRenameDraft] = useState<string>("");
  const [workspaceRenameEditing, setWorkspaceRenameEditing] = useState<boolean>(false);
  const [reviewQueueOpen, setReviewQueueOpen] = useState<boolean>(false);
  const [armedUnsafeSessionIds, setArmedUnsafeSessionIds] = useState<Set<string>>(() => new Set());
  const [runtimeStatus, setRuntimeStatus] = useState<AlfredRuntimeStatus | null>(null);
  const [previewCandidates, setPreviewCandidates] = useState<PreviewUrlCandidate[]>([]);
  const [selectedPreviewUrlsByWorkspace, setSelectedPreviewUrlsByWorkspace] = useState<Record<string, string>>({});
  const [previewRefreshKeysByWorkspace, setPreviewRefreshKeysByWorkspace] = useState<Record<string, number>>({});
  const closingSessionIdsRef = useRef<Set<string>>(new Set());
  const startingSessionIdsRef = useRef<Set<string>>(new Set());
  const terminalSessionsRef = useRef<SessionTile[]>([]);
  const workspaceStateHydratedRef = useRef<boolean>(false);
  const shortcutModifier = navigator.platform.includes("Mac") ? "Cmd" : "Ctrl";
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? DEFAULT_WORKSPACE;
  const activeWorkMode = workModesByWorkspace[activeWorkspace.id] ?? "desk";
  const activeSessions = terminalSessions.filter((session) => session.workspaceId === activeWorkspace.id);
  const activePreviewCandidates = previewCandidates.filter((candidate) => candidate.workspaceId === activeWorkspace.id);
  const activeSelectedPreviewUrl =
    activePreviewCandidates.find((candidate) => candidate.url === selectedPreviewUrlsByWorkspace[activeWorkspace.id])
      ?.url ??
    activePreviewCandidates[0]?.url ??
    null;
  const activePreviewRefreshKey = previewRefreshKeysByWorkspace[activeWorkspace.id] ?? 0;
  const previewVisible = activePreviewCandidates.length > 0;
  const activeSelectedSessionId = selectedSessionIdsByWorkspace[activeWorkspace.id] ?? null;
  const activeSelectedSession =
    activeSessions.find((session) => session.id === activeSelectedSessionId) ?? activeSessions[0] ?? null;
  const activePendingPlan = pendingPlan?.workspaceId === activeWorkspace.id ? pendingPlan : null;
  const canCloseActiveWorkspace =
    activeWorkspace.id !== DEFAULT_WORKSPACE_ID && workspaces.length > 1 && activeSessions.length === 0;
  const activeRecoverableSessions = activeSessions.filter((session) =>
    session.runtimeStatus === "restored" || session.runtimeStatus === "exited" || session.runtimeStatus === "error",
  );
  const activeAttention = workspaceAttention(activeSessions);
  const globalReviewItems = workspaceReviewQueue(workspaces, terminalSessions);
  const activeWorkspaceReviewItems = globalReviewItems.filter((item) => item.workspaceId === activeWorkspace.id);
  const activeDecisionItems = activeWorkspaceReviewItems.filter(isDecisionReviewItem);
  const crossWorkspaceReviewItems = globalReviewItems.filter((item) => item.workspaceId !== activeWorkspace.id);
  const crossWorkspaceReviewPreview = crossWorkspaceReviewItems[0] ?? null;
  const activeStagedSessions = orderStagedSessions(activeSessions, activePendingPlan);
  const stagedCount = activeSessions.filter((s) => s.stage === "staged").length;
  const globalStagedCount = terminalSessions.filter((s) => s.stage === "staged").length;
  const checkingStagedCount = activeSessions.filter((s) => s.stage === "staged" && s.stagedReviewStatus === "checking").length;
  const blockedStagedCount = activeSessions.filter((s) => s.stage === "staged" && isLaunchBlocked(s)).length;
  const unsafeStagedCount = activeSessions.filter((s) => s.stage === "staged" && s.safetyNote && !isLaunchBlocked(s)).length;
  const safeStagedCount = Math.max(0, stagedCount - unsafeStagedCount - blockedStagedCount - checkingStagedCount);
  const liveAlfredCount = activeSessions.filter((s) => s.stage === "live" && s.source === "alfred").length;
  const alfredExpanded =
    alfredStatus.kind !== "idle" ||
    activePendingPlan !== null ||
    activeRecoverableSessions.length > 0 ||
    activeDecisionItems.length > 0;
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

  useEffect(() => {
    terminalSessionsRef.current = terminalSessions;
  }, [terminalSessions]);

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
    setSelectedPreviewUrlsByWorkspace((current) => omitWorkspaceRecord(current, activeWorkspace.id));
    setPreviewRefreshKeysByWorkspace((current) => omitWorkspaceRecord(current, activeWorkspace.id));
    setPreviewCandidates((current) => current.filter((candidate) => candidate.workspaceId !== activeWorkspace.id));
    void workspaceApi?.setWorkspaceState({
      workspaces: remainingWorkspaces,
      activeWorkspaceId: nextActiveWorkspaceId,
    });
  }, [activeWorkspace.id, canCloseActiveWorkspace, workspaces]);

  const handleToggleArrangeMode = useCallback(() => {
    setArrangeMode((enabled) => !enabled);
  }, []);

  const handleBeginRenameActiveWorkspace = useCallback(() => {
    setWorkspaceRenameDraft(activeWorkspace.label);
    setWorkspaceRenameEditing(true);
    setWorkspaceMenuOpen(true);
  }, [activeWorkspace.label]);

  const handleCancelWorkspaceRename = useCallback(() => {
    setWorkspaceRenameDraft(activeWorkspace.label);
    setWorkspaceRenameEditing(false);
  }, [activeWorkspace.label]);

  const handleSaveWorkspaceRename = useCallback((label: string) => {
    const nextLabel = label.trim();
    if (!nextLabel) return;
    setWorkspaceRenameEditing(false);
    setWorkspaceMenuOpen(false);
    if (nextLabel === activeWorkspace.label) return;

    const workspaceApi = getDesktopWorkspaceApi();
    setWorkspaces((current) => {
      const next = current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? { ...workspace, label: nextLabel, shortLabel: shortLabelForWorkspace(nextLabel) }
          : workspace,
      );
      void workspaceApi?.setWorkspaceState({ workspaces: next, activeWorkspaceId: activeWorkspace.id });
      return next;
    });
  }, [activeWorkspace.id, activeWorkspace.label]);

  const handleSaveWorkspaceMissionBrief = useCallback((missionBrief: WorkspaceMissionBrief | undefined) => {
    const workspaceApi = getDesktopWorkspaceApi();
    setWorkspaceMenuOpen(false);
    setWorkspaceRenameEditing(false);
    setWorkspaces((current) => {
      const next = current.map((workspace) => {
        if (workspace.id !== activeWorkspace.id) return workspace;
        const { missionBrief: _previousMissionBrief, ...rest } = workspace;
        return missionBrief ? { ...rest, missionBrief } : rest;
      });
      void workspaceApi?.setWorkspaceState({ workspaces: next, activeWorkspaceId: activeWorkspace.id });
      return next;
    });
  }, [activeWorkspace.id]);

  const handleRevealActiveWorkspace = useCallback(async () => {
    if (!activeWorkspace.rootPath) return;
    const result = await getDesktopWorkspaceApi()?.revealPath({ cwd: activeWorkspace.rootPath, path: "." });
    if (!result?.ok) {
      setAlfredStatus(errored({ code: "network", message: result?.error ?? "Workspace folder is unavailable." }));
    }
  }, [activeWorkspace.rootPath]);

  const handleOpenActiveWorkspaceTerminal = useCallback(async () => {
    if (!activeWorkspace.rootPath) return;
    const result = await getDesktopWorkspaceApi()?.openExternalTerminal({ cwd: activeWorkspace.rootPath });
    if (!result?.ok) {
      setAlfredStatus(errored({ code: "network", message: result?.error ?? "Workspace terminal is unavailable." }));
    }
  }, [activeWorkspace.rootPath]);

  const handleCopySessionCwd = useCallback((cwd: string) => {
    void navigator.clipboard?.writeText(cwd);
  }, []);

  const handleOpenSessionFolder = useCallback(async (cwd: string) => {
    const result = await getDesktopWorkspaceApi()?.revealPath({ cwd, path: "." });
    if (!result?.ok) {
      setAlfredStatus(errored({ code: "network", message: result?.error ?? "Session folder is unavailable." }));
    }
  }, []);

  const handleOpenSessionTerminal = useCallback(async (cwd: string) => {
    const result = await getDesktopWorkspaceApi()?.openExternalTerminal({ cwd });
    if (!result?.ok) {
      setAlfredStatus(errored({ code: "network", message: result?.error ?? "Session terminal is unavailable." }));
    }
  }, []);

  const handleSelectPreviewUrl = useCallback((url: string) => {
    setSelectedPreviewUrlsByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: url,
    }));
  }, [activeWorkspace.id]);

  const handleRefreshPreview = useCallback(() => {
    setPreviewRefreshKeysByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: (current[activeWorkspace.id] ?? 0) + 1,
    }));
  }, [activeWorkspace.id]);

  const handleCopyPreviewUrl = useCallback(async (url: string) => {
    await navigator.clipboard?.writeText(url);
  }, []);

  const handleOpenPreviewExternal = useCallback(async (url: string) => {
    const result = await getDesktopWorkspaceApi()?.openExternalUrl({ url });
    if (!result?.ok) {
      setAlfredStatus(errored({ code: "network", message: result?.error ?? "Preview URL is unavailable." }));
    }
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
  const handleReviewAttention = useCallback(() => {
    if (!activeAttention) return;
    handleFocusSession(activeAttention.session.id);
  }, [activeAttention, handleFocusSession]);

  const handleOpenReviewQueue = useCallback(() => {
    setReviewQueueOpen(true);
  }, []);

  const handleCloseReviewQueue = useCallback(() => {
    setReviewQueueOpen(false);
  }, []);

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

  const handleFocusSessionInWorkspace = useCallback((workspaceId: string, sessionId: string) => {
    const targetSessions = terminalSessions.filter((session) => session.workspaceId === workspaceId);
    if (!targetSessions.some((session) => session.id === sessionId)) return;

    const layoutApi = getDesktopLayoutApi();
    const workspaceLayouts = applyLayoutPreset(targetSessions, "focus", sessionId);

    setActiveWorkspaceId(workspaceId);
    setSelectedSessionIdsByWorkspace((current) => ({
      ...current,
      [workspaceId]: sessionId,
    }));
    setWorkModesByWorkspace((current) => ({
      ...current,
      [workspaceId]: "focus",
    }));
    setTileLayoutsByWorkspace((current) => ({
      ...current,
      [workspaceId]: workspaceLayouts,
    }));
    void layoutApi?.setWorkspaceViewState({
      workspaceId,
      viewState: { workMode: "focus", selectedSessionId: sessionId },
    });
    void layoutApi?.setWorkspaceLayout({ workspaceId, layouts: workspaceLayouts });
    void refreshLiveSessions();
  }, [refreshLiveSessions, terminalSessions]);

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
    setPreviewCandidates((candidates) => candidates.filter((candidate) => candidate.sessionId !== sessionId));

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
    const exitedSession = terminalSessionsRef.current.find((item) => item.runtimeId === runtimeId);
    if (exitedSession) {
      setPreviewCandidates((candidates) => candidates.filter((candidate) => candidate.sessionId !== exitedSession.id));
    }
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
    const session = terminalSessionsRef.current.find((item) => item.runtimeId === runtimeId);
    if (session) {
      setPreviewCandidates((candidates) =>
        recordPreviewUrlsFromText(candidates, {
          workspaceId: session.workspaceId,
          sessionId: session.id,
          sessionTitle: session.title,
          text: data,
        }),
      );
    }
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
    if (tile && isLaunchBlocked(tile)) {
      setTerminalSessions((sessions) =>
        appendSessionActivity(sessions, tileId, {
          kind: "warning",
          title: "Launch blocked",
          detail: tile.launchPreflight?.status === "blocked" ? tile.launchPreflight.reason : "Preflight failed.",
        }),
      );
      return;
    }
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

  const handleLaunchReviewQueueItem = useCallback((workspaceId: string, sessionId: string) => {
    handleApproveTile(sessionId);
    handleFocusSessionInWorkspace(workspaceId, sessionId);
  }, [handleApproveTile, handleFocusSessionInWorkspace]);

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

  const handleUpdateStagedSession = useCallback(async (sessionId: string, patch: AlfredStagedSessionPatch) => {
    const alfredApi = getDesktopAlfredApi();
    const planId = pendingPlan?.id;
    if (!alfredApi || !planId) {
      throw new Error("No staged plan is available to edit.");
    }

    setArmedUnsafeSessionIds((ids) => {
      if (!ids.has(sessionId)) return ids;
      const next = new Set(ids);
      next.delete(sessionId);
      return next;
    });
    setTerminalSessions((sessions) =>
      sessions.map((session) =>
        session.id === sessionId && session.stage === "staged"
          ? { ...session, stagedReviewStatus: "checking" }
          : session,
      ),
    );

    const response = await alfredApi.updateStagedSession({
      planId,
      sessionId,
      patch,
      workspace: workspacePlanContext(activeWorkspace, activeSessions),
    });

    if (!response.ok) {
      setTerminalSessions((sessions) =>
        appendSessionActivity(
          sessions.map((session) =>
            session.id === sessionId && session.stagedReviewStatus === "checking"
              ? withoutStagedReviewStatus(session)
              : session,
          ),
          sessionId,
          {
            kind: "warning",
            title: "Edit was not saved",
            detail: response.error.message,
          },
        ),
      );
      throw new Error(response.error.message);
    }

    setTerminalSessions((sessions) =>
      appendSessionActivity(
        replaceStagedSessionsFromPlan(sessions, response.plan, activeWorkspace.rootPath ?? "", activeWorkspace.id).map((session) =>
          session.id === sessionId ? { ...session, stagedReviewStatus: "edited" } : session,
        ),
        sessionId,
        {
          kind: "plan",
          title: "Staged command edited",
          detail: "Alfred rechecked the command before launch.",
        },
      ),
    );
    setPendingPlan(toSquadPlan({ plan: response.plan, defaultWorkspaceId: activeWorkspace.id }));
  }, [activeSessions, activeWorkspace, pendingPlan?.id]);

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
        setPreviewCandidates(previewCandidatesFromSessions(hydratedSessions));
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
            <WorkspaceTitleMenu
              detail={`${activeSessions.length} tile${activeSessions.length === 1 ? "" : "s"} · ${workspaceSessionSummary(activeSessions)} · ${workspaceDetail(activeWorkspace)}`}
              menuOpen={workspaceMenuOpen}
              missionBrief={activeWorkspace.missionBrief}
              renameDraft={workspaceRenameDraft}
              renameEditing={workspaceRenameEditing}
              rootPath={activeWorkspace.rootPath}
              workspaceLabel={activeWorkspace.label}
              onCancelRename={handleCancelWorkspaceRename}
              onChangeRenameDraft={setWorkspaceRenameDraft}
              onClose={() => {
                setWorkspaceMenuOpen(false);
                setWorkspaceRenameEditing(false);
              }}
              onOpenExternalTerminal={() => void handleOpenActiveWorkspaceTerminal()}
              onRevealFolder={() => void handleRevealActiveWorkspace()}
              onSaveMissionBrief={handleSaveWorkspaceMissionBrief}
              onSaveRename={handleSaveWorkspaceRename}
              onStartRename={handleBeginRenameActiveWorkspace}
              onToggleMenu={() => {
                setWorkspaceMenuOpen((open) => !open);
                setWorkspaceRenameEditing(false);
              }}
            />
          </div>
          <div className="mission-actions" aria-label="terminal actions">
            {crossWorkspaceReviewPreview && (
              <button
                className={`review-queue-button tone-${crossWorkspaceReviewPreview.status.kind}`}
                type="button"
                aria-label={`Open review queue, ${crossWorkspaceReviewItems.length} item${crossWorkspaceReviewItems.length === 1 ? "" : "s"}`}
                onClick={handleOpenReviewQueue}
                title={`${crossWorkspaceReviewPreview.workspaceLabel}: ${crossWorkspaceReviewPreview.session.title}`}
              >
                <ListChecks size={15} />
                <span>Review</span>
                <strong>{crossWorkspaceReviewItems.length}</strong>
              </button>
            )}
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

        <div
          className={`workspace-layout ${alfredExpanded ? "alfred-expanded" : "alfred-compact"} ${
            previewVisible ? "preview-visible" : ""
          }`}
        >
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
              recoverableSessions={activeRecoverableSessions}
              selectedSessionId={activeSelectedSessionId}
              sessions={activeSessions}
              shortcutModifier={shortcutModifier}
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
              onUpdateStagedSession={handleUpdateStagedSession}
            />
          </div>
          <div className="side-dock-stack">
            {previewVisible && (
              <WorkspacePreviewPanel
                candidates={activePreviewCandidates}
                refreshKey={activePreviewRefreshKey}
                selectedUrl={activeSelectedPreviewUrl}
                workspaceLabel={activeWorkspace.label}
                onCopyUrl={handleCopyPreviewUrl}
                onOpenExternal={handleOpenPreviewExternal}
                onRefresh={handleRefreshPreview}
                onSelectUrl={handleSelectPreviewUrl}
              />
            )}
            <AlfredControlRail
              armedUnsafeSessionIds={armedUnsafeSessionIds}
              status={alfredStatus}
              activeDecisionItems={activeDecisionItems}
              missionBrief={activeWorkspace.missionBrief}
              pendingPlan={activePendingPlan}
              recoverableSessions={activeRecoverableSessions}
              selectedSessionId={activeSelectedSessionId}
              stagedSessions={activeStagedSessions}
              stagedCount={stagedCount}
              blockedStagedCount={blockedStagedCount}
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
            allSessions={terminalSessions}
            pendingPlan={activePendingPlan}
            query={commandQuery}
            recoverableSessions={activeRecoverableSessions}
            reviewQueueCount={crossWorkspaceReviewItems.length}
            reviewQueuePreview={crossWorkspaceReviewPreview}
            attention={activeAttention}
            safeStagedCount={safeStagedCount}
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
            onCopySessionCwd={handleCopySessionCwd}
            onOpenWorkspaceFolder={() => void handleRevealActiveWorkspace()}
            onOpenWorkspaceTerminal={() => void handleOpenActiveWorkspaceTerminal()}
            onOpenSessionFolder={(cwd) => void handleOpenSessionFolder(cwd)}
            onOpenSessionTerminal={(cwd) => void handleOpenSessionTerminal(cwd)}
            onRenameWorkspace={handleBeginRenameActiveWorkspace}
            onFocusSessionInWorkspace={handleFocusSessionInWorkspace}
            onFocusNextSession={() => handleFocusSessionByDelta(1)}
            onFocusPreviousSession={() => handleFocusSessionByDelta(-1)}
            onOpenReviewQueue={handleOpenReviewQueue}
            onReviewAttention={handleReviewAttention}
            onRejectAll={handleRejectAll}
            onRestartSession={handleRestartSession}
            onSelectWorkspace={handleSelectWorkspace}
            onToggleArrange={handleToggleArrangeMode}
          />
        )}
        {reviewQueueOpen && (
          <ReviewQueuePanel
            armedUnsafeSessionIds={armedUnsafeSessionIds}
            items={crossWorkspaceReviewItems}
            selectedSessionId={activeSelectedSessionId}
            onApproveTile={handleApproveTile}
            onClose={handleCloseReviewQueue}
            onContinueRestoredSession={handleContinueRestoredSession}
            onFocusItem={handleFocusSessionInWorkspace}
            onLaunchItem={handleLaunchReviewQueueItem}
            onRestartSession={handleRestartSession}
          />
        )}
      </section>
    </main>
  );
}

function WorkspaceTitleMenu({
  detail,
  menuOpen,
  missionBrief,
  renameDraft,
  renameEditing,
  rootPath,
  workspaceLabel,
  onCancelRename,
  onChangeRenameDraft,
  onClose,
  onOpenExternalTerminal,
  onRevealFolder,
  onSaveMissionBrief,
  onSaveRename,
  onStartRename,
  onToggleMenu,
}: {
  detail: string;
  menuOpen: boolean;
  missionBrief: WorkspaceMissionBrief | undefined;
  renameDraft: string;
  renameEditing: boolean;
  rootPath?: string | undefined;
  workspaceLabel: string;
  onCancelRename: () => void;
  onChangeRenameDraft: (value: string) => void;
  onClose: () => void;
  onOpenExternalTerminal: () => void;
  onRevealFolder: () => void;
  onSaveMissionBrief: (missionBrief: WorkspaceMissionBrief | undefined) => void;
  onSaveRename: (value: string) => void;
  onStartRename: () => void;
  onToggleMenu: () => void;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const missionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [missionEditing, setMissionEditing] = useState<boolean>(false);
  const [missionDraft, setMissionDraft] = useState<WorkspaceMissionDraft>(() => missionBriefToDraft(missionBrief));
  const revealLabel = navigator.platform.includes("Mac") ? "Reveal in Finder" : "Reveal folder";
  const terminalLabel = navigator.platform.includes("Mac") ? "Open in Ghostty" : "Open in external terminal";
  const popoverLabel = renameEditing
    ? "Rename workspace"
    : missionEditing
      ? "Workspace mission brief"
      : "Workspace actions";
  const missionActionLabel = missionBrief ? "Edit mission brief..." : "Add mission brief...";
  const missionSummary = missionBrief?.goal || missionBrief?.doneWhen[0] || "Give Alfred persistent context";

  useEffect(() => {
    if (!renameEditing) return;
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [renameEditing]);

  useEffect(() => {
    if (!missionEditing) return;
    window.requestAnimationFrame(() => {
      missionInputRef.current?.focus();
      missionInputRef.current?.select();
    });
  }, [missionEditing]);

  useEffect(() => {
    if (menuOpen) return;
    setMissionEditing(false);
  }, [menuOpen]);

  useEffect(() => {
    if (missionEditing) return;
    setMissionDraft(missionBriefToDraft(missionBrief));
  }, [missionBrief, missionEditing]);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && surfaceRef.current?.contains(target)) return;
      onClose();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [menuOpen, onClose]);

  const handleRenameSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSaveRename(renameDraft);
  };

  const handleMissionSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSaveMissionBrief(missionBriefFromDraft(missionDraft));
    setMissionEditing(false);
  };

  const handleCancelMissionEdit = () => {
    setMissionDraft(missionBriefToDraft(missionBrief));
    setMissionEditing(false);
  };

  return (
    <div
      className="workspace-title-menu"
      ref={surfaceRef}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        if (renameEditing) {
          onCancelRename();
        } else if (missionEditing) {
          handleCancelMissionEdit();
        } else {
          onClose();
        }
      }}
    >
      <button
        type="button"
        className="workspace-title-trigger"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-label={`Workspace menu for ${workspaceLabel}`}
        onClick={onToggleMenu}
      >
        <span>
          <strong>{workspaceLabel} workspace</strong>
          <small>{detail}</small>
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {menuOpen && (
        <div className="workspace-popover" role="dialog" aria-label={popoverLabel}>
          {renameEditing ? (
            <form className="workspace-rename-form" onSubmit={handleRenameSubmit}>
              <label>
                <span>Workspace name</span>
                <input
                  ref={inputRef}
                  value={renameDraft}
                  onChange={(event) => onChangeRenameDraft(event.target.value)}
                />
              </label>
              <div>
                <button type="submit" disabled={!renameDraft.trim()}>
                  Save
                </button>
                <button type="button" onClick={onCancelRename}>
                  Cancel
                </button>
              </div>
            </form>
          ) : missionEditing ? (
            <form className="workspace-mission-form" onSubmit={handleMissionSubmit}>
              <label>
                <span>Mission goal</span>
                <textarea
                  aria-label="Mission goal"
                  ref={missionInputRef}
                  rows={3}
                  value={missionDraft.goal}
                  onChange={(event) => setMissionDraft((draft) => ({ ...draft, goal: event.target.value }))}
                />
              </label>
              <label>
                <span>Done when</span>
                <textarea
                  aria-label="Done when"
                  rows={3}
                  value={missionDraft.doneWhen}
                  placeholder="One condition per line"
                  onChange={(event) => setMissionDraft((draft) => ({ ...draft, doneWhen: event.target.value }))}
                />
              </label>
              <label>
                <span>Guardrails</span>
                <textarea
                  aria-label="Guardrails"
                  rows={3}
                  value={missionDraft.guardrails}
                  placeholder="Constraints Alfred should respect"
                  onChange={(event) => setMissionDraft((draft) => ({ ...draft, guardrails: event.target.value }))}
                />
              </label>
              <div className="workspace-mission-actions">
                <button type="submit" disabled={!hasMissionDraft(missionDraft)}>
                  Save
                </button>
                <button type="button" onClick={handleCancelMissionEdit}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    onSaveMissionBrief(undefined);
                    setMissionDraft(missionBriefToDraft(undefined));
                    setMissionEditing(false);
                  }}
                >
                  Clear
                </button>
              </div>
            </form>
          ) : (
            <>
              <button
                type="button"
                disabled={!rootPath}
                onClick={() => {
                  onOpenExternalTerminal();
                  onClose();
                }}
              >
                <SquareTerminal size={14} />
                <span>
                  <strong>{terminalLabel}</strong>
                  <small>{rootPath ? shortenPath(rootPath) : "No folder bound"}</small>
                </span>
              </button>
              <button
                type="button"
                disabled={!rootPath}
                onClick={() => {
                  onRevealFolder();
                  onClose();
                }}
              >
                <FolderOpen size={14} />
                <span>
                  <strong>{revealLabel}</strong>
                  <small>{rootPath ? shortenPath(rootPath) : "No folder bound"}</small>
                </span>
              </button>
              <hr />
              <button type="button" onClick={onStartRename}>
                <span>
                  <strong>Rename workspace...</strong>
                  <small>Keep this desk readable</small>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMissionDraft(missionBriefToDraft(missionBrief));
                  setMissionEditing(true);
                }}
              >
                <ListChecks size={14} />
                <span>
                  <strong>{missionActionLabel}</strong>
                  <small>{truncateText(missionSummary, 38)}</small>
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type WorkspaceMissionDraft = {
  goal: string;
  doneWhen: string;
  guardrails: string;
};

function missionBriefToDraft(brief: WorkspaceMissionBrief | undefined): WorkspaceMissionDraft {
  return {
    goal: brief?.goal ?? "",
    doneWhen: brief?.doneWhen.join("\n") ?? "",
    guardrails: brief?.guardrails.join("\n") ?? "",
  };
}

function missionBriefFromDraft(draft: WorkspaceMissionDraft): WorkspaceMissionBrief | undefined {
  const goal = normalizeMissionDraftLine(draft.goal, 320);
  const doneWhen = normalizeMissionDraftList(draft.doneWhen);
  const guardrails = normalizeMissionDraftList(draft.guardrails);
  if (!goal) return undefined;
  return { goal, doneWhen, guardrails };
}

function hasMissionDraft(draft: WorkspaceMissionDraft): boolean {
  return missionBriefFromDraft(draft) !== undefined;
}

function normalizeMissionDraftList(value: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const normalized = normalizeMissionDraftLine(line, 240);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
    if (items.length >= 8) break;
  }
  return items;
}

function normalizeMissionDraftLine(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
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
    ...(session.launchPreflight === undefined ? {} : { launchPreflight: { ...session.launchPreflight } }),
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

function replaceStagedSessionsFromPlan(
  sessions: SessionTile[],
  plan: AlfredStagedPlanSnapshot,
  defaultCwd: string,
  defaultWorkspaceId: string,
): SessionTile[] {
  const replacements = hydrateStagedPlanSessions(plan, defaultCwd, defaultWorkspaceId);
  const replacementsById = new Map(replacements.map((session) => [session.id, session]));
  const existingIds = new Set(sessions.map((session) => session.id));
  const replacedIds = new Set<string>();

  const nextSessions = sessions.map((session) => {
    const replacement = replacementsById.get(session.id);
    if (!replacement || session.stage !== "staged") return session;
    replacedIds.add(session.id);
    return replacement;
  });

  const additions = replacements.filter((session) => !replacedIds.has(session.id) && !existingIds.has(session.id));
  return additions.length === 0 ? nextSessions : [...nextSessions, ...additions];
}

function withoutStagedReviewStatus(session: SessionTile): SessionTile {
  const { stagedReviewStatus: _stagedReviewStatus, ...next } = session;
  return next;
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

function previewCandidatesFromSessions(sessions: SessionTile[]): PreviewUrlCandidate[] {
  return sessions.reduce<PreviewUrlCandidate[]>((candidates, session) => {
    if (!session.initialBuffer) return candidates;
    const seenAt = session.lastOutputAt ?? session.lastActivityAt ?? session.createdAt;

    return recordPreviewUrlsFromText(candidates, {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      sessionTitle: session.title,
      text: session.initialBuffer,
      ...(seenAt === undefined ? {} : { seenAt }),
    });
  }, []);
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
    ...(workspace.missionBrief === undefined ? {} : { missionBrief: workspace.missionBrief }),
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

function shortLabelForWorkspace(label: string): string {
  const words = label.trim().split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const letters = words.length > 1 ? words.map((word) => word[0]).join("") : label.slice(0, 3);
  return (letters || "W").slice(0, 3).toUpperCase();
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

function isDecisionReviewItem(item: WorkspaceReviewItem): boolean {
  return item.status.kind === "waiting" || item.status.kind === "blocked" || item.status.kind === "staged";
}
