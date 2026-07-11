import {
  ChevronDown,
  Eye,
  FolderOpen,
  ListChecks,
  Pencil,
  RefreshCcw,
  Search,
  ShieldCheck,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  getDesktopAlfredApi,
  getDesktopLayoutApi,
  getDesktopSessionIndexApi,
  getDesktopStateApi,
  getDesktopTerminalApi,
  getDesktopWorkspaceApi,
} from "./desktop-api";
import { ComposerBar } from "./composer";
import { AlfredMark } from "./components/AlfredMark";
import { CommandPalette } from "./components/CommandPalette";
import { ContextColumn } from "./components/ContextColumn";
import { ObservatorySurface } from "./components/ObservatorySurface";
import { PrimaryNavigationRail, type PrimarySurface } from "./components/PrimaryNavigationRail";
import { ReviewSurface } from "./components/ReviewSurface";
import { SessionObservatoryPanel } from "./components/SessionObservatoryPanel";
import { TerminalDesk, type WorktreeActionKind } from "./components/TerminalDesk";
import { WorkbenchHeader } from "./components/WorkbenchHeader";
import { WorkspaceRail, type WorkspaceRailWorkspace } from "./components/WorkspaceRail";
import { inboxNavigationSummary } from "./components/workspace-navigation-copy";
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
  markSessionUnavailable,
  isLaunchBlocked,
  recordSessionOutputActivity,
  rejectAllStaged,
  rejectStaged,
  relaunchRestoredSession,
  renameSession,
  restartSession,
  sessionInstanceKey,
  type SessionActivityEvent,
  type SessionTile,
} from "./session-state";
import { terminalSessionDisplayStatus } from "./session-status";
import { sessionTileKind, tileKindMeta } from "./tile-kind";
import { recordPreviewUrlsFromText, type PreviewUrlCandidate } from "./preview-state";
import type { WorkMode } from "./terminal-desk-types";
import { workspaceAttention, workspaceReviewQueue, type WorkspaceReviewItem } from "./workspace-attention";
import { shortenPath } from "./path-display";
import { findWorkspaceForCwd } from "./workspace-path-matching";
import { sessionRelaunchSafety } from "./relaunch-safety";
import { normalizeSessionTitle } from "../shared/session-title";
import { shortLabelForWorkspace } from "../shared/workspace-label";
import type {
  DesktopPrivacySettings,
  DesktopSaveStatus,
  DesktopStateClearSavedTerminalDataResult,
  DesktopStateRevealFileResult,
} from "../shared/desktop-state-ipc";
import type {
  AgentKind,
  AlfredRuntimeStatus,
  AlfredStagedSessionPatch,
  AlfredStagedPlanSnapshot,
  AlfredStagedSession,
  AlfredWorkspaceContext,
} from "../shared/alfred-ipc";
import type {
  TerminalCreateResult,
  TerminalSessionIsolation,
  TerminalSessionSnapshot,
} from "../shared/terminal-ipc";
import type { DispatchTargetSnapshot, WorkspaceViewState } from "../shared/layout-ipc";
import type { WorkspaceMissionBrief, WorkspaceStateSnapshot } from "../shared/workspace-ipc";
import type { ExternalCodexSessionSummary } from "../shared/session-index-ipc";
import "@xterm/xterm/css/xterm.css";

type Workspace = WorkspaceRailWorkspace;
type WorkspaceHydrationStatus =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "failed"; message: string };

type PendingDiscardConfirmation = {
  files: Array<{ path: string; status: string }>;
  sessionId: string;
  summary: string;
  title: string;
};

const DEFAULT_WORKSPACE_ID = "A";
const DEFAULT_WORKSPACE: Workspace = { id: DEFAULT_WORKSPACE_ID, label: "Alfred", shortLabel: "A" };
const DEFAULT_WORKSPACES: Workspace[] = [DEFAULT_WORKSPACE];
const MAX_VISIBLE_EMPTY_NAV_WORKSPACES = 8;
const MAX_VISIBLE_ACTIVE_NAV_SESSIONS = 5;
const MAX_VISIBLE_FREE_CHAT_SESSIONS = 3;
const DEFAULT_PRIVACY_SETTINGS: DesktopPrivacySettings = {
  terminalScrollbackRetention: "redactedTail",
  externalSessionIndexingEnabled: true,
};

function tileLayoutRecordsEqual(
  left: Record<string, TileLayout> | undefined,
  right: Record<string, TileLayout>,
): boolean {
  const leftLayouts = left ?? {};
  const leftKeys = Object.keys(leftLayouts);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) return false;

  return rightKeys.every((tileId) => {
    const leftLayout = leftLayouts[tileId];
    const rightLayout = right[tileId];

    if (!leftLayout || !rightLayout) return false;

    return (
      leftLayout.tileId === rightLayout.tileId &&
      leftLayout.col === rightLayout.col &&
      leftLayout.row === rightLayout.row &&
      leftLayout.colSpan === rightLayout.colSpan &&
      leftLayout.rowSpan === rightLayout.rowSpan
    );
  });
}

