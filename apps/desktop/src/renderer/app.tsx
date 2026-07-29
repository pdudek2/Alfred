import {
  Eye,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getDesktopAlfredApi,
  getDesktopLayoutApi,
  getDesktopSessionsApi,
  getDesktopStateApi,
  getDesktopTerminalApi,
  getDesktopWorkspaceApi,
} from "./desktop-api";
import { ComposerBar } from "./composer";
import { CommandPalette } from "./components/CommandPalette";
import { ContextColumn } from "./components/ContextColumn";
import { PrepareWorkPopover } from "./components/PrepareWorkPopover";
import { ProjectNavigator, type ProjectNavigatorWorkspace } from "./components/ProjectNavigator";
import { ReviewSurface } from "./components/ReviewSurface";
import { SessionsSurface } from "./components/SessionsSurface";
import { TerminalDesk, type WorktreeActionKind } from "./components/TerminalDesk";
import { WorkbenchHeader, type PrimarySurface } from "./components/WorkbenchHeader";
import { WorkSurfaceToolbar } from "./components/WorkSurfaceToolbar";
import { WorkspaceActionsMenu } from "./components/WorkspaceActionsMenu";
import { WorkspacePreviewDock } from "./components/WorkspacePreviewDock";
import {
  blockingAttentionCount,
  blockingAttentionCountByWorkspace,
  buildAttentionProjection,
} from "./attention-projection";
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
  rejectStaged,
  relaunchRestoredSession,
  renameSession,
  restartSession,
  sessionInstanceKey,
  terminalEventMatchesSession,
  type SessionActivityEvent,
  type SessionTile,
} from "./session-state";
import { terminalSessionDisplayStatus } from "./session-status";
import { createInitialSessionsViewState } from "./sessions-view-state";
import { recordPreviewUrlsFromText, type PreviewUrlCandidate } from "./preview-state";
import type { WorkMode } from "./terminal-desk-types";
import { shortenPath } from "./path-display";
import { sessionRelaunchSafety } from "./relaunch-safety";
import type { SessionsPrimaryActionRequest } from "./sessions-projection";
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
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionIsolation,
  TerminalSessionSnapshot,
} from "../shared/terminal-ipc";
import {
  PREVIEW_DOCK_DEFAULT_WIDTH,
  type DispatchTargetSnapshot,
  type WorkspaceViewState,
} from "../shared/layout-ipc";
import type { WorkspaceMissionBrief, WorkspaceStateSnapshot } from "../shared/workspace-ipc";
import {
  SESSIONS_PAGE_SIZE,
  SUMMARY_CACHE_COUNT_LIMIT,
  type ExternalSessionSummary,
  type SessionSummary,
} from "../shared/sessions-ipc";
import "@xterm/xterm/css/xterm.css";

type Workspace = ProjectNavigatorWorkspace;
type WorkspaceHydrationStatus =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "failed"; message: string };

type ShellActionResult = {
  ok: boolean;
  error?: string;
};

type PendingDiscardConfirmation = {
  files: Array<{ path: string; status: string }>;
  sessionId: string;
  summary: string;
  title: string;
};

const ACCESSIBLE_DISMISSAL_OWNER_SELECTOR =
  'dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"]';

