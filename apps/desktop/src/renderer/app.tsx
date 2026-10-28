import { X } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  getDesktopAlfredApi,
  getDesktopLayoutApi,
  getDesktopSessionsApi,
  getDesktopStateApi,
  getDesktopTerminalApi,
  getDesktopWorkspaceApi,
} from "./desktop-api";
import { CommandPalette } from "./components/CommandPalette";
import { DetailsChanges } from "./components/DetailsChanges";
import { ContextColumn } from "./components/ContextColumn";
import { NeedsYouPopover } from "./components/NeedsYouPopover";
import { NewSessionSheet, type NewSessionKind } from "./components/NewSessionSheet";
import { ProjectNavigator, railOrder, type ProjectNavigatorWorkspace } from "./components/ProjectNavigator";
import { SessionsSurface } from "./components/SessionsSurface";
import { TerminalDesk, type TerminalStartAttempt, type WorktreeActionKind } from "./components/TerminalDesk";
import { PlanLine } from "./components/PlanLine";
import { WorkbenchHeader, type PrimarySurface } from "./components/WorkbenchHeader";
import { WorkspaceActionsMenu } from "./components/WorkspaceActionsMenu";
import { WorkspacePreviewPanel } from "./components/WorkspacePreviewPanel";
import {
  blockingAttentionCountByWorkspace,
  needsYouItems,
  buildAttentionProjection,
  type AttentionProjection,
} from "./attention-projection";
import {
  canRequestPlan,
  errored,
  idle,
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
  titleForForegroundCommand,
  type SessionActivityEvent,
  type SessionTile,
} from "./session-state";
import { nextApprovalRevealAt, sessionState } from "./session-status";
import type { HistorySelection } from "./history-presentation";
import { createInitialSessionsViewState } from "./sessions-view-state";
import {
  recordPreviewUrlsFromText,
  removePreviewSessionCandidates,
  type PreviewUrlCandidate,
} from "./preview-state";
import { shortenPath } from "./path-display";
import { sessionRelaunchSafety } from "./relaunch-safety";
import { buildSessionsProjection, type SessionsPrimaryActionRequest } from "./sessions-projection";
import { isFreeChatScope, isReviewableWorktreeSession, isWorkSession } from "./session-scope";
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
import type {
  DispatchTargetSnapshot,
  WorkspaceLayoutsSnapshot,
  WorkspaceViewState,
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
  branchName?: string | undefined;
  files: Array<{ path: string; status: string }>;
  sessionId: string;
  summary: string;
  title: string;
  /** Why Alfred cannot list the checkout's changes, such as a missing folder or the agent's commits. */
  unlisted?: string;
};

const ACCESSIBLE_DISMISSAL_OWNER_SELECTOR =
  'dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"]';

const DEFAULT_WORKSPACE_ID = "A";
const DEFAULT_WORKSPACE: Workspace = { id: DEFAULT_WORKSPACE_ID, label: "Alfred", shortLabel: "A" };
const DEFAULT_WORKSPACES: Workspace[] = [DEFAULT_WORKSPACE];
const DEFAULT_PRIVACY_SETTINGS: DesktopPrivacySettings = {
  terminalScrollbackRetention: "redactedTail",
};