export function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(DEFAULT_WORKSPACES);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(DEFAULT_WORKSPACE_ID);
  const [arrangeMode, setArrangeMode] = useState<boolean>(false);
  const [workModesByWorkspace, setWorkModesByWorkspace] = useState<Record<string, WorkMode>>({
    [DEFAULT_WORKSPACE_ID]: "desk",
  });
  const [tileLayoutsByWorkspace, setTileLayoutsByWorkspace] = useState<Record<string, Record<string, TileLayout>>>({});
  const [terminalSessions, setTerminalSessions] = useState<SessionTile[]>([]);
  const [sessionStatusAnnouncement, setSessionStatusAnnouncement] = useState<string>("");
  const [selectedSessionIdsByWorkspace, setSelectedSessionIdsByWorkspace] = useState<Record<string, string>>({});
  const [alfredStatus, setAlfredStatus] = useState<AlfredStatus>(idle());
  const [pendingPlan, setPendingPlan] = useState<SquadPlan | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [commandQuery, setCommandQuery] = useState<string>("");
  const [privacyPanelOpen, setPrivacyPanelOpen] = useState<boolean>(false);
  const [privacySettings, setPrivacySettings] = useState<DesktopPrivacySettings>(DEFAULT_PRIVACY_SETTINGS);
  const [desktopSaveStatus, setDesktopSaveStatus] = useState<DesktopSaveStatus>({ status: "saved" });
  const [sessionObservatoryOpen, setSessionObservatoryOpen] = useState<boolean>(false);
  const [activeSurface, setActiveSurface] = useState<PrimarySurface>("work");
  const [workspaceHydrationStatus, setWorkspaceHydrationStatus] = useState<WorkspaceHydrationStatus>({
    status: "loading",
  });
  const [workspaceHydrationRetryIndex, setWorkspaceHydrationRetryIndex] = useState<number>(0);
  const [externalCodexSessions, setExternalCodexSessions] = useState<ExternalCodexSessionSummary[]>([]);
  const [externalCodexSessionsError, setExternalCodexSessionsError] = useState<string | null>(null);
  const [externalCodexSessionsLoading, setExternalCodexSessionsLoading] = useState<boolean>(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState<boolean>(false);
  const [workspaceRenameDraft, setWorkspaceRenameDraft] = useState<string>("");
  const [workspaceRenameEditing, setWorkspaceRenameEditing] = useState<boolean>(false);
  const [armedRecoverySessionIds, setArmedRecoverySessionIds] = useState<Set<string>>(() => new Set());
  const [runtimeStatus, setRuntimeStatus] = useState<AlfredRuntimeStatus | null>(null);
  const [previewCandidates, setPreviewCandidates] = useState<PreviewUrlCandidate[]>([]);
  const [selectedPreviewUrlsByWorkspace, setSelectedPreviewUrlsByWorkspace] = useState<Record<string, string>>({});
  const [previewRefreshKeysByWorkspace, setPreviewRefreshKeysByWorkspace] = useState<Record<string, number>>({});
  const [worktreeActionPending, setWorktreeActionPending] = useState<Record<string, WorktreeActionKind | undefined>>({});
  const [collapsedSessionIdsByWorkspace, setCollapsedSessionIdsByWorkspace] = useState<Record<string, string[]>>({});
  const [contextDrawerOpenByWorkspace, setContextDrawerOpenByWorkspace] = useState<Record<string, boolean>>({});
  const [dispatchTargetsByWorkspace, setDispatchTargetsByWorkspace] = useState<Record<string, DispatchTargetSnapshot>>({});
  const [lastDispatchDestination, setLastDispatchDestination] = useState<string | null>(null);
  const [pendingDiscardConfirmation, setPendingDiscardConfirmation] = useState<PendingDiscardConfirmation | null>(null);
  const commandPaletteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const closingSessionIdsRef = useRef<Set<string>>(new Set());
  const startingSessionIdsRef = useRef<Set<string>>(new Set());
  const worktreeActionPendingRef = useRef<Set<string>>(new Set());
  const terminalSessionsRef = useRef<SessionTile[]>([]);
  const announcedSessionStatusesRef = useRef<Map<string, string>>(new Map());
  const sessionStatusAnnouncementsReadyRef = useRef<boolean>(false);
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
  const activeInspectedSession =
    activeSelectedSessionId
      ? activeSessions.find((session) => session.id === activeSelectedSessionId) ?? activeSessions[0] ?? null
      : activeSessions[0] ?? null;
  const activeSelectedSession =
    activeSessions.find((session) => session.id === activeSelectedSessionId) ?? activeSessions[0] ?? null;
  const activeCollapsedSessionIds = new Set(collapsedSessionIdsByWorkspace[activeWorkspace.id] ?? []);
  const activeContextDrawerOpen = contextDrawerOpenByWorkspace[activeWorkspace.id] ?? false;
  const activeDispatchTargets = dispatchTargetsForWorkspace(activeWorkspace, activeSessions, activeSelectedSession);
  const savedDispatchTarget = dispatchTargetsByWorkspace[activeWorkspace.id];
  const activeDispatchTarget =
    activeDispatchTargets.find((target) => dispatchTargetsEqual(target, savedDispatchTarget)) ??
    activeDispatchTargets[0] ??
    null;
  const activeImportantSignalCount = importantContextSignalCount(activeInspectedSession);
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
  const reviewQueuePreview = globalReviewItems[0] ?? null;
  const activeStagedSessions = orderStagedSessions(activeSessions, activePendingPlan);
  const stagedCount = activeSessions.filter((s) => s.stage === "staged").length;
  const globalStagedCount = terminalSessions.filter((s) => s.stage === "staged").length;
  const checkingStagedCount = activeSessions.filter((s) => s.stage === "staged" && s.stagedReviewStatus === "checking").length;
  const blockedStagedCount = activeSessions.filter((s) => s.stage === "staged" && isLaunchBlocked(s)).length;
  const safeStagedCount = Math.max(0, stagedCount - blockedStagedCount - checkingStagedCount);
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

  useEffect(() => {
    const previousStatuses = announcedSessionStatusesRef.current;
    const nextStatuses = new Map<string, string>();
    let nextAnnouncement: string | null = null;

    for (const session of terminalSessions) {
      const status = accessibleSessionStatusLabel(session);
      nextStatuses.set(session.id, status);
      const previousStatus = previousStatuses.get(session.id);
      if (previousStatus && previousStatus !== status) {
        nextAnnouncement = `${session.title} is now ${status}.`;
      }
    }

    announcedSessionStatusesRef.current = nextStatuses;

    if (!sessionStatusAnnouncementsReadyRef.current) {
      sessionStatusAnnouncementsReadyRef.current = true;
      return;
    }

    if (nextAnnouncement) {
      setSessionStatusAnnouncement(nextAnnouncement);
    }
  }, [terminalSessions]);

  useEffect(() => {
    const desktopStateApi = getDesktopStateApi();
    if (!desktopStateApi) return;
    let cancelled = false;

    void desktopStateApi.getPrivacySettings()
      .then((settings) => {
        if (!cancelled) setPrivacySettings(settings);
      })
      .catch(() => undefined);
    const unsubscribe = desktopStateApi.onSaveStatus((status) => {
      if (!cancelled) setDesktopSaveStatus(status);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const handleAddManualSession = useCallback(() => {
    setTerminalSessions((sessions) => addManualSession(sessions, activeWorkspace.rootPath ?? "", activeWorkspace.id));
  }, [activeWorkspace.id, activeWorkspace.rootPath]);

  const handleAddAgentSession = useCallback((kind: Extract<AgentKind, "claude" | "codex">, isolation: TerminalSessionIsolation = "shared") => {
    setTerminalSessions((sessions) =>
      addAgentSession(sessions, kind, activeWorkspace.rootPath ?? "", activeWorkspace.id, isolation),
    );
  }, [activeWorkspace.id, activeWorkspace.rootPath]);

  const handleAddWorkspace = useCallback(async () => {
    const snapshot = createScratchWorkspaceState(workspaces);
    const workspaceApi = getDesktopWorkspaceApi();

    if (workspaceApi) {
      const persisted = await workspaceApi.setWorkspaceState(snapshot);
      setWorkspaces(persisted.workspaces);
      setActiveWorkspaceId(persisted.activeWorkspaceId);
      return;
    }

    setWorkspaces(snapshot.workspaces);
    setActiveWorkspaceId(snapshot.activeWorkspaceId);
  }, [workspaces]);

  const handleBindWorkspaceFromFolder = useCallback(async () => {
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
    setCollapsedSessionIdsByWorkspace((current) => omitWorkspaceRecord(current, activeWorkspace.id));
    setContextDrawerOpenByWorkspace((current) => omitWorkspaceRecord(current, activeWorkspace.id));
    setDispatchTargetsByWorkspace((current) => omitWorkspaceRecord(current, activeWorkspace.id));
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

  const persistActiveWorkspaceViewState = useCallback((patch: WorkspaceViewState = {}) => {
    const layoutApi = getDesktopLayoutApi();
    const collapsedSessionIds = collapsedSessionIdsByWorkspace[activeWorkspace.id] ?? [];
    const contextDrawerOpen = contextDrawerOpenByWorkspace[activeWorkspace.id] ?? false;
    const dispatchTarget = dispatchTargetsByWorkspace[activeWorkspace.id];
    void layoutApi?.setWorkspaceViewState({
      workspaceId: activeWorkspace.id,
      viewState: {
        workMode: activeWorkMode,
        ...(activeSelectedSessionId === null ? {} : { selectedSessionId: activeSelectedSessionId }),
        ...(collapsedSessionIds.length === 0 ? {} : { collapsedSessionIds }),
        contextDrawerOpen,
        ...(dispatchTarget === undefined ? {} : { dispatchTarget }),
        ...patch,
      },
    });
  }, [
    activeSelectedSessionId,
    activeWorkMode,
    activeWorkspace.id,
    collapsedSessionIdsByWorkspace,
    contextDrawerOpenByWorkspace,
    dispatchTargetsByWorkspace,
  ]);

  const handleToggleContextDrawer = useCallback(() => {
    setContextDrawerOpenByWorkspace((current) => {
      const nextOpen = !(current[activeWorkspace.id] ?? false);
      persistActiveWorkspaceViewState({ contextDrawerOpen: nextOpen });
      return {
        ...current,
        [activeWorkspace.id]: nextOpen,
      };
    });
  }, [activeWorkspace.id, persistActiveWorkspaceViewState]);

  const handleCloseContextDrawer = useCallback(() => {
    setContextDrawerOpenByWorkspace((current) => {
      if (current[activeWorkspace.id] === false) return current;
      persistActiveWorkspaceViewState({ contextDrawerOpen: false });
      return {
        ...current,
        [activeWorkspace.id]: false,
      };
    });
  }, [activeWorkspace.id, persistActiveWorkspaceViewState]);

  const handleToggleCollapseSession = useCallback((sessionId: string) => {
    setCollapsedSessionIdsByWorkspace((current) => {
      const existing = current[activeWorkspace.id] ?? [];
      const nextCollapsed = existing.includes(sessionId)
        ? existing.filter((id) => id !== sessionId)
        : [...existing, sessionId];
      persistActiveWorkspaceViewState({
        collapsedSessionIds: nextCollapsed,
      });
      return {
        ...current,
        [activeWorkspace.id]: nextCollapsed,
      };
    });
  }, [activeWorkspace.id, persistActiveWorkspaceViewState]);

  const handleCycleDispatchTarget = useCallback(() => {
    if (activeDispatchTargets.length === 0) return;
    const currentIndex = activeDispatchTargets.findIndex((target) => dispatchTargetsEqual(target, activeDispatchTarget));
    const nextTarget = activeDispatchTargets[(currentIndex + 1) % activeDispatchTargets.length] ?? activeDispatchTargets[0];
    if (!nextTarget) return;
    setDispatchTargetsByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: nextTarget,
    }));
    persistActiveWorkspaceViewState({ dispatchTarget: nextTarget });
  }, [activeDispatchTarget, activeDispatchTargets, activeWorkspace.id, persistActiveWorkspaceViewState]);

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

  const handleOpenExternalTerminalForCwd = useCallback(async (cwd: string) => {
    const result = await getDesktopWorkspaceApi()?.openExternalTerminal({ cwd });
    if (!result?.ok) {
      throw new Error(result?.error ?? "Workspace runtime is unavailable.");
    }
  }, []);

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
    const workspaceLayouts = applyLayoutPreset(activeSessions, preset, selectedSessionId);

    setTileLayoutsByWorkspace((current) => {
      if (tileLayoutRecordsEqual(current[activeWorkspace.id], workspaceLayouts)) return current;

      void layoutApi?.setWorkspaceLayout({ workspaceId: activeWorkspace.id, layouts: workspaceLayouts });
      return {
        ...current,
        [activeWorkspace.id]: workspaceLayouts,
      };
    });
  }, [activeSelectedSessionId, activeSessions, activeWorkspace.id]);

  const handleApplyWorkMode = useCallback((mode: WorkMode, selectedSessionId = activeSelectedSessionId) => {
    const preset: LayoutPreset = mode === "focus" ? "focus" : mode === "split" ? "two-up" : "grid";
    const layoutApi = getDesktopLayoutApi();
    const viewStateChanged =
      activeWorkMode !== mode || (selectedSessionId !== null && activeSelectedSessionId !== selectedSessionId);

    setWorkModesByWorkspace((current) => {
      if ((current[activeWorkspace.id] ?? "desk") === mode) return current;
      return {
        ...current,
        [activeWorkspace.id]: mode,
      };
    });
    if (viewStateChanged) {
      void layoutApi?.setWorkspaceViewState({
        workspaceId: activeWorkspace.id,
        viewState: {
          workMode: mode,
          ...(selectedSessionId === null ? {} : { selectedSessionId }),
        },
      });
    }
    handleApplyLayoutPreset(preset, selectedSessionId);
  }, [activeSelectedSessionId, activeWorkMode, activeWorkspace.id, handleApplyLayoutPreset]);

  const handleSelectSession = useCallback((sessionId: string) => {
    const layoutApi = getDesktopLayoutApi();
    setSelectedSessionIdsByWorkspace((current) => {
      if (current[activeWorkspace.id] === sessionId) return current;

      void layoutApi?.setWorkspaceViewState({
        workspaceId: activeWorkspace.id,
        viewState: { workMode: activeWorkMode, selectedSessionId: sessionId },
      });
      return {
        ...current,
        [activeWorkspace.id]: sessionId,
      };
    });
  }, [activeWorkMode, activeWorkspace.id]);

  const handleFocusSession = useCallback((sessionId: string) => {
    setActiveSurface("work");
    setSelectedSessionIdsByWorkspace((current) => {
      if (current[activeWorkspace.id] === sessionId) return current;
      return {
        ...current,
        [activeWorkspace.id]: sessionId,
      };
    });
    handleApplyWorkMode("focus", sessionId);
  }, [activeWorkspace.id, handleApplyWorkMode]);
  const handleReviewAttention = useCallback(() => {
    if (!activeAttention) return;
    handleFocusSession(activeAttention.session.id);
  }, [activeAttention, handleFocusSession]);

  const handleOpenInbox = useCallback(() => {
    setCommandPaletteOpen(false);
    setCommandQuery("");
    setSessionObservatoryOpen(false);
    setActiveSurface("inbox");
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
    const viewStateChanged =
      (workModesByWorkspace[workspaceId] ?? "desk") !== "focus" ||
      selectedSessionIdsByWorkspace[workspaceId] !== sessionId;

    setActiveSurface("work");
    if (activeWorkspaceId !== workspaceId) {
      setActiveWorkspaceId(workspaceId);
    }
    setSelectedSessionIdsByWorkspace((current) => {
      if (current[workspaceId] === sessionId) return current;
      return {
        ...current,
        [workspaceId]: sessionId,
      };
    });
    setWorkModesByWorkspace((current) => {
      if ((current[workspaceId] ?? "desk") === "focus") return current;
      return {
        ...current,
        [workspaceId]: "focus",
      };
    });
    setTileLayoutsByWorkspace((current) => {
      if (tileLayoutRecordsEqual(current[workspaceId], workspaceLayouts)) return current;

      void layoutApi?.setWorkspaceLayout({ workspaceId, layouts: workspaceLayouts });
      return {
        ...current,
        [workspaceId]: workspaceLayouts,
      };
    });
    if (viewStateChanged) {
      void layoutApi?.setWorkspaceViewState({
        workspaceId,
        viewState: { workMode: "focus", selectedSessionId: sessionId },
      });
    }
    void refreshLiveSessions();
  }, [
    activeWorkspaceId,
    refreshLiveSessions,
    selectedSessionIdsByWorkspace,
    terminalSessions,
    workModesByWorkspace,
  ]);

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

  const closeSessionNow = useCallback((sessionId: string) => {
    const terminalApi = getDesktopTerminalApi();
    closingSessionIdsRef.current.add(sessionId);
    setPreviewCandidates((candidates) => candidates.filter((candidate) => candidate.sessionId !== sessionId));

    setTerminalSessions((sessions) => {
      const session = sessions.find((item) => item.id === sessionId);
      if (session?.runtimeStatus === "restored" || session?.runtimeStatus === "exited" || session?.runtimeStatus === "error") {
        terminalApi?.forget({ clientId: session.id, cleanupWorktree: true });
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

  const handleCloseSession = useCallback((sessionId: string) => {
    const session = terminalSessionsRef.current.find((item) => item.id === sessionId);
    const terminalApi = getDesktopTerminalApi();

    const destructiveWorktreeCleanup =
      session?.runtimeStatus === "restored" || session?.runtimeStatus === "exited" || session?.runtimeStatus === "error";

    if (!session || !destructiveWorktreeCleanup || !isReviewableWorktreeSession(session)) {
      closeSessionNow(sessionId);
      return;
    }

    if (!terminalApi) {
      setTerminalSessions((sessions) =>
        appendSessionActivity(sessions, sessionId, {
          kind: "error",
          title: "Discard checkout blocked",
          detail: "Desktop terminal API is unavailable, so Alfred cannot inspect this checkout before deleting it.",
        }),
      );
      return;
    }

    void terminalApi.worktreeDiff({ clientId: sessionId }).then((result) => {
      if (!result.ok) {
        setTerminalSessions((sessions) =>
          appendSessionActivity(sessions, sessionId, {
            kind: "warning",
            title: "Discard checkout blocked",
            detail: result.error,
          }),
        );
        return;
      }

      if (result.files.length === 0) {
        closeSessionNow(sessionId);
        return;
      }

      setPendingDiscardConfirmation({
        sessionId,
        title: session.title,
        summary: result.summary,
        files: result.files,
      });
    });
  }, [closeSessionNow]);

  const handleContinueRestoredSession = useCallback((sessionId: string) => {
    setTerminalSessions((sessions) => {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session || session.runtimeStatus !== "restored") return sessions;
      const relaunchSafety = sessionRelaunchSafety(session);
      if (!relaunchSafety.safe && !armedRecoverySessionIds.has(sessionId)) {
        setArmedRecoverySessionIds((ids) => new Set(ids).add(sessionId));
        return appendSessionActivity(sessions, sessionId, {
          kind: "warning",
          title: "Review before relaunch",
          detail: relaunchSafety.reason,
        });
      }
      setArmedRecoverySessionIds((ids) => {
        if (!ids.has(sessionId)) return ids;
        const next = new Set(ids);
        next.delete(sessionId);
        return next;
      });
      return appendSessionActivity(relaunchRestoredSession(sessions, sessionId), sessionId, {
        kind: "lifecycle",
        title: "Relaunching session",
        detail: "Alfred is starting a fresh process from this saved transcript.",
      });
    });
  }, [armedRecoverySessionIds]);

  const handleRestartSession = useCallback((sessionId: string) => {
    setTerminalSessions((sessions) => {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session || (session.runtimeStatus !== "exited" && session.runtimeStatus !== "error")) return sessions;
      const restartSafety = sessionRelaunchSafety(session);
      if (!restartSafety.safe && !armedRecoverySessionIds.has(sessionId)) {
        setArmedRecoverySessionIds((ids) => new Set(ids).add(sessionId));
        return appendSessionActivity(sessions, sessionId, {
          kind: "warning",
          title: "Review before restart",
          detail: restartSafety.reason,
        });
      }
      setArmedRecoverySessionIds((ids) => {
        if (!ids.has(sessionId)) return ids;
        const next = new Set(ids);
        next.delete(sessionId);
        return next;
      });
      return appendSessionActivity(restartSession(sessions, sessionId), sessionId, {
        kind: "lifecycle",
        title: "Restarting session",
        detail: "Alfred is starting a fresh process in this tile.",
      });
    });
  }, [armedRecoverySessionIds]);

  const handleRenameSession = useCallback((sessionId: string, title: string) => {
    const normalizedTitle = normalizeSessionTitle(title);
    if (!normalizedTitle) return;
    setTerminalSessions((sessions) => renameSession(sessions, sessionId, normalizedTitle));
    void getDesktopTerminalApi()?.rename({ clientId: sessionId, title: normalizedTitle });
  }, []);

  const beginWorktreeAction = useCallback((session: SessionTile, action: WorktreeActionKind): string | null => {
    const actionKey = sessionInstanceKey(session);
    if (worktreeActionPendingRef.current.has(actionKey)) return null;
    worktreeActionPendingRef.current.add(actionKey);
    setWorktreeActionPending((pending) => ({ ...pending, [actionKey]: action }));
    return actionKey;
  }, []);

  const finishWorktreeAction = useCallback((actionKey: string): void => {
    worktreeActionPendingRef.current.delete(actionKey);
    setWorktreeActionPending((pending) => {
      if (!pending[actionKey]) return pending;
      const next = { ...pending };
      delete next[actionKey];
      return next;
    });
  }, []);

  const isCurrentSessionInstance = useCallback((sessionId: string, actionKey: string): boolean => {
    const currentSession = terminalSessionsRef.current.find((item) => item.id === sessionId);
    return Boolean(currentSession && sessionInstanceKey(currentSession) === actionKey);
  }, []);

  const handleReviewWorktree = useCallback(async (sessionId: string) => {
    const session = terminalSessionsRef.current.find((item) => item.id === sessionId);
    if (!session || !isReviewableWorktreeSession(session)) {
      setTerminalSessions((sessions) =>
        appendSessionActivity(sessions, sessionId, {
          kind: "warning",
          title: "Review diff unavailable",
          detail: "Session is not an isolated checkout.",
        }),
      );
      return;
    }

    const terminalApi = getDesktopTerminalApi();
    if (!terminalApi) {
      setTerminalSessions((sessions) =>
        appendSessionActivity(sessions, sessionId, {
          kind: "error",
          title: "Review diff failed",
          detail: "Desktop terminal API is unavailable.",
        }),
      );
      return;
    }

    const actionKey = beginWorktreeAction(session, "review");
    if (!actionKey) return;
    try {
      const result = await terminalApi.worktreeDiff({ clientId: sessionId });
      if (!isCurrentSessionInstance(sessionId, actionKey)) return;
      setTerminalSessions((sessions) =>
        sessions.some((item) => item.id === sessionId && sessionInstanceKey(item) === actionKey)
          ? appendSessionActivity(
              sessions,
              sessionId,
              result.ok
                ? {
                    kind: "plan",
                    title: "Checkout diff reviewed",
                    detail: worktreeDiffDetail(result),
                    payload: { type: "plan", summary: worktreeDiffDetail(result) },
                  }
                : {
                    kind: "error",
                    title: "Review diff failed",
                    detail: result.error,
                    payload: { type: "error", message: result.error },
                  },
            )
          : sessions,
      );
    } finally {
      finishWorktreeAction(actionKey);
    }
  }, [beginWorktreeAction, finishWorktreeAction, isCurrentSessionInstance]);

  const handleApplyWorktree = useCallback(async (sessionId: string) => {
    const session = terminalSessionsRef.current.find((item) => item.id === sessionId);
    if (!session || !isReviewableWorktreeSession(session)) {
      setTerminalSessions((sessions) =>
        appendSessionActivity(sessions, sessionId, {
          kind: "warning",
          title: "Apply blocked",
          detail: "Session is not an isolated checkout.",
        }),
      );
      return;
    }

    const terminalApi = getDesktopTerminalApi();
    if (!terminalApi) {
      setTerminalSessions((sessions) =>
        appendSessionActivity(sessions, sessionId, {
          kind: "error",
          title: "Apply failed",
          detail: "Desktop terminal API is unavailable.",
        }),
      );
      return;
    }

    const actionKey = beginWorktreeAction(session, "apply");
    if (!actionKey) return;
    try {
      const result = await terminalApi.worktreeApply({ clientId: sessionId });
      if (!isCurrentSessionInstance(sessionId, actionKey)) return;
      setTerminalSessions((sessions) =>
        sessions.some((item) => item.id === sessionId && sessionInstanceKey(item) === actionKey)
          ? appendSessionActivity(
              sessions,
              sessionId,
              result.ok
                ? {
                    kind: "lifecycle",
                    title: "Applied to project",
                    detail: `${changedFileCountLabel(result.appliedFiles)} applied to the base workspace. Review and commit normally.`,
                  }
                : {
                    kind: result.needsManualReview ? "warning" : "error",
                    title: result.needsManualReview ? "Apply needs review" : "Apply failed",
                    detail: result.error,
                    payload: result.needsManualReview
                      ? { type: "warning", message: result.error }
                      : { type: "error", message: result.error },
                  },
            )
          : sessions,
      );
    } finally {
      finishWorktreeAction(actionKey);
    }
  }, [beginWorktreeAction, finishWorktreeAction, isCurrentSessionInstance]);

  const handleCloseSelectedSession = useCallback(() => {
    const selectedSessionId = selectedSessionIdsByWorkspace[activeWorkspace.id];
    const currentWorkspaceSessions = terminalSessionsRef.current.filter(
      (session) => session.workspaceId === activeWorkspace.id,
    );
    const session =
      (selectedSessionId
        ? currentWorkspaceSessions.find((item) => item.id === selectedSessionId)
        : null) ??
      currentWorkspaceSessions[0] ??
      activeSelectedSession;
    if (!session) return;
    handleCloseSession(session.id);
  }, [activeSelectedSession, activeWorkspace.id, handleCloseSession, selectedSessionIdsByWorkspace]);

  const handleCloseRecoverableSessions = useCallback(() => {
    for (const session of activeRecoverableSessions) {
      handleCloseSession(session.id);
    }
  }, [activeRecoverableSessions, handleCloseSession]);

  const handleCancelDiscardCheckout = useCallback(() => {
    setPendingDiscardConfirmation(null);
  }, []);

  const handleReviewDiscardCheckout = useCallback(() => {
    const confirmation = pendingDiscardConfirmation;
    if (!confirmation) return;

    setPendingDiscardConfirmation(null);
    void handleReviewWorktree(confirmation.sessionId);
  }, [handleReviewWorktree, pendingDiscardConfirmation]);

  const handleConfirmDiscardCheckout = useCallback(() => {
    const confirmation = pendingDiscardConfirmation;
    if (!confirmation) return;

    setPendingDiscardConfirmation(null);
    closeSessionNow(confirmation.sessionId);
  }, [closeSessionNow, pendingDiscardConfirmation]);

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

  const handleRuntimeSessionFailed = useCallback((tileId: string, reason?: string) => {
    startingSessionIdsRef.current.delete(tileId);
    setTerminalSessions((sessions) =>
      appendSessionActivity(markSessionStartFailed(sessions, tileId), tileId, {
        kind: "error",
        title: "Start failed",
        detail: reason?.trim() || "The runtime could not create this terminal.",
      }),
    );
  }, []);

  const handleRuntimeSessionUnavailable = useCallback((tileId: string) => {
    startingSessionIdsRef.current.delete(tileId);
    setTerminalSessions((sessions) =>
      appendSessionActivity(markSessionUnavailable(sessions, tileId), tileId, {
        kind: "warning",
        title: "Desktop terminal unavailable",
        detail: "Open Alfred Desktop to attach a real local PTY.",
      }),
    );
  }, []);

  const handleRuntimeSessionExited = useCallback((runtimeId: TerminalCreateResult["id"], exitCode = 0) => {
    const exitedSession = terminalSessionsRef.current.find((item) => item.runtimeId === runtimeId);
    if (exitedSession) {
      setPreviewCandidates((candidates) => candidates.filter((candidate) => candidate.sessionId !== exitedSession.id));
    }
    setTerminalSessions((sessions) => {
      const session = sessions.find((item) => item.runtimeId === runtimeId);
      const failed = exitCode !== 0;
      const next = markSessionExited(sessions, runtimeId, exitCode);
      if (!session) return next;
      return appendSessionActivity(next, session.id, {
        kind: failed ? "error" : "lifecycle",
        title: failed ? "Process failed" : "Process exited",
        detail: failed
          ? `The terminal process exited with code ${exitCode}.`
          : "The terminal process ended; scrollback remains available.",
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

  const handleRuntimeSessionSnapshot = useCallback((sessionId: string, snapshot: TerminalSessionSnapshot) => {
    setTerminalSessions((sessions) =>
      sessions.map((session) => {
        if (session.id !== sessionId && session.runtimeId !== snapshot.id) {
          return session;
        }

        const mergedActivityEvents = mergeSnapshotActivityEvents(session.activityEvents, snapshot.activityEvents);
        const mergedLastActivityAt = maxDefinedTimestamp(
          session.lastActivityAt,
          snapshot.lastActivityAt,
          mergedActivityEvents?.at(-1)?.at,
        );
        const mergedLastOutputAt = maxDefinedTimestamp(session.lastOutputAt, snapshot.lastOutputAt);

        return {
          ...session,
          initialBuffer: snapshot.buffer,
          ...(mergedActivityEvents === undefined ? {} : { activityEvents: mergedActivityEvents }),
          ...(mergedLastActivityAt === undefined ? {} : { lastActivityAt: mergedLastActivityAt }),
          ...(mergedLastOutputAt === undefined ? {} : { lastOutputAt: mergedLastOutputAt }),
        };
      }),
    );
  }, []);

  const handleRuntimeSessionReplayBuffer = useCallback(
    (sessionId: string, runtimeId: TerminalCreateResult["id"], buffer: string) => {
      setTerminalSessions((sessions) =>
        sessions.map((session) =>
          session.id === sessionId || session.runtimeId === runtimeId
            ? {
                ...session,
                initialBuffer: buffer,
              }
            : session,
        ),
      );
    },
    [],
  );

  const handleSubmitPrompt = useCallback(async (dispatchTarget: DispatchTargetSnapshot, draft: string): Promise<boolean> => {
    const prompt = draft.trim();
    if (!prompt) return false;
    if (!canRequestPlan(alfredStatus, globalStagedCount)) return false;
    const alfredApi = getDesktopAlfredApi();
    if (!alfredApi) {
      setAlfredStatus(errored({ code: "network", message: "Alfred runtime is unavailable. Open the desktop app." }));
      return false;
    }
    setAlfredStatus(thinking());
    const response = await alfredApi.requestPlan({
      dispatchTarget,
      prompt,
      workspace: workspacePlanContext(activeWorkspace, activeSessions, dispatchTarget),
    });
    if (!response.ok) {
      setAlfredStatus(errored(response.error));
      return false;
    }
    setAlfredStatus(idle());
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
    return true;
  }, [activeSessions, activeWorkspace, alfredStatus, globalStagedCount]);

  const handleSubmitDispatch = useCallback((draft: string) => {
    const target = activeDispatchTarget;
    if (!target) return false;
    return handleSubmitPrompt(target, draft).then((submitted) => {
      if (submitted) setLastDispatchDestination(target.label);
      return submitted;
    });
  }, [activeDispatchTarget, handleSubmitPrompt]);

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
    if (tile?.safetyNote) {
      setTerminalSessions((sessions) =>
        appendSessionActivity(sessions, tileId, {
          kind: "warning",
          title: "Launch blocked",
          detail: tile.safetyNote ?? "This command needs to be edited before launch.",
        }),
      );
      return;
    }

    setTerminalSessions((sessions) =>
      appendSessionActivity(approveStaged(sessions, tileId), tileId, {
        kind: "approval",
        title: "Approved for launch",
        detail: "The staged command was released to the terminal runtime.",
      }),
    );
  }, [terminalSessions]);

  const handleLaunchReviewQueueItem = useCallback((workspaceId: string, sessionId: string) => {
    handleApproveTile(sessionId);
    handleFocusSessionInWorkspace(workspaceId, sessionId);
  }, [handleApproveTile, handleFocusSessionInWorkspace]);

  const handleRejectTile = useCallback((tileId: string) => {
    const alfredApi = getDesktopAlfredApi();
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
    setTerminalSessions((sessions) => approveAllStaged(sessions, activeWorkspace.id));
  }, [activeWorkspace.id]);

  const handleRejectAll = useCallback(() => {
    const alfredApi = getDesktopAlfredApi();
    setTerminalSessions((sessions) => rejectAllStaged(sessions, activeWorkspace.id));
    setPendingPlan(null);
    void alfredApi?.clearStagedPlan();
  }, [activeWorkspace.id]);

  const handleDismissError = useCallback(() => {
    setAlfredStatus(idle());
  }, []);

  const handleOpenCommandPalette = useCallback(() => {
    setSessionObservatoryOpen(false);
    setPrivacyPanelOpen(false);
    setCommandQuery("");
    setCommandPaletteOpen(true);
  }, []);

  const handleOpenPrivacyPanel = useCallback(() => {
    setSessionObservatoryOpen(false);
    setCommandPaletteOpen(false);
    setCommandQuery("");
    setPrivacyPanelOpen(true);
  }, []);

  const handleClosePrivacyPanel = useCallback(() => {
    setPrivacyPanelOpen(false);
  }, []);

  const handleCloseCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
    setCommandQuery("");
  }, []);

  const handleOpenSessionObservatory = useCallback(() => {
    setPrivacyPanelOpen(false);
    setCommandPaletteOpen(false);
    setCommandQuery("");
    setSessionObservatoryOpen(true);
  }, []);

  const handleCloseSessionObservatory = useCallback(() => {
    setSessionObservatoryOpen(false);
  }, []);

  const handleRefreshExternalCodexSessions = useCallback(async () => {
    if (!privacySettings.externalSessionIndexingEnabled) {
      setExternalCodexSessions([]);
      setExternalCodexSessionsLoading(false);
      setExternalCodexSessionsError(null);
      return;
    }

    const sessionIndexApi = getDesktopSessionIndexApi();
    if (!sessionIndexApi) {
      setExternalCodexSessionsError("External Codex indexing is unavailable in this build.");
      return;
    }

    setExternalCodexSessionsLoading(true);
    setExternalCodexSessionsError(null);
    try {
      const result = await sessionIndexApi.listExternalCodexSessions();
      setExternalCodexSessions(result.sessions);
      setExternalCodexSessionsError(null);
    } catch {
      setExternalCodexSessionsError("Refresh failed. Retry when the local session index is available.");
    } finally {
      setExternalCodexSessionsLoading(false);
    }
  }, [privacySettings.externalSessionIndexingEnabled]);

  const handleUpdatePrivacySettings = useCallback(async (nextSettings: DesktopPrivacySettings) => {
    const desktopStateApi = getDesktopStateApi();
    setPrivacySettings(nextSettings);
    if (!nextSettings.externalSessionIndexingEnabled) {
      setExternalCodexSessions([]);
      setExternalCodexSessionsLoading(false);
      setExternalCodexSessionsError(null);
    }

    if (!desktopStateApi) return;
    try {
      const persisted = await desktopStateApi.updatePrivacySettings(nextSettings);
      setPrivacySettings(persisted);
    } catch {
      setDesktopSaveStatus({ status: "saveFailed", message: "Failed to persist desktop state.", failedAt: Date.now() });
    }
  }, []);

  const handleClearSavedTerminalData = useCallback(async () => {
    const desktopStateApi = getDesktopStateApi();
    if (!desktopStateApi) return { ok: false as const, error: "Desktop state controls are unavailable in this build." };

    const result = await desktopStateApi.clearSavedTerminalData();
    if (result.ok) {
      setTerminalSessions((sessions) =>
        sessions.map((session) => {
          const {
            activityEvents: _activityEvents,
            initialBuffer: _initialBuffer,
            lastActivityAt: _lastActivityAt,
            lastOutputAt: _lastOutputAt,
            ...rest
          } = session;
          return rest;
        }),
      );
    }
    return result;
  }, []);

  const handleRevealStateFile = useCallback(async () => {
    const desktopStateApi = getDesktopStateApi();
    if (!desktopStateApi) return { ok: false as const, error: "Desktop state controls are unavailable in this build." };
    return desktopStateApi.revealStateFile();
  }, []);

  const handleRetryStateSave = useCallback(async () => {
    const desktopStateApi = getDesktopStateApi();
    if (!desktopStateApi) return;
    const status = await desktopStateApi.retrySave();
    setDesktopSaveStatus(status);
  }, []);

  const handleRetryWorkspaceHydration = useCallback(() => {
    setWorkspaceHydrationStatus({ status: "loading" });
    setWorkspaceHydrationRetryIndex((index) => index + 1);
  }, []);

  const handleOpenManagedSessionFromObservatory = useCallback((workspaceId: string, sessionId: string) => {
    setActiveSurface("work");
    handleFocusSessionInWorkspace(workspaceId, sessionId);
  }, [handleFocusSessionInWorkspace]);

  const handleReviewBlockedSession = useCallback((workspaceId: string, sessionId: string) => {
    handleFocusSessionInWorkspace(workspaceId, sessionId);
    setContextDrawerOpenByWorkspace((current) => ({
      ...current,
      [workspaceId]: true,
    }));
  }, [handleFocusSessionInWorkspace]);

  const handleResumeExternalCodexSession = useCallback((session: ExternalCodexSessionSummary) => {
    const now = Date.now();
    const workspaceApi = getDesktopWorkspaceApi();
    const targetWorkspace = workspaceForCwd(session.cwd, workspaces);
    if (!targetWorkspace) return;
    const title = normalizeSessionTitle(session.title ? `Codex · ${session.title}` : "Codex resume") ?? "Codex resume";
    const tile: SessionTile = {
      id: `external-codex-${session.id.slice(0, 8)}-${now}`,
      title,
      workspaceId: targetWorkspace.id,
      cwd: session.cwd || targetWorkspace.rootPath || activeWorkspace.rootPath || "",
      source: "manual",
      stage: "live",
      runtimeStatus: "starting",
      agentKind: "codex",
      command: "codex",
      args: ["resume", session.id],
      resumeTarget: { agentKind: "codex", sessionId: session.id, source: "external-session-index" },
      resumeMode: "exact",
      isolation: "shared",
      createdAt: now,
      activityEvents: [
        {
          id: `external-codex-${session.id.slice(0, 8)}-${now}-resume`,
          kind: "approval",
          title: "External Codex session resumed",
          detail: "Alfred is opening this Codex transcript in a managed terminal.",
          at: now,
        },
      ],
      lastActivityAt: now,
    };

    setActiveWorkspaceId(targetWorkspace.id);
    setActiveSurface("work");
    setSelectedSessionIdsByWorkspace((current) => ({ ...current, [targetWorkspace.id]: tile.id }));
    setTerminalSessions((sessions) => [...sessions, tile]);
    void workspaceApi?.setWorkspaceState({ workspaces, activeWorkspaceId: targetWorkspace.id });
  }, [activeWorkspace.rootPath, workspaces]);

  const handleTrustExternalCodexWorkspace = useCallback(async (_session: ExternalCodexSessionSummary) => {
    const workspaceApi = getDesktopWorkspaceApi();
    if (!workspaceApi) return;

    const snapshot = await workspaceApi.bindFolderToWorkspace({ workspaceId: activeWorkspace.id });
    setWorkspaces(snapshot.workspaces);
    setActiveWorkspaceId(snapshot.activeWorkspaceId);
  }, [activeWorkspace.id]);

  useEffect(() => {
    if (activeSurface !== "history") return;
    if (!privacySettings.externalSessionIndexingEnabled) return;
    void handleRefreshExternalCodexSessions();
  }, [activeSurface, handleRefreshExternalCodexSessions, privacySettings.externalSessionIndexingEnabled]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (commandPaletteOpen || sessionObservatoryOpen || privacyPanelOpen) {
        const shortcutPressed = event.metaKey || event.ctrlKey;
        const key = event.key.toLowerCase();
        const appShortcut =
          shortcutPressed && (
            /^[1-9]$/.test(event.key) ||
            key === "k" ||
            key === "t" ||
            key === "w" ||
            (event.shiftKey && key === "o") ||
            (event.shiftKey && (event.code === "BracketRight" || event.code === "BracketLeft"))
          );

        if (appShortcut) {
          event.preventDefault();
          if (key === "k") {
            if (commandPaletteOpen) {
              handleCloseCommandPalette();
            } else {
              handleOpenCommandPalette();
            }
          }
        }
        return;
      }

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
        if (commandPaletteOpen) {
          handleCloseCommandPalette();
        } else {
          handleOpenCommandPalette();
        }
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

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "o") {
        if (activeSelectedSession?.cwd) {
          event.preventDefault();
          void handleOpenSessionTerminal(activeSelectedSession.cwd);
        }
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
  }, [
    activeSelectedSession,
    commandPaletteOpen,
    handleAddManualSession,
    handleCloseSelectedSession,
    handleCloseCommandPalette,
    handleFocusSessionByDelta,
    handleOpenCommandPalette,
    handleOpenSessionTerminal,
    handleSelectWorkspace,
    privacyPanelOpen,
    sessionObservatoryOpen,
    workspaces,
  ]);

  useEffect(() => {
    const terminalApi = getDesktopTerminalApi();
    const alfredApi = getDesktopAlfredApi();
    const layoutApi = getDesktopLayoutApi();
    const workspaceApi = getDesktopWorkspaceApi();
    let cancelled = false;

    workspaceStateHydratedRef.current = false;

    if (!terminalApi) {
      setTerminalSessions([]);
      setWorkspaceHydrationStatus({ status: "ready" });
      return;
    }

    setWorkspaceHydrationStatus({ status: "loading" });

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
        setCollapsedSessionIdsByWorkspace(
          Object.fromEntries(
            Object.entries(layoutResult.viewStateByWorkspace).flatMap(([workspaceId, viewState]) =>
              viewState.collapsedSessionIds?.length ? [[workspaceId, viewState.collapsedSessionIds]] : [],
            ),
          ),
        );
        setContextDrawerOpenByWorkspace(
          Object.fromEntries(
            Object.entries(layoutResult.viewStateByWorkspace).flatMap(([workspaceId, viewState]) =>
              viewState.contextDrawerOpen === undefined ? [] : [[workspaceId, viewState.contextDrawerOpen]],
            ),
          ),
        );
        setDispatchTargetsByWorkspace(
          Object.fromEntries(
            Object.entries(layoutResult.viewStateByWorkspace).flatMap(([workspaceId, viewState]) =>
              viewState.dispatchTarget ? [[workspaceId, viewState.dispatchTarget]] : [],
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
            : workspaceRootPath(workspaceStateResult, workspaceStateResult?.activeWorkspaceId ?? DEFAULT_WORKSPACE_ID)
              ? createInitialSessions(
                  workspaceRootPath(workspaceStateResult, workspaceStateResult?.activeWorkspaceId ?? DEFAULT_WORKSPACE_ID),
                  workspaceStateResult?.activeWorkspaceId ?? DEFAULT_WORKSPACE_ID,
                )
              : [];
        setWorkspaces((current) =>
          ensureWorkspacesForSessions(workspaceStateResult?.workspaces ?? current, hydratedSessions),
        );
        setTerminalSessions(hydratedSessions);
        setPreviewCandidates(previewCandidatesFromSessions(hydratedSessions));
        setPendingPlan(toSquadPlan({ plan: stagedPlanResult.plan, omittedSessionIds: alreadyLiveStagedIds }));
        workspaceStateHydratedRef.current = true;
        setWorkspaceHydrationStatus({ status: "ready" });
      })
      .catch(() => {
        if (!cancelled) {
          workspaceStateHydratedRef.current = false;
          setWorkspaceHydrationStatus({
            status: "failed",
            message: "Failed to hydrate desktop state.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceHydrationRetryIndex]);

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

  const workSurfaceHidden = activeSurface !== "work";

  return (
    <main className="agent-space-shell">
      <div
        className="visually-hidden"
        aria-live="polite"
        aria-atomic="true"
        data-testid="session-status-announcer"
      >
        {sessionStatusAnnouncement}
      </div>
      <section
        className={`desktop-frame ${shortcutModifier === "Cmd" ? "mac-frame" : ""}`}
        aria-label="Alfred Agent Space desktop shell"
      >
        <div className="mission-bar">
          <WorkbenchHeader
            activeSurface={activeSurface}
            activeSessionCount={activeSessions.length}
            arrangeMode={arrangeMode}
            contextOpen={activeContextDrawerOpen}
            contextSignalCount={activeImportantSignalCount}
            inboxCount={globalReviewItems.length}
            sessionCount={terminalSessions.length}
            shortcutModifier={shortcutModifier}
            workMode={activeWorkMode}
            workspaceSwitcher={
              <div className="mission-name" role="group" aria-label="Workspace context">
                <AlfredMark label={activeWorkspace.shortLabel} />
                <WorkspaceTitleMenu
                  detail={workspaceDetail(activeWorkspace)}
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
            }
            onAddAgentSession={handleAddAgentSession}
            onAddManualSession={handleAddManualSession}
            onApplyWorkMode={handleApplyWorkMode}
            onOpenInbox={handleOpenInbox}
            onOpenSessionObservatory={handleOpenSessionObservatory}
            onToggleArrangeMode={handleToggleArrangeMode}
            onToggleContext={handleToggleContextDrawer}
          />
        </div>

        {desktopSaveStatus.status === "saveFailed" && (
          <div className="desktop-save-banner" role="alert">
            <div>
              <strong>State not saved</strong>
              <span>{desktopSaveStatus.message}</span>
            </div>
            <button type="button" onClick={() => void handleRetryStateSave()}>
              <RefreshCcw size={14} />
              <span>Retry</span>
            </button>
          </div>
        )}

        {workspaceHydrationStatus.status === "failed" && (
          <div className="desktop-save-banner" role="alert">
            <div>
              <strong>Workspace not loaded</strong>
              <span>{workspaceHydrationStatus.message}</span>
            </div>
            <button type="button" onClick={handleRetryWorkspaceHydration}>
              <RefreshCcw size={14} />
              <span>Retry</span>
            </button>
          </div>
        )}

        <div
          className={`workspace-layout surface-${activeSurface} ${alfredExpanded ? "alfred-expanded" : "alfred-compact"} ${
            previewVisible ? "preview-visible" : ""
          }`}
          data-testid="workbench-shell"
        >
          <PrimaryNavigationRail
            activeSurface={activeSurface}
            commandPaletteTriggerRef={commandPaletteTriggerRef}
            contextOpen={activeContextDrawerOpen}
            contextSignalCount={activeImportantSignalCount}
            inboxCount={globalReviewItems.length}
            shortcutModifier={shortcutModifier}
            onOpenCommandPalette={handleOpenCommandPalette}
            onOpenPrivacyControls={handleOpenPrivacyPanel}
            onToggleContext={handleToggleContextDrawer}
            onSelectSurface={(surface) => setActiveSurface(surface)}
          />
          <QuietWorkspaceNavigationPanel
            activeSessions={activeSessions}
            activeWorkspace={activeWorkspace}
            activeWorkspaceId={activeWorkspace.id}
            inboxCount={globalReviewItems.length}
            sessions={terminalSessions}
            workspaces={workspaces}
            onAddWorkspace={handleAddWorkspace}
            onFocusSession={handleFocusSession}
            onFocusSessionInWorkspace={handleFocusSessionInWorkspace}
            onOpenInbox={handleOpenInbox}
            onSelectWorkspace={handleSelectWorkspace}
          />
          <div className="orchestrator-surface" data-testid="workbench-surface">
            <div
              className={`surface-panel desk-surface-panel ${workSurfaceHidden ? "inactive" : "active"}`}
              data-testid="desk-runtime-surface"
              aria-hidden={workSurfaceHidden ? "true" : undefined}
              inert={workSurfaceHidden || undefined}
            >
              <TerminalDesk
                arrangeMode={arrangeMode}
                armedRecoverySessionIds={armedRecoverySessionIds}
                collapsedSessionIds={activeCollapsedSessionIds}
                layouts={ensureTileLayouts(activeSessions, tileLayoutsByWorkspace[activeWorkspace.id] ?? {})}
                recoverableSessions={activeRecoverableSessions}
                selectedSessionId={activeSelectedSessionId}
                sessions={activeSessions}
                workMode={activeWorkMode}
                worktreeActionPending={worktreeActionPending}
                workspaceGitBranch={activeWorkspace.gitBranch}
                workspaceLabel={activeWorkspace.label}
                workspaceRootPath={activeWorkspace.rootPath}
                onBindWorkspace={handleBindWorkspaceFromFolder}
                onAddAgentSession={handleAddAgentSession}
                onAddManualSession={handleAddManualSession}
                onApplyWorktree={handleApplyWorktree}
                onCloseSession={handleCloseSession}
                onContinueRestoredSession={handleContinueRestoredSession}
                onOpenInbox={handleOpenInbox}
                onRestartSession={handleRestartSession}
                onApplyWorkMode={handleApplyWorkMode}
                onMoveTile={handleMoveTile}
                onRuntimeSessionFailed={handleRuntimeSessionFailed}
                onRuntimeSessionExited={handleRuntimeSessionExited}
                onRuntimeSessionOutput={handleRuntimeSessionOutput}
                onRuntimeSessionReplayBuffer={handleRuntimeSessionReplayBuffer}
                onRuntimeSessionSnapshot={handleRuntimeSessionSnapshot}
                onRuntimeSessionReady={handleRuntimeSessionReady}
                onRuntimeSessionStarting={handleRuntimeSessionStarting}
                onRuntimeSessionUnavailable={handleRuntimeSessionUnavailable}
                onRenameSession={handleRenameSession}
                onFocusSession={handleFocusSession}
                onSelectSession={handleSelectSession}
                onApproveTile={handleApproveTile}
                onRejectTile={handleRejectTile}
                onResizeTile={handleResizeTile}
                onReviewWorktree={handleReviewWorktree}
                showHeaderControls={false}
                onToggleCollapseSession={handleToggleCollapseSession}
              />
            </div>
            {activeSurface === "inbox" && (
              <div className="surface-panel active">
                <ReviewSurface
                  armedRecoverySessionIds={armedRecoverySessionIds}
                  items={globalReviewItems}
                  selectedSessionId={activeSelectedSessionId}
                  onContinueRestoredSession={handleContinueRestoredSession}
                  onDiscardSession={handleCloseSession}
                  onFocusItem={handleOpenManagedSessionFromObservatory}
                  onLaunchItem={handleLaunchReviewQueueItem}
                  onRestartSession={handleRestartSession}
                  onReviewBlockedItem={handleReviewBlockedSession}
                />
              </div>
            )}
            {activeSurface === "history" && (
              <div className="surface-panel active">
                <ObservatorySurface
                  activeWorkspaceId={activeWorkspace.id}
                  externalCodexSessions={externalCodexSessions}
                  externalSessionIndexingEnabled={privacySettings.externalSessionIndexingEnabled}
                  externalSessionsError={externalCodexSessionsError}
                  loadingExternalSessions={externalCodexSessionsLoading}
                  sessions={terminalSessions}
                  workspaces={workspaces}
                  onOpenManagedSession={handleOpenManagedSessionFromObservatory}
                  onRefreshExternalSessions={handleRefreshExternalCodexSessions}
                  onResumeExternalCodexSession={handleResumeExternalCodexSession}
                  onTrustExternalCodexWorkspace={handleTrustExternalCodexWorkspace}
                  onSelectWorkspace={handleSelectWorkspace}
                />
              </div>
            )}
          </div>
          <ContextColumn
            contextOpen={activeContextDrawerOpen}
            previewVisible={previewVisible}
            onCloseContext={handleCloseContextDrawer}
            previewProps={{
              candidates: activePreviewCandidates,
              refreshKey: activePreviewRefreshKey,
              selectedUrl: activeSelectedPreviewUrl,
              workspaceLabel: activeWorkspace.label,
              onCopyUrl: handleCopyPreviewUrl,
              onOpenExternal: handleOpenPreviewExternal,
              onRefresh: handleRefreshPreview,
              onSelectUrl: handleSelectPreviewUrl,
            }}
            timelineProps={{
              session: activeInspectedSession,
              onCopyActivityText: handleCopyActivityText,
              onOpenExternalTerminal: handleOpenExternalTerminalForCwd,
              onRevealActivityFile: handleRevealActivityFile,
              onUpdateStagedSession: handleUpdateStagedSession,
            }}
            railProps={{
              status: alfredStatus,
              activeDecisionItems,
              missionBrief: activeWorkspace.missionBrief,
              pendingPlan: activePendingPlan,
              recoverableSessions: activeRecoverableSessions,
              selectedSessionId: activeSelectedSessionId,
              stagedSessions: activeStagedSessions,
              stagedCount,
              blockedStagedCount,
              liveAlfredCount,
              onApproveAll: handleApproveAll,
              onApproveTile: handleApproveTile,
              onDismissError: handleDismissError,
              onFocusSession: handleFocusSession,
              onRejectAll: handleRejectAll,
              onRejectTile: handleRejectTile,
            }}
          />
        </div>
        <ComposerBar
          blockedActionLabel={
            stagedWorkspaceId && stagedWorkspaceLabel
              ? `Open ${stagedWorkspaceLabel}`
              : undefined
          }
          blockedReason={composerBlockedReason}
          dispatchTarget={activeDispatchTarget}
          lastDispatchDestination={lastDispatchDestination}
          thinking={isThinking(alfredStatus)}
          disabled={commandPaletteOpen || sessionObservatoryOpen || privacyPanelOpen}
          onBlockedAction={
            stagedWorkspaceId
              ? () => handleSelectWorkspace(stagedWorkspaceId)
              : undefined
          }
          onCycleDispatchTarget={handleCycleDispatchTarget}
          onSubmit={handleSubmitDispatch}
        />
        {pendingDiscardConfirmation && (
          <DiscardCheckoutDialog
            confirmation={pendingDiscardConfirmation}
            onCancel={handleCancelDiscardCheckout}
            onConfirmDiscard={handleConfirmDiscardCheckout}
            onReviewChanges={handleReviewDiscardCheckout}
          />
        )}
        {privacyPanelOpen && (
          <PrivacyPanel
            saveStatus={desktopSaveStatus}
            settings={privacySettings}
            onClearSavedTerminalData={handleClearSavedTerminalData}
            onClose={handleClosePrivacyPanel}
            onRevealStateFile={handleRevealStateFile}
            onRetrySave={handleRetryStateSave}
            onUpdateSettings={handleUpdatePrivacySettings}
          />
        )}
        {commandPaletteOpen && (
          <CommandPalette
            activeWorkspaceId={activeWorkspace.id}
            activeWorkMode={activeWorkMode}
            arrangeMode={arrangeMode}
            allSessions={terminalSessions}
            pendingPlan={activePendingPlan}
            query={commandQuery}
            recoverableSessions={activeRecoverableSessions}
            reviewQueuePreview={reviewQueuePreview}
            attention={activeAttention}
            safeStagedCount={safeStagedCount}
            selectedSessionId={activeSelectedSessionId}
            sessions={activeSessions}
            shortcutModifier={shortcutModifier}
            blockedStagedCount={blockedStagedCount}
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
            onOpenInbox={handleOpenInbox}
            onOpenPrivacyControls={handleOpenPrivacyPanel}
            onReviewAttention={handleReviewAttention}
            onRejectAll={handleRejectAll}
            onRestartSession={handleRestartSession}
            onSelectWorkspace={handleSelectWorkspace}
            onToggleArrange={handleToggleArrangeMode}
          />
        )}
        {sessionObservatoryOpen && (
          <SessionObservatoryPanel
            activeWorkspaceId={activeWorkspace.id}
            sessions={terminalSessions}
            workspaces={workspaces}
            onClose={handleCloseSessionObservatory}
            onOpenSession={handleFocusSessionInWorkspace}
          />
        )}
      </section>
    </main>
  );
}

type QuietWorkspaceNavigationPanelProps = {
  activeWorkspace: WorkspaceRailWorkspace;
  activeWorkspaceId: string;
  activeSessions: SessionTile[];
  inboxCount: number;
  sessions: SessionTile[];
  workspaces: WorkspaceRailWorkspace[];
  onAddWorkspace: () => void;
  onFocusSession: (sessionId: string) => void;
  onFocusSessionInWorkspace: (workspaceId: string, sessionId: string) => void;
  onOpenInbox: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
};

function QuietWorkspaceNavigationPanel({
  activeWorkspace,
  activeWorkspaceId,
  activeSessions,
  inboxCount,
  sessions,
  workspaces,
  onAddWorkspace,
  onFocusSession,
  onFocusSessionInWorkspace,
  onOpenInbox,
  onSelectWorkspace,
}: QuietWorkspaceNavigationPanelProps) {
  const [navigationQuery, setNavigationQuery] = useState("");
  const [showAllEmptyWorkspaces, setShowAllEmptyWorkspaces] = useState(false);
  const freeChats = sessions
    .filter((session) => session.workspaceId !== activeWorkspaceId && isFreeChatSession(session))
    .slice(0, MAX_VISIBLE_FREE_CHAT_SESSIONS);
  const { hiddenEmptyWorkspaceCount, visibleWorkspaces } = visibleNavigationWorkspaces(
    workspaces,
    sessions,
    activeWorkspaceId,
    navigationQuery,
    showAllEmptyWorkspaces,
  );

  return (
    <aside className="workspace-navigation-panel" data-testid="workspace-navigation-panel" aria-label="Runs and workspaces">
      <header className="workspace-nav-head" title={activeWorkspace.rootPath ?? undefined}>
        <span className="workspace-nav-avatar">{activeWorkspace.shortLabel}</span>
        <div>
          <strong>{activeWorkspace.label}</strong>
          <span>
            {activeSessions.length} terminals · {activeWorkspace.gitBranch ?? "local"}
          </span>
        </div>
      </header>
      <label className="workspace-nav-search">
        <Search size={14} />
        <input
          aria-label="Search sessions, chats, files"
          placeholder="Search sessions, chats, files"
          value={navigationQuery}
          onChange={(event) => setNavigationQuery(event.target.value)}
        />
      </label>
      <div className="workspace-nav-scroll">
        <section className="workspace-nav-section">
          <header>
            <span>Terminals</span>
          </header>
          <div className="workspace-nav-list">
            {activeSessions.length === 0 ? (
              <p className="workspace-nav-empty">No active terminals in this workspace.</p>
            ) : (
              activeSessions.slice(0, MAX_VISIBLE_ACTIVE_NAV_SESSIONS).map((session) => {
                const status = terminalSessionDisplayStatus(session);
                const kindMeta = tileKindMeta(sessionTileKind(session));
                return (
                  <button
                    key={session.id}
                    type="button"
                    className="workspace-nav-row"
                    title={session.cwd}
                    onClick={() => onFocusSession(session.id)}
                  >
                    <span className={`workspace-nav-mark ${kindMeta.className}`}>{kindMeta.shortLabel}</span>
                    <strong>{session.title}</strong>
                    <small>{status.label}</small>
                  </button>
                );
              })
            )}
          </div>
        </section>
        <button type="button" className="workspace-nav-row workspace-nav-inbox" onClick={onOpenInbox}>
          <span className={`workspace-nav-mark${inboxCount > 0 ? " alert" : ""}`} aria-hidden="true">
            {inboxCount > 0 ? "!" : ""}
          </span>
          <strong>Inbox</strong>
          <small>{inboxNavigationSummary(inboxCount)}</small>
        </button>
        {freeChats.length > 0 && (
          <section className="workspace-nav-section">
            <header>
              <span>Free chats</span>
            </header>
            <div className="workspace-nav-list">
              {freeChats.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="workspace-nav-row"
                  title={session.cwd}
                  onClick={() => onFocusSessionInWorkspace(session.workspaceId, session.id)}
                >
                  <span className="workspace-nav-mark">FC</span>
                  <strong>{session.title}</strong>
                </button>
              ))}
            </div>
          </section>
        )}
        <section className="workspace-nav-section workspace-nav-workspaces">
          <header>
            <span>Workspaces</span>
          </header>
          <WorkspaceRail
            activeWorkspaceId={activeWorkspaceId}
            embedded
            sessions={sessions}
            workspaces={visibleWorkspaces}
            onAddWorkspace={onAddWorkspace}
            onSelectWorkspace={onSelectWorkspace}
          />
          {navigationQuery.trim().length === 0 && hiddenEmptyWorkspaceCount > 0 && !showAllEmptyWorkspaces && (
            <button
              type="button"
              className="workspace-nav-more-button"
              onClick={() => setShowAllEmptyWorkspaces(true)}
            >
              Show {hiddenEmptyWorkspaceCount} more empty workspaces
            </button>
          )}
        </section>
      </div>
    </aside>
  );
}

function PrivacyPanel({
  saveStatus,
  settings,
  onClearSavedTerminalData,
  onClose,
  onRevealStateFile,
  onRetrySave,
  onUpdateSettings,
}: {
  saveStatus: DesktopSaveStatus;
  settings: DesktopPrivacySettings;
  onClearSavedTerminalData: () => Promise<DesktopStateClearSavedTerminalDataResult>;
  onClose: () => void;
  onRevealStateFile: () => Promise<DesktopStateRevealFileResult>;
  onRetrySave: () => Promise<void>;
  onUpdateSettings: (settings: DesktopPrivacySettings) => Promise<void>;
}) {
  const [clearArmed, setClearArmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const updateRetention = (terminalScrollbackRetention: DesktopPrivacySettings["terminalScrollbackRetention"]) => {
    setMessage(null);
    void onUpdateSettings({ ...settings, terminalScrollbackRetention });
  };

  const updateExternalIndexing = () => {
    setMessage(null);
    void onUpdateSettings({
      ...settings,
      externalSessionIndexingEnabled: !settings.externalSessionIndexingEnabled,
    });
  };

  const clearSavedTerminalData = async () => {
    const result = await onClearSavedTerminalData();
    setClearArmed(false);
    setMessage(
      result.ok
        ? `Cleared saved data for ${result.clearedSessions} session${result.clearedSessions === 1 ? "" : "s"}.`
        : result.error,
    );
  };

  const revealStateFile = async () => {
    const result = await onRevealStateFile();
    setMessage(result.ok ? "Local state file revealed." : result.error);
  };

  return (
    <div className="privacy-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="privacy-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Local Data & Privacy"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="privacy-panel-header">
          <div>
            <span>Local controls</span>
            <strong>Local Data & Privacy</strong>
            <small>Saved terminal data and external Codex indexing</small>
          </div>
          <button type="button" className="privacy-panel-close" onClick={onClose} aria-label="Close privacy controls">
            <X size={15} />
          </button>
        </header>
        <div className="privacy-panel-body">
          <section className="privacy-control-row">
            <div>
              <strong>Terminal scrollback retention</strong>
              <span>{settings.terminalScrollbackRetention === "off" ? "Saved terminal buffers are disabled." : "Only a redacted 80k tail is saved."}</span>
            </div>
            <div className="privacy-segmented" role="group" aria-label="Terminal scrollback retention">
              <button
                type="button"
                aria-pressed={settings.terminalScrollbackRetention === "redactedTail"}
                onClick={() => updateRetention("redactedTail")}
              >
                <ShieldCheck size={14} />
                <span>Redacted tail</span>
              </button>
              <button
                type="button"
                aria-pressed={settings.terminalScrollbackRetention === "off"}
                onClick={() => updateRetention("off")}
              >
                <X size={14} />
                <span>Off</span>
              </button>
            </div>
          </section>

          <section className="privacy-control-row">
            <div>
              <strong>External Codex indexing</strong>
              <span>{settings.externalSessionIndexingEnabled ? "Observatory can index local Codex transcripts." : "Observatory will not scan external Codex transcripts."}</span>
            </div>
            <label className="privacy-toggle">
              <input
                type="checkbox"
                checked={settings.externalSessionIndexingEnabled}
                onChange={updateExternalIndexing}
              />
              <span>{settings.externalSessionIndexingEnabled ? "On" : "Off"}</span>
            </label>
          </section>

          <section className="privacy-action-row">
            <div>
              <strong>Saved transcripts</strong>
              <span>Clear Alfred's persisted terminal buffers and activity previews.</span>
            </div>
            {clearArmed ? (
              <div className="privacy-confirm-actions">
                <button type="button" onClick={() => setClearArmed(false)}>
                  Cancel
                </button>
                <button type="button" className="danger" onClick={() => void clearSavedTerminalData()}>
                  <Trash2 size={14} />
                  <span>Confirm clear</span>
                </button>
              </div>
            ) : (
              <button type="button" className="privacy-action-button danger" onClick={() => setClearArmed(true)}>
                <Trash2 size={14} />
                <span>Clear saved transcripts</span>
              </button>
            )}
          </section>

          <section className="privacy-action-row">
            <div>
              <strong>Local state file</strong>
              <span>Reveal Alfred's desktop state file in Finder.</span>
            </div>
            <button type="button" className="privacy-action-button" onClick={() => void revealStateFile()}>
              <Eye size={14} />
              <span>Reveal local state file</span>
            </button>
          </section>

          {saveStatus.status === "saveFailed" && (
            <div className="privacy-panel-status error" role="alert">
              <span>{saveStatus.message}</span>
              <button type="button" onClick={() => void onRetrySave()}>
                <RefreshCcw size={14} />
                <span>Retry</span>
              </button>
            </div>
          )}
          {message && (
            <div className="privacy-panel-status" role="status">
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DiscardCheckoutDialog({
  confirmation,
  onCancel,
  onConfirmDiscard,
  onReviewChanges,
}: {
  confirmation: PendingDiscardConfirmation;
  onCancel: () => void;
  onConfirmDiscard: () => void;
  onReviewChanges: () => void;
}) {
  const changedFileLabel = `${confirmation.files.length} changed file${confirmation.files.length === 1 ? "" : "s"}`;
  const previewFiles = confirmation.files.slice(0, 6);
  const remaining = confirmation.files.length - previewFiles.length;

  return (
    <div className="discard-checkout-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="discard-checkout-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Discard isolated checkout"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="discard-checkout-header">
          <div>
            <span>Destructive action</span>
            <strong>Discard isolated checkout</strong>
            <small>{confirmation.title} · {changedFileLabel}</small>
          </div>
          <button type="button" className="discard-checkout-close" onClick={onCancel} aria-label="Close discard dialog">
            <X size={15} />
          </button>
        </header>
        <div className="discard-checkout-body">
          <p>
            This checkout has local changes. Review them before deleting the isolated worktree, or confirm discard
            explicitly.
          </p>
          <dl>
            <div>
              <dt>status</dt>
              <dd>{confirmation.summary}</dd>
            </div>
            <div>
              <dt>files</dt>
              <dd>{changedFileLabel}</dd>
            </div>
          </dl>
          <ol aria-label="Changed files">
            {previewFiles.map((file) => (
              <li key={`${file.status}:${file.path}`}>
                <span>{file.status}</span>
                <code>{file.path}</code>
              </li>
            ))}
            {remaining > 0 && <li className="discard-checkout-more">+{remaining} more</li>}
          </ol>
        </div>
        <footer className="discard-checkout-actions">
          <button type="button" className="discard-checkout-primary" onClick={onReviewChanges}>
            Review changes
          </button>
          <button type="button" className="discard-checkout-cancel" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button type="button" className="discard-checkout-danger" onClick={onConfirmDiscard}>
            Discard checkout permanently
          </button>
        </footer>
      </div>
    </div>
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
          <strong>{workspaceLabel}</strong>
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
                <Pencil size={14} />
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

function isReviewableWorktreeSession(
  session: Pick<SessionTile, "baseCwd" | "branchName" | "isolation"> | null | undefined,
): boolean {
  if (session?.isolation === "shared") return false;
  return Boolean(session?.baseCwd && session.branchName);
}

function worktreeDiffDetail(result: {
  summary: string;
  files: Array<{ path: string; status: string }>;
}): string {
  if (result.files.length === 0) {
    return "No changes in the isolated checkout.";
  }

  const preview = result.files
    .slice(0, 5)
    .map((file) => `${file.status} ${file.path}`)
    .join(", ");
  const remaining = result.files.length > 5 ? `, +${result.files.length - 5} more` : "";
  return `${result.summary}: ${preview}${remaining}`;
}

function changedFileCountLabel(count: number): string {
  return `${count} file${count === 1 ? "" : "s"}`;
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
    ...(session.isolation === undefined ? {} : { isolation: session.isolation }),
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

function mergeSnapshotActivityEvents(
  currentEvents: SessionActivityEvent[] | undefined,
  snapshotEvents: SessionActivityEvent[] | undefined,
): SessionActivityEvent[] | undefined {
  if (snapshotEvents === undefined) return currentEvents;
  if (currentEvents === undefined) return snapshotEvents;

  const mergedByKey = new Map<string, SessionActivityEvent>();
  for (const event of [...snapshotEvents, ...currentEvents]) {
    const key = event.id || `${event.kind}:${event.title}:${event.detail}:${event.at}`;
    const previous = mergedByKey.get(key);
    if (!previous || previous.at <= event.at) {
      mergedByKey.set(key, event);
    }
  }

  return Array.from(mergedByKey.values())
    .sort((left, right) => left.at - right.at)
    .slice(-40);
}

function maxDefinedTimestamp(...values: Array<number | undefined>): number | undefined {
  const definedValues = values.filter((value): value is number => value !== undefined);
  return definedValues.length > 0 ? Math.max(...definedValues) : undefined;
}

function mergeSessionInitialBuffer(
  currentBuffer: string | undefined,
  incomingBuffer: string | undefined,
): string | undefined {
  if (currentBuffer === undefined) return incomingBuffer;
  if (incomingBuffer === undefined) return currentBuffer;
  if (currentBuffer === incomingBuffer) return incomingBuffer;
  if (incomingBuffer.includes(currentBuffer)) return incomingBuffer;
  if (currentBuffer.includes(incomingBuffer)) return currentBuffer;
  if (incomingBuffer.endsWith(currentBuffer)) return incomingBuffer;
  if (currentBuffer.endsWith(incomingBuffer)) return currentBuffer;

  const maxOverlap = Math.min(currentBuffer.length, incomingBuffer.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (currentBuffer.endsWith(incomingBuffer.slice(0, overlap))) {
      return `${currentBuffer}${incomingBuffer.slice(overlap)}`;
    }
  }

  return incomingBuffer.length >= currentBuffer.length ? incomingBuffer : currentBuffer;
}

function isFreeChatSession(session: SessionTile): boolean {
  return session.stage === "live" && session.cwd.includes("/Documents/Codex/");
}

function accessibleSessionStatusLabel(session: SessionTile): string {
  if (session.stage === "staged") {
    if (session.stagedReviewStatus === "checking") return "checking";
    return isLaunchBlocked(session) ? "blocked" : "ready";
  }

  if (session.runtimeStatus === undefined) return terminalSessionDisplayStatus(session).label;

  switch (session.runtimeStatus) {
    case "starting":
      return "starting";
    case "live":
      return "running";
    case "exited":
      return "done";
    case "error":
      return "error";
    case "restored":
      return "restored";
    case "unavailable":
      return "unavailable";
  }
}

function visibleNavigationWorkspaces(
  workspaces: WorkspaceRailWorkspace[],
  sessions: SessionTile[],
  activeWorkspaceId: string,
  query: string,
  showAllEmptyWorkspaces: boolean,
): { hiddenEmptyWorkspaceCount: number; visibleWorkspaces: WorkspaceRailWorkspace[] } {
  const normalizedQuery = normalizeNavigationQuery(query);
  const workspaceIdsWithSessions = new Set(sessions.map((session) => session.workspaceId));
  const sessionsByWorkspaceId = new Map<string, SessionTile[]>();
  for (const session of sessions) {
    const existing = sessionsByWorkspaceId.get(session.workspaceId);
    if (existing) {
      existing.push(session);
      continue;
    }
    sessionsByWorkspaceId.set(session.workspaceId, [session]);
  }

  const visibleWorkspaces: WorkspaceRailWorkspace[] = [];
  let hiddenEmptyWorkspaceCount = 0;
  let visibleEmptyWorkspaceCount = 0;

  for (const workspace of workspaces) {
    const isActiveWorkspace = workspace.id === activeWorkspaceId;
    const hasSessions = workspaceIdsWithSessions.has(workspace.id);
    const isEmptyWorkspace = !isActiveWorkspace && !hasSessions;

    if (!isEmptyWorkspace) {
      visibleWorkspaces.push(workspace);
      continue;
    }

    if (normalizedQuery.length > 0) {
      if (workspaceMatchesNavigationQuery(workspace, sessionsByWorkspaceId.get(workspace.id) ?? [], normalizedQuery)) {
        visibleWorkspaces.push(workspace);
      }
      continue;
    }

    if (showAllEmptyWorkspaces || visibleEmptyWorkspaceCount < MAX_VISIBLE_EMPTY_NAV_WORKSPACES) {
      visibleEmptyWorkspaceCount += 1;
      visibleWorkspaces.push(workspace);
      continue;
    }

    hiddenEmptyWorkspaceCount += 1;
  }

  return { hiddenEmptyWorkspaceCount, visibleWorkspaces };
}

function workspaceMatchesNavigationQuery(
  workspace: WorkspaceRailWorkspace,
  sessions: SessionTile[],
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) return true;

  return [
    workspace.label,
    workspace.shortLabel,
    workspace.rootPath,
    workspace.gitBranch,
    ...sessions.flatMap((session) => [session.title, session.cwd]),
  ].some((value) => normalizeNavigationQuery(value).includes(normalizedQuery));
}

function normalizeNavigationQuery(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function workspaceRootPath(state: WorkspaceStateSnapshot | null, workspaceId: string): string {
  return state?.workspaces.find((workspace) => workspace.id === workspaceId)?.rootPath ?? "";
}

function dispatchTargetsForWorkspace(
  workspace: Workspace,
  sessions: SessionTile[],
  selectedSession: SessionTile | null,
): DispatchTargetSnapshot[] {
  const targets: DispatchTargetSnapshot[] = [{ kind: "workspace", id: workspace.id, label: workspace.label }];
  if (selectedSession) {
    targets.push({ kind: "session", id: selectedSession.id, label: selectedSession.title });
  }
  for (const session of sessions) {
    if (session.id === selectedSession?.id) continue;
    targets.push({ kind: "session", id: session.id, label: session.title });
  }
  return targets;
}

function dispatchTargetsEqual(
  left: DispatchTargetSnapshot | null | undefined,
  right: DispatchTargetSnapshot | null | undefined,
): boolean {
  return Boolean(left && right && left.kind === right.kind && left.id === right.id);
}

function importantContextSignalCount(session: SessionTile | null): number {
  if (!session) return 0;
  let count = 0;
  if (session.stage === "staged") count += 1;
  if (session.runtimeStatus === "restored" || session.runtimeStatus === "exited" || session.runtimeStatus === "error") {
    count += 1;
  }
  if (session.safetyNote || isLaunchBlocked(session)) count += 1;
  if (session.activityEvents?.some((event) => event.kind === "error" || event.kind === "warning" || event.kind === "approval")) {
    count += 1;
  }
  return Math.min(count, 9);
}

function createScratchWorkspaceState(workspaces: Workspace[]): WorkspaceStateSnapshot {
  const usedIds = new Set(workspaces.map((workspace) => workspace.id));
  let index = workspaces.length + 1;
  let id = `W${index}`;

  while (usedIds.has(id)) {
    index += 1;
    id = `W${index}`;
  }

  const workspace: Workspace = {
    id,
    label: `Workspace ${index}`,
    shortLabel: id,
  };

  return {
    workspaces: [...workspaces, workspace],
    activeWorkspaceId: workspace.id,
  };
}

function workspaceForCwd(cwd: string, workspaces: Workspace[]): Workspace | null {
  return findWorkspaceForCwd(cwd, workspaces);
}

function omitWorkspaceRecord<T>(record: Record<string, T>, workspaceId: string): Record<string, T> {
  if (!(workspaceId in record)) return record;
  const next = { ...record };
  delete next[workspaceId];
  return next;
}

function workspacePlanContext(
  workspace: Workspace,
  sessions: SessionTile[],
  dispatchTarget?: DispatchTargetSnapshot,
): AlfredWorkspaceContext {
  const contextSessions =
    dispatchTarget?.kind === "session" ? sessions.filter((session) => session.id === dispatchTarget.id) : sessions;
  return {
    id: workspace.id,
    label: workspace.label,
    ...(workspace.rootPath === undefined ? {} : { rootPath: workspace.rootPath }),
    ...(workspace.gitBranch === undefined ? {} : { gitBranch: workspace.gitBranch }),
    ...(workspace.missionBrief === undefined ? {} : { missionBrief: workspace.missionBrief }),
    ...(contextSessions.length === 0
      ? {}
      : {
          sessions: contextSessions.slice(0, 8).map((session) => {
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

function workspaceDetail(workspace: Workspace): string {
  const location = workspace.rootPath ? shortenPath(workspace.rootPath) : "local desk";
  return workspace.gitBranch ? `${location} · ${workspace.gitBranch}` : location;
}

function mergeLiveSessions(sessions: SessionTile[], liveSessions: SessionTile[]): SessionTile[] {
  const liveById = new Map(liveSessions.map((session) => [session.id, session]));
  const existingIds = new Set(sessions.map((session) => session.id));
  const merged = sessions.map((session) => {
    const liveSession = liveById.get(session.id);
    if (!liveSession) return session;

    const mergedInitialBuffer = mergeSessionInitialBuffer(session.initialBuffer, liveSession.initialBuffer);
    const mergedActivityEvents = mergeSnapshotActivityEvents(session.activityEvents, liveSession.activityEvents);
    const mergedLastActivityAt = maxDefinedTimestamp(
      session.lastActivityAt,
      liveSession.lastActivityAt,
      mergedActivityEvents?.at(-1)?.at,
    );
    const mergedLastOutputAt = maxDefinedTimestamp(session.lastOutputAt, liveSession.lastOutputAt);

    return {
      ...liveSession,
      ...(mergedInitialBuffer === undefined ? {} : { initialBuffer: mergedInitialBuffer }),
      ...(mergedActivityEvents === undefined ? {} : { activityEvents: mergedActivityEvents }),
      ...(mergedLastActivityAt === undefined ? {} : { lastActivityAt: mergedLastActivityAt }),
      ...(mergedLastOutputAt === undefined ? {} : { lastOutputAt: mergedLastOutputAt }),
    };
  });
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
