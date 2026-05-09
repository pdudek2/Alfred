import type { SessionTile } from "../session-state";
import { terminalSessionDisplayStatus, type SessionDisplayStatus } from "../session-status";

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
  const countsByWorkspace = new Map<string, WorkspaceRailCounts>();
  for (const session of sessions) {
    const counts = countsByWorkspace.get(session.workspaceId) ?? emptyCounts();
    counts.total += 1;
    counts[terminalSessionDisplayStatus(session).kind] += 1;
    countsByWorkspace.set(session.workspaceId, counts);
  }

  return (
    <nav className="workspace-rail" aria-label="workspaces" role="tablist">
      {workspaces.map((workspace) => {
        const active = workspace.id === activeWorkspaceId;
        const counts = countsByWorkspace.get(workspace.id) ?? emptyCounts();
        const summary = statusSummary(counts);
        const tone = railTone(counts);
        return (
          <button
            className={`workspace-button ${active ? "active" : ""} tone-${tone}`}
            type="button"
            aria-label={`${workspace.label} workspace, ${summary}`}
            aria-selected={active}
            key={workspace.id}
            onClick={() => onSelectWorkspace(workspace.id)}
            role="tab"
            title={`${workspace.label}${workspace.gitBranch ? ` · ${workspace.gitBranch}` : ""}: ${summary}`}
          >
            <span>{workspace.shortLabel}</span>
            {counts.total > 0 && <small aria-hidden="true">{priorityBadgeCount(counts)}</small>}
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

type CountableSessionStatus = SessionDisplayStatus["kind"];

type WorkspaceRailCounts = Record<CountableSessionStatus, number> & {
  total: number;
};

function emptyCounts(): WorkspaceRailCounts {
  return {
    active: 0,
    blocked: 0,
    done: 0,
    error: 0,
    idle: 0,
    restored: 0,
    runtime: 0,
    staged: 0,
    starting: 0,
    total: 0,
    waiting: 0,
  };
}

function statusSummary(counts: WorkspaceRailCounts): string {
  if (counts.total === 0) return "empty";

  return [
    countLabel(counts.error, "error"),
    countLabel(counts.waiting, "waiting"),
    countLabel(counts.blocked, "blocked"),
    countLabel(counts.active, "active"),
    countLabel(counts.starting, "starting"),
    countLabel(counts.staged, "staged"),
    countLabel(counts.idle, "idle"),
    countLabel(counts.done, "done"),
    countLabel(counts.restored, "restored"),
    countLabel(counts.runtime, "runtime"),
  ]
    .filter((item): item is string => item !== null)
    .join(", ");
}

function countLabel(count: number, label: string): string | null {
  if (count === 0) return null;
  return `${count} ${label}`;
}

function railTone(counts: WorkspaceRailCounts): string {
  if (counts.error > 0) return "error";
  if (counts.waiting > 0 || counts.blocked > 0) return "waiting";
  if (counts.active > 0 || counts.starting > 0) return "active";
  if (counts.staged > 0) return "staged";
  if (counts.total > 0) return "quiet";
  return "empty";
}

function priorityBadgeCount(counts: WorkspaceRailCounts): number {
  return counts.error || counts.waiting || counts.blocked || counts.active || counts.starting || counts.staged || counts.total;
}