export function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(DEFAULT_WORKSPACES);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(DEFAULT_WORKSPACE_ID);
  const [terminalSessions, setTerminalSessions] = useState<SessionTile[]>([]);
  const [sessionStatusAnnouncement, setSessionStatusAnnouncement] = useState<string>("");
  const [selectedSessionIdsByWorkspace, setSelectedSessionIdsByWorkspace] = useState<Record<string, string>>({});
  // At most one session per project kept under the focus (contract: Pin). It lasts for this run of the app.
  const [pinnedSessionIdsByWorkspace, setPinnedSessionIdsByWorkspace] = useState<Record<string, string>>({});
  const [alfredStatus, setAlfredStatus] = useState<AlfredStatus>(idle());
  const [shellActionError, setShellActionError] = useState<string | null>(null);
  const [pendingPlans, setPendingPlans] = useState<Record<string, SquadPlan>>({});
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [commandQuery, setCommandQuery] = useState<string>("");
  const [privacyPanelOpen, setPrivacyPanelOpen] = useState<boolean>(false);
  const [privacySettings, setPrivacySettings] = useState<DesktopPrivacySettings>(DEFAULT_PRIVACY_SETTINGS);
  const [desktopSaveStatus, setDesktopSaveStatus] = useState<DesktopSaveStatus>({ status: "saved" });
  const [activeSurface, setActiveSurface] = useState<PrimarySurface>("work");
  const [sessionsViewState, setSessionsViewState] = useState(createInitialSessionsViewState);
  const [historySelection, setHistorySelection] = useState<HistorySelection | null>(null);
  // History reports its selection on every state tick; keep the same object while nothing visible changed.
  const handleHistorySelectionChange = useCallback((next: HistorySelection | null) => {
    setHistorySelection((current) => (
      current?.title === next?.title && current?.status.kind === next?.status.kind ? current : next
    ));
  }, []);
  const [workspaceHydrationStatus, setWorkspaceHydrationStatus] = useState<WorkspaceHydrationStatus>({
    status: "loading",
  });
  const [workspaceHydrationRetryIndex, setWorkspaceHydrationRetryIndex] = useState<number>(0);
  const [externalSessions, setExternalSessions] = useState<ExternalSessionSummary[]>([]);
  const [externalSessionsError, setExternalSessionsError] = useState<string | null>(null);
  const [externalSessionsLoading, setExternalSessionsLoading] = useState<boolean>(false);
  const externalSessionsRequestGenerationRef = useRef(0);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState<boolean>(false);
  const [workspaceRenameDraft, setWorkspaceRenameDraft] = useState<string>("");
  const [workspaceRenameEditing, setWorkspaceRenameEditing] = useState<boolean>(false);
  const [needsYouOpen, setNeedsYouOpen] = useState(false);
  const [terminalFocusRequestKey, setTerminalFocusRequestKey] = useState(0);
  const [armedRecoverySessionIds, setArmedRecoverySessionIds] = useState<Set<string>>(() => new Set());
  const [runtimeStatus, setRuntimeStatus] = useState<AlfredRuntimeStatus | null>(null);
  const [previewCandidates, setPreviewCandidates] = useState<PreviewUrlCandidate[]>([]);
  const [selectedPreviewUrlsByWorkspace, setSelectedPreviewUrlsByWorkspace] = useState<Record<string, string>>({});
  const [previewRefreshKeysByWorkspace, setPreviewRefreshKeysByWorkspace] = useState<Record<string, number>>({});
  const [previewDockOpenByWorkspace, setPreviewDockOpenByWorkspace] = useState<Record<string, boolean>>({});
  const [worktreeActionPending, setWorktreeActionPending] = useState<Record<string, WorktreeActionKind | undefined>>({});
  const [worktreeDiffView, setWorktreeDiffView] = useState<WorktreeDiffView | null>(null);
  const [contextDrawerOpenByWorkspace, setContextDrawerOpenByWorkspace] = useState<Record<string, boolean>>({});
  const [pendingDiscardConfirmation, setPendingDiscardConfirmation] = useState<PendingDiscardConfirmation | null>(null);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [newSessionDraftsByWorkspace, setNewSessionDraftsByWorkspace] = useState<Record<string, string>>({});
  const commandPaletteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const newSessionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [newSessionKind, setNewSessionKind] = useState<NewSessionKind>("codex");
  const [newSessionProjectId, setNewSessionProjectId] = useState(DEFAULT_WORKSPACE_ID);
  const [newSessionIsolation, setNewSessionIsolation] = useState(false);
  // "New worker" on a rail row: the session the new one is started under.
  const [newSessionParentId, setNewSessionParentId] = useState<string | null>(null);
  const [newSessionOpening, setNewSessionOpening] = useState(0);
  const newSessionGenerationRef = useRef(0);
  const closeNewSession = useCallback(() => {
    newSessionGenerationRef.current += 1;
    setNewSessionOpen(false);
  }, []);
  const openNewSession = useCallback((kind?: NewSessionKind, isolation: TerminalSessionIsolation = "shared") => {
    newSessionGenerationRef.current += 1;
    setNewSessionOpening(newSessionGenerationRef.current);
    if (kind) setNewSessionKind(kind);
    setNewSessionProjectId(activeWorkspaceId);
    setNewSessionIsolation(isolation === "worktree");
    setNewSessionParentId(null);
    setNewSessionOpen(true);
    setNeedsYouOpen(false);
  }, [activeWorkspaceId]);
  const openNewWorker = useCallback((parentSessionId: string) => {
    openNewSession();
    setNewSessionParentId(parentSessionId);
    // A plan is not a session, so it cannot be a worker.
    setNewSessionKind((kind) => (kind === "plan" ? "codex" : kind));
  }, [openNewSession]);
  const needsYouTriggerRef = useRef<HTMLButtonElement | null>(null);
  const worktreeDiffReturnFocusRef = useRef<HTMLElement | null>(null);
  const contextReturnFocusRef = useRef<HTMLElement | null>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const privacyReturnFocusRef = useRef<HTMLElement | null>(null);
  const discardReturnFocusRef = useRef<HTMLElement | null>(null);
  const workReturnFocusRef = useRef<HTMLElement | null>(null);
  const workReturnFocusLabelRef = useRef<string | null>(null);
  const restoreWorkFocusPendingRef = useRef(false);
  const contextFocusRequestKeyRef = useRef(0);
  const closingSessionIdsRef = useRef(new Map<string, { instanceKey: string; attempt?: TerminalStartAttempt }>());
  // Every id a session had in this run. A new session never takes one, so it cannot inherit a closed session's saved
  // screen or share its id in the agent event log; after a restart, the sessions Alfred keeps come back with theirs.
  const seenSessionIdsRef = useRef(new Set<string>());
  const startingSessionIdsRef = useRef(new Map<string, { attempt: TerminalStartAttempt; cancelled: boolean }>());
  const resumingExternalSessionKeysRef = useRef<Set<string>>(new Set());
  const externalResumeReservationsRef = useRef<Map<string, { tileId: string; workspaceId: string }>>(new Map());
  const worktreeActionPendingRef = useRef<Set<string>>(new Set());
  const terminalSessionsRef = useRef<SessionTile[]>([]);
  const pendingPlansRef = useRef<Record<string, SquadPlan>>({});
  const announcedSessionStatusesRef = useRef<Map<string, string>>(new Map());
  const sessionStatusAnnouncementsReadyRef = useRef<boolean>(false);
  const workspaceStateHydratedRef = useRef<boolean>(false);
  const workspaceStatePersistenceSkipRef = useRef<WorkspaceStateSnapshot | null>(null);
  const shortcutModifier = navigator.platform.includes("Mac") ? "Cmd" : "Ctrl";
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? DEFAULT_WORKSPACE;
  const workSessions = terminalSessions.filter(isWorkSession);
  const activeSessions = terminalSessions.filter((session) => session.workspaceId === activeWorkspace.id);
  const activeWorkSessions = workSessions.filter((session) => session.workspaceId === activeWorkspace.id);
  // Terminals in the grid; drafts sit on the plan line instead.
  const activeTerminalSessions = activeWorkSessions.filter((session) => session.stage !== "staged");
  const activeDrafts = activeWorkSessions.filter((session) => session.stage === "staged");
  const activeSavedSessions = activeSessions.filter((session) => !isWorkSession(session));
  const activeSavedSessionCount = buildSessionsProjection({
    sessions: activeSavedSessions,
    workspaces,
    externalSessions: [],
  }).total;
  const activeWorkSessionsById = new Map(activeWorkSessions.map((session) => [session.id, session]));
  const activePreviewCandidates = previewCandidates.flatMap((candidate) => {
    const source = candidate.workspaceId === activeWorkspace.id ? activeWorkSessionsById.get(candidate.sessionId) : undefined;
    // Named as the session is now: a shell takes its program's name after that program has printed its address.
    return source ? [{ ...candidate, sessionTitle: source.title }] : [];
  });
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
  const activeSelectedSessionId = selectedSessionIdsByWorkspace[activeWorkspace.id] ?? null;
  const activePinnedSessionId = pinnedSessionIdsByWorkspace[activeWorkspace.id] ?? null;
  const newSessionParent = newSessionParentId === null ? null : terminalSessions.find((session) => session.id === newSessionParentId) ?? null;
  const activeInspectedSession =
    activeSelectedSessionId
      ? activeWorkSessions.find((session) => session.id === activeSelectedSessionId) ?? activeTerminalSessions[0] ?? null
      : activeTerminalSessions[0] ?? null;
  const activeSelectedSession =
    activeWorkSessions.find((session) => session.id === activeSelectedSessionId) ?? activeTerminalSessions[0] ?? null;
  // Details holds the column the session stack had, so it starts open; ⌘I hides it.
  const activeContextDrawerOpen = contextDrawerOpenByWorkspace[activeWorkspace.id] ?? true;
  // Details describes the deck's focused session. History has its own reader and no side column, and a project with
  // nothing running has nothing to describe (v4 Fresh board), so the empty deck takes the whole width.
  const detailsVisible = activeContextDrawerOpen && activeSurface === "work" && activeInspectedSession !== null;
  const canCloseActiveWorkspace =
    activeWorkspace.id !== DEFAULT_WORKSPACE_ID && workspaces.length > 1 && activeSessions.length === 0;
  const unavailableWorkspaceIds = new Set(
    workspaces.filter((workspace) => workspace.rootStatus === "missing").map((workspace) => workspace.id),
  );
  const now = useSessionClock(terminalSessions);
  const attentionItems = buildAttentionProjection(workspaces, terminalSessions, now).filter((item) => {
    if (unavailableWorkspaceIds.has(item.workspaceId)) return false;
    const session = terminalSessions.find((candidate) => candidate.id === item.sessionId);
    return item.section !== "recovery"
      || session?.runtimeStatus !== "restored"
      || canRelaunchRestoredSession(session);
  });
  const needsYouAttention = needsYouItems(attentionItems);
  const needsYouCount = needsYouAttention.length;
  const activeNeedsYouIds = new Set(
    needsYouAttention.filter((item) => item.workspaceId === activeWorkspace.id).map((item) => item.sessionId),
  );
  const activePlan = pendingPlans[activeWorkspace.id];
  const activePlanName = activePlan && activeDrafts.some((draft) => activePlan.sessionIds.includes(draft.id))
    ? activePlan.name ?? activePlan.prompt
    : "Draft plan";
  const projectSessionIds = new Set(terminalSessions.filter((session) => !isFreeChatScope(session)).map((session) => session.id));
  const attentionCountsByWorkspace = blockingAttentionCountByWorkspace(
    attentionItems.filter((item) => projectSessionIds.has(item.sessionId)),
  );
  const reviewQueuePreview = attentionItems.find((item) => item.blocksAgent) ?? null;
  // Plan with Alfred plans through OpenRouter; without a key it is not offered anywhere.
  const planAvailable = runtimeStatus?.openRouterConfigured === true;
  const composerBlockedReason =
    terminalSessions.some((session) => session.workspaceId === newSessionProjectId && session.stage === "staged")
      ? "Resolve the current Alfred plan before asking for another."
      : alfredStatus.kind === "thinking"
        ? "Alfred is preparing a plan. Please wait."
      : runtimeStatus && !runtimeStatus.openRouterConfigured
        ? "Set OPENROUTER_API_KEY in repo .env to use Alfred."
        : undefined;

  useLayoutEffect(() => {
    terminalSessionsRef.current = terminalSessions;
    for (const session of terminalSessions) seenSessionIdsRef.current.add(session.id);
  }, [terminalSessions]);

  useEffect(() => {
    const previousStatuses = announcedSessionStatusesRef.current;
    const nextStatuses = new Map<string, string>();
    let nextAnnouncement: string | null = null;

    for (const session of terminalSessions) {
      const status = sessionState(session, "ready", now).label;
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
  }, [now, terminalSessions]);

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

  // Asking for a session means asking for its terminal, so Preview steps aside.
  const showTerminalInWorkspace = useCallback((workspaceId: string) => {
    if (!previewDockOpenByWorkspace[workspaceId]) return;
    setPreviewDockOpenByWorkspace((current) => ({
      ...current,
      [workspaceId]: false,
    }));
    void getDesktopLayoutApi()?.setWorkspaceViewState({
      workspaceId,
      viewState: { previewDockOpen: false },
    });
  }, [previewDockOpenByWorkspace]);

  const commitAddedSession = useCallback((nextSessions: SessionTile[]) => {
    const addedSession = nextSessions.at(-1);
    if (!addedSession) return;
    const layoutApi = getDesktopLayoutApi();

    terminalSessionsRef.current = nextSessions;
    setTerminalSessions(nextSessions);
    setNeedsYouOpen(false);
    setActiveSurface("work");
    showTerminalInWorkspace(addedSession.workspaceId);
    setActiveWorkspaceId(addedSession.workspaceId);
    setSelectedSessionIdsByWorkspace((current) => ({
      ...current,
      [addedSession.workspaceId]: addedSession.id,
    }));
    void layoutApi?.setWorkspaceViewState({
      workspaceId: addedSession.workspaceId,
      viewState: { selectedSessionId: addedSession.id },
    });
  }, [showTerminalInWorkspace]);

  const handleAddAgentSession = useCallback((kind: Extract<AgentKind, "claude" | "codex">, isolation: TerminalSessionIsolation = "shared", workspace: Workspace = activeWorkspace, prompt = "", parentSessionId?: string) => {
    if (workspace.rootStatus === "missing") return;
    commitAddedSession(
      addAgentSession(
        terminalSessionsRef.current,
        kind,
        workspace.rootPath ?? "",
        workspace.id,
        isolation,
        prompt,
        parentSessionId,
        seenSessionIdsRef.current,
      ),
    );
  }, [
    activeWorkspace,
    commitAddedSession,
  ]);

  // An orchestrator agent asked for a worker: it goes under its parent, and your focus, selection and project stay put.
  useEffect(() => {
    const terminalApi = getDesktopTerminalApi();
    if (!terminalApi?.onWorkerRequest) return;
    return terminalApi.onWorkerRequest((request) => {
      const parent = terminalSessionsRef.current.find((session) => session.id === request.parentClientId && session.stage === "live");
      const workspace = workspaces.find((candidate) => candidate.id === parent?.workspaceId);
      if (!parent || !workspace || workspace.rootStatus === "missing") {
        terminalApi.answerWorkerRequest({
          requestId: request.requestId,
          error: parent ? "The project folder is missing, so Alfred cannot start a worker there." : "Alfred no longer shows this session.",
        });
        return;
      }
      const added = addAgentSession(
        terminalSessionsRef.current,
        request.agent,
        workspace.rootPath ?? "",
        workspace.id,
        request.isolated ? "worktree" : "shared",
        request.prompt,
        parent.id,
        seenSessionIdsRef.current,
      );
      const generated = added.at(-1)!;
      // The orchestrator's model and effort, as each CLI takes them; main has checked the values.
      const flags = request.agent === "claude"
        ? [...(request.model ? ["--model", request.model] : []), ...(request.effort ? ["--effort", request.effort] : [])]
        : [...(request.model ? ["-m", request.model] : []), ...(request.effort ? ["-c", `model_reasoning_effort="${request.effort}"`] : [])];
      const worker = {
        ...generated,
        args: [...flags, ...(generated.args ?? [])],
        title: normalizeSessionTitle(request.title ?? "") || generated.title,
      };
      const nextSessions = [...added.slice(0, -1), worker];
      terminalSessionsRef.current = nextSessions;
      setTerminalSessions(nextSessions);
      terminalApi.answerWorkerRequest({ requestId: request.requestId, clientId: worker.id, title: worker.title });
    });
  }, [workspaces]);

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
      // A project whose folder is gone, or a sandbox without one, takes the folder you pick.
      if (activeWorkspace.rootStatus === "missing" || !activeWorkspace.rootPath) {
        const snapshot = await workspaceApi.bindFolderToWorkspace({ workspaceId: activeWorkspace.id });
        const workspace = snapshot.workspaces.find((item) => item.id === snapshot.activeWorkspaceId);
        setWorkspaces(snapshot.workspaces);
        setActiveWorkspaceId(snapshot.activeWorkspaceId);
        const rootPath = workspace?.rootPath;
        if (workspace && rootPath && workspace.rootStatus !== "missing") {
          setTerminalSessions((sessions) => {
            const workspaceSessions = sessions.filter((session) => session.workspaceId === workspace.id);
            if (workspaceSessions.length === 0) return addManualSession(sessions, rootPath, workspace.id, undefined, seenSessionIdsRef.current);

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

      return;
    }
  }, [activeWorkspace.id, activeWorkspace.rootPath, activeWorkspace.rootStatus]);

  // The rail's + and the palette's Add project: a folder you pick becomes a project; cancelling adds nothing.
  const handleAddProjectFromFolder = useCallback(async () => {
    const workspaceApi = getDesktopWorkspaceApi();
    if (!workspaceApi) return;
    const previousWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
    const snapshot = await workspaceApi.createWorkspaceFromFolder();
    const workspace = snapshot.workspaces.find((item) => item.id === snapshot.activeWorkspaceId);

    setWorkspaces(snapshot.workspaces);
    setActiveWorkspaceId(snapshot.activeWorkspaceId);
    if (workspace && !previousWorkspaceIds.has(workspace.id)) {
      setTerminalSessions((sessions) => addManualSession(sessions, workspace.rootPath ?? "", workspace.id, undefined, seenSessionIdsRef.current));
    }
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
    setSelectedSessionIdsByWorkspace((current) => omitWorkspaceRecord(current, activeWorkspace.id));
    setContextDrawerOpenByWorkspace((current) => omitWorkspaceRecord(current, activeWorkspace.id));
    setNewSessionDraftsByWorkspace((current) => omitWorkspaceRecord(current, activeWorkspace.id));
    setSelectedPreviewUrlsByWorkspace((current) => omitWorkspaceRecord(current, activeWorkspace.id));
    setPreviewRefreshKeysByWorkspace((current) => omitWorkspaceRecord(current, activeWorkspace.id));
    setPreviewDockOpenByWorkspace((current) => omitWorkspaceRecord(current, activeWorkspace.id));
    setPreviewCandidates((current) => current.filter((candidate) => candidate.workspaceId !== activeWorkspace.id));
    void workspaceApi?.setWorkspaceState({
      workspaces: remainingWorkspaces,
      activeWorkspaceId: nextActiveWorkspaceId,
    });
  }, [activeWorkspace.id, canCloseActiveWorkspace, workspaces]);

  const persistActiveWorkspaceViewState = useCallback((patch: WorkspaceViewState = {}) => {
    void getDesktopLayoutApi()?.setWorkspaceViewState({
      workspaceId: activeWorkspace.id,
      viewState: {
        ...(activeSelectedSessionId === null ? {} : { selectedSessionId: activeSelectedSessionId }),
        ...patch,
      },
    });
  }, [activeSelectedSessionId, activeWorkspace.id]);

  const handleToggleContextDrawer = useCallback(() => {
    const nextOpen = !activeContextDrawerOpen;
    if (nextOpen) {
      contextReturnFocusRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement : null;
      setNeedsYouOpen(false);
      contextFocusRequestKeyRef.current += 1;
    }
    if (!nextOpen) {
      // With nothing left to return to, the focused terminal takes the keyboard back.
      if (contextReturnFocusRef.current?.isConnected) contextReturnFocusRef.current.focus();
      else setTerminalFocusRequestKey((key) => key + 1);
    }
    setContextDrawerOpenByWorkspace((current) => {
      return {
        ...current,
        [activeWorkspace.id]: nextOpen,
      };
    });
  }, [activeContextDrawerOpen, activeWorkspace.id]);

  const handleOpenContextFromCommandPalette = useCallback(() => {
    setActiveSurface("work");
    contextReturnFocusRef.current = commandPaletteTriggerRef.current;
    setNeedsYouOpen(false);
    contextFocusRequestKeyRef.current += 1;
    setContextDrawerOpenByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: true,
    }));
  }, [activeWorkspace.id]);

  const handleBeginRenameActiveWorkspace = useCallback(() => {
    setNeedsYouOpen(false);
    setActiveSurface("work");
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
      "Project folder is unavailable.",
    );
  }, [activeWorkspace.rootPath, runShellAction]);

  const handleOpenActiveWorkspaceTerminal = useCallback(async () => {
    const rootPath = activeWorkspace.rootPath;
    if (!rootPath) return;
    await runShellAction(
      () => getDesktopWorkspaceApi()?.openExternalTerminal({ cwd: rootPath }),
      "Project terminal is unavailable.",
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
      "Project runtime is unavailable.",
    );
    if (!succeeded) throw new Error("Project runtime is unavailable.");
  }, [runShellAction]);

  const handleOpenExternalTerminalForCwd = useCallback(async (cwd: string) => {
    const succeeded = await runShellAction(
      () => getDesktopWorkspaceApi()?.openExternalTerminal({ cwd }),
      "Project runtime is unavailable.",
    );
    if (!succeeded) throw new Error("Project runtime is unavailable.");
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

  const handleOpenPreviewExternal = useCallback(async (url: string) => {
    await runShellAction(
      () => getDesktopWorkspaceApi()?.openExternalUrl({ url }),
      "Preview URL is unavailable.",
    );
  }, [runShellAction]);

  const handleClosePreviewDock = useCallback(() => {
    setPreviewDockOpenByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: false,
    }));
    persistActiveWorkspaceViewState({ previewDockOpen: false });
    // Back on the Terminal tab the keyboard belongs to the shell again.
    setTerminalFocusRequestKey((key) => key + 1);
  }, [activeWorkspace.id, persistActiveWorkspaceViewState]);

  const handleTogglePreviewDock = useCallback(() => {
    if (!previewVisible) return;
    if (activePreviewDockOpen) {
      handleClosePreviewDock();
      return;
    }
    setNeedsYouOpen(false);
    setPreviewDockOpenByWorkspace((current) => ({
      ...current,
      [activeWorkspace.id]: true,
    }));
    persistActiveWorkspaceViewState({ previewDockOpen: true });
  }, [activePreviewDockOpen, activeWorkspace.id, handleClosePreviewDock, persistActiveWorkspaceViewState, previewVisible]);

  const handleSelectSession = useCallback((sessionId: string) => {
    if (selectedSessionIdsByWorkspace[activeWorkspace.id] === sessionId) return;

    const layoutApi = getDesktopLayoutApi();
    setSelectedSessionIdsByWorkspace((current) => ({ ...current, [activeWorkspace.id]: sessionId }));
    void layoutApi?.setWorkspaceViewState({
      workspaceId: activeWorkspace.id,
      viewState: { selectedSessionId: sessionId },
    });
  }, [activeWorkspace.id, selectedSessionIdsByWorkspace]);

  const handleAddManualSession = useCallback((workspace: Workspace = activeWorkspace, parentSessionId?: string) => {
    if (workspace.rootStatus === "missing") return;
    commitAddedSession(
      addManualSession(
        terminalSessionsRef.current,
        workspace.rootPath ?? "",
        workspace.id,
        parentSessionId,
        seenSessionIdsRef.current,
      ),
    );
  }, [
    activeWorkspace,
    commitAddedSession,
  ]);

  const handlePinSession = useCallback((sessionId: string | null) => {
    setPinnedSessionIdsByWorkspace((current) => {
      const { [activeWorkspace.id]: _previous, ...others } = current;
      return sessionId === null ? others : { ...others, [activeWorkspace.id]: sessionId };
    });
  }, [activeWorkspace.id]);
  const handleFocusSession = useCallback((sessionId: string) => {
    setActiveSurface("work");
    showTerminalInWorkspace(activeWorkspace.id);
    setSelectedSessionIdsByWorkspace((current) => {
      if (current[activeWorkspace.id] === sessionId) return current;
      return {
        ...current,
        [activeWorkspace.id]: sessionId,
      };
    });
    if (selectedSessionIdsByWorkspace[activeWorkspace.id] !== sessionId) {
      void getDesktopLayoutApi()?.setWorkspaceViewState({
        workspaceId: activeWorkspace.id,
        viewState: { selectedSessionId: sessionId },
      });
    }
  }, [activeWorkspace.id, selectedSessionIdsByWorkspace, showTerminalInWorkspace]);
  // The deck links to History for this project and for what Alfred ran here: ended sessions can be
  // resumed too, not only asleep ones.
  const openProjectHistory = useCallback((selectedSessionKey: string | null = null) => {
    setNeedsYouOpen(false);
    setSessionsViewState((current) => ({
      ...current,
      query: "",
      selectedProjectId: activeWorkspace.id,
      source: "managed",
      pageIndex: 0,
      selectedSessionKey,
      navigatorScrollTop: 0,
      readerScrollTop: 0,
      readerPages: [],
      focusTarget: "search",
    }));
    setActiveSurface("sessions");
  }, [activeWorkspace.id]);
  // The Asleep line lands on the most recent asleep session, with the project's other sessions around it.
  const handleOpenSavedSessions = useCallback(() => {
    const at = (session: SessionTile) => session.lastActivityAt ?? session.lastOutputAt ?? session.createdAt ?? 0;
    const newestAsleep = [...activeSavedSessions].sort((a, b) => at(b) - at(a))[0];
    openProjectHistory(newestAsleep ? `managed:${newestAsleep.id}` : null);
  }, [activeSavedSessions, openProjectHistory]);
  const handleOpenRecoveryHistory = useCallback(() => openProjectHistory(), [openProjectHistory]);

  const handleFocusSessionByDelta = useCallback((delta: number) => {
    if (activeTerminalSessions.length === 0) return;
    const currentIndex = Math.max(
      0,
      activeTerminalSessions.findIndex((session) => session.id === activeSelectedSessionId),
    );
    const nextIndex = (currentIndex + delta + activeTerminalSessions.length) % activeTerminalSessions.length;
    const nextSession = activeTerminalSessions[nextIndex];
    if (nextSession) {
      handleFocusSession(nextSession.id);
    }
  }, [activeSelectedSessionId, activeTerminalSessions, handleFocusSession]);

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

    setActiveSurface("work");
    setActiveWorkspaceId(workspaceId);
    setSelectedSessionIdsByWorkspace((current) =>
      current[workspaceId] === sessionId ? current : { ...current, [workspaceId]: sessionId },
    );
    void getDesktopLayoutApi()?.setWorkspaceViewState({
      workspaceId,
      viewState: { selectedSessionId: sessionId },
    });
    void refreshLiveSessions();
  }, [refreshLiveSessions]);

  const handleFocusSessionInWorkspace = useCallback((workspaceId: string, sessionId: string) => {
    const targetExists = terminalSessionsRef.current.some((session) => (
      session.workspaceId === workspaceId && (isWorkSession(session) || session.id === sessionId)
    ));
    if (!targetExists) return;

    const layoutApi = getDesktopLayoutApi();
    const viewStateChanged = selectedSessionIdsByWorkspace[workspaceId] !== sessionId;

    setActiveSurface("work");
    showTerminalInWorkspace(workspaceId);
    if (activeWorkspaceId !== workspaceId) {
      setActiveWorkspaceId(workspaceId);
    }
    setSelectedSessionIdsByWorkspace((current) =>
      current[workspaceId] === sessionId ? current : { ...current, [workspaceId]: sessionId },
    );
    if (viewStateChanged) {
      void layoutApi?.setWorkspaceViewState({
        workspaceId,
        viewState: { selectedSessionId: sessionId },
      });
    }
    void refreshLiveSessions();
  }, [
    activeWorkspaceId,
    refreshLiveSessions,
    selectedSessionIdsByWorkspace,
    showTerminalInWorkspace,
  ]);

  useEffect(() => {
    for (const [conversationId] of externalResumeReservationsRef.current) {
      const actual = terminalSessions.find((session) => session.resumeTarget?.sessionId === conversationId);
      if (!actual) continue;
      externalResumeReservationsRef.current.delete(conversationId);
      handleFocusSessionInWorkspace(actual.workspaceId, actual.id);
    }
  }, [handleFocusSessionInWorkspace, terminalSessions]);

  useEffect(() => {
    setSelectedSessionIdsByWorkspace((current) => {
      const currentId = current[activeWorkspace.id];
      // A pick made after this render (a new session) is checked by the next render, whose lists hold it.
      if ((currentId ?? null) !== activeSelectedSessionId) return current;
      if (currentId && activeWorkSessions.some((session) => session.id === currentId)) {
        return current;
      }
      // Fall back to a terminal only; a draft is selected when someone opens it.
      const fallbackId = activeTerminalSessions[0]?.id;
      if (!fallbackId) {
        if (!currentId) return current;
        const next = { ...current };
        delete next[activeWorkspace.id];
        return next;
      }
      return {
        ...current,
        [activeWorkspace.id]: fallbackId,
      };
    });
  }, [activeSelectedSessionId, activeTerminalSessions, activeWorkSessions, activeWorkspace.id]);

  /** Closes a session; `discardCheckout` also removes a running session's checkout, after main stops its agent. */
  const closeSessionNow = useCallback(async (sessionId: string, discardCheckout = false) => {
    const terminalApi = getDesktopTerminalApi();
    const session = terminalSessionsRef.current.find((item) => item.id === sessionId);
    if (!session || closingSessionIdsRef.current.has(sessionId)) return;

    const closingOperation: { instanceKey: string; attempt?: TerminalStartAttempt } = {
      instanceKey: sessionInstanceKey(session),
    };
    const finishClosing = () => {
      if (closingSessionIdsRef.current.get(sessionId) === closingOperation) {
        closingSessionIdsRef.current.delete(sessionId);
      }
    };
    closingSessionIdsRef.current.set(sessionId, closingOperation);
    const destructiveWorktreeCleanup = discardCheckout
      || session.runtimeStatus === "restored" || session.runtimeStatus === "exited" || session.runtimeStatus === "error";
    const pendingStart = startingSessionIdsRef.current.get(sessionId);
    if (pendingStart) {
      pendingStart.cancelled = true;
      closingOperation.attempt = pendingStart.attempt;
    }

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
    setWorktreeDiffView((current) => (current?.sessionId === sessionId ? null : current));

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

  // Closing a checkout, running or ended, settles it: one with nothing outside the project goes with its session,
  // one with unapplied changes asks first. None is left on disk without a session.
  const handleCloseSession = useCallback((sessionId: string) => {
    const session = terminalSessionsRef.current.find((item) => item.id === sessionId);
    const terminalApi = getDesktopTerminalApi();
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const settlesCheckout = session?.runtimeStatus === "live" || session?.runtimeStatus === "restored"
      || session?.runtimeStatus === "exited" || session?.runtimeStatus === "error";
    if (!session || !settlesCheckout || !isReviewableWorktreeSession(session)) {
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

      // A checkout whose folder is gone or whose agent committed has no diff to list; it can still go once you confirm.
      if (!result.ok) {
        discardReturnFocusRef.current = returnFocus;
        setPendingDiscardConfirmation({
          sessionId,
          title: session.title,
          summary: "",
          files: [],
          branchName: session.branchName,
          unlisted: result.error,
        });
        return;
      }

      if (result.files.length === 0 || result.applied) {
        void closeSessionNow(sessionId, true);
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
        title: "Review before resuming",
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
        title: "Resuming session",
        detail: "Alfred is starting a fresh process from this asleep session.",
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
        title: "Review before resuming",
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
        title: "Resuming session",
        detail: "Alfred is starting a fresh process in this session.",
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
    setNeedsYouOpen(false);
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
                ? result.alreadyApplied
                  ? {
                      kind: "lifecycle",
                      title: "Already in the project",
                      detail: "This checkout's changes are already in the project's files. Nothing was applied again.",
                    }
                  : {
                      kind: "lifecycle",
                      title: "Applied to project",
                      detail: `${changedFileCountLabel(result.appliedFiles)} applied to the base project. Review and commit normally.`,
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
    void closeSessionNow(confirmation.sessionId, true);
  }, [closeSessionNow, pendingDiscardConfirmation]);

  const handleRuntimeSessionStarting = useCallback((tileId: string, attempt: TerminalStartAttempt): boolean => {
    const current = startingSessionIdsRef.current.get(tileId);
    if (current && !current.cancelled) {
      return false;
    }

    startingSessionIdsRef.current.set(tileId, { attempt, cancelled: false });
    const closingOperation = closingSessionIdsRef.current.get(tileId);
    if (closingOperation && !closingOperation.attempt) closingOperation.attempt = attempt;
    return true;
  }, []);

  const handleRuntimeSessionReady = useCallback((tileId: string, attempt: TerminalStartAttempt, runtime: TerminalCreateResult) => {
    const terminalApi = getDesktopTerminalApi();
    const alfredApi = getDesktopAlfredApi();
    const pendingStart = startingSessionIdsRef.current.get(tileId);
    const closingOperation = closingSessionIdsRef.current.get(tileId);
    const currentSession = terminalSessionsRef.current.find((session) => session.id === tileId);
    if (
      !pendingStart
      || pendingStart.attempt !== attempt
      || pendingStart.cancelled
      || closingOperation
      || !currentSession
      || currentSession.workspaceId !== attempt.workspaceId
      || runtime.clientId !== tileId
      || runtime.workspaceId !== attempt.workspaceId
      || (currentSession.runtimeId && currentSession.runtimeId !== runtime.id)
    ) {
      terminalApi?.kill({ id: runtime.id });
      if (pendingStart?.attempt === attempt) startingSessionIdsRef.current.delete(tileId);
      if (closingOperation?.attempt === attempt && closingSessionIdsRef.current.get(tileId) === closingOperation) {
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
      const withAttachment = appendSessionActivity(attached, tileId, {
        kind: "lifecycle",
        title: "Session attached",
        detail: `${runtime.shell} is running in ${runtime.cwd ? shortenPath(runtime.cwd) : "the project"}.`,
      }, attachmentAt);
      const uncommitted = runtime.uncommittedFiles ?? 0;
      return uncommitted === 0 ? withAttachment : appendSessionActivity(withAttachment, tileId, {
        kind: "lifecycle",
        title: "Started from the last commit",
        // Details shows the first sentence of a detail, so this stays one.
        detail: `Started from the last commit, without the project's ${uncommitted} uncommitted ${uncommitted === 1 ? "file" : "files"}.`,
      }, attachmentAt);
    });
    if (runtime.source === "alfred") {
      void alfredApi?.resolveStagedPlan({ sessionIds: [tileId] });
      pendingPlansRef.current = removePendingPlanSession(pendingPlansRef.current, tileId);
      setPendingPlans(pendingPlansRef.current);
    }
  }, []);

  const handleRuntimeSessionFailed = useCallback((tileId: string, attempt: TerminalStartAttempt, reason?: string) => {
    const pendingStart = startingSessionIdsRef.current.get(tileId);
    if (pendingStart?.attempt !== attempt) return;
    startingSessionIdsRef.current.delete(tileId);
    if (pendingStart.cancelled) return;
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
      const generatedTitle = generatedTitleForDetectedAgent(terminalSessionsRef.current, session, event.foregroundAgentKind);
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
        const { shellTitle: _shellTitle, ...withoutShellTitle } = session;

        return {
          ...withoutShellTitle,
          ...titleForForegroundCommand(session, snapshot),
          detectedAgentKind: snapshot.foregroundAgentKind,
          initialBuffer: snapshot.buffer,
          ...(snapshot.agentSignal === undefined ? {} : { agentSignal: snapshot.agentSignal }),
          ...(snapshot.shellBusy === undefined ? {} : { shellBusy: snapshot.shellBusy }),
          ...(snapshot.promptSubmitted ? { promptSubmitted: true } : {}),
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

  const handleSubmitPrompt = useCallback(async (dispatchTarget: DispatchTargetSnapshot, draft: string, workspace: Workspace): Promise<boolean> => {
    const prompt = draft.trim();
    if (!prompt) return false;
    if (!canRequestPlan(alfredStatus, terminalSessionsRef.current.filter((session) => session.workspaceId === workspace.id && session.stage === "staged").length)) return false;
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
        workspace: workspacePlanContext(workspace, terminalSessionsRef.current.filter((session) => session.workspaceId === workspace.id), dispatchTarget),
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
      workspace.rootPath ?? "",
      workspace.id,
      seenSessionIdsRef.current,
    );
    const stagedSessions = after.slice(before.length);
    const stagedPlan = createStagedPlanSnapshot({
      ...(response.plan.name === undefined ? {} : { name: response.plan.name }),
      prompt,
      workspaceId: workspace.id,
      sessions: stagedSessions,
    });
    const nextPendingPlan = toSquadPlan({ plan: stagedPlan });

    setTerminalSessions((current) => [...current, ...stagedSessions]);
    pendingPlansRef.current = nextPendingPlan
      ? { ...pendingPlansRef.current, [workspace.id]: nextPendingPlan }
      : omitWorkspaceRecord(pendingPlansRef.current, workspace.id);
    setPendingPlans(pendingPlansRef.current);
    if (stagedPlan) void alfredApi.setStagedPlan(stagedPlan);
    else void alfredApi.clearStagedPlan({ workspaceId: workspace.id });
    return true;
  }, [alfredStatus]);

  const handleStartNewSession = async (isolated: boolean) => {
    const workspace = workspaces.find((item) => item.id === newSessionProjectId);
    if (!workspace || workspace.rootStatus === "missing") return false;
    const draft = newSessionDraftsByWorkspace[workspace.id] ?? "";
    const parentSessionId = newSessionParent?.workspaceId === workspace.id ? newSessionParent.id : undefined;
    if (newSessionKind === "plan") {
      if (composerBlockedReason) return false;
      const submitted = await handleSubmitPrompt({ kind: "workspace", id: workspace.id, label: workspace.label }, draft, workspace);
      if (!submitted || newSessionGenerationRef.current !== newSessionOpening) return false;
      handleSelectWorkspace(workspace.id);
      setActiveSurface("work");
    } else if (newSessionKind === "terminal") {
      handleAddManualSession(workspace, parentSessionId);
    } else {
      handleAddAgentSession(newSessionKind, isolated ? "worktree" : "shared", workspace, draft.trim(), parentSessionId);
    }
    setNewSessionDraftsByWorkspace((current) => omitWorkspaceRecord(current, workspace.id));
    return true;
  };

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
        // A record of your launch, not a question: it must not read as one, nor make the session wait.
        kind: "lifecycle",
        title: "Approved for launch",
        detail: "Launched from the plan.",
      }),
    );
  }, [terminalSessions, workspaces]);

  const handleLaunchDrafts = useCallback((sessionIds: string[]) => {
    sessionIds.forEach(handleApproveTile);
  }, [handleApproveTile]);

  const handleRecoverSession = useCallback((workspaceId: string, sessionId: string) => {
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
      activeSurface === "sessions" &&
      nextSurface !== activeSurface &&
      armedRecoverySessionIds.size > 0
    ) {
      setArmedRecoverySessionIds(new Set());
      return;
    }
    setNeedsYouOpen(false);
    setActiveSurface(nextSurface);
  }, [activeSurface, armedRecoverySessionIds]);

  // The rail stays visible on History; picking a project there returns to its deck.
  const handleSelectWorkspaceFromRail = useCallback((workspaceId: string) => {
    if (activeSurface === "sessions" && armedRecoverySessionIds.size > 0) {
      setArmedRecoverySessionIds(new Set());
      return;
    }
    setActiveSurface("work");
    handleSelectWorkspace(workspaceId);
  }, [activeSurface, armedRecoverySessionIds, handleSelectWorkspace]);

  const handleExitSessionsToWork = useCallback(() => {
    if (armedRecoverySessionIds.size > 0) {
      setArmedRecoverySessionIds(new Set());
      return;
    }
    restoreWorkFocusPendingRef.current = true;
    setActiveSurface("work");
  }, [armedRecoverySessionIds]);

  useEffect(() => {
    setArmedRecoverySessionIds((current) => current.size === 0 ? current : new Set());
  }, [activeSurface, activeWorkspaceId]);

  const handleRejectTile = useCallback((tileId: string) => {
    const alfredApi = getDesktopAlfredApi();
    const owningPlan = Object.values(pendingPlansRef.current).find((plan) => plan.sessionIds.includes(tileId));
    setTerminalSessions((sessions) => rejectStaged(sessions, tileId));
    if (!owningPlan) return;

    pendingPlansRef.current = removePendingPlanSession(pendingPlansRef.current, tileId);
    setPendingPlans(pendingPlansRef.current);
    void alfredApi?.resolveStagedPlan({ sessionIds: [tileId] });
  }, []);

  const handleUpdateStagedSession = useCallback(async (sessionId: string, patch: AlfredStagedSessionPatch) => {
    const alfredApi = getDesktopAlfredApi();
    const owningPlan = Object.values(pendingPlansRef.current).find((plan) => plan.sessionIds.includes(sessionId));
    const owningWorkspace = workspaces.find((workspace) => workspace.id === owningPlan?.workspaceId);
    if (!alfredApi || !owningPlan || !owningWorkspace) {
      throw new Error("No draft plan is available to edit.");
    }

    setTerminalSessions((sessions) =>
      sessions.map((session) =>
        session.id === sessionId && session.stage === "staged"
          ? { ...session, stagedReviewStatus: "checking" }
          : session,
      ),
    );

    const response = await alfredApi.updateStagedSession({
      planId: owningPlan.id,
      sessionId,
      patch,
      workspace: workspacePlanContext(
        owningWorkspace,
        terminalSessionsRef.current.filter((session) => session.workspaceId === owningWorkspace.id && isWorkSession(session)),
      ),
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
        replaceStagedSessionsFromPlan(sessions, response.plan, owningWorkspace.rootPath ?? "").map((session) =>
          session.id === sessionId ? { ...session, stagedReviewStatus: "edited" } : session,
        ),
        sessionId,
        {
          kind: "plan",
          title: "Draft command edited",
          detail: "Alfred rechecked the command before launch.",
        },
      ),
    );
    const nextPendingPlan = toSquadPlan({ plan: response.plan });
    pendingPlansRef.current = nextPendingPlan
      ? { ...pendingPlansRef.current, [owningWorkspace.id]: nextPendingPlan }
      : omitWorkspaceRecord(pendingPlansRef.current, owningWorkspace.id);
    setPendingPlans(pendingPlansRef.current);
  }, [workspaces]);

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
        : settingsTriggerRef.current;
    setCommandPaletteOpen(false);
    setCommandQuery("");
    setPrivacyPanelOpen(true);
  }, [commandPaletteOpen]);

  const handleClosePrivacyPanel = useCallback(() => {
    setPrivacyPanelOpen(false);
    requestAnimationFrame(() => {
      const target = privacyReturnFocusRef.current;
      if (target?.isConnected) target.focus();
      else settingsTriggerRef.current?.focus();
      privacyReturnFocusRef.current = null;
    });
  }, []);

  const handleCloseCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
    setCommandQuery("");
  }, []);

  const handleRefreshExternalSessions = useCallback(async () => {
    const sessionsApi = getDesktopSessionsApi();
    if (!sessionsApi) {
      setExternalSessionsError("Session history is unavailable in this build.");
      return;
    }

    const requestGeneration = externalSessionsRequestGenerationRef.current + 1;
    externalSessionsRequestGenerationRef.current = requestGeneration;
    setExternalSessionsLoading(true);
    setExternalSessionsError(null);
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
        setExternalSessions((current) => {
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
      setExternalSessions(accumulated);
      setExternalSessionsError(null);
    } catch {
      if (externalSessionsRequestGenerationRef.current !== requestGeneration) return;
      setExternalSessionsError("Refresh failed. Retry when the local session index is available.");
    } finally {
      if (snapshotCursorToRelease) {
        await sessionsApi.releaseListSnapshot({ cursor: snapshotCursorToRelease }).catch(() => {});
      }
      if (externalSessionsRequestGenerationRef.current === requestGeneration) setExternalSessionsLoading(false);
    }
  }, [workspaces]);

  // The main process already dropped the saved plans; drop their draft sessions from the view too.
  const dropPendingPlan = useCallback(() => {
    pendingPlansRef.current = {};
    setPendingPlans({});
    setTerminalSessions((sessions) => sessions.filter((session) => session.stage !== "staged"));
  }, []);

  const handleUpdatePrivacySettings = useCallback(async (nextSettings: DesktopPrivacySettings) => {
    const desktopStateApi = getDesktopStateApi();
    setPrivacySettings(nextSettings);

    if (!desktopStateApi) return;
    try {
      const persisted = await desktopStateApi.updatePrivacySettings(nextSettings);
      setPrivacySettings(persisted);
      if (persisted.terminalScrollbackRetention === "off") dropPendingPlan();
    } catch {
      setDesktopSaveStatus({ status: "saveFailed", message: "Failed to persist desktop state.", failedAt: Date.now() });
    }
  }, [dropPendingPlan]);

  const handleClearSavedTerminalData = useCallback(async () => {
    const desktopStateApi = getDesktopStateApi();
    if (!desktopStateApi) return { ok: false as const, error: "Desktop state controls are unavailable in this build." };

    const result = await desktopStateApi.clearSavedTerminalData();
    if (result.ok) {
      dropPendingPlan();
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
  }, [dropPendingPlan]);

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
    if (terminalSessionsRef.current.some((session) => session.id === sessionId && session.stage === "staged")) {
      // Drafts are not in the grid, so select the draft for Details instead of focusing a tile.
      setActiveSurface("work");
      setActiveWorkspaceId(workspaceId);
      setSelectedSessionIdsByWorkspace((current) => ({ ...current, [workspaceId]: sessionId }));
      void layoutApi?.setWorkspaceViewState({ workspaceId, viewState: { selectedSessionId: sessionId } });
    } else {
      handleFocusSessionInWorkspace(workspaceId, sessionId);
    }
    setContextDrawerOpenByWorkspace((current) => ({
      ...current,
      [workspaceId]: true,
    }));
  }, [handleFocusSessionInWorkspace]);

  const handleRunNeedsYouAction = useCallback((item: AttentionProjection) => {
    setNeedsYouOpen(false);
    if (item.action.kind === "review-edit") {
      handleReviewBlockedSession(item.workspaceId, item.sessionId);
      return;
    }
    handleFocusSessionInWorkspace(item.workspaceId, item.sessionId);
    setTerminalFocusRequestKey((key) => key + 1);
  }, [handleFocusSessionInWorkspace, handleReviewBlockedSession]);

  const handleOpenNeedsYou = useCallback(() => {
    flushSync(() => {
      setCommandPaletteOpen(false);
      setCommandQuery("");
    });
    setNeedsYouOpen(true);
  }, []);

  const handleToggleNeedsYou = useCallback(() => {
    setNeedsYouOpen((open) => !open);
  }, []);

  const handleCloseNeedsYou = useCallback(() => {
    setNeedsYouOpen(false);
  }, []);

  const handleResumeExternalSession = useCallback(async (summary: SessionSummary) => {
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
      const { agentKind } = resolved;
      const agentLabel = agentKind === "claude" ? "Claude" : "Codex";
      const alreadyManaged = terminalSessionsRef.current.find((session) => (
        session.resumeTarget?.agentKind === agentKind
        && session.resumeTarget?.sessionId === resolved.sessionId
      ));
      if (alreadyManaged) {
        // An asleep or ended session that holds the conversation resumes it in place, as its own Resume would.
        const { runtimeStatus } = alreadyManaged;
        if (runtimeStatus === "restored" || runtimeStatus === "exited" || runtimeStatus === "error") {
          handleRecoverSession(alreadyManaged.workspaceId, alreadyManaged.id);
        } else {
          handleFocusSessionInWorkspace(alreadyManaged.workspaceId, alreadyManaged.id);
        }
        return;
      }
      if (externalResumeReservationsRef.current.has(resolved.sessionId)) return;
      const title = normalizeSessionTitle(summary.title ?? "") || `${agentLabel} resume`;
      const tile: SessionTile = {
        id: `external-${agentKind}-${resolved.sessionId.slice(0, 8)}-${now}`,
        title,
        workspaceId: targetWorkspace.id,
        cwd: resolved.cwd,
        source: "manual",
        stage: "live",
        runtimeStatus: "starting",
        agentKind,
        command: agentKind,
        args: agentKind === "claude" ? ["--resume", resolved.sessionId] : ["resume", resolved.sessionId],
        resumeTarget: { agentKind, sessionId: resolved.sessionId, source: "external-session-index" },
        resumeMode: "exact",
        isolation: "shared",
        createdAt: now,
        activityEvents: [
          {
            id: `external-${agentKind}-${resolved.sessionId.slice(0, 8)}-${now}-resume`,
            kind: "lifecycle",
            title: `External ${agentLabel} session resumed`,
            detail: `Alfred is opening this ${agentLabel} transcript in a managed terminal.`,
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
          session.resumeTarget?.agentKind === agentKind
          && session.resumeTarget?.sessionId === resolved.sessionId
        ))) return sessions;
        return [...sessions, tile];
      });
    } finally {
      resumingExternalSessionKeysRef.current.delete(sessionKey);
    }
  }, [handleFocusSessionInWorkspace, handleRecoverSession, workspaces]);

  const handleAddExternalProject = useCallback(async () => {
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
        if (request.target) handleRecoverSession(request.target.workspaceId, request.target.sessionId);
        return;
      case "resume-external":
        void handleResumeExternalSession(request.summary);
        return;
      case "add-project":
        void handleAddExternalProject();
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
    handleAddExternalProject,
    handleFocusSessionInWorkspace,
    handleRecoverSession,
    handleResumeExternalSession,
    selectedSessionIdsByWorkspace,
    workspaces,
  ]);

  useEffect(() => {
    if (activeSurface !== "sessions" && !needsGeneratedCodexTitleBackfill) return;
    void handleRefreshExternalSessions();
  }, [activeSurface, handleRefreshExternalSessions, needsGeneratedCodexTitleBackfill]);

  useEffect(() => {
    if (externalSessions.length === 0) return;
    for (const backfill of generatedCodexTitleBackfills(terminalSessionsRef.current, externalSessions)) {
      handleRenameSession(backfill.sessionId, backfill.title);
    }
  }, [externalSessions, handleRenameSession]);

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
          // The rail sits outside the shell, so look for the current project across the frame.
          const fallback = document.querySelector<HTMLElement>(
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
            key === "i" ||
            key === "j" ||
            key === "k" ||
            key === "t" ||
            key === "n" ||
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

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (!newSessionOpen) openNewSession();
        return;
      }
      if (newSessionOpen && !(event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey))) return;

      if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) {
        const index = Number.parseInt(event.key, 10) - 1;
        const workspace = railOrder(workspaces)[index];
        if (workspace) {
          event.preventDefault();
          handleSelectWorkspaceFromRail(workspace.id);
        }
        return;
      }

      // The Deck's session shortcuts act on sessions you can see; History hides the Deck. The keys are still taken,
      // or Command W would reach the window menu.
      const key = event.key.toLowerCase();
      const sessionShortcut = (event.metaKey || event.ctrlKey) && (
        key === "t" || key === "w"
        || (event.shiftKey && (key === "o" || event.code === "BracketRight" || event.code === "BracketLeft"))
      );
      if (sessionShortcut && activeSurface !== "work") {
        event.preventDefault();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "i") {
        event.preventDefault();
        if (activeSurface === "work" && !newSessionOpen && !workspaceMenuOpen && !pendingDiscardConfirmation) {
          handleToggleContextDrawer();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "j") {
        event.preventDefault();
        handleToggleNeedsYou();
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
    activeSurface,
    commandPaletteOpen,
    handleAddManualSession,
    openNewSession,
    newSessionOpen,
    handleCloseSelectedSession,
    handleCloseCommandPalette,
    handleFocusSessionByDelta,
    handleOpenCommandPalette,
    handleOpenSessionTerminal,
    handleSelectWorkspaceFromRail,
    handleToggleNeedsYou,
    handleToggleContextDrawer,
    workspaceMenuOpen,
    pendingDiscardConfirmation,
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

    const emptyLayouts: WorkspaceLayoutsSnapshot = { viewStateByWorkspace: {} };

    Promise.all([
      terminalApi.list(),
      alfredApi?.getStagedPlans().catch(() => ({ plans: [] })) ?? Promise.resolve({ plans: [] }),
      alfredApi?.getRuntimeStatus().catch(() => null) ?? Promise.resolve(null),
      layoutApi?.getLayouts() ?? Promise.resolve(emptyLayouts),
      workspaceApi?.getWorkspaceState() ?? Promise.resolve(null),
    ])
      .then(([terminalResult, stagedPlanResult, runtimeStatusResult, layoutResult, workspaceStateResult]) => {
        if (cancelled) return;
        const hydratedWorkspaceId = workspaceStateResult?.activeWorkspaceId ?? DEFAULT_WORKSPACE_ID;
        setRuntimeStatus(runtimeStatusResult);
        const hydratedSelectedSessionIds = Object.fromEntries(
          Object.entries(layoutResult.viewStateByWorkspace).flatMap(([workspaceId, viewState]) =>
            viewState.selectedSessionId ? [[workspaceId, viewState.selectedSessionId]] : [],
          ),
        );
        setSelectedSessionIdsByWorkspace((current) => ({
          ...hydratedSelectedSessionIds,
          ...current,
        }));
        setPreviewDockOpenByWorkspace(
          Object.fromEntries(
            Object.entries(layoutResult.viewStateByWorkspace).flatMap(([workspaceId, viewState]) =>
              viewState.previewDockOpen === undefined ? [] : [[workspaceId, viewState.previewDockOpen]],
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
        const stagedSessions = stagedPlanResult.plans.flatMap((plan) =>
          hydrateStagedPlanSessions(plan, workspaceRootPath(workspaceStateResult, plan.workspaceId)),
        ).filter(
          (session) => !liveClientIds.has(session.id) && !restoredClientIds.has(session.id),
        );
        const alreadyLaunchedStagedIds = stagedPlanResult.plans
          .flatMap((plan) => plan.sessions.map((session) => session.id))
          .filter((id) => liveClientIds.has(id) || restoredClientIds.has(id));
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
        const hydratedPendingPlans = Object.fromEntries(stagedPlanResult.plans.flatMap((plan) => {
          const pendingPlan = toSquadPlan({ plan, omittedSessionIds: alreadyLaunchedStagedIds });
          return pendingPlan ? [[plan.workspaceId, pendingPlan]] : [];
        }));
        pendingPlansRef.current = hydratedPendingPlans;
        setPendingPlans(hydratedPendingPlans);
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
        if (event.key === "Escape" && activeSurface === "work" && armedRecoverySessionIds.size > 0
          && !activeAccessibleDismissalOwner(event.currentTarget)) {
          event.preventDefault();
          event.stopPropagation();
          setArmedRecoverySessionIds(new Set());
          return;
        }
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
        <ProjectNavigator
          activeSessionId={activeSelectedSessionId}
          asleepCount={activeSavedSessionCount}
          activeSurface={activeSurface}
          activeWorkspaceId={activeWorkspace.id}
          attentionCountsByWorkspace={attentionCountsByWorkspace}
          inert={newSessionOpen && !commandPaletteOpen && !privacyPanelOpen}
          now={now}
          pinnedSessionId={activePinnedSessionId}
          sessions={terminalSessions}
          settingsTriggerRef={settingsTriggerRef}
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
          onAddWorkspace={handleAddProjectFromFolder}
          onFocusSession={handleFocusSession}
          onNewWorker={openNewWorker}
          onOpenAsleep={handleOpenSavedSessions}
          onOpenSettings={handleOpenPrivacyPanel}
          onPinSession={handlePinSession}
          onSelectSessionInWorkspace={handleSelectSessionInWorkspace}
          onSelectSurface={handleSelectPrimarySurface}
          onSelectWorkspace={handleSelectWorkspaceFromRail}
        />
        <div className="mission-bar" inert={newSessionOpen && !commandPaletteOpen && !privacyPanelOpen}>
          <WorkbenchHeader
            activeSurface={activeSurface}
            commandPaletteTriggerRef={commandPaletteTriggerRef}
            historySelection={historySelection}
            needsYouCount={needsYouCount}
            needsYouOpen={needsYouOpen}
            needsYouTriggerRef={needsYouTriggerRef}
            newSessionTriggerRef={newSessionTriggerRef}
            now={now}
            previewAvailable={previewVisible}
            previewOpen={activePreviewDockOpen}
            projectDetail={workspaceDetail(activeWorkspace)}
            projectLabel={activeWorkspace.label}
            selectedSession={activeSelectedSession}
            shortcutModifier={shortcutModifier}
            onOpenCommandPalette={handleOpenCommandPalette}
            onOpenNewSession={() => openNewSession()}
            onToggleNeedsYou={handleToggleNeedsYou}
            onTogglePreview={handleTogglePreviewDock}
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
                Retry
              </button>
            </div>
          )}

          {workspaceHydrationStatus.status === "failed" && (
            <div className="desktop-save-banner" role="alert">
              <div>
                <strong>Project not loaded</strong>
                <span>{workspaceHydrationStatus.message}</span>
              </div>
              <button type="button" onClick={handleRetryWorkspaceHydration}>
                Retry
              </button>
            </div>
          )}
        </div>

        <div
          className={[
            "workspace-layout",
            `surface-${activeSurface}`,
            activePreviewDockOpen ? "preview-visible" : "",
            detailsVisible ? "context-visible" : "",
          ].filter(Boolean).join(" ")}
          inert={newSessionOpen && !commandPaletteOpen && !privacyPanelOpen}
          data-testid="workbench-shell"
        >
          <div className="orchestrator-surface" data-testid="workbench-surface">
            <div
              className={`surface-panel desk-surface-panel ${workSurfaceHidden ? "inactive" : "active"}`}
              data-testid="desk-runtime-surface"
              aria-hidden={workSurfaceHidden ? "true" : undefined}
              inert={workSurfaceHidden || undefined}
            >
                <TerminalDesk
                  activeWorkspaceId={activeWorkspace.id}
                  armedRecoverySessionIds={armedRecoverySessionIds}
                  now={now}
                  previewPane={activePreviewDockOpen ? (
                    <WorkspacePreviewPanel
                      candidates={activePreviewCandidates}
                      refreshKey={activePreviewRefreshKey}
                      selectedUrl={activeSelectedPreviewUrl}
                      onClose={handleClosePreviewDock}
                      onOpenExternal={handleOpenPreviewExternal}
                      onRefresh={handleRefreshPreview}
                      onSelectUrl={handleSelectPreviewUrl}
                    />
                  ) : null}
                  pinnedSessionId={activePinnedSessionId}
                  selectedSessionId={activeSelectedSessionId}
                  sessions={terminalSessions}
                  surfaceActive={!workSurfaceHidden}
                  terminalFocusRequestKey={terminalFocusRequestKey}
                  worktreeDiffReturnFocus={worktreeDiffReturnFocusRef.current}
                  worktreeDiffView={worktreeDiffView}
                  workspaceGitBranch={activeWorkspace.gitBranch}
                  workspaceLabel={activeWorkspace.label}
                  workspaceRootPath={activeWorkspace.rootPath}
                  workspaceRootStatus={activeWorkspace.rootStatus}
                  onBindWorkspace={handleBindWorkspaceFromFolder}
                  onAddAgentSession={(kind) => openNewSession(kind)}
                  onOpenPlan={planAvailable ? () => openNewSession("plan") : undefined}
                  onAddManualSession={() => openNewSession("terminal")}
                  onCloseSession={handleCloseSession}
                  onCloseWorktreeDiff={handleCloseWorktreeDiff}
                  onContinueRestoredSession={handleContinueRestoredSession}
                  onOpenExternalTerminal={handleOpenSessionTerminal}
                  onOpenHistory={handleOpenRecoveryHistory}
                  onRestartSession={handleRestartSession}
                  onRuntimeSessionFailed={handleRuntimeSessionFailed}
                  onRuntimeSessionExited={handleRuntimeSessionExited}
                  onRuntimeSessionOutput={handleRuntimeSessionOutput}
                  onRuntimeSessionReplayBuffer={handleRuntimeSessionReplayBuffer}
                  onRuntimeSessionSnapshot={handleRuntimeSessionSnapshot}
                  onRuntimeSessionReady={handleRuntimeSessionReady}
                  onRuntimeSessionStarting={handleRuntimeSessionStarting}
                  onRuntimeSessionUnavailable={handleRuntimeSessionUnavailable}
                  onRenameSession={handleRenameSession}
                  onPinSession={handlePinSession}
                  onSelectSession={handleSelectSession}
                  planLine={
                    <PlanLine
                      key={activeWorkspace.id}
                      drafts={activeDrafts}
                      name={activePlanName}
                      needsYouIds={activeNeedsYouIds}
                      onDiscard={handleRejectTile}
                      onEdit={(sessionId) => handleReviewBlockedSession(activeWorkspace.id, sessionId)}
                      onLaunch={handleApproveTile}
                      onLaunchAll={handleLaunchDrafts}
                    />
                  }
                />
            </div>
            {activeSurface === "sessions" && (
              <div className="surface-panel active">
                <SessionsSurface
                  armedRecoverySessionIds={armedRecoverySessionIds}
                  externalSessions={externalSessions}
                  externalSessionsError={externalSessionsError}
                  loadingExternalSessions={externalSessionsLoading}
                  now={now}
                  sessions={terminalSessions}
                  sessionsApi={getDesktopSessionsApi()}
                  state={sessionsViewState}
                  terminalApi={getDesktopTerminalApi()}
                  worktreeActionPending={worktreeActionPending}
                  workspaces={workspaces}
                  onApplyWorktree={handleApplyWorktree}
                  onBackToWork={handleExitSessionsToWork}
                  onDiscardSavedSession={handleCloseSession}
                  onPrimaryAction={handleSessionsPrimaryAction}
                  onSelectionChange={handleHistorySelectionChange}
                  onRefreshExternalSessions={() => void handleRefreshExternalSessions()}
                  onReviewWorktree={handleReviewWorktree}
                  onStateChange={setSessionsViewState}
                />
              </div>
            )}
          </div>
          <ContextColumn
            contextOpen={detailsVisible}
            dismissalSuspended={
              commandPaletteOpen ||
              privacyPanelOpen ||
              newSessionOpen ||
              workspaceMenuOpen ||
              pendingDiscardConfirmation !== null ||
              needsYouOpen ||
              worktreeDiffView !== null
            }
            focusRequestKey={contextFocusRequestKeyRef.current}
            shortcutModifier={shortcutModifier}
            timelineProps={{
              session: activeInspectedSession,
              now,
              projectName: activeWorkspace.label,
              changes: <DetailsChanges
                open={detailsVisible}
                session={activeInspectedSession}
                projectName={activeWorkspace.label}
                pendingAction={activeInspectedSession ? worktreeActionPending[sessionInstanceKey(activeInspectedSession)] : undefined}
                onReview={handleReviewWorktree}
                onApply={handleApplyWorktree}
              />,
              onCopyActivityText: handleCopyActivityText,
              onOpenExternalTerminal: handleOpenExternalTerminalForCwd,
              onRevealActivityFile: handleRevealActivityFile,
              onUpdateStagedSession: handleUpdateStagedSession,
            }}
          />
        </div>
        {needsYouOpen && (
          <NeedsYouPopover
            dismissalSuspended={commandPaletteOpen || privacyPanelOpen || pendingDiscardConfirmation !== null}
            items={needsYouAttention}
            shortcutLabel={shortcutModifier === "Cmd" ? "⌘J" : "Ctrl J"}
            triggerRef={needsYouTriggerRef}
            onClose={handleCloseNeedsYou}
            onRunAction={handleRunNeedsYouAction}
          />
        )}
        {newSessionOpen && (
          <NewSessionSheet
            key={newSessionOpening}
            triggerRef={newSessionTriggerRef}
            projects={workspaces}
            projectId={newSessionProjectId}
            kind={newSessionKind === "plan" && !planAvailable ? "codex" : newSessionKind}
            planAvailable={planAvailable}
            initialIsolation={newSessionIsolation}
            parentTitle={newSessionParent?.workspaceId === newSessionProjectId ? newSessionParent.title : undefined}
            draft={newSessionDraftsByWorkspace[newSessionProjectId] ?? ""}
            disabled={commandPaletteOpen || privacyPanelOpen}
            blockedReason={composerBlockedReason}
            requestError={alfredStatus.kind === "error" ? alfredStatus.error.message : undefined}
            onProjectChange={setNewSessionProjectId}
            onKindChange={setNewSessionKind}
            onDraftChange={(draft) => setNewSessionDraftsByWorkspace((current) => ({ ...current, [newSessionProjectId]: draft }))}
            onStart={handleStartNewSession}
            onClose={closeNewSession}
          />
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
            allSessions={workSessions}
            now={now}
            pinnedSessionId={activePinnedSessionId}
            query={commandQuery}
            reviewQueuePreview={reviewQueuePreview}
            selectedSessionId={activeSelectedSessionId}
            sessions={activeWorkSessions}
            shortcutModifier={shortcutModifier}
            workspaces={workspaces}
            canCloseWorkspace={canCloseActiveWorkspace}
            hasSavedSessions={activeSavedSessionCount > 0}
            onAddAgentSession={(kind, isolation) => openNewSession(kind, isolation)}
            onAddManualSession={() => openNewSession("terminal")}
            onOpenPlan={planAvailable ? () => openNewSession("plan") : undefined}
            onAddWorkspace={handleAddWorkspace}
            onAddProject={handleAddProjectFromFolder}
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
            onOpenNeedsYou={handleOpenNeedsYou}
            onOpenContext={handleOpenContextFromCommandPalette}
            onOpenPrivacyControls={handleOpenPrivacyPanel}
            onPinSession={handlePinSession}
            onRestartSession={handleRestartSession}
            onSelectWorkspace={handleSelectWorkspace}
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
          <strong>Local Data & Privacy</strong>
          <small>Choose what Alfred keeps on this Mac.</small>
        </header>
        <div className="privacy-panel-body">
          <section className="privacy-control-row">
            <div>
              <strong>Terminal scrollback</strong>
              <span>{settings.terminalScrollbackRetention === "off" ? "Saved terminal buffers and agent events are disabled." : "Only a redacted 80k tail and redacted agent events are saved."}</span>
            </div>
            <div className="privacy-segmented" role="group" aria-label="Terminal scrollback retention">
              <button
                type="button"
                aria-pressed={settings.terminalScrollbackRetention === "redactedTail"}
                onClick={() => updateRetention("redactedTail")}
              >
                Redacted tail
              </button>
              <button
                type="button"
                aria-pressed={settings.terminalScrollbackRetention === "off"}
                onClick={() => updateRetention("off")}
              >
                Off
              </button>
            </div>
          </section>

          <section className="privacy-action-row">
            <div>
              <strong>Asleep sessions</strong>
              <span>
                Clear Alfred&apos;s persisted terminal buffers, activity previews, the draft plan, and the agent event log.
                This can&apos;t be undone.
              </span>
            </div>
            {clearArmed ? (
              <div className="privacy-confirm-actions">
                <button ref={keepDataButtonRef} type="button" onClick={cancelClearSavedTerminalData}>
                  Keep data
                </button>
                <button type="button" className="privacy-action-button danger" onClick={() => void clearSavedTerminalData()}>
                  Clear asleep sessions
                </button>
              </div>
            ) : (
              <button ref={clearActionRef} type="button" className="privacy-action-button danger" onClick={() => setClearArmed(true)}>
                Clear asleep sessions…
              </button>
            )}
          </section>

          <section className="privacy-action-row">
            <div>
              <strong>Local state file</strong>
              <span>Reveal Alfred's desktop state file in Finder.</span>
            </div>
            <button type="button" className="privacy-action-button" onClick={() => void revealStateFile()}>
              Reveal in Finder
            </button>
          </section>

          {saveStatus.status === "saveFailed" && (
            <div className="privacy-panel-status error" role="alert">
              <span>{saveStatus.message}</span>
              <button type="button" onClick={() => void onRetrySave()}>
                Retry
              </button>
            </div>
          )}
          {message && (
            <div className="privacy-panel-status" role="status">
              {message}
            </div>
          )}
        </div>
        <footer className="privacy-panel-actions">
          <button ref={closeButtonRef} type="button" className="privacy-panel-done" onClick={onClose}>
            Done
          </button>
        </footer>
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
          <strong>Discard isolated checkout</strong>
          <small>
            {confirmation.unlisted === undefined
              ? `${confirmation.title} has ${changedFileLabel}.`
              : `Alfred cannot list the changes of ${confirmation.title}.`}
          </small>
        </header>
        {confirmation.unlisted === undefined ? (
          <div className="discard-checkout-body">
            <p>This checkout has local changes. Review them before you delete the isolated worktree, or discard them for good.</p>
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
        ) : (
          <div className="discard-checkout-body">
            <p>{confirmation.unlisted}</p>
            <p>
              Discarding deletes the checkout folder and its branch
              {confirmation.branchName ? <> <code>{confirmation.branchName}</code></> : null}, with any commits that are only on
              that branch.
            </p>
          </div>
        )}
        <footer className="discard-checkout-actions">
          {confirmation.unlisted === undefined && (
            <button type="button" className="discard-checkout-primary" onClick={onReviewChanges}>
              Review changes
            </button>
          )}
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
  workspaceId,
  sessions,
}: {
  name?: string;
  prompt: string;
  workspaceId: string;
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
    workspaceId,
    ...(name === undefined ? {} : { name }),
    prompt,
    sessions: planSessions,
  };
}

function removePendingPlanSession(plans: Record<string, SquadPlan>, sessionId: string): Record<string, SquadPlan> {
  const plan = Object.values(plans).find((candidate) => candidate.sessionIds.includes(sessionId));
  if (!plan) return plans;
  const sessionIds = plan.sessionIds.filter((id) => id !== sessionId);
  return sessionIds.length === 0
    ? omitWorkspaceRecord(plans, plan.workspaceId)
    : { ...plans, [plan.workspaceId]: { ...plan, sessionIds } };
}

function toSquadPlan({
  omittedSessionIds = [],
  plan,
}: {
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
    workspaceId: plan.workspaceId,
  };
}

function replaceStagedSessionsFromPlan(
  sessions: SessionTile[],
  plan: AlfredStagedPlanSnapshot,
  defaultCwd: string,
): SessionTile[] {
  const replacements = hydrateStagedPlanSessions(plan, defaultCwd);
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
      label: `Project ${session.workspaceId}`,
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
    label: `Project ${index}`,
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
              status: sessionState(session).label,
              ...(session.cwd ? { cwd: session.cwd } : {}),
              ...(command ? { command } : {}),
            };
          }),
        }),
  };
}

