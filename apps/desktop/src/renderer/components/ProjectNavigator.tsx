import { MessageSquare, Plus } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import type { WorkspaceMissionBrief, WorkspaceRootStatus } from "../../shared/workspace-ipc";
import { isFreeChatScope, isFreeChatSession, isNavigableLiveSession } from "../session-scope";
import type { SessionTile } from "../session-state";
import { isRestartable, SESSION_STATE_LABELS, sessionState } from "../session-status";
import { sessionAgeLabel } from "../session-time";
import { SessionStatusGlyph } from "./SessionStatusGlyph";
import { useStackClock } from "./SessionStack";
import { sessionTileKind } from "../tile-kind";
import { TileKindIcon } from "../tile-kind-icon";

const RECENT_RESULT_LIMIT = 2;

export type ProjectNavigatorWorkspace = {
  id: string;
  label: string;
  shortLabel: string;
  rootPath?: string;
  rootStatus?: WorkspaceRootStatus;
  gitBranch?: string;
  missionBrief?: WorkspaceMissionBrief;
};

export type ProjectNavigatorProps = {
  activeSessionId: string | null;
  activeWorkspaceId: string;
  attentionCountsByWorkspace: ReadonlyMap<string, number>;
  sessions: SessionTile[];
  workspaces: ProjectNavigatorWorkspace[];
  workspaceActions: ReactNode;
  onAddWorkspace: () => void;
  onSelectSessionInWorkspace: (workspaceId: string, sessionId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
};

export type ProjectRailState = "needs-you" | "your-turn" | "working" | "running";

// The head of SESSION_STATE_PRIORITY: only these put a glyph on a project row.
const RAIL_STATES: readonly ProjectRailState[] = ["needs-you", "your-turn", "working", "running"];

export function projectRailState(
  sessions: readonly SessionTile[],
  workspaceId: string,
  needsYouCount: number,
  now: number,
): ProjectRailState | null {
  if (needsYouCount > 0) return "needs-you";
  let best: number = RAIL_STATES.length;
  for (const session of sessions) {
    if (!isProjectLiveSession(session, workspaceId)) continue;
    const rank = RAIL_STATES.indexOf(sessionState(session, "ready", now).kind as ProjectRailState);
    if (rank >= 0 && rank < best) best = rank;
  }
  return RAIL_STATES[best] ?? null;
}

function highestRailState(states: readonly (ProjectRailState | null)[]): ProjectRailState | null {
  return RAIL_STATES.find((state) => states.includes(state)) ?? null;
}

// Rootless workspaces group under Sandboxes only beside real projects; alone they stay a flat list,
// which also keeps the pre-load default workspace from flashing into the group.
function railGroups<T extends ProjectNavigatorWorkspace>(workspaces: readonly T[]): { projects: T[]; sandboxes: T[] } {
  const grouped = workspaces.some((workspace) => workspace.rootPath);
  return {
    projects: grouped ? workspaces.filter((workspace) => workspace.rootPath) : [...workspaces],
    sandboxes: grouped ? workspaces.filter((workspace) => !workspace.rootPath) : [],
  };
}

/** The rail's top-to-bottom order, which ⌘1–⌘9 follow. */
export function railOrder<T extends ProjectNavigatorWorkspace>(workspaces: readonly T[]): T[] {
  const { projects, sandboxes } = railGroups(workspaces);
  return [...projects, ...sandboxes];
}

export function ProjectNavigator({
  activeSessionId,
  activeWorkspaceId,
  attentionCountsByWorkspace,
  sessions,
  workspaces,
  workspaceActions,
  onAddWorkspace,
  onSelectSessionInWorkspace,
  onSelectWorkspace,
}: ProjectNavigatorProps) {
  const { projects, sandboxes } = railGroups(workspaces);
  const activeIsSandbox = sandboxes.some((workspace) => workspace.id === activeWorkspaceId);
  const [sandboxesOpen, setSandboxesOpen] = useState(activeIsSandbox);
  const projectRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const now = useStackClock(sessions.length > 0);
  const freeChats = sessions.filter(
    (session) => session.workspaceId !== activeWorkspaceId && isFreeChatSession(session),
  );
  const recentResults = recentAgentResults(workspaces, sessions);
  const railStates = new Map(workspaces.map((workspace) => [
    workspace.id,
    projectRailState(sessions, workspace.id, attentionCountsByWorkspace.get(workspace.id) ?? 0, now),
  ]));
  const sandboxState = highestRailState(sandboxes.map((workspace) => railStates.get(workspace.id) ?? null));
  const visibleRows = sandboxesOpen ? [...projects, ...sandboxes] : projects;

  useLayoutEffect(() => {
    if (activeIsSandbox) setSandboxesOpen(true);
  }, [activeIsSandbox, activeWorkspaceId]);

  const renderRow = (workspace: ProjectNavigatorWorkspace) => {
    const active = workspace.id === activeWorkspaceId;
    const state = railStates.get(workspace.id) ?? null;
    const live = sessions.some((session) => isProjectLiveSession(session, workspace.id));
    const statusId = `project-${workspace.id}-status`;
    const rowIndex = visibleRows.indexOf(workspace);
    return (
      <section className="project-item" key={workspace.id} role="listitem">
        <div className={`project-row${active ? " is-active" : ""}`}>
          <button
            type="button"
            className={`project-row-button${live ? "" : " is-calm"}`}
            aria-current={active ? "location" : undefined}
            aria-describedby={state ? statusId : undefined}
            aria-label={`${workspace.label} project`}
            data-label={workspace.label}
            data-project-destination={workspace.id}
            onClick={() => onSelectWorkspace(workspace.id)}
            onKeyDown={(event) => handleProjectKeyDown(event, visibleRows, rowIndex, onSelectWorkspace, projectRefs)}
            ref={(element) => {
              projectRefs.current[workspace.id] = element;
            }}
            title={workspace.label}
          >
            <span className="project-row-monogram" aria-hidden="true">{workspace.shortLabel}</span>
            <span className="project-row-label">{workspace.label}</span>
            {state && <SessionStatusGlyph kind={state} label={SESSION_STATE_LABELS[state]} className="project-row-state" size={12} />}
            {state && <span className="visually-hidden" id={statusId}>{SESSION_STATE_LABELS[state]}</span>}
          </button>
          {active && <div className="project-workspace-actions">{workspaceActions}</div>}
        </div>
      </section>
    );
  };

  return (
    <aside
      className="project-navigator"
      data-testid="project-navigator"
      aria-label="Projects and Free Chats"
      role="navigation"
    >
      <header className="project-navigator-header">
        <strong>Projects</strong>
        <button type="button" className="project-navigator-add" aria-label="Add project" title="Add project" onClick={onAddWorkspace}>
          <Plus aria-hidden="true" size={15} />
        </button>
      </header>

      <div className="project-navigator-scroll">
        {recentResults.length > 0 && (
          <section className="project-recents" aria-label="Recent agent results">
            <header className="project-recents-header">
              <strong>Recent</strong>
              <span aria-label={`${recentResults.length} recent result${recentResults.length === 1 ? "" : "s"}`}>
                {recentResults.length}
              </span>
            </header>
            <div className="project-recent-list">
              {recentResults.map((result) => (
                <button
                  type="button"
                  className={`project-recent-result status-${result.status}`}
                  key={result.session.id}
                  aria-label={`Open ${result.status === "done" ? "finished" : "stopped"} ${result.session.title} in ${result.workspaceLabel}`}
                  onClick={() => onSelectSessionInWorkspace(result.session.workspaceId, result.session.id)}
                  title={`${result.session.title} · ${result.workspaceLabel} · ${result.status}`}
                >
                  <SessionStatusGlyph kind={result.status} label={result.status} className="project-recent-status" size={12} />
                  <span className="project-recent-copy">
                    <strong>{result.session.title}</strong>
                    <small>{result.workspaceLabel} · {result.agentLabel}</small>
                  </span>
                  {result.ageLabel && result.activityAt !== undefined && (
                    <time dateTime={new Date(result.activityAt).toISOString()}>{result.ageLabel}</time>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="project-list" role="list" aria-label="Projects">
          {projects.map(renderRow)}
          {sandboxes.length > 0 && (
            <section className="project-item project-sandboxes" role="listitem">
              <div className={`project-row${activeIsSandbox && !sandboxesOpen ? " is-active" : ""}`}>
                <button
                  type="button"
                  className="project-row-button project-sandbox-toggle"
                  aria-controls="project-sandbox-list"
                  aria-current={activeIsSandbox && !sandboxesOpen ? "location" : undefined}
                  aria-describedby={sandboxState ? "project-sandboxes-status" : undefined}
                  aria-expanded={sandboxesOpen}
                  aria-label={`Sandboxes, ${sandboxes.length} project${sandboxes.length === 1 ? "" : "s"}`}
                  data-label="Sandboxes"
                  onClick={() => setSandboxesOpen((open) => !open)}
                  title="Projects without a folder"
                >
                  <span className="project-row-label">Sandboxes</span>
                  <span className="project-sandbox-count" aria-hidden="true">{sandboxes.length}</span>
                  {sandboxState && <SessionStatusGlyph kind={sandboxState} label={SESSION_STATE_LABELS[sandboxState]} className="project-row-state" size={12} />}
                  {sandboxState && (
                    <span className="visually-hidden" id="project-sandboxes-status">{SESSION_STATE_LABELS[sandboxState]}</span>
                  )}
                </button>
              </div>
              {sandboxesOpen && (
                <div className="project-sandbox-list" id="project-sandbox-list" role="list" aria-label="Sandboxes">
                  {sandboxes.map(renderRow)}
                </div>
              )}
            </section>
          )}
        </div>

        {freeChats.length > 0 && (
          <section className="free-chat-section" role="group" aria-label="Free Chats">
            <header>
              <MessageSquare aria-hidden="true" size={13} />
              <strong>Free Chats</strong>
            </header>
            <div className="free-chat-list">
              {freeChats.map((session) => (
                <NavigatorSessionButton
                  active={session.id === activeSessionId}
                  key={session.id}
                  session={session}
                  onClick={() => onSelectSessionInWorkspace(session.workspaceId, session.id)}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}

type RecentAgentResult = {
  session: SessionTile;
  workspaceLabel: string;
  agentLabel: "Claude" | "Codex";
  status: "done" | "failed";
  activityAt?: number;
  ageLabel: string | null;
};

function recentAgentResults(
  workspaces: ProjectNavigatorWorkspace[],
  sessions: SessionTile[],
): RecentAgentResult[] {
  const workspaceLabels = new Map(workspaces.map((workspace) => [workspace.id, workspace.label]));

  return sessions.flatMap((session): RecentAgentResult[] => {
    const agentLabel = recentAgentLabel(session);
    const state = sessionState(session);
    if (!agentLabel || !isRestartable(state)) return [];
    const status = state.kind === "done" ? "done" : "failed";

    const activityAt = session.lastActivityAt ?? session.lastOutputAt ?? session.createdAt;
    return [{
      session,
      workspaceLabel: workspaceLabels.get(session.workspaceId) ?? session.workspaceId,
      agentLabel,
      status,
      ...(activityAt === undefined ? {} : { activityAt }),
      ageLabel: sessionAgeLabel(activityAt),
    }];
  }).sort((left, right) => (
    (right.activityAt ?? 0) - (left.activityAt ?? 0)
    || left.session.id.localeCompare(right.session.id)
  )).slice(0, RECENT_RESULT_LIMIT);
}

function recentAgentLabel(session: SessionTile): "Claude" | "Codex" | null {
  const kind = session.agentKind === "claude" || session.agentKind === "codex"
    ? session.agentKind
    : session.detectedAgentKind === "claude" || session.detectedAgentKind === "codex"
      ? session.detectedAgentKind
      : session.command === "claude" || session.command === "codex"
        ? session.command
        : null;
  if (!kind) return null;
  return kind === "claude" ? "Claude" : "Codex";
}

function NavigatorSessionButton({
  active,
  session,
  onClick,
}: {
  active: boolean;
  session: SessionTile;
  onClick: () => void;
}) {
  const status = sessionState(session);
  const kind = sessionTileKind(session);
  const statusId = useId();
  const agentLabel = recentAgentLabel(session) ?? "Terminal";
  return (
    <button
      type="button"
      className={`project-session${active ? " is-active" : ""}`}
      aria-current={active ? "page" : undefined}
      aria-describedby={statusId}
      aria-label={session.title}
      data-label={session.title}
      data-session-id={session.id}
      onClick={onClick}
      title={`${session.title} · ${status.label}`}
    >
      <span className={`project-session-kind kind-${kind}`} aria-hidden="true">
        <TileKindIcon kind={kind} size={14} />
      </span>
      <span className="project-session-copy">
        <span className="project-session-title">{session.title}</span>
        <small className="project-session-meta" id={statusId}>{agentLabel} · {status.label}</small>
      </span>
    </button>
  );
}

function isProjectLiveSession(session: SessionTile, workspaceId: string): boolean {
  return session.workspaceId === workspaceId
    && isNavigableLiveSession(session)
    && !isFreeChatScope(session);
}

function handleProjectKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  projects: ProjectNavigatorWorkspace[],
  currentIndex: number,
  onSelectWorkspace: (workspaceId: string) => void,
  refs: MutableRefObject<Record<string, HTMLButtonElement | null>>,
): void {
  let nextIndex: number | null = null;
  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
    nextIndex = (currentIndex + 1) % projects.length;
  } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
    nextIndex = (currentIndex - 1 + projects.length) % projects.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = projects.length - 1;
  }
  if (nextIndex === null) return;
  const nextProject = projects[nextIndex];
  if (!nextProject) return;
  event.preventDefault();
  onSelectWorkspace(nextProject.id);
  window.requestAnimationFrame(() => refs.current[nextProject.id]?.focus());
}
