import type { SessionTile } from "../session-state";

export type WorkspaceRailWorkspace = {
  id: string;
  label: string;
  shortLabel: string;
  rootPath?: string;
  gitBranch?: string;
};

type WorkspaceRailProps = {
  activeWorkspaceId: string;
  sessions: SessionTile[];
  workspaces: WorkspaceRailWorkspace[];
  onAddWorkspace: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
};

export function WorkspaceRail({
  activeWorkspaceId,
  sessions,
  workspaces,
  onAddWorkspace,
  onSelectWorkspace,
}: WorkspaceRailProps) {
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
            title={`${workspace.label}${workspace.gitBranch ? ` · ${workspace.gitBranch}` : ""}: ${counts.live} live, ${counts.staged} staged`}
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
