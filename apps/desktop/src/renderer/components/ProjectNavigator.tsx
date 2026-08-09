import { Check, ChevronRight, CircleSlash, Folder, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import type { WorkspaceMissionBrief, WorkspaceRootStatus } from "../../shared/workspace-ipc";
import { isFreeChatSession, isNavigableLiveSession } from "../session-scope";
import type { SessionTile } from "../session-state";
import { terminalSessionDisplayStatus } from "../session-status";
import { sessionAgeLabel } from "../session-time";
import { AlfredSignalGlyph } from "./AlfredSignalGlyph";
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
  collapsed: boolean;
  sessions: SessionTile[];
  workspaces: ProjectNavigatorWorkspace[];
  workspaceActions: ReactNode;
  onAddWorkspace: () => void;
  onSelectSessionInWorkspace: (workspaceId: string, sessionId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onToggleCollapsed: () => void;
};

export function ProjectNavigator({
  activeSessionId,
  activeWorkspaceId,
  attentionCountsByWorkspace,
  collapsed,
  sessions,
  workspaces,
  workspaceActions,
  onAddWorkspace,
  onSelectSessionInWorkspace,
  onSelectWorkspace,
  onToggleCollapsed,
}: ProjectNavigatorProps) {
  const [showAllProjects, setShowAllProjects] = useState(
    () => workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId) >= 5,
  );
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(
    () => new Set([activeWorkspaceId]),
  );
  const projectRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const activeProjectIndex = workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId);
  const visibleProjects = showAllProjects ? workspaces : workspaces.slice(0, 5);
  const hiddenProjects = showAllProjects ? [] : workspaces.slice(5);
  const freeChats = sessions.filter(
    (session) => session.workspaceId !== activeWorkspaceId && isFreeChatSession(session),
  );
  const recentResults = recentAgentResults(workspaces, sessions);
  const hiddenAttentionCount = hiddenProjects.reduce(
    (count, workspace) => count + (attentionCountsByWorkspace.get(workspace.id) ?? 0),
    0,
  );

  useEffect(() => {
    if (workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId) >= 5) {
      setShowAllProjects(true);
    }
  }, [activeWorkspaceId, workspaces]);

  useLayoutEffect(() => {
    setExpandedWorkspaceIds((current) => {
      if (current.has(activeWorkspaceId)) return current;
      return new Set([...current, activeWorkspaceId]);
    });
  }, [activeWorkspaceId]);

  return (
    <aside
      className={`project-navigator${collapsed ? " is-collapsed" : ""}`}
      data-testid="project-navigator"
      aria-label="Projects and Free Chats"
      role="navigation"
    >
      <header className="project-navigator-header">
        <strong>Projects</strong>
        <button
          type="button"
          className="project-navigator-collapse"
          aria-label={collapsed ? "Expand project navigator" : "Collapse project navigator"}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" size={16} /> : <PanelLeftClose aria-hidden="true" size={16} />}
        </button>
      </header>

      <div className="project-navigator-scroll">
        {!collapsed && recentResults.length > 0 && (
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
                  <span className="project-recent-status" aria-hidden="true">
                    {result.status === "done" ? <Check size={11} /> : <CircleSlash size={11} />}
                  </span>
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

        {!collapsed && recentResults.length > 0 && (
          <div className="project-section-heading">Projects</div>
        )}

        <div className="project-list" role="list" aria-label="Workspaces">
          {visibleProjects.map((workspace, visibleIndex) => {
            const active = workspace.id === activeWorkspaceId;
            const stableIndex = workspaces.findIndex((candidate) => candidate.id === workspace.id);
            const attentionCount = attentionCountsByWorkspace.get(workspace.id) ?? 0;
            const hasAttention = attentionCount > 0;
            const workspaceSessions = sessions.filter((session) => isActiveNavigatorSession(session, workspace.id));
            const sessionsExpanded = expandedWorkspaceIds.has(workspace.id);
            const sessionGroupId = `project-${workspace.id}-sessions`;
            return (
              <section
                className={`project-item${active ? " is-active" : ""}`}
                key={workspace.id}
                role="listitem"
              >
                <div className="project-row">
                  <button
                    type="button"
                    className="project-row-button"
                    aria-current={active ? "location" : undefined}
                    aria-label={`${workspace.label} workspace${
                      hasAttention
                        ? `, ${attentionCount} decision${attentionCount === 1 ? " needs" : "s need"} review`
                        : ""
                    }`}
                    data-attention={hasAttention ? "true" : undefined}
                    data-label={workspace.label}
                    data-project-destination={workspace.id}
                    onClick={() => onSelectWorkspace(workspace.id)}
                    onKeyDown={(event) =>
                      handleProjectKeyDown(event, visibleProjects, visibleIndex, onSelectWorkspace, projectRefs)
                    }
                    ref={(element) => {
                      projectRefs.current[workspace.id] = element;
                    }}
                    title={workspace.label}
                  >
                    <Folder className="project-folder-icon" aria-hidden="true" size={15} />
                    <span className="project-row-label">{workspace.label}</span>
                    {stableIndex >= 0 && stableIndex < 5 && <kbd aria-hidden="true">⌘{stableIndex + 1}</kbd>}
                    {hasAttention && (
                      <span
                        className="project-attention-signal"
                        aria-label={`${attentionCount} decision${attentionCount === 1 ? " needs" : "s need"} review`}
                      >
                        <AlfredSignalGlyph />
                        {attentionCount > 1 && <span className="project-attention-count">{attentionCount}</span>}
                      </span>
                    )}
                  </button>
                  {workspaceSessions.length > 0 && (
                    <button
                      type="button"
                      className="project-session-disclosure"
                      aria-controls={sessionGroupId}
                      aria-expanded={sessionsExpanded}
                      aria-label={`${sessionsExpanded ? "Collapse" : "Expand"} ${workspace.label} sessions`}
                      onClick={() => setExpandedWorkspaceIds((current) => {
                        const next = new Set(current);
                        if (next.has(workspace.id)) next.delete(workspace.id);
                        else next.add(workspace.id);
                        return next;
                      })}
                    >
                      <ChevronRight aria-hidden="true" size={13} />
                    </button>
                  )}
                  {active && <div className="project-workspace-actions">{workspaceActions}</div>}
                </div>

                {sessionsExpanded && workspaceSessions.length > 0 && (
                  <div
                    id={sessionGroupId}
                    className="project-session-list"
                    role="group"
                    aria-label={`${workspace.label} sessions`}
                  >
                    {workspaceSessions.map((session) => (
                      <NavigatorSessionButton
                        active={session.id === activeSessionId}
                        key={session.id}
                        session={session}
                        onClick={() => onSelectSessionInWorkspace(workspace.id, session.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {hiddenProjects.length > 0 && (
          <button
            type="button"
            className="project-overflow-button"
            aria-label={`Show ${hiddenProjects.length} more projects${hiddenAttentionCount > 0 ? ", hidden project needs review" : ""}`}
            data-attention={hiddenAttentionCount > 0 ? "true" : undefined}
            onClick={() => setShowAllProjects(true)}
          >
            <span>Show {hiddenProjects.length} more</span>
            {hiddenAttentionCount > 0 && (
              <span className="project-attention-signal" aria-label="Hidden project needs review">
                <AlfredSignalGlyph />
                {hiddenAttentionCount > 1 && (
                  <span className="project-attention-count">{hiddenAttentionCount}</span>
                )}
              </span>
            )}
          </button>
        )}

        {showAllProjects && workspaces.length > 5 && (
          <button
            type="button"
            className="project-overflow-button"
            aria-label="Show fewer projects"
            disabled={activeProjectIndex >= 5}
            title={activeProjectIndex >= 5 ? "The active project must remain visible" : undefined}
            onClick={() => setShowAllProjects(false)}
          >
            <span>Show fewer projects</span>
          </button>
        )}

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

      <footer className="project-navigator-footer">
        <button type="button" aria-label="Add workspace" onClick={onAddWorkspace}>
          <Plus aria-hidden="true" size={15} />
          <span>Add project</span>
        </button>
      </footer>
    </aside>
  );
}

type RecentAgentResult = {
  session: SessionTile;
  workspaceLabel: string;
  agentLabel: "Claude" | "Codex";
  status: "done" | "error";
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
    const status = terminalSessionDisplayStatus(session).kind;
    if (!agentLabel || (status !== "done" && status !== "error")) return [];

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
  const status = terminalSessionDisplayStatus(session);
  const kind = sessionTileKind(session);
  return (
    <button
      type="button"
      className={`project-session${active ? " is-active" : ""}`}
      aria-current={active ? "page" : undefined}
      aria-label={session.title}
      data-label={session.title}
      data-session-id={session.id}
      onClick={onClick}
      title={`${session.title} · ${status.label}`}
    >
      <span className={`project-session-kind kind-${kind}`} aria-hidden="true">
        <TileKindIcon kind={kind} size={14} />
      </span>
      <span className="project-session-title">{session.title}</span>
    </button>
  );
}

function isActiveNavigatorSession(session: SessionTile, workspaceId: string): boolean {
  return session.workspaceId === workspaceId
    && isNavigableLiveSession(session);
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