const DEFAULT_WORKSPACE_ID = "A";
const DEFAULT_WORKSPACE: Workspace = { id: DEFAULT_WORKSPACE_ID, label: "Alfred", shortLabel: "A" };
const DEFAULT_WORKSPACES: Workspace[] = [DEFAULT_WORKSPACE];
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
  const [shellActionError, setShellActionError] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<SquadPlan | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [commandQuery, setCommandQuery] = useState<string>("");
  const [privacyPanelOpen, setPrivacyPanelOpen] = useState<boolean>(false);
  const [privacySettings, setPrivacySettings] = useState<DesktopPrivacySettings>(DEFAULT_PRIVACY_SETTINGS);
  const [desktopSaveStatus, setDesktopSaveStatus] = useState<DesktopSaveStatus>({ status: "saved" });
  const [activeSurface, setActiveSurface] = useState<PrimarySurface>("work");
  const [sessionsViewState, setSessionsViewState] = useState(createInitialSessionsViewState);
  const [workspaceHydrationStatus, setWorkspaceHydrationStatus] = useState<WorkspaceHydrationStatus>({
    status: "loading",
  });
  const [workspaceHydrationRetryIndex, setWorkspaceHydrationRetryIndex] = useState<number>(0);
  const [externalCodexSessions, setExternalCodexSessions] = useState<ExternalSessionSummary[]>([]);
  const [externalCodexSessionsError, setExternalCodexSessionsError] = useState<string | null>(null);
  const [externalCodexSessionsLoading, setExternalCodexSessionsLoading] = useState<boolean>(false);
  const externalSessionsRequestGenerationRef = useRef(0);
  const externalSessionsQueryRefreshTimeoutRef = useRef<number | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState<boolean>(false);
  const [workspaceRenameDraft, setWorkspaceRenameDraft] = useState<string>("");
  const [workspaceRenameEditing, setWorkspaceRenameEditing] = useState<boolean>(false);
  const [projectNavigatorCollapsed, setProjectNavigatorCollapsed] = useState(false);
  const [armedRecoverySessionIds, setArmedRecoverySessionIds] = useState<Set<string>>(() => new Set());
  const [runtimeStatus, setRuntimeStatus] = useState<AlfredRuntimeStatus | null>(null);
  const [previewCandidates, setPreviewCandidates] = useState<PreviewUrlCandidate[]>([]);
  const [selectedPreviewUrlsByWorkspace, setSelectedPreviewUrlsByWorkspace] = useState<Record<string, string>>({});
  const [previewRefreshKeysByWorkspace, setPreviewRefreshKeysByWorkspace] = useState<Record<string, number>>({});
  const [previewDockOpenByWorkspace, setPreviewDockOpenByWorkspace] = useState<Record<string, boolean>>({});
  const [previewDockWidthsByWorkspace, setPreviewDockWidthsByWorkspace] = useState<Record<string, number>>({});
  const [worktreeActionPending, setWorktreeActionPending] = useState<Record<string, WorktreeActionKind | undefined>>({});
  const [collapsedSessionIdsByWorkspace, setCollapsedSessionIdsByWorkspace] = useState<Record<string, string[]>>({});
  const [contextDrawerOpenByWorkspace, setContextDrawerOpenByWorkspace] = useState<Record<string, boolean>>({});
  const [dispatchTargetsByWorkspace, setDispatchTargetsByWorkspace] = useState<Record<string, DispatchTargetSnapshot>>({});
  const [lastDispatchDestination, setLastDispatchDestination] = useState<string | null>(null);
  const [pendingDiscardConfirmation, setPendingDiscardConfirmation] = useState<PendingDiscardConfirmation | null>(null);
  const [prepareWorkOpen, setPrepareWorkOpen] = useState(false);
  const commandPaletteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const prepareWorkTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const surfacesTriggerRef = useRef<HTMLButtonElement | null>(null);
  const privacyReturnFocusRef = useRef<HTMLElement | null>(null);
  const discardReturnFocusRef = useRef<HTMLElement | null>(null);
  const workReturnFocusRef = useRef<HTMLElement | null>(null);
  const workReturnFocusLabelRef = useRef<string | null>(null);
  const restoreWorkFocusPendingRef = useRef(false);
  const contextReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const contextFocusRequestKeyRef = useRef(0);
  const closingSessionIdsRef = useRef(new Map<string, { instanceKey: string }>());
  const startingSessionIdsRef = useRef<Set<string>>(new Set());
  const resumingExternalSessionKeysRef = useRef<Set<string>>(new Set());
  const externalResumeReservationsRef = useRef<Map<string, { tileId: string; workspaceId: string }>>(new Map());
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
  const activePreviewDockOpen = previewVisible && (previewDockOpenByWorkspace[activeWorkspace.id] ?? false);
  const activePreviewDockWidth = previewDockWidthsByWorkspace[activeWorkspace.id] ?? PREVIEW_DOCK_DEFAULT_WIDTH;
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
  const canCloseActiveWorkspace =
    activeWorkspace.id !== DEFAULT_WORKSPACE_ID && workspaces.length > 1 && activeSessions.length === 0;
  const attentionItems = buildAttentionProjection(workspaces, terminalSessions);
  const recoverySessionIds = new Set(
    attentionItems
      .filter((item) => item.section === "recovery" && item.workspaceId === activeWorkspace.id)
      .map((item) => item.sessionId),
  );
  const activeRecoverableSessions = activeSessions.filter((session) => recoverySessionIds.has(session.id));
  const sessionDetailsById: ReadonlyMap<
    string,
    Pick<SessionTile, "args" | "command" | "cwd">
  > = new Map(terminalSessions.map((session) => [
    session.id,
    {
      cwd: session.cwd,
      ...(session.command === undefined ? {} : { command: session.command }),
      ...(session.args === undefined ? {} : { args: session.args }),
    },
  ]));
  const needsYouCount = blockingAttentionCount(attentionItems);
  const attentionCountsByWorkspace = blockingAttentionCountByWorkspace(attentionItems);
  const reviewQueuePreview = attentionItems.find((item) => item.blocksAgent) ?? null;
  const globalStagedCount = terminalSessions.filter((s) => s.stage === "staged").length;
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

  useLayoutEffect(() => {
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

  const handleAddAgentSession = useCallback((kind: Extract<AgentKind, "claude" | "codex">, isolation: TerminalSessionIsolation = "shared") => {
    if (activeWorkspace.rootStatus === "missing") return;
    setTerminalSessions((sessions) =>
      addAgentSession(sessions, kind, activeWorkspace.rootPath ?? "", activeWorkspace.id, isolation),
    );
  }, [activeWorkspace.id, activeWorkspace.rootPath, activeWorkspace.rootStatus]);

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
      if (activeWorkspace.rootStatus === "missing") {
        const snapshot = await workspaceApi.bindFolderToWorkspace({ workspaceId: activeWorkspace.id });
        const workspace = snapshot.workspaces.find((item) => item.id === snapshot.activeWorkspaceId);
        setWorkspaces(snapshot.workspaces);
        setActiveWorkspaceId(snapshot.activeWorkspaceId);
        const rootPath = workspace?.rootPath;
        if (workspace && rootPath && workspace.rootStatus !== "missing") {
          setTerminalSessions((sessions) => addManualSession(sessions, rootPath, workspace.id));
        }
        return;
      }

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
  }, [activeWorkspace.id, activeWorkspace.rootStatus, workspaces]);

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
    setPreviewDockOpenByWorkspace((current) => omitWorkspaceRecord(current, activeWorkspace.id));
    setPreviewDockWidthsByWorkspace((current) => omitWorkspaceRecord(current, activeWorkspace.id));
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
    const dispatchTarget = dispatchTargetsByWorkspace[activeWorkspace.id];
    void layoutApi?.setWorkspaceViewState({
      workspaceId: activeWorkspace.id,
      viewState: {
        workMode: activeWorkMode,
        ...(activeSelectedSessionId === null ? {} : { selectedSessionId: activeSelectedSessionId }),
        ...(collapsedSessionIds.length === 0 ? {} : { collapsedSessionIds }),
        ...(dispatchTarget === undefined ? {} : { dispatchTarget }),
        ...patch,
      },
    });
  }, [
    activeSelectedSessionId,
    activeWorkMode,
    activeWorkspace.id,
    collapsedSessionIdsByWorkspace,
    dispatchTargetsByWorkspace,
  ]);

  const handleToggleContextDrawer = useCallback(() => {
    const nextOpen = !activeContextDrawerOpen;
    if (nextOpen) {
      contextReturnFocusRef.current = surfacesTriggerRef.current;
      contextFocusRequestKeyRef.current += 1;
      setPreviewDockOpenByWorkspace((current) => ({
        ...current,
        [activeWorkspace.id]: false,
      }));
      persistActiveWorkspaceViewState({ previewDockOpen: false });
    }
    setContextDrawerOpenByWorkspace((current) => {
      return {
        ...current,
        [activeWorkspace.id]: nextOpen,
      };
    });
  }, [activeContextDrawerOpen, activeWorkspace.id, persistActiveWorkspaceViewState]);

  const handleOpenContextFromCommandPalette = useCallback(() => {
    contextReturnFocusRef.current = commandPaletteTriggerRef.current;
    contextFocusRequestKeyRef.current += 1;
    setPreviewDockOpenByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: false,
    }));
    persistActiveWorkspaceViewState({ previewDockOpen: false });
    setContextDrawerOpenByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: true,
    }));
  }, [activeWorkspace.id, persistActiveWorkspaceViewState]);

  const handleCloseContextDrawer = useCallback(() => {
    setContextDrawerOpenByWorkspace((current) => {
      if (current[activeWorkspace.id] === false) return current;
      return {
        ...current,
        [activeWorkspace.id]: false,
      };
    });
  }, [activeWorkspace.id]);

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

  const runShellAction = useCallback(async (
    action: () => Promise<ShellActionResult> | undefined,
    fallbackMessage: string,
  ): Promise<boolean> => {
    setShellActionError(null);
    try {
      const result = await action();
      if (!result?.ok) {
        setShellActionError(result?.error ?? fallbackMessage);
        return false;
      }
      return true;
    } catch (error) {
      setShellActionError(error instanceof Error ? error.message : fallbackMessage);
      return false;
    }
  }, []);

  const handleRevealActiveWorkspace = useCallback(async () => {
    const rootPath = activeWorkspace.rootPath;
    if (!rootPath) return;
    await runShellAction(
      () => getDesktopWorkspaceApi()?.revealPath({ cwd: rootPath, path: "." }),
      "Workspace folder is unavailable.",
    );
  }, [activeWorkspace.rootPath, runShellAction]);

  const handleOpenActiveWorkspaceTerminal = useCallback(async () => {
    const rootPath = activeWorkspace.rootPath;
    if (!rootPath) return;
    await runShellAction(
      () => getDesktopWorkspaceApi()?.openExternalTerminal({ cwd: rootPath }),
      "Workspace terminal is unavailable.",
    );
  }, [activeWorkspace.rootPath, runShellAction]);

  const handleCopyActivityText = useCallback(async (value: string) => {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard is unavailable.");
    }
    await navigator.clipboard.writeText(value);
  }, []);

  const handleRevealActivityFile = useCallback(async (filePath: string, cwd: string) => {
    const succeeded = await runShellAction(
      () => getDesktopWorkspaceApi()?.revealPath({ cwd, path: filePath }),
      "Workspace runtime is unavailable.",
    );
    if (!succeeded) throw new Error("Workspace runtime is unavailable.");
  }, [runShellAction]);

  const handleOpenExternalTerminalForCwd = useCallback(async (cwd: string) => {
    const succeeded = await runShellAction(
      () => getDesktopWorkspaceApi()?.openExternalTerminal({ cwd }),
      "Workspace runtime is unavailable.",
    );
    if (!succeeded) throw new Error("Workspace runtime is unavailable.");
  }, [runShellAction]);

  const handleCopySessionCwd = useCallback((cwd: string) => {
    void navigator.clipboard?.writeText(cwd);
  }, []);

  const handleOpenSessionFolder = useCallback(async (cwd: string) => {
    await runShellAction(
      () => getDesktopWorkspaceApi()?.revealPath({ cwd, path: "." }),
      "Session folder is unavailable.",
    );
  }, [runShellAction]);

  const handleOpenSessionTerminal = useCallback(async (cwd: string) => {
    await runShellAction(
      () => getDesktopWorkspaceApi()?.openExternalTerminal({ cwd }),
      "Session terminal is unavailable.",
    );
  }, [runShellAction]);

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
    setShellActionError(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable.");
      await navigator.clipboard.writeText(url);
    } catch (error) {
      setShellActionError(error instanceof Error ? error.message : "Clipboard is unavailable.");
    }
  }, []);

  const handleOpenPreviewExternal = useCallback(async (url: string) => {
    await runShellAction(
      () => getDesktopWorkspaceApi()?.openExternalUrl({ url }),
      "Preview URL is unavailable.",
    );
  }, [runShellAction]);

  const handleTogglePreviewDock = useCallback(() => {
    if (!previewVisible) return;
    const nextOpen = !activePreviewDockOpen;
    if (nextOpen) {
      setContextDrawerOpenByWorkspace((current) => ({
        ...current,
        [activeWorkspace.id]: false,
      }));
    }
    setPreviewDockOpenByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: nextOpen,
    }));
    persistActiveWorkspaceViewState({ previewDockOpen: nextOpen });
  }, [activePreviewDockOpen, activeWorkspace.id, persistActiveWorkspaceViewState, previewVisible]);

  const handleClosePreviewDock = useCallback(() => {
    setPreviewDockOpenByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: false,
    }));
    persistActiveWorkspaceViewState({ previewDockOpen: false });
    requestAnimationFrame(() => previewTriggerRef.current?.focus());
  }, [activeWorkspace.id, persistActiveWorkspaceViewState]);

  const handlePreviewDockWidthChange = useCallback((width: number) => {
    setPreviewDockWidthsByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: width,
    }));
  }, [activeWorkspace.id]);

  const handlePreviewDockWidthCommit = useCallback((width: number) => {
    setPreviewDockWidthsByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: width,
    }));
    persistActiveWorkspaceViewState({ previewDockWidth: width });
  }, [activeWorkspace.id, persistActiveWorkspaceViewState]);

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

  const handleAddManualSession = useCallback(() => {
    if (activeWorkspace.rootStatus === "missing") return;
    const nextSessions = addManualSession(
      terminalSessionsRef.current,
      activeWorkspace.rootPath ?? "",
      activeWorkspace.id,
    );
    const addedSession = nextSessions.at(-1);
    terminalSessionsRef.current = nextSessions;
    setTerminalSessions(nextSessions);
    if (addedSession && activeWorkMode === "focus") handleSelectSession(addedSession.id);
  }, [activeWorkMode, activeWorkspace.id, activeWorkspace.rootPath, activeWorkspace.rootStatus, handleSelectSession]);

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
  const handleOpenInbox = useCallback(() => {
    setCommandPaletteOpen(false);
    setCommandQuery("");
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
    const targetSessions = terminalSessionsRef.current.filter((session) => session.workspaceId === workspaceId);
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
    workModesByWorkspace,
  ]);

  useEffect(() => {
    for (const [codexSessionId] of externalResumeReservationsRef.current) {
      const actual = terminalSessions.find((session) => (
        session.resumeTarget?.agentKind === "codex"
        && session.resumeTarget.sessionId === codexSessionId
      ));
      if (!actual) continue;
      externalResumeReservationsRef.current.delete(codexSessionId);
      handleFocusSessionInWorkspace(actual.workspaceId, actual.id);
    }
  }, [handleFocusSessionInWorkspace, terminalSessions]);

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

  const closeSessionNow = useCallback(async (sessionId: string) => {
    const terminalApi = getDesktopTerminalApi();
    const session = terminalSessionsRef.current.find((item) => item.id === sessionId);
    if (!session || closingSessionIdsRef.current.has(sessionId)) return;

    const closingOperation = { instanceKey: sessionInstanceKey(session) };
    const finishClosing = () => {
      if (closingSessionIdsRef.current.get(sessionId) === closingOperation) {
        closingSessionIdsRef.current.delete(sessionId);
      }
    };
    closingSessionIdsRef.current.set(sessionId, closingOperation);
    const destructiveWorktreeCleanup =
      session.runtimeStatus === "restored" || session.runtimeStatus === "exited" || session.runtimeStatus === "error";
    if (destructiveWorktreeCleanup) {
      const result = terminalApi
        ? await terminalApi.forget({ clientId: session.id, cleanupWorktree: true })
        : { ok: false as const, error: "Desktop terminal API is unavailable." };
      const currentSession = terminalSessionsRef.current.find((item) => item.id === sessionId);
      if (!currentSession || sessionInstanceKey(currentSession) !== closingOperation.instanceKey) {
        finishClosing();
        return;
      }
      if (!result.ok) {
        finishClosing();
        setTerminalSessions((current) =>
          current.some(
            (item) => item.id === sessionId && sessionInstanceKey(item) === closingOperation.instanceKey,
          )
            ? appendSessionActivity(current, session.id, {
                kind: "warning",
                title: "Discard checkout blocked",
                detail: result.error,
              })
            : current,
        );
        return;
      }
    }

    setArmedRecoverySessionIds((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Set(current);
      next.delete(sessionId);
      return next;
    });
    setPreviewCandidates((candidates) => candidates.filter((candidate) => candidate.sessionId !== sessionId));

    if (destructiveWorktreeCleanup) {
      finishClosing();
    } else if (session.runtimeId) {
      terminalApi?.kill({ id: session.runtimeId });
      window.setTimeout(finishClosing, 5_000);
    } else {
      finishClosing();
    }
    setTerminalSessions((sessions) =>
      sessions.some(
        (item) => item.id === sessionId && sessionInstanceKey(item) === closingOperation.instanceKey,
      )
        ? closeSession(sessions, sessionId)
        : sessions,
    );
  }, []);

  const handleCloseSession = useCallback((sessionId: string) => {
    const session = terminalSessionsRef.current.find((item) => item.id === sessionId);
    const terminalApi = getDesktopTerminalApi();
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const destructiveWorktreeCleanup =
      session?.runtimeStatus === "restored" || session?.runtimeStatus === "exited" || session?.runtimeStatus === "error";

    if (!session || !destructiveWorktreeCleanup || !isReviewableWorktreeSession(session)) {
      void closeSessionNow(sessionId);
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
        void closeSessionNow(sessionId);
        return;
      }

      discardReturnFocusRef.current = returnFocus;
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

  const handleCancelDiscardCheckout = useCallback(() => {
    const returnFocus = discardReturnFocusRef.current;
    discardReturnFocusRef.current = null;
    setPendingDiscardConfirmation(null);
    queueMicrotask(() => {
      if (returnFocus?.isConnected) returnFocus.focus();
    });
  }, []);

  const handleReviewDiscardCheckout = useCallback(() => {
    const confirmation = pendingDiscardConfirmation;
    if (!confirmation) return;

    discardReturnFocusRef.current = null;
    setPendingDiscardConfirmation(null);
    void handleReviewWorktree(confirmation.sessionId);
  }, [handleReviewWorktree, pendingDiscardConfirmation]);

  const handleConfirmDiscardCheckout = useCallback(() => {
    const confirmation = pendingDiscardConfirmation;
    if (!confirmation) return;

    discardReturnFocusRef.current = null;
    setPendingDiscardConfirmation(null);
    void closeSessionNow(confirmation.sessionId);
  }, [closeSessionNow, pendingDiscardConfirmation]);

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

    const closingOperation = closingSessionIdsRef.current.get(tileId);
    if (closingOperation) {
      terminalApi?.kill({ id: runtime.id });
      if (closingSessionIdsRef.current.get(tileId) === closingOperation) {
        closingSessionIdsRef.current.delete(tileId);
      }
      return;
    }

    startingSessionIdsRef.current.delete(tileId);
    setTerminalSessions((sessions) => {
      const attached = attachRuntimeSession(sessions, tileId, runtime);
      const attachmentAt = runtime.createdAt ?? Date.now();
      const session = attached.find((candidate) => candidate.id === tileId);
      if (session?.activityEvents?.some((event) => event.at >= attachmentAt)) {
        return attached;
      }
      return appendSessionActivity(attached, tileId, {
        kind: "lifecycle",
        title: "Session attached",
        detail: `${runtime.shell} is running in ${runtime.cwd || "the workspace"}.`,
      }, attachmentAt);
    });
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

  const handleRuntimeSessionExited = useCallback((event: TerminalExitEvent) => {
    const exitedSession = terminalSessionsRef.current.find((item) => terminalEventMatchesSession(item, event));
    if (exitedSession) {
      setPreviewCandidates((candidates) => candidates.filter((candidate) => candidate.sessionId !== exitedSession.id));
    }
    setTerminalSessions((sessions) => {
      const session = sessions.find((item) => terminalEventMatchesSession(item, event));
      const failed = event.exitCode !== 0;
      const next = markSessionExited(sessions, event.id, event.exitCode, event.clientId);
      if (!session) return next;
      return appendSessionActivity(next, session.id, {
        kind: failed ? "error" : "lifecycle",
        title: failed ? "Process failed" : "Process exited",
        detail: failed
          ? `The terminal process exited with code ${event.exitCode}.`
          : "The terminal process ended; scrollback remains available.",
      });
    });
  }, []);

  const handleRuntimeSessionOutput = useCallback((event: TerminalDataEvent) => {
    const session = terminalSessionsRef.current.find((item) => terminalEventMatchesSession(item, event));
    if (session) {
      setPreviewCandidates((candidates) =>
        recordPreviewUrlsFromText(candidates, {
          workspaceId: session.workspaceId,
          sessionId: session.id,
          sessionTitle: session.title,
          text: event.data,
        }),
      );
    }
    setTerminalSessions((sessions) => recordSessionOutputActivity(sessions, event));
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

  const handleLaunchInboxItem = useCallback((sessionId: string) => {
    handleApproveTile(sessionId);
  }, [handleApproveTile]);

  const handleRecoverInboxItem = useCallback((workspaceId: string, sessionId: string) => {
    const session = terminalSessions.find((item) => item.id === sessionId);
    if (!session) return;
    const shouldFocusAfterRecovery = sessionRelaunchSafety(session).safe || armedRecoverySessionIds.has(sessionId);
    if (session?.runtimeStatus === "restored") {
      handleContinueRestoredSession(sessionId);
    } else if (session?.runtimeStatus === "exited" || session?.runtimeStatus === "error") {
      handleRestartSession(sessionId);
    } else {
      return;
    }
    if (shouldFocusAfterRecovery) handleFocusSessionInWorkspace(workspaceId, sessionId);
  }, [
    armedRecoverySessionIds,
    handleContinueRestoredSession,
    handleFocusSessionInWorkspace,
    handleRestartSession,
    terminalSessions,
  ]);

  const handleSelectPrimarySurface = useCallback((nextSurface: PrimarySurface) => {
    if (
      (activeSurface === "inbox" || activeSurface === "sessions") &&
      nextSurface !== activeSurface &&
      armedRecoverySessionIds.size > 0
    ) {
      setArmedRecoverySessionIds(new Set());
      return;
    }
    setActiveSurface(nextSurface);
  }, [activeSurface, armedRecoverySessionIds]);

  const handleExitInboxToWork = useCallback(() => {
    if (armedRecoverySessionIds.size > 0) {
      setArmedRecoverySessionIds(new Set());
      return;
    }
    restoreWorkFocusPendingRef.current = true;
    setActiveSurface("work");
  }, [armedRecoverySessionIds]);

  const handleExitSessionsToWork = useCallback(() => {
    if (armedRecoverySessionIds.size > 0) {
      setArmedRecoverySessionIds(new Set());
      return;
    }
    restoreWorkFocusPendingRef.current = true;
    setActiveSurface("work");
  }, [armedRecoverySessionIds]);

  useEffect(() => {
    if (
      (activeSurface === "inbox" || activeSurface === "sessions")
      || armedRecoverySessionIds.size === 0
    ) return;
    setArmedRecoverySessionIds(new Set());
  }, [activeSurface, armedRecoverySessionIds]);

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

  const handleOpenCommandPalette = useCallback(() => {
    setPrivacyPanelOpen(false);
    setCommandQuery("");
    setCommandPaletteOpen(true);
  }, []);

  const handleOpenPrivacyPanel = useCallback(() => {
    privacyReturnFocusRef.current = commandPaletteOpen
      ? commandPaletteTriggerRef.current
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : surfacesTriggerRef.current;
    setCommandPaletteOpen(false);
    setCommandQuery("");
    setPrivacyPanelOpen(true);
  }, [commandPaletteOpen]);

  const handleClosePrivacyPanel = useCallback(() => {
    setPrivacyPanelOpen(false);
    requestAnimationFrame(() => {
      const target = privacyReturnFocusRef.current;
      if (target?.isConnected) target.focus();
      else surfacesTriggerRef.current?.focus();
      privacyReturnFocusRef.current = null;
    });
  }, []);

  const handleCloseCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
    setCommandQuery("");
  }, []);

  const handleRefreshExternalCodexSessions = useCallback(async (query: string) => {
    if (externalSessionsQueryRefreshTimeoutRef.current !== null) {
      window.clearTimeout(externalSessionsQueryRefreshTimeoutRef.current);
      externalSessionsQueryRefreshTimeoutRef.current = null;
    }
    if (!privacySettings.externalSessionIndexingEnabled) {
      externalSessionsRequestGenerationRef.current += 1;
      setExternalCodexSessions([]);
      setExternalCodexSessionsLoading(false);
      setExternalCodexSessionsError(null);
      return;
    }

    const sessionsApi = getDesktopSessionsApi();
    if (!sessionsApi) {
      setExternalCodexSessionsError("External Codex indexing is unavailable in this build.");
      return;
    }

    const requestGeneration = externalSessionsRequestGenerationRef.current + 1;
    externalSessionsRequestGenerationRef.current = requestGeneration;
    setExternalCodexSessionsLoading(true);
    setExternalCodexSessionsError(null);
    const normalizedQuery = query.trim();
    let snapshotCursorToRelease: string | undefined;
    try {
      const accumulated: ExternalSessionSummary[] = [];
      const seenSessionKeys = new Set<string>();
      const seenCursors = new Set<string>();
      let cursor: string | undefined;

      for (let requestCount = 0; requestCount < SUMMARY_CACHE_COUNT_LIMIT; requestCount += 1) {
        snapshotCursorToRelease = cursor;
        const result = await sessionsApi.listExternalSessions({
          projects: workspaces,
          limit: Math.min(SESSIONS_PAGE_SIZE, SUMMARY_CACHE_COUNT_LIMIT - accumulated.length),
          ...(normalizedQuery ? { query: normalizedQuery } : {}),
          ...(cursor ? { cursor } : {}),
        });
        snapshotCursorToRelease = result.nextCursor ?? undefined;
        if (externalSessionsRequestGenerationRef.current !== requestGeneration) return;

        const previousCount = accumulated.length;
        for (const session of result.sessions) {
          if (seenSessionKeys.has(session.sessionKey)) continue;
          seenSessionKeys.add(session.sessionKey);
          accumulated.push(session);
          if (accumulated.length === SUMMARY_CACHE_COUNT_LIMIT) break;
        }
        setExternalCodexSessions((current) => {
          const merged = new Map(current.map((session) => [session.sessionKey, session]));
          for (const session of accumulated) merged.set(session.sessionKey, session);
          return [...merged.values()];
        });

        const nextCursor = result.nextCursor;
        if (
          !nextCursor
          || accumulated.length === SUMMARY_CACHE_COUNT_LIMIT
          || accumulated.length === previousCount
          || nextCursor === cursor
          || seenCursors.has(nextCursor)
        ) break;
        if (cursor) seenCursors.add(cursor);
        cursor = nextCursor;
      }

      if (externalSessionsRequestGenerationRef.current !== requestGeneration) return;
      setExternalCodexSessions(accumulated);
      setExternalCodexSessionsError(null);
    } catch {
      if (externalSessionsRequestGenerationRef.current !== requestGeneration) return;
      setExternalCodexSessionsError("Refresh failed. Retry when the local session index is available.");
    } finally {
      if (snapshotCursorToRelease) {
        await sessionsApi.releaseListSnapshot({ cursor: snapshotCursorToRelease }).catch(() => {});
      }
      if (externalSessionsRequestGenerationRef.current === requestGeneration) setExternalCodexSessionsLoading(false);
    }
  }, [privacySettings.externalSessionIndexingEnabled, workspaces]);

  const handleUpdatePrivacySettings = useCallback(async (nextSettings: DesktopPrivacySettings) => {
    const desktopStateApi = getDesktopStateApi();
    setPrivacySettings(nextSettings);
    if (!nextSettings.externalSessionIndexingEnabled) {
      externalSessionsRequestGenerationRef.current += 1;
      setExternalCodexSessions([]);
      setExternalCodexSessionsLoading(false);
      setExternalCodexSessionsError(null);
      void getDesktopSessionsApi()?.clearCaches().catch(() => {});
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

  const handleReviewBlockedSession = useCallback((workspaceId: string, sessionId: string) => {
    contextReturnFocusRef.current = null;
    contextFocusRequestKeyRef.current += 1;
    const layoutApi = getDesktopLayoutApi();
    handleFocusSessionInWorkspace(workspaceId, sessionId);
    setPreviewDockOpenByWorkspace((current) => ({
      ...current,
      [workspaceId]: false,
    }));
    void layoutApi?.setWorkspaceViewState({
      workspaceId,
      viewState: { previewDockOpen: false },
    });
    setContextDrawerOpenByWorkspace((current) => ({
      ...current,
      [workspaceId]: true,
    }));
  }, [handleFocusSessionInWorkspace]);

  const handleResumeExternalCodexSession = useCallback(async (summary: SessionSummary) => {
    const sessionKey = summary.sessionKey;
    if (resumingExternalSessionKeysRef.current.has(sessionKey)) return;
    resumingExternalSessionKeysRef.current.add(sessionKey);
    const now = Date.now();
    const sessionsApi = getDesktopSessionsApi();
    try {
      if (!sessionsApi) return;
      const resolved = await sessionsApi.resolveExternalSession({ sessionKey });
      if (resolved.kind !== "resume") return;
      const targetWorkspace = workspaces.find((workspace) => workspace.id === resolved.projectId);
      if (!targetWorkspace) return;
      const alreadyManaged = terminalSessionsRef.current.find((session) => (
        session.resumeTarget?.agentKind === "codex"
        && session.resumeTarget.sessionId === resolved.sessionId
      ));
      if (alreadyManaged) {
        handleFocusSessionInWorkspace(alreadyManaged.workspaceId, alreadyManaged.id);
        return;
      }
      if (externalResumeReservationsRef.current.has(resolved.sessionId)) return;
      const title = normalizeSessionTitle(summary.title ? `Codex · ${summary.title}` : "Codex resume") ?? "Codex resume";
      const tile: SessionTile = {
        id: `external-codex-${resolved.sessionId.slice(0, 8)}-${now}`,
        title,
        workspaceId: targetWorkspace.id,
        cwd: resolved.cwd,
        source: "manual",
        stage: "live",
        runtimeStatus: "starting",
        agentKind: "codex",
        command: "codex",
        args: ["resume", resolved.sessionId],
        resumeTarget: { agentKind: "codex", sessionId: resolved.sessionId, source: "external-session-index" },
        resumeMode: "exact",
        isolation: "shared",
        createdAt: now,
        activityEvents: [
          {
            id: `external-codex-${resolved.sessionId.slice(0, 8)}-${now}-resume`,
            kind: "approval",
            title: "External Codex session resumed",
            detail: "Alfred is opening this Codex transcript in a managed terminal.",
            at: now,
          },
        ],
        lastActivityAt: now,
      };
      externalResumeReservationsRef.current.set(resolved.sessionId, {
        tileId: tile.id,
        workspaceId: targetWorkspace.id,
      });
      setTerminalSessions((sessions) => {
        if (sessions.some((session) => (
          session.resumeTarget?.agentKind === "codex"
          && session.resumeTarget.sessionId === resolved.sessionId
        ))) return sessions;
        return [...sessions, tile];
      });
    } finally {
      resumingExternalSessionKeysRef.current.delete(sessionKey);
    }
  }, [handleFocusSessionInWorkspace, workspaces]);

  const handleAddExternalCodexProject = useCallback(async () => {
    const workspaceApi = getDesktopWorkspaceApi();
    if (!workspaceApi) return;

    const snapshot = await workspaceApi.createWorkspaceFromFolder();
    setWorkspaces(snapshot.workspaces);
    setActiveWorkspaceId(snapshot.activeWorkspaceId);
  }, []);

  const handleSessionsPrimaryAction = useCallback((request: SessionsPrimaryActionRequest) => {
    switch (request.action.kind) {
      case "reveal":
        if (request.target) handleFocusSessionInWorkspace(request.target.workspaceId, request.target.sessionId);
        return;
      case "recover":
        if (request.target) handleRecoverInboxItem(request.target.workspaceId, request.target.sessionId);
        return;
      case "resume-external":
        void handleResumeExternalCodexSession(request.summary);
        return;
      case "add-project":
        void handleAddExternalCodexProject();
        return;
      case "open-project": {
        const workspaceId = request.summary.project.id;
        if (!workspaceId || !workspaces.some((workspace) => workspace.id === workspaceId)) return;
        const workspaceSessions = terminalSessionsRef.current.filter((session) => session.workspaceId === workspaceId);
        const savedSessionId = selectedSessionIdsByWorkspace[workspaceId];
        const targetSession = workspaceSessions.find((session) => session.id === savedSessionId)
          ?? workspaceSessions[0];
        if (targetSession) {
          handleFocusSessionInWorkspace(workspaceId, targetSession.id);
        } else {
          setActiveWorkspaceId(workspaceId);
          setActiveSurface("work");
        }
      }
    }
  }, [
    handleAddExternalCodexProject,
    handleFocusSessionInWorkspace,
    handleRecoverInboxItem,
    handleResumeExternalCodexSession,
    selectedSessionIdsByWorkspace,
    workspaces,
  ]);

  useEffect(() => {
    if (activeSurface !== "sessions") return;
    if (!privacySettings.externalSessionIndexingEnabled) return;
    const query = sessionsViewState.query.trim();
    if (!query) {
      void handleRefreshExternalCodexSessions("");
      return;
    }
    const timeout = window.setTimeout(() => {
      externalSessionsQueryRefreshTimeoutRef.current = null;
      void handleRefreshExternalCodexSessions(query);
    }, 150);
    externalSessionsQueryRefreshTimeoutRef.current = timeout;
    return () => {
      window.clearTimeout(timeout);
      if (externalSessionsQueryRefreshTimeoutRef.current === timeout) {
        externalSessionsQueryRefreshTimeoutRef.current = null;
      }
    };
  }, [activeSurface, handleRefreshExternalCodexSessions, privacySettings.externalSessionIndexingEnabled, sessionsViewState.query]);

  useEffect(() => {
    if (activeSurface !== "work") return;
    if (restoreWorkFocusPendingRef.current) {
      restoreWorkFocusPendingRef.current = false;
      requestAnimationFrame(() => {
        queueMicrotask(() => {
          if (workReturnFocusRef.current?.isConnected) {
            workReturnFocusRef.current.focus();
            return;
          }
          const shell = document.querySelector<HTMLElement>("[data-testid='workbench-shell']");
          const labeledFallback = workReturnFocusLabelRef.current
            ? Array.from(shell?.querySelectorAll<HTMLElement>("[aria-label]") ?? []).find(
              (element) => element.getAttribute("aria-label") === workReturnFocusLabelRef.current,
            )
            : null;
          const fallback = shell?.querySelector<HTMLElement>(
            ".project-session[aria-current='true'], .project-row-button[aria-selected='true'], [data-testid='terminal-input']",
          );
          (labeledFallback ?? fallback)?.focus();
        });
      });
    }
  }, [activeSurface]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (commandPaletteOpen || privacyPanelOpen) {
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
        setDispatchTargetsByWorkspace(
          Object.fromEntries(
            Object.entries(layoutResult.viewStateByWorkspace).flatMap(([workspaceId, viewState]) =>
              viewState.dispatchTarget ? [[workspaceId, viewState.dispatchTarget]] : [],
            ),
          ),
        );
        setPreviewDockOpenByWorkspace(
          Object.fromEntries(
            Object.entries(layoutResult.viewStateByWorkspace).flatMap(([workspaceId, viewState]) =>
              viewState.previewDockOpen === undefined ? [] : [[workspaceId, viewState.previewDockOpen]],
            ),
          ),
        );
        setPreviewDockWidthsByWorkspace(
          Object.fromEntries(
            Object.entries(layoutResult.viewStateByWorkspace).flatMap(([workspaceId, viewState]) =>
              viewState.previewDockWidth === undefined ? [] : [[workspaceId, viewState.previewDockWidth]],
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
        const restoredClientIds = new Set(restoredSessions.map((session) => session.id));
        const hydratedWorkspaceId = workspaceStateResult?.activeWorkspaceId ?? DEFAULT_WORKSPACE_ID;
        const hydratedWorkspaceRootPath = workspaceRootPath(workspaceStateResult, hydratedWorkspaceId);
        const hydratedWorkspaceMissing =
          workspaceStateResult?.workspaces.find((workspace) => workspace.id === hydratedWorkspaceId)?.rootStatus
          === "missing";
        const stagedSessions = hydrateStagedPlanSessions(
          stagedPlanResult.plan,
          hydratedWorkspaceRootPath,
        ).filter(
          (session) => !liveClientIds.has(session.id) && !restoredClientIds.has(session.id),
        );
        const alreadyLaunchedStagedIds =
          stagedPlanResult.plan?.sessions
            .map((session) => session.id)
            .filter((id) => liveClientIds.has(id) || restoredClientIds.has(id)) ?? [];
        if (alreadyLaunchedStagedIds.length > 0) {
          void alfredApi?.resolveStagedPlan({ sessionIds: alreadyLaunchedStagedIds });
        }
        const hydratedSessions =
          liveSessions.length + restoredSessions.length + stagedSessions.length > 0
            ? [...liveSessions, ...restoredSessions, ...stagedSessions]
            : hydratedWorkspaceRootPath && !hydratedWorkspaceMissing
              ? createInitialSessions(
                  hydratedWorkspaceRootPath,
                  hydratedWorkspaceId,
                )
              : [];
        setWorkspaces((current) =>
          ensureWorkspacesForSessions(workspaceStateResult?.workspaces ?? current, hydratedSessions),
        );
        setTerminalSessions(hydratedSessions);
        setPreviewCandidates(previewCandidatesFromSessions(hydratedSessions));
        setPendingPlan(toSquadPlan({ plan: stagedPlanResult.plan, omittedSessionIds: alreadyLaunchedStagedIds }));
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
  const activeSessionCount = activeSessions.length;
  const visibleWorkSessionCount = arrangeMode || activeWorkMode === "desk"
    ? activeSessionCount
    : activeWorkMode === "focus"
      ? Math.min(1, activeSessionCount)
      : Math.min(2, activeSessionCount);
  const inboxOwnsEscape = activeSurface === "inbox";

  return (
    <main
      className="agent-space-shell"
      onFocusCapture={(event) => {
        if (activeSurface !== "work" || !(event.target instanceof HTMLElement)) return;
        if (
          document.activeElement === event.target
          && event.target.closest("[data-testid='workbench-shell']")
        ) {
          workReturnFocusRef.current = event.target;
          workReturnFocusLabelRef.current = event.target.getAttribute("aria-label");
        }
      }}
      onKeyDownCapture={(event) => {
        if (!inboxOwnsEscape || event.key !== "Escape") return;
        const dismissalOwner = activeAccessibleDismissalOwner(event.currentTarget);
        if (dismissalOwner) {
          if (event.target instanceof Node && dismissalOwner.contains(event.target)) return;
          event.preventDefault();
          event.stopPropagation();
          dismissalOwner.dispatchEvent(new KeyboardEvent("keydown", {
            key: event.key,
            code: event.code,
            bubbles: true,
            cancelable: true,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          }));
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        handleExitInboxToWork();
      }}
    >
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
            commandPaletteTriggerRef={commandPaletteTriggerRef}
            inboxCount={needsYouCount}
            prepareWorkTriggerRef={prepareWorkTriggerRef}
            selectedSession={activeSelectedSession}
            shortcutModifier={shortcutModifier}
            surfacesTriggerRef={surfacesTriggerRef}
            workspaceDetail={workspaceDetail(activeWorkspace)}
            onAddAgentSession={handleAddAgentSession}
            onAddManualSession={handleAddManualSession}
            onOpenCommandPalette={handleOpenCommandPalette}
            onOpenInbox={handleOpenInbox}
            onOpenPrepareWork={() => setPrepareWorkOpen(true)}
            onOpenPrivacyControls={handleOpenPrivacyPanel}
            onSelectSurface={handleSelectPrimarySurface}
            onToggleContext={handleToggleContextDrawer}
          />
        </div>

        {shellActionError && (
          <div className="shell-action-alert" role="alert" aria-label="Shell action failed">
            <div>
              <strong>Action unavailable</strong>
              <span>{shellActionError}</span>
            </div>
            <button
              type="button"
              aria-label="Dismiss action error"
              onClick={() => setShellActionError(null)}
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
        )}

        <div className="desktop-alert-stack">
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
        </div>

        <div
          className={[
            "workspace-layout",
            `surface-${activeSurface}`,
            activePreviewDockOpen ? "preview-visible" : "",
            activeContextDrawerOpen ? "context-visible" : "",
          ].filter(Boolean).join(" ")}
          data-testid="workbench-shell"
        >
          {activeSurface === "work" && (
            <ProjectNavigator
              activeSessionId={activeSelectedSessionId}
              activeWorkspaceId={activeWorkspace.id}
              attentionCountsByWorkspace={attentionCountsByWorkspace}
              collapsed={projectNavigatorCollapsed}
              sessions={terminalSessions}
              workspaces={workspaces}
              workspaceActions={(
                <WorkspaceActionsMenu
                  canCloseWorkspace={canCloseActiveWorkspace}
                  detail={workspaceDetail(activeWorkspace)}
                  menuOpen={workspaceMenuOpen}
                  missionBrief={activeWorkspace.missionBrief}
                  renameDraft={workspaceRenameDraft}
                  renameEditing={workspaceRenameEditing}
                  {...(activeWorkspace.rootPath ? { rootPath: activeWorkspace.rootPath } : {})}
                  workspaceLabel={activeWorkspace.label}
                  onCancelRename={handleCancelWorkspaceRename}
                  onChangeRenameDraft={setWorkspaceRenameDraft}
                  onClose={() => {
                    setWorkspaceMenuOpen(false);
                    setWorkspaceRenameEditing(false);
                  }}
                  onCloseWorkspace={handleCloseActiveWorkspace}
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
              )}
              onAddWorkspace={handleAddWorkspace}
              onFocusSessionInWorkspace={handleFocusSessionInWorkspace}
              onSelectWorkspace={handleSelectWorkspace}
              onToggleCollapsed={() => setProjectNavigatorCollapsed((collapsed) => !collapsed)}
            />
          )}
          <div className="orchestrator-surface" data-testid="workbench-surface">
            <div
              className={`surface-panel desk-surface-panel ${workSurfaceHidden ? "inactive" : "active"}`}
              data-testid="desk-runtime-surface"
              aria-hidden={workSurfaceHidden ? "true" : undefined}
              inert={workSurfaceHidden || undefined}
            >
              <WorkSurfaceToolbar
                arrangeMode={arrangeMode}
                branch={activeWorkspace.gitBranch}
                previewAvailable={previewVisible}
                previewOpen={activePreviewDockOpen}
                previewTriggerRef={previewTriggerRef}
                rootPath={activeWorkspace.rootPath}
                terminalLaunchDisabled={activeWorkspace.rootStatus === "missing"}
                visibleSessionCount={visibleWorkSessionCount}
                workMode={activeWorkMode}
                onAddManualSession={handleAddManualSession}
                onApplyWorkMode={handleApplyWorkMode}
                onToggleArrangeMode={handleToggleArrangeMode}
                onTogglePreview={handleTogglePreviewDock}
              />
              <WorkspacePreviewDock
                open={activePreviewDockOpen}
                width={activePreviewDockWidth}
                onWidthChange={handlePreviewDockWidthChange}
                onWidthCommit={handlePreviewDockWidthCommit}
                previewProps={{
                  candidates: activePreviewCandidates,
                  refreshKey: activePreviewRefreshKey,
                  selectedUrl: activeSelectedPreviewUrl,
                  workspaceLabel: activeWorkspace.label,
                  onClose: handleClosePreviewDock,
                  onCopyUrl: handleCopyPreviewUrl,
                  onOpenExternal: handleOpenPreviewExternal,
                  onRefresh: handleRefreshPreview,
                  onSelectUrl: handleSelectPreviewUrl,
                }}
              >
                <TerminalDesk
                  activeWorkspaceId={activeWorkspace.id}
                  arrangeMode={arrangeMode}
                  armedRecoverySessionIds={armedRecoverySessionIds}
                  collapsedSessionIds={activeCollapsedSessionIds}
                  layouts={ensureTileLayouts(activeSessions, tileLayoutsByWorkspace[activeWorkspace.id] ?? {})}
                  recoverableSessions={activeRecoverableSessions}
                  selectedSessionId={activeSelectedSessionId}
                  sessions={terminalSessions}
                  surfaceActive={!workSurfaceHidden}
                  workMode={activeWorkMode}
                  worktreeActionPending={worktreeActionPending}
                  workspaceGitBranch={activeWorkspace.gitBranch}
                  workspaceLabel={activeWorkspace.label}
                  workspaceRootPath={activeWorkspace.rootPath}
                  workspaceRootStatus={activeWorkspace.rootStatus}
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
                  onToggleCollapseSession={handleToggleCollapseSession}
                />
              </WorkspacePreviewDock>
            </div>
            {activeSurface === "inbox" && (
              <div className="surface-panel active">
                <ReviewSurface
                  attentionItems={attentionItems}
                  armedRecoverySessionIds={armedRecoverySessionIds}
                  sessionDetailsById={sessionDetailsById}
                  onDiscardRecovery={handleCloseSession}
                  onLaunch={handleLaunchInboxItem}
                  onOpenInWork={handleFocusSessionInWorkspace}
                  onRecover={handleRecoverInboxItem}
                  onReviewEdit={handleReviewBlockedSession}
                  onBackToWork={handleExitInboxToWork}
                />
              </div>
            )}
            {activeSurface === "sessions" && (
              <div className="surface-panel active">
                <SessionsSurface
                  armedRecoverySessionIds={armedRecoverySessionIds}
                  externalSessionIndexingEnabled={privacySettings.externalSessionIndexingEnabled}
                  externalSessions={externalCodexSessions}
                  externalSessionsError={externalCodexSessionsError}
                  loadingExternalSessions={externalCodexSessionsLoading}
                  sessions={terminalSessions}
                  sessionsApi={getDesktopSessionsApi()}
                  state={sessionsViewState}
                  terminalApi={getDesktopTerminalApi()}
                  workspaces={workspaces}
                  onBackToWork={handleExitSessionsToWork}
                  onOpenPrivacySettings={handleOpenPrivacyPanel}
                  onPrimaryAction={handleSessionsPrimaryAction}
                  onRefreshExternalSessions={() => void handleRefreshExternalCodexSessions(sessionsViewState.query)}
                  onStateChange={setSessionsViewState}
                />
              </div>
            )}
          </div>
          <ContextColumn
            contextOpen={activeContextDrawerOpen}
            dismissalSuspended={
              commandPaletteOpen ||
              privacyPanelOpen ||
              prepareWorkOpen ||
              workspaceMenuOpen ||
              pendingDiscardConfirmation !== null ||
              inboxOwnsEscape
            }
            focusRequestKey={contextFocusRequestKeyRef.current}
            returnFocusRef={contextReturnFocusRef}
            onCloseContext={handleCloseContextDrawer}
            timelineProps={{
              session: activeInspectedSession,
              onCopyActivityText: handleCopyActivityText,
              onOpenExternalTerminal: handleOpenExternalTerminalForCwd,
              onRevealActivityFile: handleRevealActivityFile,
              onUpdateStagedSession: handleUpdateStagedSession,
            }}
          />
        </div>
        {prepareWorkOpen && (
          <PrepareWorkPopover
            dismissalSuspended={commandPaletteOpen || privacyPanelOpen}
            triggerRef={prepareWorkTriggerRef}
            onClose={() => setPrepareWorkOpen(false)}
          >
            <ComposerBar
              autoFocus
              blockedActionLabel={
                stagedWorkspaceId && stagedWorkspaceLabel
                  ? `Open ${stagedWorkspaceLabel}`
                  : undefined
              }
              blockedReason={composerBlockedReason}
              dispatchTarget={activeDispatchTarget}
              lastDispatchDestination={lastDispatchDestination}
              requestError={alfredStatus.kind === "error" ? alfredStatus.error.message : undefined}
              thinking={isThinking(alfredStatus)}
              disabled={commandPaletteOpen || privacyPanelOpen}
              onBlockedAction={
                stagedWorkspaceId
                  ? () => handleSelectWorkspace(stagedWorkspaceId)
                  : undefined
              }
              onCycleDispatchTarget={handleCycleDispatchTarget}
              onSubmit={async (draft) => {
                const submitted = await handleSubmitDispatch(draft);
                if (submitted) setPrepareWorkOpen(false);
                return submitted;
              }}
            />
          </PrepareWorkPopover>
        )}
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
            query={commandQuery}
            reviewQueuePreview={reviewQueuePreview}
            selectedSessionId={activeSelectedSessionId}
            sessions={activeSessions}
            shortcutModifier={shortcutModifier}
            workspaces={workspaces}
            canCloseWorkspace={canCloseActiveWorkspace}
            onAddAgentSession={handleAddAgentSession}
            onAddManualSession={handleAddManualSession}
            onAddWorkspace={handleAddWorkspace}
            onApplyWorkMode={handleApplyWorkMode}
            onChangeQuery={setCommandQuery}
            onClose={handleCloseCommandPalette}
            onCloseSession={handleCloseSession}
            onCloseWorkspace={handleCloseActiveWorkspace}
            onCopySessionCwd={handleCopySessionCwd}
            onOpenWorkspaceFolder={() => void handleRevealActiveWorkspace()}
            onOpenWorkspaceTerminal={() => void handleOpenActiveWorkspaceTerminal()}
            onOpenSessionFolder={(cwd) => void handleOpenSessionFolder(cwd)}
            onOpenSessionTerminal={(cwd) => void handleOpenSessionTerminal(cwd)}
            onRenameWorkspace={handleBeginRenameActiveWorkspace}
            onFocusSessionInWorkspace={handleFocusSessionInWorkspace}
            onFocusNextSession={() => handleFocusSessionByDelta(1)}
            onFocusPreviousSession={() => handleFocusSessionByDelta(-1)}
            onOpenContext={handleOpenContextFromCommandPalette}
            onOpenInbox={handleOpenInbox}
            onOpenPrivacyControls={handleOpenPrivacyPanel}
            onRestartSession={handleRestartSession}
            onSelectWorkspace={handleSelectWorkspace}
            onToggleArrange={handleToggleArrangeMode}
          />
        )}
      </section>
    </main>
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const clearActionRef = useRef<HTMLButtonElement | null>(null);
  const keepDataButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreClearFocusRef = useRef(false);

  useLayoutEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (clearArmed) {
      keepDataButtonRef.current?.focus();
    } else if (restoreClearFocusRef.current) {
      restoreClearFocusRef.current = false;
      clearActionRef.current?.focus();
    }
  }, [clearArmed]);

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
    restoreClearFocusRef.current = true;
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

  const cancelClearSavedTerminalData = () => {
    restoreClearFocusRef.current = true;
    setClearArmed(false);
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [])];
    if (controls.length === 0) return;
    const first = controls[0]!;
    const last = controls[controls.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="privacy-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="privacy-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Local Data & Privacy"
        onKeyDown={handleDialogKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="privacy-panel-header">
          <div>
            <strong>Local Data & Privacy</strong>
            <small>
              Control what Alfred keeps on this Mac and which local Codex sessions appear in Sessions.
            </small>
          </div>
          <button ref={closeButtonRef} type="button" className="privacy-panel-close" onClick={onClose} aria-label="Close privacy controls">
            <X size={15} />
          </button>
        </header>
        <div className="privacy-panel-body">
          <section className="privacy-control-row">
            <div>
              <strong>Terminal scrollback</strong>
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
              <span>{settings.externalSessionIndexingEnabled ? "Sessions can index local Codex transcripts." : "Sessions will not scan external Codex transcripts."}</span>
            </div>
            <label className="privacy-toggle">
              <input
                type="checkbox"
                role="switch"
                aria-label="External Codex indexing"
                checked={settings.externalSessionIndexingEnabled}
                onChange={updateExternalIndexing}
              />
              <span className="privacy-toggle-track" aria-hidden="true" />
              <span>{settings.externalSessionIndexingEnabled ? "On" : "Off"}</span>
            </label>
          </section>

          <section className="privacy-action-row">
            <div>
              <strong>Saved transcripts</strong>
              <span>
                Clear Alfred&apos;s persisted terminal buffers and activity previews.
                This can&apos;t be undone.
              </span>
            </div>
            {clearArmed ? (
              <div className="privacy-confirm-actions">
                <button ref={keepDataButtonRef} type="button" onClick={cancelClearSavedTerminalData}>
                  Keep data
                </button>
                <button type="button" className="danger" onClick={() => void clearSavedTerminalData()}>
                  Clear saved transcripts
                </button>
              </div>
            ) : (
              <button ref={clearActionRef} type="button" className="privacy-action-button danger" onClick={() => setClearArmed(true)}>
                <Trash2 size={14} />
                <span>Clear saved transcripts…</span>
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
              <span>Reveal in Finder</span>
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const changedFileLabel = `${confirmation.files.length} changed file${confirmation.files.length === 1 ? "" : "s"}`;
  const previewFiles = confirmation.files.slice(0, 6);
  const remaining = confirmation.files.length - previewFiles.length;

  return (
    <div className="discard-checkout-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        ref={panelRef}
        className="discard-checkout-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Discard isolated checkout"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
            return;
          }
          if (event.key !== "Tab") return;
          const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? [])];
          const first = controls[0];
          const last = controls.at(-1);
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
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

function isReviewableWorktreeSession(
  session: Pick<
    SessionTile,
    "baseCwd" | "branchName" | "isolation" | "workspaceId" | "workspaceRootFingerprint"
  > | null | undefined,
): boolean {
  if (session?.isolation === "shared") return false;
  return Boolean(
    session?.branchName
    && (session.baseCwd || (session.workspaceId && session.workspaceRootFingerprint)),
  );
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

function activeAccessibleDismissalOwner(root: HTMLElement): HTMLElement | null {
  const owners = Array.from(root.querySelectorAll<HTMLElement>(ACCESSIBLE_DISMISSAL_OWNER_SELECTOR));
  return owners.filter((owner) => {
    if (owner.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const style = window.getComputedStyle(owner);
    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
  }).at(-1) ?? null;
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
