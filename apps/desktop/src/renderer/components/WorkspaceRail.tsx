import { useRef, type KeyboardEvent, type MutableRefObject } from "react";
import type { SessionTile } from "../session-state";
import { terminalSessionDisplayStatus, type SessionDisplayStatus } from "../session-status";
import type { WorkspaceMissionBrief } from "../../shared/workspace-ipc";
import { shortenPath } from "../path-display";

export type WorkspaceRailWorkspace = {
  id: string;
  label: string;
  shortLabel: string;
  rootPath?: string;
  gitBranch?: string;
  missionBrief?: WorkspaceMissionBrief;
};

type WorkspaceRailProps = {
  activeWorkspaceId: string;
  embedded?: boolean;
  sessions: SessionTile[];
  workspaces: WorkspaceRailWorkspace[];
  onAddWorkspace: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
};

export function WorkspaceRail({
  activeWorkspaceId,
  embedded = false,
  sessions,
  workspaces,
  onAddWorkspace,
  onSelectWorkspace,
}: WorkspaceRailProps) {
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const countsByWorkspace = new Map<string, WorkspaceRailCounts>();
  for (const session of sessions) {
    const counts = countsByWorkspace.get(session.workspaceId) ?? emptyCounts();
    counts.total += 1;
    counts[terminalSessionDisplayStatus(session).kind] += 1;
    countsByWorkspace.set(session.workspaceId, counts);
  }

  return (
    <nav className={`workspace-rail ${embedded ? "embedded" : ""}`} aria-label="workspaces" aria-orientation="vertical" role="tablist">
      {workspaces.map((workspace) => {
        const active = workspace.id === activeWorkspaceId;
        const counts = countsByWorkspace.get(workspace.id) ?? emptyCounts();
        const summary = statusSummary(counts);
        const tone = railTone(counts);
        const priority = priorityChip(counts);
        const meta = workspaceMeta(workspace);
        const metaId = `workspace-${safeDomId(workspace.id)}-meta`;
        return (
          <button
            className={`workspace-button ${active ? "active" : ""} tone-${tone}`}
            type="button"
            aria-describedby={metaId}
            aria-label={`${workspace.label} workspace, ${summary}`}
            aria-selected={active}
            key={workspace.id}
            onClick={() => onSelectWorkspace(workspace.id)}
            onKeyDown={(event) => handleWorkspaceKeyDown(event, workspaces, workspace.id, onSelectWorkspace, buttonRefs)}
            ref={(element) => {
              buttonRefs.current[workspace.id] = element;
            }}
            role="tab"
            tabIndex={active ? 0 : -1}
            title={`${workspace.label}${workspace.gitBranch ? ` · ${workspace.gitBranch}` : ""}: ${summary}`}
          >
            <span className="workspace-monogram">{workspace.shortLabel}</span>
            <span className="workspace-button-details">
              <strong>{workspace.label}</strong>
              <span id={metaId}>{meta}</span>
            </span>
            <small className={`workspace-priority-chip tone-${priority.tone}`} aria-hidden="true" title={priority.label}>
              {priority.label}
            </small>
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
    checking: 0,
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
    countLabel(counts.checking, "checking"),
    countLabel(counts.runtime, "unavailable"),
    countLabel(counts.active, "active"),
    countLabel(counts.starting, "starting"),
    countLabel(counts.staged, "staged"),
    countLabel(counts.idle, "idle"),
    countLabel(counts.done, "done"),
    countLabel(counts.restored, "restored"),
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
  if (counts.checking > 0) return "staged";
  if (counts.active > 0 || counts.starting > 0) return "active";
  if (counts.staged > 0) return "staged";
  if (counts.total > 0) return "quiet";
  return "empty";
}

function priorityChip(counts: WorkspaceRailCounts): { tone: string; label: string } {
  if (counts.error > 0) return { tone: "error", label: countLabel(counts.error, "error") ?? "error" };
  if (counts.waiting > 0) return { tone: "waiting", label: countLabel(counts.waiting, "waiting") ?? "waiting" };
  if (counts.blocked > 0) return { tone: "waiting", label: countLabel(counts.blocked, "blocked") ?? "blocked" };
  if (counts.checking > 0) return { tone: "staged", label: countLabel(counts.checking, "checking") ?? "checking" };
  if (counts.runtime > 0) return { tone: "quiet", label: countLabel(counts.runtime, "unavailable") ?? "unavailable" };
  if (counts.active > 0) return { tone: "active", label: countLabel(counts.active, "active") ?? "active" };
  if (counts.starting > 0) return { tone: "active", label: countLabel(counts.starting, "starting") ?? "starting" };
  if (counts.staged > 0) return { tone: "staged", label: countLabel(counts.staged, "staged") ?? "staged" };
  if (counts.restored > 0) return { tone: "quiet", label: "restored" };
  if (counts.total > 0) return { tone: "quiet", label: `${counts.total} session${counts.total === 1 ? "" : "s"}` };
  return { tone: "empty", label: "empty" };
}

function workspaceMeta(workspace: WorkspaceRailWorkspace): string {
  const location = workspace.rootPath ? shortenPath(workspace.rootPath) : "scratch desk";
  return workspace.gitBranch ? `${location} · ${workspace.gitBranch}` : location;
}

function safeDomId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}

function handleWorkspaceKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  workspaces: WorkspaceRailWorkspace[],
  currentWorkspaceId: string,
  onSelectWorkspace: (workspaceId: string) => void,
  buttonRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>,
): void {
  const currentIndex = workspaces.findIndex((workspace) => workspace.id === currentWorkspaceId);
  if (currentIndex === -1) return;

  const keyDelta: Record<string, number> = {
    ArrowDown: 1,
    ArrowRight: 1,
    ArrowUp: -1,
    ArrowLeft: -1,
  };

  let nextIndex: number | null = null;
  const delta = keyDelta[event.key];
  if (delta !== undefined) {
    nextIndex = (currentIndex + delta + workspaces.length) % workspaces.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = workspaces.length - 1;
  }

  if (nextIndex === null) return;
  event.preventDefault();
  const nextWorkspace = workspaces[nextIndex];
  if (!nextWorkspace) return;

  onSelectWorkspace(nextWorkspace.id);
  window.requestAnimationFrame(() => {
    buttonRefs.current[nextWorkspace.id]?.focus();
  });
}
