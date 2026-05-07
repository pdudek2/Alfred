import { Plus, X } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDesktopAlfredApi, getDesktopTerminalApi } from "./desktop-api";
import { ComposerBar } from "./composer";
import { StagedTilePreview } from "./staged-tile";
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
  rejectAllStaged,
  rejectStaged,
  type SessionTile,
} from "./session-state";
import type { AlfredRuntimeStatus, AlfredStagedPlanSnapshot, AlfredStagedSession } from "../shared/alfred-ipc";
import type { TerminalCreateRequest, TerminalCreateResult, TerminalSessionId } from "../shared/terminal-ipc";
import "@xterm/xterm/css/xterm.css";

type Workspace = {
  id: string;
  label: string;
  shortLabel: string;
};

const DEFAULT_WORKSPACE_ID = "A";
const DEFAULT_WORKSPACE: Workspace = { id: DEFAULT_WORKSPACE_ID, label: "Alfred", shortLabel: "A" };
const DEFAULT_WORKSPACES: Workspace[] = [DEFAULT_WORKSPACE];

export function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(DEFAULT_WORKSPACES);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(DEFAULT_WORKSPACE_ID);
  const [terminalSessions, setTerminalSessions] = useState<SessionTile[]>([]);
  const [alfredStatus, setAlfredStatus] = useState<AlfredStatus>(idle());
  const [pendingPlan, setPendingPlan] = useState<SquadPlan | null>(null);
  const [composerValue, setComposerValue] = useState<string>("");
  const [armedUnsafeSessionIds, setArmedUnsafeSessionIds] = useState<Set<string>>(() => new Set());
  const [runtimeStatus, setRuntimeStatus] = useState<AlfredRuntimeStatus | null>(null);
  const closingSessionIdsRef = useRef<Set<string>>(new Set());
  const shortcutModifier = navigator.platform.includes("Mac") ? "Cmd" : "Ctrl";
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? DEFAULT_WORKSPACE;
  const activeSessions = terminalSessions.filter((session) => session.workspaceId === activeWorkspace.id);
  const activePendingPlan = pendingPlan?.workspaceId === activeWorkspace.id ? pendingPlan : null;
  const stagedCount = activeSessions.filter((s) => s.stage === "staged").length;
  const globalStagedCount = terminalSessions.filter((s) => s.stage === "staged").length;
  const unsafeStagedCount = activeSessions.filter((s) => s.stage === "staged" && s.safetyNote).length;
  const liveAlfredCount = activeSessions.filter((s) => s.stage === "live" && s.source === "alfred").length;
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

  const refreshLiveSessions = useCallback(async () => {
    const terminalApi = getDesktopTerminalApi();
    if (!terminalApi) return;

    const terminalResult = await terminalApi.list();
    const liveSessions = hydrateLiveTerminalSessions(terminalResult.sessions);
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
        closingSessionIdsRef.current.delete(sessionId);
      }
      return closeSession(sessions, sessionId);
    });
  }, []);

  const handleRuntimeSessionReady = useCallback((tileId: string, runtime: TerminalCreateResult) => {
    const terminalApi = getDesktopTerminalApi();
    const alfredApi = getDesktopAlfredApi();

    if (closingSessionIdsRef.current.has(tileId)) {
      terminalApi?.kill({ id: runtime.id });
      closingSessionIdsRef.current.delete(tileId);
      return;
    }

    setTerminalSessions((sessions) => attachRuntimeSession(sessions, tileId, runtime.id));
    if (runtime.source === "alfred") {
      void alfredApi?.resolveStagedPlan({ sessionIds: [tileId] });
    }
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
    setPendingPlan((plan) => {
      if (!plan) return plan;
      const remaining = plan.sessionIds.filter((id) => id !== tileId);
      return remaining.length === 0 ? null : { ...plan, sessionIds: remaining };
    });
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
    setPendingPlan((plan) => {
      if (!plan) return plan;
      const unsafeIds = terminalSessions
        .filter((session) => session.workspaceId === activeWorkspace.id && session.stage === "staged" && session.safetyNote && plan.sessionIds.includes(session.id))
        .map((session) => session.id);
      return unsafeIds.length === 0 ? null : { ...plan, sessionIds: unsafeIds };
    });
  }, [activeWorkspace.id, terminalSessions]);

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
    let cancelled = false;

    if (!terminalApi) {
      setTerminalSessions(createInitialSessions(""));
      return;
    }

    Promise.all([
      terminalApi.list(),
      alfredApi?.getStagedPlan().catch(() => ({ plan: null })) ?? Promise.resolve({ plan: null }),
      alfredApi?.getRuntimeStatus().catch(() => null) ?? Promise.resolve(null),
    ])
      .then(([terminalResult, stagedPlanResult, runtimeStatusResult]) => {
        if (cancelled) return;
        setRuntimeStatus(runtimeStatusResult);
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
            <div className="alfred-mark">{activeWorkspace.shortLabel}</div>
            <div>
              <strong>{activeWorkspace.label} workspace</strong>
              <span>{activeSessions.length} tile{activeSessions.length === 1 ? "" : "s"} · manual mode · local runtime</span>
            </div>
          </div>
          <div className="mission-actions" aria-label="terminal actions">
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

        <div className="workspace-layout">
          <WorkspaceRail
            activeWorkspaceId={activeWorkspace.id}
            sessions={terminalSessions}
            workspaces={workspaces}
            onAddWorkspace={handleAddWorkspace}
            onSelectWorkspace={handleSelectWorkspace}
          />
          <TerminalGrid
            armedUnsafeSessionIds={armedUnsafeSessionIds}
            sessions={activeSessions}
            shortcutModifier={shortcutModifier}
            onCloseSession={handleCloseSession}
            onRuntimeSessionReady={handleRuntimeSessionReady}
            onApproveTile={handleApproveTile}
            onRejectTile={handleRejectTile}
          />
          <AlfredDock
            status={alfredStatus}
            pendingPlan={activePendingPlan}
            stagedCount={stagedCount}
            unsafeStagedCount={unsafeStagedCount}
            liveAlfredCount={liveAlfredCount}
            onApproveAll={handleApproveAll}
            onRejectAll={handleRejectAll}
            onDismissError={handleDismissError}
          />
        </div>
        <ComposerBar
          blockedReason={composerBlockedReason}
          value={composerValue}
          thinking={isThinking(alfredStatus)}
          onChange={setComposerValue}
          onSubmit={handleSubmitPrompt}
        />
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

function WorkspaceRail({
  activeWorkspaceId,
  sessions,
  workspaces,
  onAddWorkspace,
  onSelectWorkspace,
}: {
  activeWorkspaceId: string;
  sessions: SessionTile[];
  workspaces: Workspace[];
  onAddWorkspace: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
}) {
  const countsByWorkspace = new Map<string, { live: number; staged: number }>();
  for (const session of sessions) {
    const counts = countsByWorkspace.get(session.workspaceId) ?? { live: 0, staged: 0 };
    if (session.stage === "staged") counts.staged += 1;
    else counts.live += 1;
    countsByWorkspace.set(session.workspaceId, counts);
  }

  return (
    <nav className="workspace-rail" aria-label="workspaces" role="tablist">
      {workspaces.map((workspace) => {
        const active = workspace.id === activeWorkspaceId;
        const counts = countsByWorkspace.get(workspace.id) ?? { live: 0, staged: 0 };
        return (
          <button
            className={`workspace-button ${active ? "active" : ""}`}
            type="button"
            aria-label={`${workspace.label} workspace, ${counts.live} live, ${counts.staged} staged`}
            aria-selected={active}
            key={workspace.id}
            onClick={() => onSelectWorkspace(workspace.id)}
            role="tab"
            title={`${workspace.label}: ${counts.live} live, ${counts.staged} staged`}
          >
            <span>{workspace.shortLabel}</span>
            {(counts.live > 0 || counts.staged > 0) && (
              <small aria-hidden="true">{counts.staged > 0 ? counts.staged : counts.live}</small>
            )}
          </button>
        );
      })}
      <div className="workspace-spacer" />
      <button className="workspace-button add-workspace" type="button" aria-label="Add workspace" onClick={onAddWorkspace}>
        +
      </button>
    </nav>
  );
}

function AlfredDock({
  status,
  pendingPlan,
  stagedCount,
  unsafeStagedCount,
  liveAlfredCount,
  onApproveAll,
  onRejectAll,
  onDismissError,
}: {
  status: AlfredStatus;
  pendingPlan: SquadPlan | null;
  stagedCount: number;
  unsafeStagedCount: number;
  liveAlfredCount: number;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onDismissError: () => void;
}) {
  const safeStagedCount = Math.max(0, stagedCount - unsafeStagedCount);

  return (
    <aside className="alfred-dock" aria-label="Alfred status">
      <div className="alfred-dock-header">
        <div className="alfred-dock-mark">A</div>
        <div>
          <strong>Alfred</strong>
          <span>{status.kind === "thinking" ? "thinking" : status.kind === "error" ? "error" : "quiet"}</span>
        </div>
      </div>

      {status.kind === "error" ? (
        <div className="alfred-dock-error" role="alert">
          <div>{status.error.message}</div>
          <button type="button" className="dismiss" onClick={onDismissError} aria-label="Dismiss error">
            Dismiss
          </button>
        </div>
      ) : pendingPlan ? (
        <div className="alfred-dock-plan">
          <div className="plan-name">{pendingPlan.name ?? "Squad"}</div>
          <div className="plan-counts">
            {stagedCount} staged · {liveAlfredCount} live
          </div>
          {unsafeStagedCount > 0 && (
            <div className="plan-safety-note" role="note">
              {unsafeStagedCount} flagged item{unsafeStagedCount === 1 ? "" : "s"} need manual approval.
            </div>
          )}
          <div className="plan-actions">
            <button
              type="button"
              className="approve-all"
              onClick={onApproveAll}
              disabled={safeStagedCount === 0}
            >
              {unsafeStagedCount > 0 ? "Approve Safe" : "Approve All"}
            </button>
            <button type="button" onClick={onRejectAll}>
              Reject All
            </button>
          </div>
          <p className="plan-prompt">"{truncate(pendingPlan.prompt, 140)}"</p>
        </div>
      ) : (
        <p>Manual work stays in front. Alfred will surface only when you ask for a launch plan.</p>
      )}

      <div className="alfred-dock-footer">
        <span>{status.kind}</span>
        <span>local</span>
      </div>
    </aside>
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function TerminalGrid({
  armedUnsafeSessionIds,
  sessions,
  shortcutModifier,
  onCloseSession,
  onRuntimeSessionReady,
  onApproveTile,
  onRejectTile,
}: {
  armedUnsafeSessionIds: Set<string>;
  sessions: SessionTile[];
  shortcutModifier: string;
  onCloseSession: (sessionId: string) => void;
  onRuntimeSessionReady: (tileId: string, runtime: TerminalCreateResult) => void;
  onApproveTile: (tileId: string) => void;
  onRejectTile: (tileId: string) => void;
}) {
  return (
    <section className="terminal-stage" aria-label="terminals">
      <header className="terminal-stage-header">
        <div>
          <strong>Terminals</strong>
          <span>{sessions.length} tile{sessions.length === 1 ? "" : "s"} ({sessions.filter(s => s.stage === "staged").length} staged)</span>
        </div>
        <kbd>{shortcutModifier} T</kbd>
      </header>
      <div className="terminal-grid">
        {sessions.map((session) =>
          session.stage === "live" ? (
            <ManualTerminalTile
              cwd={session.cwd}
              key={session.id}
              sessionKey={session.id}
              runtimeId={session.runtimeId}
              workspaceId={session.workspaceId}
              title={session.title}
              source={session.source}
              agentKind={session.agentKind}
              command={session.command}
              args={session.args}
              initialBuffer={session.initialBuffer}
              onClose={() => onCloseSession(session.id)}
              onRuntimeSessionReady={onRuntimeSessionReady}
            />
          ) : (
            <StagedTilePreview
              armed={armedUnsafeSessionIds.has(session.id)}
              key={session.id}
              tile={session}
              onApprove={onApproveTile}
              onReject={onRejectTile}
            />
          ),
        )}
      </div>
    </section>
  );
}

function ManualTerminalTile({
  cwd,
  agentKind,
  initialBuffer,
  onClose,
  onRuntimeSessionReady,
  runtimeId,
  sessionKey,
  source,
  workspaceId,
  title,
  command,
  args,
}: {
  cwd: string;
  agentKind?: SessionTile["agentKind"];
  initialBuffer?: string | undefined;
  onClose: () => void;
  onRuntimeSessionReady: (tileId: string, runtime: TerminalCreateResult) => void;
  runtimeId?: TerminalSessionId | undefined;
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
  const [status, setStatus] = useState<"connecting" | "ready" | "browser" | "exited" | "error">("connecting");
  const [resolvedCwd, setResolvedCwd] = useState<string>(cwd);

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

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.25,
      theme: {
        background: "#040505",
        foreground: "#d7cebb",
        cursor: "#f5f0e4",
        black: "#050607",
        blue: "#56c8d5",
        brightBlack: "#696357",
        brightBlue: "#9be7ef",
        brightCyan: "#a8edf3",
        brightGreen: "#baf0c6",
        brightMagenta: "#d4c5ff",
        brightRed: "#ffaaa0",
        brightWhite: "#fff8e9",
        brightYellow: "#f5d67f",
        cyan: "#56c8d5",
        green: "#78d991",
        magenta: "#b7a1ff",
        red: "#ef8173",
        white: "#f5f0e4",
        yellow: "#d9ae46",
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

    if (!terminalApi) {
      setStatus("browser");
      terminal.writeln("Manual terminal requires the Electron desktop runtime.");
      terminal.writeln("Open it with: pnpm --filter @alfred/desktop dev:electron");
      return () => {
        terminal.dispose();
      };
    }

    const removeDataListener = terminalApi.onData((event) => {
      if (event.id === sessionIdRef.current) {
        terminal.write(event.data);
      }
    });
    const removeExitListener = terminalApi.onExit((event) => {
      if (event.id === sessionIdRef.current) {
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
  }, [cwd, sessionKey, title, source, workspaceId, agentKind, command, args, initialBuffer, onRuntimeSessionReady]);

  return (
    <article className={`terminal-tile manual real-terminal ${status}`} aria-label={title}>
      <header className="tile-header">
        <div className="tile-title">
          <span className="tool-dot" />
          <div>
            <b>{title}</b>
            <small>{resolvedCwd ? shortenPath(resolvedCwd) : "runtime cwd"}</small>
          </div>
        </div>
        <div className="tile-actions">
          <span className="tile-status">{statusLabel(status)}</span>
          <button type="button" aria-label={`Close ${title}`} onClick={onClose} title="Close terminal">
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="xterm-host" ref={containerRef} />
    </article>
  );
}

function statusLabel(status: "connecting" | "ready" | "browser" | "exited" | "error"): string {
  switch (status) {
    case "browser":
      return "electron only";
    case "connecting":
      return "starting";
    case "error":
      return "error";
    case "exited":
      return "exited";
    case "ready":
      return "live";
  }
}

function shortenPath(value: string): string {
  const parts = value.split("/");

  if (parts.length <= 3) {
    return value;
  }

  return `…/${parts.slice(-2).join("/")}`;
}