/**
 * The one clock every surface reads a session's state from, so the rail, the deck, Details and Needs you
 * never disagree. It ticks every 5 s for ages and decaying busy states, and at the moment an approval
 * stops being masked by recent output.
 */
function useSessionClock(sessions: SessionTile[]): number {
  const [now, setNow] = useState(() => Date.now());
  const revealAt = nextApprovalRevealAt(sessions, now);
  useEffect(() => {
    const nextAt = Math.min(now + 5_000, revealAt ?? Infinity);
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextAt - Date.now()));
    return () => clearTimeout(timer);
  }, [now, revealAt]);
  return now;
}

function workspaceDetail(workspace: Workspace): string {
  const location = workspace.rootPath ? shortenPath(workspace.rootPath) : "local desk";
  return workspace.gitBranch ? `${location} on ${workspace.gitBranch}` : location;
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
      // The main process sends these again only when they change, so a list read before the last change keeps them.
      ...(liveSession.agentSignal === undefined && session.agentSignal !== undefined ? { agentSignal: session.agentSignal } : {}),
      ...(liveSession.shellBusy === undefined && session.shellBusy !== undefined ? { shellBusy: session.shellBusy } : {}),
      ...(session.promptSubmitted ? { promptSubmitted: true } : {}),
      ...(mergedInitialBuffer === undefined ? {} : { initialBuffer: mergedInitialBuffer }),
      ...(mergedActivityEvents === undefined ? {} : { activityEvents: mergedActivityEvents }),
      ...(mergedLastActivityAt === undefined ? {} : { lastActivityAt: mergedLastActivityAt }),
      ...(mergedLastOutputAt === undefined ? {} : { lastOutputAt: mergedLastOutputAt }),
    };
  });
  const additions = liveSessions.filter((session) => !existingIds.has(session.id));

  return [...merged, ...additions];
}
