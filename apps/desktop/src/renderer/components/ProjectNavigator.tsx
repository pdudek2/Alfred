import { ChevronDown, ChevronRight, Folder, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import type { WorkspaceMissionBrief } from "../../shared/workspace-ipc";
import type { SessionTile } from "../session-state";
import { terminalSessionDisplayStatus } from "../session-status";
import { SessionStatusGlyph } from "./SessionStatusGlyph";

export type ProjectNavigatorWorkspace = {
  id: string;
  label: string;
  shortLabel: string;
  rootPath?: string;
  gitBranch?: string;
  missionBrief?: WorkspaceMissionBrief;
};

export type ProjectNavigatorProps = {
  activeSessionId: string | null;
  activeWorkspaceId: string;
  attentionWorkspaceIds: ReadonlySet<string>;
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
  attentionWorkspaceIds,
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
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const visibleProjects = showAllProjects ? workspaces : workspaces.slice(0, 5);
  const hiddenProjects = showAllProjects ? [] : workspaces.slice(5);
  const activeSessions = sessions.filter((session) => isActiveNavigatorSession(session, activeWorkspaceId));
  const freeChats = sessions.filter(
    (session) => session.workspaceId !== activeWorkspaceId && isFreeChatSession(session),
  );
  const hiddenAttention = hiddenProjects.some((workspace) => attentionWorkspaceIds.has(workspace.id));

  useEffect(() => {
    if (workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId) >= 5) {
      setShowAllProjects(true);
    }
  }, [activeWorkspaceId, workspaces]);

  return (
    <aside
      className={`project-navigator${collapsed ? " is-collapsed" : ""}`}
      data-testid="project-navigator"
      aria-label="Projects and sessions"
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
        <div className="project-list" role="tablist" aria-label="workspaces" aria-orientation="vertical">
          {visibleProjects.map((workspace, visibleIndex) => {
            const active = workspace.id === activeWorkspaceId;
            const stableIndex = workspaces.findIndex((candidate) => candidate.id === workspace.id);
            const hasAttention = attentionWorkspaceIds.has(workspace.id);
            return (
              <section className={`project-item${active ? " is-active" : ""}`} key={workspace.id}>
                <div className="project-row">
                  <button
                    type="button"
                    className="project-row-button"
                    aria-label={`${workspace.label} workspace`}
                    aria-selected={active}
                    data-attention={hasAttention ? "true" : undefined}
                    data-label={workspace.label}
                    onClick={() => onSelectWorkspace(workspace.id)}
                    onKeyDown={(event) =>
                      handleProjectKeyDown(event, visibleProjects, visibleIndex, onSelectWorkspace, tabRefs)
                    }
                    ref={(element) => {
                      tabRefs.current[workspace.id] = element;
                    }}
                    role="tab"
                    tabIndex={active ? 0 : -1}
                    title={workspace.label}
                  >
                    <Folder className="project-folder-icon" aria-hidden="true" size={15} />
                    <span className="project-row-label">{workspace.label}</span>
                    {stableIndex >= 0 && stableIndex < 5 && <kbd aria-hidden="true">⌘{stableIndex + 1}</kbd>}
                    {hasAttention && <span className="project-attention-dot" aria-label="Needs review" />}
                    {active ? <ChevronDown aria-hidden="true" size={13} /> : <ChevronRight aria-hidden="true" size={13} />}
                  </button>
                  {active && <div className="project-workspace-actions">{workspaceActions}</div>}
                </div>

                {active && activeSessions.length > 0 && (
                  <div className="project-session-list" role="group" aria-label={`${workspace.label} sessions`}>
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
            aria-label={`Show ${hiddenProjects.length} more projects`}
            data-attention={hiddenAttention ? "true" : undefined}
            onClick={() => setShowAllProjects(true)}
          >
            <span>Show {hiddenProjects.length} more</span>
            {hiddenAttention && <span className="project-attention-dot" aria-label="Hidden project needs review" />}
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
  return (
    <button
      type="button"
      className={`project-session${active ? " is-active" : ""}`}
      aria-current={active ? "true" : undefined}
      aria-label={`${session.title}, ${status.label}`}
      data-label={session.title}
      onClick={onClick}
      title={`${session.title} · ${status.label}`}
    >
      <SessionStatusGlyph kind={status.kind} label={status.label} />
      <span className="project-session-title">{session.title}</span>
    </button>
  );
}

function isActiveNavigatorSession(session: SessionTile, workspaceId: string): boolean {
  return session.workspaceId === workspaceId
    && session.stage === "live"
    && session.runtimeStatus !== "restored"
    && session.runtimeStatus !== "exited"
    && session.runtimeStatus !== "error";
}

function isFreeChatSession(session: SessionTile): boolean {
  return session.stage === "live" && session.cwd.includes("/Documents/Codex/");
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
