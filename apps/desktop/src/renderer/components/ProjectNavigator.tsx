import { Folder, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import type { WorkspaceMissionBrief, WorkspaceRootStatus } from "../../shared/workspace-ipc";
import { isFreeChatSession, isNavigableLiveSession } from "../session-scope";
import type { SessionTile } from "../session-state";
import { terminalSessionDisplayStatus } from "../session-status";
import { AlfredSignalGlyph } from "./AlfredSignalGlyph";
import { sessionTileKind } from "../tile-kind";
import { TileKindIcon } from "../tile-kind-icon";

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
  onFocusSessionInWorkspace: (workspaceId: string, sessionId: string) => void;
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
  onFocusSessionInWorkspace,
  onSelectWorkspace,
  onToggleCollapsed,
}: ProjectNavigatorProps) {
  const [showAllProjects, setShowAllProjects] = useState(
    () => workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId) >= 5,
  );
  const projectRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const activeProjectIndex = workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId);
  const visibleProjects = showAllProjects ? workspaces : workspaces.slice(0, 5);
  const hiddenProjects = showAllProjects ? [] : workspaces.slice(5);
  const activeSessions = sessions.filter((session) => isActiveNavigatorSession(session, activeWorkspaceId));
  const freeChats = sessions.filter(
    (session) => session.workspaceId !== activeWorkspaceId && isFreeChatSession(session),
  );
  const hiddenAttentionCount = hiddenProjects.reduce(
    (count, workspace) => count + (attentionCountsByWorkspace.get(workspace.id) ?? 0),
    0,
  );

  useEffect(() => {
    if (workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId) >= 5) {
      setShowAllProjects(true);
    }
  }, [activeWorkspaceId, workspaces]);

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
        <div className="project-list" role="list" aria-label="Workspaces">
          {visibleProjects.map((workspace, visibleIndex) => {
            const active = workspace.id === activeWorkspaceId;
            const stableIndex = workspaces.findIndex((candidate) => candidate.id === workspace.id);
            const attentionCount = attentionCountsByWorkspace.get(workspace.id) ?? 0;
            const hasAttention = attentionCount > 0;
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
                  {active && <div className="project-workspace-actions">{workspaceActions}</div>}
                </div>

                {active && activeSessions.length > 0 && (
                  <div
                    className="project-session-list"
                    role="group"
                    aria-label={`${workspace.label} sessions`}
                  >
                    {activeSessions.map((session) => (
                      <NavigatorSessionButton
                        active={session.id === activeSessionId}
                        key={session.id}
                        session={session}
                        onClick={() => onFocusSessionInWorkspace(workspace.id, session.id)}
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
                  onClick={() => onFocusSessionInWorkspace(session.workspaceId, session.id)}
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
