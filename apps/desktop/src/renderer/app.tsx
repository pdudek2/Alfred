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
import { AgentsDrawer } from "./components/AgentsDrawer";
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
  type AttentionProjection,
} from "./attention-projection";
import {
  ensureTileLayouts,
  moveTileLayout,
  resizeTileLayout,
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
  canRelaunchRestoredSession,
  closeSession,
  createInitialSessions,
  generatedTitleForDetectedAgent,
  hydrateStagedPlanSessions,
  hydrateLiveTerminalSessions,
  hydratePersistedTerminalSessions,
  isGeneratedSessionTitle,
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
import {
  recordPreviewUrlsFromText,
  removePreviewSessionCandidates,
  type PreviewUrlCandidate,
} from "./preview-state";
import type { WorkMode } from "./terminal-desk-types";
import { shortenPath } from "./path-display";
import { sessionRelaunchSafety } from "./relaunch-safety";
import { buildSessionsProjection, type SessionsPrimaryActionRequest } from "./sessions-projection";
import { isActiveAgentSession, isReviewableWorktreeSession, isWorkSession } from "./session-scope";
import type { WorktreeDiffView } from "./worktree-diff";
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
  AlfredPlanResponse,
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
  TerminalForgetResult,
  TerminalSessionIsolation,
  TerminalSessionSnapshot,
  TerminalWorktreeDiffResult,
} from "../shared/terminal-ipc";
import {
  PREVIEW_DOCK_DEFAULT_WIDTH,
  type DispatchTargetSnapshot,
  type WorkspaceLayoutsSnapshot,
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

function hasTileLayoutMembership(
  sessions: SessionTile[],
  layouts: Record<string, TileLayout>,
): boolean {
  const sessionIds = new Set(sessions.map((session) => session.id));
  const layoutIds = Object.keys(layouts);
  return sessionIds.size === layoutIds.length && layoutIds.every((id) => sessionIds.has(id));
}

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
  const [revealSessionId, setRevealSessionId] = useState<string | null>(null);
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
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState<boolean>(false);
  const [workspaceRenameDraft, setWorkspaceRenameDraft] = useState<string>("");
  const [workspaceRenameEditing, setWorkspaceRenameEditing] = useState<boolean>(false);
  const [projectNavigatorCollapsed, setProjectNavigatorCollapsed] = useState(false);
  const [agentsDrawerOpen, setAgentsDrawerOpen] = useState(false);
  const [armedRecoverySessionIds, setArmedRecoverySessionIds] = useState<Set<string>>(() => new Set());
  const [runtimeStatus, setRuntimeStatus] = useState<AlfredRuntimeStatus | null>(null);
  const [previewCandidates, setPreviewCandidates] = useState<PreviewUrlCandidate[]>([]);
  const [selectedPreviewUrlsByWorkspace, setSelectedPreviewUrlsByWorkspace] = useState<Record<string, string>>({});
  const [previewRefreshKeysByWorkspace, setPreviewRefreshKeysByWorkspace] = useState<Record<string, number>>({});
  const [previewDockOpenByWorkspace, setPreviewDockOpenByWorkspace] = useState<Record<string, boolean>>({});
  const [previewDockWidthsByWorkspace, setPreviewDockWidthsByWorkspace] = useState<Record<string, number>>({});
  const [worktreeActionPending, setWorktreeActionPending] = useState<Record<string, WorktreeActionKind | undefined>>({});
  const [worktreeDiffView, setWorktreeDiffView] = useState<WorktreeDiffView | null>(null);
  const [collapsedSessionIdsByWorkspace, setCollapsedSessionIdsByWorkspace] = useState<Record<string, string[]>>({});
  const [contextDrawerOpenByWorkspace, setContextDrawerOpenByWorkspace] = useState<Record<string, boolean>>({});
  const [dispatchTargetsByWorkspace, setDispatchTargetsByWorkspace] = useState<Record<string, DispatchTargetSnapshot>>({});
  const [lastDispatchDestination, setLastDispatchDestination] = useState<string | null>(null);
  const [pendingDiscardConfirmation, setPendingDiscardConfirmation] = useState<PendingDiscardConfirmation | null>(null);
  const [prepareWorkOpen, setPrepareWorkOpen] = useState(false);
  const commandPaletteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const prepareWorkTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const agentsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const worktreeDiffReturnFocusRef = useRef<HTMLElement | null>(null);
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
  const pendingPlanRef = useRef<SquadPlan | null>(null);
  const announcedSessionStatusesRef = useRef<Map<string, string>>(new Map());
  const sessionStatusAnnouncementsReadyRef = useRef<boolean>(false);
  const workspaceStateHydratedRef = useRef<boolean>(false);
  const workTileMembershipByWorkspaceRef = useRef<Record<string, string> | null>(null);
  const workspaceStatePersistenceSkipRef = useRef<WorkspaceStateSnapshot | null>(null);
  const shortcutModifier = navigator.platform.includes("Mac") ? "Cmd" : "Ctrl";
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? DEFAULT_WORKSPACE;
  const activeWorkMode = workModesByWorkspace[activeWorkspace.id] ?? "desk";
  const workSessions = terminalSessions.filter(isWorkSession);
  const activeSessions = terminalSessions.filter((session) => session.workspaceId === activeWorkspace.id);
  const activeWorkSessions = workSessions.filter((session) => session.workspaceId === activeWorkspace.id);
  const activeSavedSessions = activeSessions.filter((session) => !isWorkSession(session));
  const activeSavedSessionCount = buildSessionsProjection({
    sessions: activeSavedSessions,
    workspaces,
    externalSessions: [],
  }).total;
  const activeWorkSessionIds = new Set(activeWorkSessions.map((session) => session.id));
  const activePreviewCandidates = previewCandidates.filter(
    (candidate) => candidate.workspaceId === activeWorkspace.id && activeWorkSessionIds.has(candidate.sessionId),
  );
  const needsGeneratedCodexTitleBackfill = terminalSessions.some((session) => (
    isGeneratedSessionTitle(session.title)
    && (session.agentKind === "codex" || session.detectedAgentKind === "codex" || session.command === "codex")
  ));
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
      ? activeWorkSessions.find((session) => session.id === activeSelectedSessionId) ?? activeWorkSessions[0] ?? null
      : activeWorkSessions[0] ?? null;
  const activeSelectedSession =
    activeWorkSessions.find((session) => session.id === activeSelectedSessionId) ?? activeWorkSessions[0] ?? null;
  const activeCollapsedSessionIds = new Set(collapsedSessionIdsByWorkspace[activeWorkspace.id] ?? []);
  const activeContextDrawerOpen = contextDrawerOpenByWorkspace[activeWorkspace.id] ?? false;
  const activeDispatchTargets = dispatchTargetsForWorkspace(activeWorkspace, activeWorkSessions, activeSelectedSession);
  const savedDispatchTarget = dispatchTargetsByWorkspace[activeWorkspace.id];
  const activeDispatchTarget =
    activeDispatchTargets.find((target) => dispatchTargetsEqual(target, savedDispatchTarget)) ??
    activeDispatchTargets[0] ??
    null;
  const canCloseActiveWorkspace =
    activeWorkspace.id !== DEFAULT_WORKSPACE_ID && workspaces.length > 1 && activeSessions.length === 0;
  const unavailableWorkspaceIds = new Set(
    workspaces.filter((workspace) => workspace.rootStatus === "missing").map((workspace) => workspace.id),
  );
  const attentionItems = buildAttentionProjection(workspaces, terminalSessions).filter((item) => {
    if (unavailableWorkspaceIds.has(item.workspaceId)) return false;
    const session = terminalSessions.find((candidate) => candidate.id === item.sessionId);
    return item.section !== "recovery"
      || session?.runtimeStatus !== "restored"
      || canRelaunchRestoredSession(session);
  });
  const recoverySessionIds = new Set(
    attentionItems
      .filter((item) => item.section === "recovery" && item.workspaceId === activeWorkspace.id)
      .map((item) => item.sessionId),
  );
  const activeRecoverableSessions = activeSessions.filter((session) => recoverySessionIds.has(session.id));
  const activeWorkRecoverableSessions = activeRecoverableSessions.filter(isWorkSession);
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
  const activeAgentSessions = terminalSessions.filter(isActiveAgentSession);
  const activeAgentCountsByWorkspace = activeAgentSessions.reduce((counts, session) => {
    counts.set(session.workspaceId, (counts.get(session.workspaceId) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
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
    if (!workspaceStateHydratedRef.current || workspaceHydrationStatus.status !== "ready") return;

    const workSessionsByWorkspace = new Map<string, SessionTile[]>();
    for (const session of terminalSessions) {
      if (!isWorkSession(session)) continue;
      const sessions = workSessionsByWorkspace.get(session.workspaceId) ?? [];
      sessions.push(session);
      workSessionsByWorkspace.set(session.workspaceId, sessions);
    }

    const workspaceIds = new Set([
      ...workSessionsByWorkspace.keys(),
      ...Object.keys(tileLayoutsByWorkspace),
    ]);
    const nextMembership = Object.fromEntries([...workspaceIds].map((workspaceId) => [
      workspaceId,
      (workSessionsByWorkspace.get(workspaceId) ?? []).map((session) => session.id).sort().join("\u0000"),
    ]));
    const previousMembership = workTileMembershipByWorkspaceRef.current;
    workTileMembershipByWorkspaceRef.current = nextMembership;
    if (previousMembership === null) {
      const initialLayouts = [...workspaceIds].flatMap((workspaceId) => {
        const sessions = workSessionsByWorkspace.get(workspaceId) ?? [];
        const layouts = tileLayoutsByWorkspace[workspaceId] ?? {};
        return hasTileLayoutMembership(sessions, layouts)
          ? []
          : [[workspaceId, ensureTileLayouts(sessions, layouts)] as const];
      });
      if (initialLayouts.length > 0) {
        setTileLayoutsByWorkspace((current) => ({ ...current, ...Object.fromEntries(initialLayouts) }));
      }
      return;
    }

    const changes = [...workspaceIds].flatMap((workspaceId) => {
      if (previousMembership[workspaceId] === nextMembership[workspaceId]) return [];
      const sessions = workSessionsByWorkspace.get(workspaceId) ?? [];
      const layouts = tileLayoutsByWorkspace[workspaceId] ?? {};
      if (hasTileLayoutMembership(sessions, layouts)) return [];
      return [{ workspaceId, layouts: ensureTileLayouts(sessions, layouts) }];
    });

    if (changes.length === 0) return;

    setTileLayoutsByWorkspace((current) => ({
      ...current,
      ...Object.fromEntries(changes.map(({ workspaceId, layouts }) => [workspaceId, layouts])),
    }));

    const layoutApi = getDesktopLayoutApi();
    for (const { workspaceId, layouts } of changes) {
      void layoutApi?.setWorkspaceLayout({ workspaceId, layouts });
    }
  }, [terminalSessions, tileLayoutsByWorkspace, workspaceHydrationStatus.status]);

  useEffect(() => {
    const previousStatuses = announcedSessionStatusesRef.current;
    const nextStatuses = new Map<string, string>();
    let nextAnnouncement: string | null = null;

    for (const session of terminalSessions) {
      const status = terminalSessionDisplayStatus(session).label;
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

  const handleSessionRevealed = useCallback((sessionId: string) => {
    setRevealSessionId((current) => current === sessionId ? null : current);
  }, []);

  const commitAddedSession = useCallback((nextSessions: SessionTile[]) => {
    const addedSession = nextSessions.at(-1);
    if (!addedSession) return;
    const layoutApi = getDesktopLayoutApi();

    terminalSessionsRef.current = nextSessions;
    setTerminalSessions(nextSessions);
    setRevealSessionId(activeWorkMode === "focus" ? null : addedSession.id);
    setSelectedSessionIdsByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: addedSession.id,
    }));
    void layoutApi?.setWorkspaceViewState({
      workspaceId: activeWorkspace.id,
      viewState: { workMode: activeWorkMode, selectedSessionId: addedSession.id },
    });
  }, [activeWorkMode, activeWorkspace.id]);

  const handleAddAgentSession = useCallback((kind: Extract<AgentKind, "claude" | "codex">, isolation: TerminalSessionIsolation = "shared") => {
    if (activeWorkspace.rootStatus === "missing") return;
    commitAddedSession(
      addAgentSession(
        terminalSessionsRef.current,
        kind,
        activeWorkspace.rootPath ?? "",
        activeWorkspace.id,
        isolation,
      ),
    );
  }, [
    activeWorkspace.id,
    activeWorkspace.rootPath,
    activeWorkspace.rootStatus,
    commitAddedSession,
  ]);

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
          setTerminalSessions((sessions) => {
            const workspaceSessions = sessions.filter((session) => session.workspaceId === workspace.id);
            if (workspaceSessions.length === 0) return addManualSession(sessions, rootPath, workspace.id);

            return sessions.map((session) => {
              if (
                session.workspaceId !== workspace.id
                || session.stage !== "staged"
                || session.cwd !== activeWorkspace.rootPath
              ) return session;

              return {
                ...session,
                cwd: rootPath,
                ...(session.launchPreflight?.status === "ready" && session.launchPreflight.cwd === activeWorkspace.rootPath
                  ? { launchPreflight: { ...session.launchPreflight, cwd: rootPath } }
                  : {}),
              };
            });
          });
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

    const index = workspaces.length + 1;
    const workspace: Workspace = {
      id: `W${index}`,
      label: `Workspace ${index}`,
      shortLabel: `W${index}`,
    };
    setWorkspaces([...workspaces, workspace]);
    setActiveWorkspaceId(workspace.id);
    setTerminalSessions((sessions) => addManualSession(sessions, "", workspace.id));
  }, [activeWorkspace.id, activeWorkspace.rootPath, activeWorkspace.rootStatus, workspaces]);

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
      setAgentsDrawerOpen(false);
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
    setAgentsDrawerOpen(false);
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

  const handleToggleAgentsDrawer = useCallback(() => {
    const nextOpen = !agentsDrawerOpen;
    if (nextOpen) {
      setContextDrawerOpenByWorkspace((current) => ({
        ...current,
        [activeWorkspace.id]: false,
      }));
      setPreviewDockOpenByWorkspace((current) => ({
        ...current,
        [activeWorkspace.id]: false,
      }));
      persistActiveWorkspaceViewState({ previewDockOpen: false });
    }
    setAgentsDrawerOpen(nextOpen);
  }, [activeWorkspace.id, agentsDrawerOpen, persistActiveWorkspaceViewState]);

  const handleToggleCollapseSession = useCallback((sessionId: string) => {
    const existing = collapsedSessionIdsByWorkspace[activeWorkspace.id] ?? [];
    const nextCollapsed = existing.includes(sessionId)
      ? existing.filter((id) => id !== sessionId)
      : [...existing, sessionId];
    setCollapsedSessionIdsByWorkspace({
      ...collapsedSessionIdsByWorkspace,
      [activeWorkspace.id]: nextCollapsed,
    });
    persistActiveWorkspaceViewState({
      collapsedSessionIds: nextCollapsed,
    });
  }, [
    activeWorkspace.id,
    collapsedSessionIdsByWorkspace,
    persistActiveWorkspaceViewState,
  ]);

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
    const nextWorkspaces = workspaces.map((workspace) =>
      workspace.id === activeWorkspace.id
        ? { ...workspace, label: nextLabel, shortLabel: shortLabelForWorkspace(nextLabel) }
        : workspace,
    );
    setWorkspaces(nextWorkspaces);
    if (workspaceApi) {
      workspaceStatePersistenceSkipRef.current = {
        workspaces: nextWorkspaces,
        activeWorkspaceId: activeWorkspace.id,
      };
      void workspaceApi.setWorkspaceState({
        workspaces: nextWorkspaces,
        activeWorkspaceId: activeWorkspace.id,
      });
    }
  }, [activeWorkspace.id, activeWorkspace.label, workspaces]);

  const handleSaveWorkspaceMissionBrief = useCallback((missionBrief: WorkspaceMissionBrief | undefined) => {
    const workspaceApi = getDesktopWorkspaceApi();
    setWorkspaceMenuOpen(false);
    setWorkspaceRenameEditing(false);
    const nextWorkspaces = workspaces.map((workspace) => {
      if (workspace.id !== activeWorkspace.id) return workspace;
      const { missionBrief: _previousMissionBrief, ...rest } = workspace;
      return missionBrief ? { ...rest, missionBrief } : rest;
    });
    setWorkspaces(nextWorkspaces);
    if (workspaceApi) {
      workspaceStatePersistenceSkipRef.current = {
        workspaces: nextWorkspaces,
        activeWorkspaceId: activeWorkspace.id,
      };
      void workspaceApi.setWorkspaceState({
        workspaces: nextWorkspaces,
        activeWorkspaceId: activeWorkspace.id,
      });
    }
  }, [activeWorkspace.id, workspaces]);

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

  const handleOpenSessionTerminal = useCallback((cwd: string) =>
    runShellAction(
      () => getDesktopWorkspaceApi()?.openExternalTerminal({ cwd }),
      "Session terminal is unavailable.",
    ), [runShellAction]);

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
      setAgentsDrawerOpen(false);
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

  const handleApplyWorkMode = useCallback((mode: WorkMode, selectedSessionId = activeSelectedSessionId) => {
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
  }, [activeSelectedSessionId, activeWorkMode, activeWorkspace.id]);

  const handleSelectSession = useCallback((sessionId: string) => {
    if (selectedSessionIdsByWorkspace[activeWorkspace.id] === sessionId) return;

    const layoutApi = getDesktopLayoutApi();
    setSelectedSessionIdsByWorkspace({
      ...selectedSessionIdsByWorkspace,
      [activeWorkspace.id]: sessionId,
    });
    void layoutApi?.setWorkspaceViewState({
      workspaceId: activeWorkspace.id,
      viewState: { workMode: activeWorkMode, selectedSessionId: sessionId },
    });
  }, [activeWorkMode, activeWorkspace.id, selectedSessionIdsByWorkspace]);

  const handleAddManualSession = useCallback(() => {
    if (activeWorkspace.rootStatus === "missing") return;
    commitAddedSession(
      addManualSession(
        terminalSessionsRef.current,
        activeWorkspace.rootPath ?? "",
        activeWorkspace.id,
      ),
    );
  }, [
    activeWorkspace.id,
    activeWorkspace.rootPath,
    activeWorkspace.rootStatus,
    commitAddedSession,
  ]);

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
    setAgentsDrawerOpen(false);
    setCommandPaletteOpen(false);
    setCommandQuery("");
    setActiveSurface("inbox");
  }, []);

  const handleOpenSavedSessions = useCallback(() => {
    setAgentsDrawerOpen(false);
    setSessionsViewState((current) => ({
      ...current,
      query: "",
      selectedProjectId: activeWorkspace.id,
      source: "saved",
      timeRange: "any",
      pageIndex: 0,
      selectedSessionKey: null,
      navigatorScrollTop: 0,
      readerScrollTop: 0,
      readerPages: [],
      focusTarget: "search",
    }));
    setActiveSurface("sessions");
  }, [activeWorkspace.id]);

  const handleFocusSessionByDelta = useCallback((delta: number) => {
    if (activeWorkSessions.length === 0) return;
    const currentIndex = Math.max(
      0,
      activeWorkSessions.findIndex((session) => session.id === activeSelectedSessionId),
    );
    const nextIndex = (currentIndex + delta + activeWorkSessions.length) % activeWorkSessions.length;
    const nextSession = activeWorkSessions[nextIndex];
    if (nextSession) {
      handleFocusSession(nextSession.id);
    }
  }, [activeSelectedSessionId, activeWorkSessions, handleFocusSession]);

  const handleMoveTile = useCallback((tileId: string, deltaCol: number, deltaRow: number) => {
    const layoutApi = getDesktopLayoutApi();
    const workspaceLayouts = moveTileLayout(
      ensureTileLayouts(activeWorkSessions, tileLayoutsByWorkspace[activeWorkspace.id] ?? {}),
      tileId,
      deltaCol,
      deltaRow,
    );
    setTileLayoutsByWorkspace({
      ...tileLayoutsByWorkspace,
      [activeWorkspace.id]: workspaceLayouts,
    });
    void layoutApi?.setWorkspaceLayout({ workspaceId: activeWorkspace.id, layouts: workspaceLayouts });
  }, [activeWorkSessions, activeWorkspace.id, tileLayoutsByWorkspace]);

  const handleResizeTile = useCallback((tileId: string, deltaColSpan: number, deltaRowSpan: number) => {
    const layoutApi = getDesktopLayoutApi();
    const workspaceLayouts = resizeTileLayout(
      ensureTileLayouts(activeWorkSessions, tileLayoutsByWorkspace[activeWorkspace.id] ?? {}),
      tileId,
      deltaColSpan,
      deltaRowSpan,
    );
    setTileLayoutsByWorkspace({
      ...tileLayoutsByWorkspace,
      [activeWorkspace.id]: workspaceLayouts,
    });
    void layoutApi?.setWorkspaceLayout({ workspaceId: activeWorkspace.id, layouts: workspaceLayouts });
  }, [activeWorkSessions, activeWorkspace.id, tileLayoutsByWorkspace]);

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

  const handleSelectSessionInWorkspace = useCallback((workspaceId: string, sessionId: string) => {
    const targetExists = terminalSessionsRef.current.some(
      (session) => session.workspaceId === workspaceId && session.id === sessionId,
    );
    if (!targetExists) return;

    const workMode = workModesByWorkspace[workspaceId] ?? "desk";
    setActiveSurface("work");
    setActiveWorkspaceId(workspaceId);
    setSelectedSessionIdsByWorkspace((current) =>
      current[workspaceId] === sessionId ? current : { ...current, [workspaceId]: sessionId },
    );
    void getDesktopLayoutApi()?.setWorkspaceViewState({
      workspaceId,
      viewState: { workMode, selectedSessionId: sessionId },
    });
    void refreshLiveSessions();
  }, [refreshLiveSessions, workModesByWorkspace]);

  const handleFocusSessionInWorkspace = useCallback((workspaceId: string, sessionId: string) => {
    const targetExists = terminalSessionsRef.current.some((session) => (
      session.workspaceId === workspaceId && (isWorkSession(session) || session.id === sessionId)
    ));
    if (!targetExists) return;

    const layoutApi = getDesktopLayoutApi();
    const viewStateChanged =
      (workModesByWorkspace[workspaceId] ?? "desk") !== "focus" ||
      selectedSessionIdsByWorkspace[workspaceId] !== sessionId;

    setActiveSurface("work");
    if (activeWorkspaceId !== workspaceId) {
      setActiveWorkspaceId(workspaceId);
    }
    if (selectedSessionIdsByWorkspace[workspaceId] !== sessionId) {
      setSelectedSessionIdsByWorkspace({
        ...selectedSessionIdsByWorkspace,
        [workspaceId]: sessionId,
      });
    }
    setWorkModesByWorkspace((current) => {
      if ((current[workspaceId] ?? "desk") === "focus") return current;
      return {
        ...current,
        [workspaceId]: "focus",
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
      if (activeWorkSessions.length === 0) {
        if (!currentId) return current;
        const next = { ...current };
        delete next[activeWorkspace.id];
        return next;
      }
      if (currentId && activeWorkSessions.some((session) => session.id === currentId)) {
        return current;
      }
      return {
        ...current,
        [activeWorkspace.id]: activeWorkSessions[0]?.id ?? "",
      };
    });
  }, [activeWorkSessions, activeWorkspace.id]);

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
      let result: TerminalForgetResult;
      try {
        result = terminalApi
          ? await terminalApi.forget({ clientId: session.id, cleanupWorktree: true })
          : { ok: false, error: "Desktop terminal API is unavailable." };
      } catch {
        result = { ok: false, error: "Desktop terminal request failed. Try again." };
      }
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
    setPreviewCandidates((candidates) => removePreviewSessionCandidates(candidates, sessionId));

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

    const discardSessionInstanceKey = sessionInstanceKey(session);
    void terminalApi.worktreeDiff({ clientId: sessionId }).then((result) => {
      const currentSession = terminalSessionsRef.current.find((item) => item.id === sessionId);
      if (!currentSession || sessionInstanceKey(currentSession) !== discardSessionInstanceKey) return;

      if (!result.ok) {
        setTerminalSessions((sessions) =>
          sessions.some(
            (item) => item.id === sessionId && sessionInstanceKey(item) === discardSessionInstanceKey,
          )
            ? appendSessionActivity(sessions, sessionId, {
                kind: "warning",
                title: "Discard checkout blocked",
                detail: result.error,
              })
            : sessions,
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
    }).catch(() => {
      const currentSession = terminalSessionsRef.current.find((item) => item.id === sessionId);
      if (!currentSession || sessionInstanceKey(currentSession) !== discardSessionInstanceKey) return;
      setTerminalSessions((sessions) =>
        sessions.some(
          (item) => item.id === sessionId && sessionInstanceKey(item) === discardSessionInstanceKey,
        )
          ? appendSessionActivity(sessions, sessionId, {
              kind: "warning",
              title: "Discard checkout blocked",
              detail: "Desktop terminal request failed. Try again.",
            })
          : sessions,
      );
    });
  }, [closeSessionNow]);

  const handleContinueRestoredSession = useCallback((sessionId: string) => {
    const sessions = terminalSessionsRef.current;
    const session = sessions.find((item) => item.id === sessionId);
    if (!session || !canRelaunchRestoredSession(session)) return;
    const relaunchSafety = sessionRelaunchSafety(session);
    if (!relaunchSafety.safe && !armedRecoverySessionIds.has(sessionId)) {
      setArmedRecoverySessionIds(new Set(armedRecoverySessionIds).add(sessionId));
      setTerminalSessions(appendSessionActivity(sessions, sessionId, {
        kind: "warning",
        title: "Review before relaunch",
        detail: relaunchSafety.reason,
      }));
      return;
    }

    const nextArmed = new Set(armedRecoverySessionIds);
    nextArmed.delete(sessionId);
    setArmedRecoverySessionIds(nextArmed);
    setTerminalSessions(
      appendSessionActivity(relaunchRestoredSession(sessions, sessionId), sessionId, {
        kind: "lifecycle",
        title: "Relaunching session",
        detail: "Alfred is starting a fresh process from this saved transcript.",
      }),
    );
  }, [armedRecoverySessionIds]);

  const handleRestartSession = useCallback((sessionId: string) => {
    const sessions = terminalSessionsRef.current;
    const session = sessions.find((item) => item.id === sessionId);
    if (!session || (session.runtimeStatus !== "exited" && session.runtimeStatus !== "error")) return;
    const restartSafety = sessionRelaunchSafety(session);
    if (!restartSafety.safe && !armedRecoverySessionIds.has(sessionId)) {
      setArmedRecoverySessionIds(new Set(armedRecoverySessionIds).add(sessionId));
      setTerminalSessions(appendSessionActivity(sessions, sessionId, {
        kind: "warning",
        title: "Review before restart",
        detail: restartSafety.reason,
      }));
      return;
    }

    const nextArmed = new Set(armedRecoverySessionIds);
    nextArmed.delete(sessionId);
    setArmedRecoverySessionIds(nextArmed);
    setTerminalSessions(
      appendSessionActivity(restartSession(sessions, sessionId), sessionId, {
        kind: "lifecycle",
        title: "Restarting session",
        detail: "Alfred is starting a fresh process in this tile.",
      }),
    );
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

  const handleOpenWorktreeDiff = useCallback(async (workspaceId: string, sessionId: string) => {
    const session = terminalSessionsRef.current.find((item) => (
      item.workspaceId === workspaceId && item.id === sessionId
    ));
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

    const actionKey = beginWorktreeAction(session, "review");
    if (!actionKey) return;
    worktreeDiffReturnFocusRef.current = document.activeElement instanceof HTMLElement
      && document.activeElement !== document.body
      ? document.activeElement
      : null;
    setAgentsDrawerOpen(false);
    handleFocusSessionInWorkspace(workspaceId, sessionId);
    setWorktreeDiffView({
      status: "loading",
      instanceKey: actionKey,
      sessionId,
      sessionTitle: session.title,
    });

    try {
      let result: TerminalWorktreeDiffResult;
      const terminalApi = getDesktopTerminalApi();
      try {
        result = terminalApi
          ? await terminalApi.worktreeDiff({ clientId: sessionId })
          : { ok: false, error: "Desktop terminal API is unavailable." };
      } catch (error) {
        result = {
          ok: false,
          error: error instanceof Error ? error.message : "Checkout diff inspection failed.",
        };
      }

      if (!isCurrentSessionInstance(sessionId, actionKey)) {
        setWorktreeDiffView((current) =>
          current?.instanceKey === actionKey ? null : current,
        );
        return;
      }

      setWorktreeDiffView((current) => {
        if (current?.instanceKey !== actionKey || current.sessionId !== sessionId) return current;
        return result.ok
          ? { ...current, status: "ready", result }
          : { ...current, status: "error", error: result.error };
      });
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
  }, [beginWorktreeAction, finishWorktreeAction, handleFocusSessionInWorkspace, isCurrentSessionInstance]);

  const handleReviewWorktree = useCallback((sessionId: string) => {
    const session = terminalSessionsRef.current.find((item) => item.id === sessionId);
    void handleOpenWorktreeDiff(session?.workspaceId ?? activeWorkspaceId, sessionId);
  }, [activeWorkspaceId, handleOpenWorktreeDiff]);

  const handleCloseWorktreeDiff = useCallback(() => {
    worktreeDiffReturnFocusRef.current = null;
    setWorktreeDiffView(null);
  }, []);

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
    } catch {
      if (!isCurrentSessionInstance(sessionId, actionKey)) return;
      setTerminalSessions((sessions) =>
        sessions.some((item) => item.id === sessionId && sessionInstanceKey(item) === actionKey)
          ? appendSessionActivity(sessions, sessionId, {
              kind: "error",
              title: "Apply failed",
              detail: "Desktop terminal request failed. Try again.",
              payload: { type: "error", message: "Desktop terminal request failed. Try again." },
            })
          : sessions,
      );
    } finally {
      finishWorktreeAction(actionKey);
    }
  }, [beginWorktreeAction, finishWorktreeAction, isCurrentSessionInstance]);

  const handleCloseSelectedSession = useCallback(() => {
    const selectedSessionId = selectedSessionIdsByWorkspace[activeWorkspace.id];
    const currentWorkspaceSessions = terminalSessionsRef.current.filter(
      (session) => session.workspaceId === activeWorkspace.id && isWorkSession(session),
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
    const attachmentAt = runtime.createdAt ?? Date.now();
    setTerminalSessions((sessions) => {
      const attached = attachRuntimeSession(sessions, tileId, runtime);
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
      const currentPlan = pendingPlanRef.current;
      if (currentPlan?.sessionIds.includes(tileId)) {
        const remaining = currentPlan.sessionIds.filter((id) => id !== tileId);
        pendingPlanRef.current = remaining.length === 0 ? null : { ...currentPlan, sessionIds: remaining };
        setPendingPlan((plan) => {
          if (!plan || plan.id !== currentPlan.id || !plan.sessionIds.includes(tileId)) return plan;
          const currentRemaining = plan.sessionIds.filter((id) => id !== tileId);
          return currentRemaining.length === 0 ? null : { ...plan, sessionIds: currentRemaining };
        });
      }
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
      setPreviewCandidates((candidates) => removePreviewSessionCandidates(candidates, exitedSession.id));
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
      const generatedTitle = generatedTitleForDetectedAgent(session, event.foregroundAgentKind);
      if (generatedTitle !== session.title) {
        void getDesktopTerminalApi()?.rename({ clientId: session.id, title: generatedTitle });
      }
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
          detectedAgentKind: snapshot.foregroundAgentKind,
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
    let response: AlfredPlanResponse;
    try {
      response = await alfredApi.requestPlan({
        dispatchTarget,
        prompt,
        workspace: workspacePlanContext(activeWorkspace, activeWorkSessions, dispatchTarget),
      });
    } catch {
      setAlfredStatus(errored({ code: "network", message: "Alfred runtime request failed. Try again." }));
      return false;
    }
    if (!response.ok) {
      setAlfredStatus(errored(response.error));
      return false;
    }
    setAlfredStatus(idle());
    const before = terminalSessionsRef.current;
    const after = addStagedSessions(
      before,
      response.plan.sessions,
      activeWorkspace.rootPath ?? "",
      activeWorkspace.id,
    );
    const stagedSessions = after.slice(before.length);
    const stagedPlan = createStagedPlanSnapshot({
      ...(response.plan.name === undefined ? {} : { name: response.plan.name }),
      prompt,
      sessions: stagedSessions,
    });
    const nextPendingPlan = stagedPlan
      ? {
          id: stagedPlan.id,
          ...(stagedPlan.name === undefined ? {} : { name: stagedPlan.name }),
          prompt: stagedPlan.prompt,
          sessionIds: stagedPlan.sessions.map((session) => session.id),
          workspaceId: activeWorkspace.id,
        }
      : null;

    setTerminalSessions((current) => [...current, ...stagedSessions]);
    pendingPlanRef.current = nextPendingPlan;
    setPendingPlan(nextPendingPlan);
    if (stagedPlan) void alfredApi.setStagedPlan(stagedPlan);
    else void alfredApi.clearStagedPlan();
    return true;
  }, [activeWorkSessions, activeWorkspace, alfredStatus, globalStagedCount]);

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
    if (tile && workspaces.find((workspace) => workspace.id === tile.workspaceId)?.rootStatus === "missing") {
      return;
    }
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
  }, [terminalSessions, workspaces]);

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
    setAgentsDrawerOpen(false);
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
    const owningPlan = pendingPlanRef.current;
    const planOwnsTile = owningPlan?.sessionIds.includes(tileId) ?? false;
    setTerminalSessions((sessions) => rejectStaged(sessions, tileId));
    if (!owningPlan || !planOwnsTile) return;

    const remaining = owningPlan.sessionIds.filter((id) => id !== tileId);
    pendingPlanRef.current = remaining.length === 0 ? null : { ...owningPlan, sessionIds: remaining };
    setPendingPlan((current) => {
      if (!current || current.id !== owningPlan.id || !current.sessionIds.includes(tileId)) return current;
      const currentRemaining = current.sessionIds.filter((id) => id !== tileId);
      return currentRemaining.length === 0 ? null : { ...current, sessionIds: currentRemaining };
    });
    void alfredApi?.resolveStagedPlan({ sessionIds: [tileId] });
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
      workspace: workspacePlanContext(activeWorkspace, activeWorkSessions),
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
    const nextPendingPlan = toSquadPlan({ plan: response.plan, defaultWorkspaceId: activeWorkspace.id });
    pendingPlanRef.current = nextPendingPlan;
    setPendingPlan(nextPendingPlan);
  }, [activeWorkSessions, activeWorkspace, pendingPlan?.id]);

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

  const handleRefreshExternalCodexSessions = useCallback(async () => {
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

  const handleOpenAgentSession = useCallback((workspaceId: string, sessionId: string) => {
    setAgentsDrawerOpen(false);
    handleFocusSessionInWorkspace(workspaceId, sessionId);
  }, [handleFocusSessionInWorkspace]);

  const handleRunAgentsAttentionAction = useCallback((item: AttentionProjection) => {
    setAgentsDrawerOpen(false);
    switch (item.action.kind) {
      case "open-in-work":
        handleFocusSessionInWorkspace(item.workspaceId, item.sessionId);
        return;
      case "launch":
        handleLaunchInboxItem(item.sessionId);
        return;
      case "review-edit":
        handleReviewBlockedSession(item.workspaceId, item.sessionId);
        return;
      case "resume":
      case "relaunch":
        handleRecoverInboxItem(item.workspaceId, item.sessionId);
    }
  }, [
    handleFocusSessionInWorkspace,
    handleLaunchInboxItem,
    handleRecoverInboxItem,
    handleReviewBlockedSession,
  ]);

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
        const workspaceSessions = terminalSessionsRef.current.filter(
          (session) => session.workspaceId === workspaceId && isWorkSession(session),
        );
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
    if (!privacySettings.externalSessionIndexingEnabled) return;
    if (activeSurface !== "sessions" && !needsGeneratedCodexTitleBackfill) return;
    void handleRefreshExternalCodexSessions();
  }, [
    activeSurface,
    handleRefreshExternalCodexSessions,
    needsGeneratedCodexTitleBackfill,
    privacySettings.externalSessionIndexingEnabled,
  ]);

  useEffect(() => {
    if (externalCodexSessions.length === 0) return;
    for (const backfill of generatedCodexTitleBackfills(terminalSessionsRef.current, externalCodexSessions)) {
      handleRenameSession(backfill.sessionId, backfill.title);
    }
  }, [externalCodexSessions, handleRenameSession]);

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
            ".project-session[aria-current='page'], .project-row-button[aria-current='location'], [data-testid='terminal-input']",
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
    workTileMembershipByWorkspaceRef.current = null;

    if (!terminalApi) {
      setTerminalSessions([]);
      setWorkspaceHydrationStatus({ status: "ready" });
      return;
    }

    setWorkspaceHydrationStatus({ status: "loading" });

    const emptyLayouts: WorkspaceLayoutsSnapshot = {
      layoutsByWorkspace: {},
      viewStateByWorkspace: {},
    };

    Promise.all([
      terminalApi.list(),
      alfredApi?.getStagedPlan().catch(() => ({ plan: null })) ?? Promise.resolve({ plan: null }),
      alfredApi?.getRuntimeStatus().catch(() => null) ?? Promise.resolve(null),
      layoutApi?.getLayouts().catch(() => emptyLayouts) ?? Promise.resolve(emptyLayouts),
      workspaceApi?.getWorkspaceState().catch(() => null) ?? Promise.resolve(null),
    ])
      .then(([terminalResult, stagedPlanResult, runtimeStatusResult, layoutResult, workspaceStateResult]) => {
        if (cancelled) return;
        const hydratedWorkspaceId = workspaceStateResult?.activeWorkspaceId ?? DEFAULT_WORKSPACE_ID;
        setRuntimeStatus(runtimeStatusResult);
        setTileLayoutsByWorkspace(layoutResult.layoutsByWorkspace);
        setArrangeMode(false);
        setWorkModesByWorkspace({
          [DEFAULT_WORKSPACE_ID]: "desk",
          ...Object.fromEntries(
            Object.entries(layoutResult.viewStateByWorkspace).flatMap(([workspaceId, viewState]) =>
              viewState.workMode ? [[workspaceId, viewState.workMode]] : [],
            ),
          ),
        });
        const hydratedSelectedSessionIds = Object.fromEntries(
          Object.entries(layoutResult.viewStateByWorkspace).flatMap(([workspaceId, viewState]) =>
            viewState.selectedSessionId ? [[workspaceId, viewState.selectedSessionId]] : [],
          ),
        );
        setSelectedSessionIdsByWorkspace((current) => ({
          ...hydratedSelectedSessionIds,
          ...current,
        }));
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
        const hydratedPendingPlan = toSquadPlan({
          plan: stagedPlanResult.plan,
          omittedSessionIds: alreadyLaunchedStagedIds,
        });
        pendingPlanRef.current = hydratedPendingPlan;
        setPendingPlan(hydratedPendingPlan);
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
    const alreadyPersisted = workspaceStatePersistenceSkipRef.current;
    if (
      alreadyPersisted?.workspaces === workspaces
      && alreadyPersisted.activeWorkspaceId === activeWorkspaceId
    ) {
      workspaceStatePersistenceSkipRef.current = null;
      return;
    }

    const snapshot: WorkspaceStateSnapshot = {
      workspaces,
      activeWorkspaceId,
    };
    void workspaceApi.setWorkspaceState(snapshot);
  }, [activeWorkspaceId, workspaces]);

  const workSurfaceHidden = activeSurface !== "work";
  const activeSessionCount = activeWorkSessions.length;
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
            agentsDrawerOpen && activeSurface === "work" ? "agents-visible" : "",
          ].filter(Boolean).join(" ")}
          data-testid="workbench-shell"
        >
          {activeSurface === "work" && (
            <ProjectNavigator
              activeSessionId={activeSelectedSessionId}
              activeWorkspaceId={activeWorkspace.id}
              activeAgentCountsByWorkspace={activeAgentCountsByWorkspace}
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
              onSelectSessionInWorkspace={handleSelectSessionInWorkspace}
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
                activeAgentCount={activeAgentSessions.length}
                agentsOpen={agentsDrawerOpen}
                agentsTriggerRef={agentsTriggerRef}
                arrangeMode={arrangeMode}
                branch={activeWorkspace.gitBranch}
                previewAvailable={previewVisible}
                previewOpen={activePreviewDockOpen}
                previewTriggerRef={previewTriggerRef}
                rootPath={activeWorkspace.rootPath}
                savedSessionCount={activeSavedSessionCount}
                terminalLaunchDisabled={activeWorkspace.rootStatus === "missing"}
                visibleSessionCount={visibleWorkSessionCount}
                workMode={activeWorkMode}
                onAddManualSession={handleAddManualSession}
                onApplyWorkMode={handleApplyWorkMode}
                onOpenSavedSessions={handleOpenSavedSessions}
                onToggleArrangeMode={handleToggleArrangeMode}
                onToggleAgents={handleToggleAgentsDrawer}
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
                  layouts={ensureTileLayouts(activeWorkSessions, tileLayoutsByWorkspace[activeWorkspace.id] ?? {})}
                  recoverableSessions={activeWorkRecoverableSessions}
                  revealSessionId={revealSessionId}
                  selectedSessionId={activeSelectedSessionId}
                  sessions={terminalSessions}
                  surfaceActive={!workSurfaceHidden}
                  workMode={activeWorkMode}
                  worktreeActionPending={worktreeActionPending}
                  worktreeDiffReturnFocus={worktreeDiffReturnFocusRef.current}
                  worktreeDiffView={worktreeDiffView}
                  workspaceGitBranch={activeWorkspace.gitBranch}
                  workspaceLabel={activeWorkspace.label}
                  workspaceRootPath={activeWorkspace.rootPath}
                  workspaceRootStatus={activeWorkspace.rootStatus}
                  onBindWorkspace={handleBindWorkspaceFromFolder}
                  onAddAgentSession={handleAddAgentSession}
                  onAddManualSession={handleAddManualSession}
                  onApplyWorktree={handleApplyWorktree}
                  onCloseSession={handleCloseSession}
                  onCloseWorktreeDiff={handleCloseWorktreeDiff}
                  onContinueRestoredSession={handleContinueRestoredSession}
                  onOpenExternalTerminal={handleOpenSessionTerminal}
                  onOpenInbox={handleOpenInbox}
                  onSessionRevealed={handleSessionRevealed}
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
                  worktreeActionPending={worktreeActionPending}
                  workspaces={workspaces}
                  onApplyWorktree={handleApplyWorktree}
                  onBackToWork={handleExitSessionsToWork}
                  onDiscardSavedSession={handleCloseSession}
                  onOpenPrivacySettings={handleOpenPrivacyPanel}
                  onPrimaryAction={handleSessionsPrimaryAction}
                  onRefreshExternalSessions={() => void handleRefreshExternalCodexSessions()}
                  onReviewWorktree={handleReviewWorktree}
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
          <AgentsDrawer
            sessions={terminalSessions}
            activeSessionId={activeSelectedSessionId}
            activeWorkspaceId={activeWorkspace.id}
            attentionItems={attentionItems}
            dismissalSuspended={
              commandPaletteOpen ||
              privacyPanelOpen ||
              prepareWorkOpen ||
              workspaceMenuOpen ||
              pendingDiscardConfirmation !== null
            }
            open={activeSurface === "work" && agentsDrawerOpen}
            returnFocusRef={agentsTriggerRef}
            workspaces={workspaces}
            onClose={() => setAgentsDrawerOpen(false)}
            onOpenInbox={handleOpenInbox}
            onOpenSession={handleOpenAgentSession}
            onOpenWorktreeDiff={(workspaceId, sessionId) => void handleOpenWorktreeDiff(workspaceId, sessionId)}
            onRunAttentionAction={handleRunAgentsAttentionAction}
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
            allSessions={workSessions}
            query={commandQuery}
            reviewQueuePreview={reviewQueuePreview}
            selectedSessionId={activeSelectedSessionId}
            sessions={activeWorkSessions}
            shortcutModifier={shortcutModifier}
            workspaces={workspaces}
            canCloseWorkspace={canCloseActiveWorkspace}
            hasSavedSessions={activeSavedSessionCount > 0}
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

function generatedCodexTitleBackfills(
  sessions: SessionTile[],
  externalSessions: ExternalSessionSummary[],
): Array<{ sessionId: string; title: string }> {
  const titleByContentKey = new Map(externalSessions.map((session) => [session.contentSessionKey, session.title]));
  const generatedSessions = sessions.filter((session) => (
    isGeneratedSessionTitle(session.title)
    && (session.agentKind === "codex" || session.detectedAgentKind === "codex" || session.command === "codex")
  ));
  const backfills: Array<{ sessionId: string; title: string }> = [];
  const matchedSessionIds = new Set<string>();
  const reservedContentKeys = new Set<string>();

  for (const session of generatedSessions) {
    const contentKey = managedCodexContentKey(session);
    const title = contentKey ? titleByContentKey.get(contentKey) : undefined;
    if (!contentKey || !title) continue;
    backfills.push({ sessionId: session.id, title });
    matchedSessionIds.add(session.id);
    reservedContentKeys.add(contentKey);
  }

  // ponytail: 30s UUIDv7 proximity is a fallback; replace it with runtime session IDs when Codex exposes them.
  const pairs = generatedSessions
    .filter((session) => !matchedSessionIds.has(session.id) && session.createdAt !== undefined)
    .flatMap((session) => externalSessions.flatMap((external) => {
      if (reservedContentKeys.has(external.contentSessionKey)) return [];
      const createdAt = codexUuidV7Timestamp(external.contentSessionKey);
      const sameLocation = external.project.id === session.workspaceId
        || external.locationLabel === session.cwd.replace(/\\/g, "/").split("/").filter(Boolean).at(-1);
      const distance = createdAt === null ? Number.POSITIVE_INFINITY : Math.abs(createdAt - session.createdAt!);
      return sameLocation && distance <= 30_000 ? [{ session, external, distance }] : [];
    }))
    .sort((left, right) => left.distance - right.distance);
  const assignedContentKeys = new Set(reservedContentKeys);

  for (const { session, external } of pairs) {
    if (matchedSessionIds.has(session.id) || assignedContentKeys.has(external.contentSessionKey)) continue;
    backfills.push({ sessionId: session.id, title: external.title });
    matchedSessionIds.add(session.id);
    assignedContentKeys.add(external.contentSessionKey);
  }

  return backfills;
}

function managedCodexContentKey(session: SessionTile): string | null {
  if (session.resumeTarget?.agentKind === "codex") {
    return `external-codex:${session.resumeTarget.sessionId}`;
  }
  const rolloutId = session.initialBuffer?.match(
    /rollout-[^/\\\s]*?([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.jsonl/i,
  )?.[1];
  return rolloutId ? `external-codex:${rolloutId}` : null;
}

function codexUuidV7Timestamp(contentSessionKey: string): number | null {
  const id = contentSessionKey.startsWith("external-codex:")
    ? contentSessionKey.slice("external-codex:".length)
    : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
  return Number.parseInt(`${id.slice(0, 8)}${id.slice(9, 13)}`, 16);
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
