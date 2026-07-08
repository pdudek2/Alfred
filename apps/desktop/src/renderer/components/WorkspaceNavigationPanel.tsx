import { Search } from "lucide-react";
import type { SessionTile } from "../session-state";
import { terminalSessionDisplayStatus } from "../session-status";
import { sessionTileKind, tileKindMeta } from "../tile-kind";
import { WorkspaceRail, type WorkspaceRailWorkspace } from "./WorkspaceRail";
import { inboxNavigationSummary } from "./workspace-navigation-copy";

type WorkspaceNavigationPanelProps = {
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

export function WorkspaceNavigationPanel({
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
}: WorkspaceNavigationPanelProps) {
  const freeChats = sessions
    .filter((session) => session.workspaceId !== activeWorkspaceId && session.cwd.includes("/Documents/Codex/"))
    .slice(0, 3);

  return (
    <aside className="workspace-navigation-panel" data-testid="workspace-navigation-panel" aria-label="Runs and workspaces">
      <header className="workspace-nav-head">
        <span className="workspace-nav-avatar">{activeWorkspace.shortLabel}</span>
        <div>
          <strong>{activeWorkspace.label}</strong>
          <span>
            {activeSessions.length} terminals · {activeWorkspace.gitBranch ?? "local"} ·{" "}
            {activeWorkspace.rootPath ? activeWorkspace.rootPath.replace(/^.*\/Desktop\//, "~/Desktop/") : "scratch desk"}
          </span>
        </div>
      </header>
      <label className="workspace-nav-search">
        <Search size={14} />
        <input aria-label="Search sessions, chats, files" placeholder="Search sessions, chats, files" />
      </label>
      <div className="workspace-nav-scroll">
        <section className="workspace-nav-section">
          <header>
            <span>Active terminals</span>
            <strong>{activeSessions.length}</strong>
          </header>
          <div className="workspace-nav-list">
            {activeSessions.length === 0 ? (
              <p className="workspace-nav-empty">No active terminals in this workspace.</p>
            ) : (
              activeSessions.slice(0, 5).map((session) => {
                const status = terminalSessionDisplayStatus(session);
                const kindMeta = tileKindMeta(sessionTileKind(session));
                return (
                  <button key={session.id} type="button" className="workspace-nav-row" onClick={() => onFocusSession(session.id)}>
                    <span className={`workspace-nav-mark ${kindMeta.className}`}>{kindMeta.shortLabel}</span>
                    <span>
                      <strong>{session.title}</strong>
                      <small>{status.label} · {session.cwd.replace(/^.*\/Desktop\//, "~/Desktop/")}</small>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>
        <section className="workspace-nav-section">
          <header>
            <span>Inbox</span>
            <strong>{inboxCount}</strong>
          </header>
          <div className="workspace-nav-list">
            <button type="button" className="workspace-nav-row" onClick={onOpenInbox}>
              <span className="workspace-nav-mark alert">!</span>
              <span>
                <strong>Needs review</strong>
                <small>{inboxNavigationSummary(inboxCount)}</small>
              </span>
            </button>
          </div>
        </section>
        <section className="workspace-nav-section">
          <header>
            <span>Free chats</span>
            <strong>{freeChats.length}</strong>
          </header>
          <div className="workspace-nav-list">
            {freeChats.length === 0 ? (
              <p className="workspace-nav-empty">No scratch chats yet.</p>
            ) : (
              freeChats.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="workspace-nav-row"
                  onClick={() => onFocusSessionInWorkspace(session.workspaceId, session.id)}
                >
                  <span className="workspace-nav-mark">FC</span>
                  <span>
                    <strong>{session.title}</strong>
                    <small>{session.cwd.replace(/^.*\/Documents\/Codex\//, "~/Documents/Codex/")}</small>
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
        <section className="workspace-nav-section workspace-nav-workspaces">
          <header>
            <span>Workspaces</span>
            <strong>{workspaces.length}</strong>
          </header>
          <WorkspaceRail
            activeWorkspaceId={activeWorkspaceId}
            embedded
            sessions={sessions}
            workspaces={workspaces}
            onAddWorkspace={onAddWorkspace}
            onSelectWorkspace={onSelectWorkspace}
          />
        </section>
      </div>
    </aside>
  );
}
