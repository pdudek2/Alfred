import { ExternalLink, Play, RefreshCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { ExternalCodexSessionSummary } from "../../shared/session-index-ipc";
import type { SessionTile } from "../session-state";
import { terminalSessionDisplayStatus } from "../session-status";
import { sessionAgeLabel } from "../session-time";
import { sessionTileKind, tileKindMeta } from "../tile-kind";
import { TileKindIcon } from "../tile-kind-icon";
import { shortenPath } from "../path-display";
import type { WorkspaceRailWorkspace } from "./WorkspaceRail";

type ObservatorySurfaceProps = {
  activeWorkspaceId: string;
  externalCodexSessions: ExternalCodexSessionSummary[];
  loadingExternalSessions: boolean;
  sessions: SessionTile[];
  workspaces: WorkspaceRailWorkspace[];
  onOpenManagedSession: (workspaceId: string, sessionId: string) => void;
  onRefreshExternalSessions: () => void;
  onResumeExternalCodexSession: (session: ExternalCodexSessionSummary) => void;
  onSelectWorkspace: (workspaceId: string) => void;
};

type ObservatoryRow =
  | {
      id: string;
      source: "managed-alfred";
      title: string;
      workspaceId: string;
      workspaceLabel: string;
      location: string;
      updatedAt: number;
      status: string;
      kindLabel: string;
      kindClassName: string;
      kind: ReturnType<typeof sessionTileKind>;
      rawSearchText: string;
      session: SessionTile;
    }
  | {
      id: string;
      source: "external-codex";
      title: string;
      workspaceId: string | null;
      workspaceLabel: string;
      location: string;
      updatedAt: number;
      status: string;
      kindLabel: string;
      kindClassName: string;
      rawSearchText: string;
      session: ExternalCodexSessionSummary;
    };

export function ObservatorySurface({
  activeWorkspaceId,
  externalCodexSessions,
  loadingExternalSessions,
  sessions,
  workspaces,
  onOpenManagedSession,
  onRefreshExternalSessions,
  onResumeExternalCodexSession,
  onSelectWorkspace,
}: ObservatorySurfaceProps) {
  const [query, setQuery] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const workspaceById = useMemo(() => new Map(workspaces.map((workspace) => [workspace.id, workspace])), [workspaces]);
  const rows = useMemo(
    () => buildObservatoryRows({ externalCodexSessions, sessions, workspaces }),
    [externalCodexSessions, sessions, workspaces],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = useMemo(
    () =>
      rows
        .filter((row) => selectedProjectId === "all" || row.workspaceId === selectedProjectId)
        .filter((row) => matchesObservatoryRow(row, normalizedQuery))
        .sort(compareObservatoryRows),
    [normalizedQuery, rows, selectedProjectId],
  );
  const selectedRow = visibleRows.find((row) => row.id === selectedRowId) ?? visibleRows[0] ?? null;
  const activeWorkspace = workspaceById.get(activeWorkspaceId);

  return (
    <section className="observatory-surface" aria-label="Observatory workspace">
      <header className="observatory-surface-header">
        <div>
          <span>Observatory</span>
          <strong>Sessions and project memory</strong>
          <p>Browse Alfred-managed terminals and external Codex sessions. External sessions are read-only until resumed.</p>
        </div>
        <button type="button" onClick={onRefreshExternalSessions} disabled={loadingExternalSessions}>
          <RefreshCcw size={15} />
          <span>{loadingExternalSessions ? "Refreshing" : "Refresh"}</span>
        </button>
      </header>

      <div className="observatory-search">
        <Search size={15} />
        <input
          value={query}
          aria-label="Search Observatory sessions"
          placeholder="Search project, title, cwd, model..."
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="observatory-grid">
        <aside className="observatory-projects" aria-label="Projects">
          <div className="observatory-column-heading">
            <span>Projects</span>
            <strong>{workspaces.length}</strong>
          </div>
          <button
            type="button"
            className={`observatory-project ${selectedProjectId === "all" ? "active" : ""}`}
            onClick={() => {
              setSelectedProjectId("all");
              setSelectedRowId(null);
            }}
          >
            <span>All</span>
            <strong>{rows.length}</strong>
          </button>
          {workspaces.map((workspace) => {
            const count = rows.filter((row) => row.workspaceId === workspace.id).length;
            return (
              <button
                type="button"
                className={`observatory-project ${workspace.id === selectedProjectId ? "active" : ""} ${
                  workspace.id === activeWorkspaceId ? "current" : ""
                }`}
                key={workspace.id}
                onClick={() => {
                  onSelectWorkspace(workspace.id);
                  setSelectedProjectId(workspace.id);
                  setSelectedRowId(null);
                }}
              >
                <span>{workspace.label}</span>
                <small>{workspace.rootPath ? shortenPath(workspace.rootPath) : "scratch desk"}</small>
                <strong>{count}</strong>
              </button>
            );
          })}
          {activeWorkspace && (
            <p className="observatory-project-note">Current desk: {activeWorkspace.label}</p>
          )}
        </aside>

        <div className="observatory-session-list" aria-label="Sessions">
          <div className="observatory-column-heading">
            <span>Sessions</span>
            <strong>{visibleRows.length}</strong>
          </div>
          {visibleRows.length === 0 ? (
            <div className="observatory-empty" role="status">
              <span>No sessions match.</span>
              <strong>Try a project, cwd, or prompt title.</strong>
            </div>
          ) : (
            <ol>
              {visibleRows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={`observatory-session-row ${row.id === selectedRow?.id ? "selected" : ""}`}
                    onClick={() => setSelectedRowId(row.id)}
                  >
                    <span className={`observatory-source-badge source-${row.source}`}>
                      {row.source === "managed-alfred" ? (
                        <>
                          <TileKindIcon kind={row.kind} />
                          {row.kindLabel}
                        </>
                      ) : (
                        "Cx"
                      )}
                    </span>
                    <span className="observatory-row-copy">
                      <strong>{row.title}</strong>
                      <small>{row.workspaceLabel} · {row.location}</small>
                    </span>
                    <span className="observatory-row-meta">
                      <time>{sessionAgeLabel(row.updatedAt)}</time>
                      <small>{row.status}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        <aside className="observatory-detail" aria-label="Session detail">
          {selectedRow ? (
            <ObservatoryDetail
              row={selectedRow}
              onOpenManagedSession={onOpenManagedSession}
              onResumeExternalCodexSession={onResumeExternalCodexSession}
            />
          ) : (
            <div className="observatory-empty detail">
              <span>No session selected.</span>
              <strong>Select a row to inspect source and actions.</strong>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function ObservatoryDetail({
  row,
  onOpenManagedSession,
  onResumeExternalCodexSession,
}: {
  row: ObservatoryRow;
  onOpenManagedSession: (workspaceId: string, sessionId: string) => void;
  onResumeExternalCodexSession: (session: ExternalCodexSessionSummary) => void;
}) {
  return (
    <div className={`observatory-detail-card source-${row.source}`}>
      <span>{row.source === "managed-alfred" ? "Managed by Alfred" : "External Codex"}</span>
      <strong>{row.title}</strong>
      <p>{row.source === "managed-alfred" ? "Live or saved terminal managed by Alfred." : "Read-only Codex history. Resume creates a new Alfred terminal."}</p>
      <dl>
        <div>
          <dt>project</dt>
          <dd>{row.workspaceLabel}</dd>
        </div>
        <div>
          <dt>location</dt>
          <dd title={row.location}>{row.location}</dd>
        </div>
        <div>
          <dt>updated</dt>
          <dd>{new Date(row.updatedAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>status</dt>
          <dd>{row.status}</dd>
        </div>
        {row.source === "external-codex" && row.session.model && (
          <div>
            <dt>model</dt>
            <dd>{row.session.model}</dd>
          </div>
        )}
        {row.source === "external-codex" && row.session.originator && (
          <div>
            <dt>originator</dt>
            <dd>{row.session.originator}</dd>
          </div>
        )}
      </dl>
      {row.source === "managed-alfred" ? (
        <button type="button" onClick={() => onOpenManagedSession(row.workspaceId, row.session.id)}>
          <ExternalLink size={15} />
          <span>Open in Desk</span>
        </button>
      ) : (
        <button type="button" onClick={() => onResumeExternalCodexSession(row.session)}>
          <Play size={15} />
          <span>Resume in Alfred</span>
        </button>
      )}
    </div>
  );
}

function buildObservatoryRows({
  externalCodexSessions,
  sessions,
  workspaces,
}: {
  externalCodexSessions: ExternalCodexSessionSummary[];
  sessions: SessionTile[];
  workspaces: WorkspaceRailWorkspace[];
}): ObservatoryRow[] {
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const workspaceByRoot = new Map(
    workspaces.flatMap((workspace) => (workspace.rootPath ? [[workspace.rootPath, workspace] as const] : [])),
  );
  const managedRows: ObservatoryRow[] = sessions.map((session) => {
    const workspace = workspaceById.get(session.workspaceId);
    const status = terminalSessionDisplayStatus(session);
    const kind = sessionTileKind(session);
    const kindMeta = tileKindMeta(kind);
    const updatedAt = session.lastActivityAt ?? session.lastOutputAt ?? session.createdAt ?? 0;
    const location = session.cwd || workspace?.rootPath || "local desk";
    return {
      id: `managed:${session.workspaceId}:${session.id}`,
      source: "managed-alfred",
      title: session.title,
      workspaceId: session.workspaceId,
      workspaceLabel: workspace?.label ?? session.workspaceId,
      location: shortenPath(location),
      updatedAt,
      status: status.label,
      kind,
      kindLabel: kindMeta.shortLabel,
      kindClassName: kindMeta.className,
      rawSearchText: [
        session.title,
        workspace?.label,
        session.cwd,
        session.branchName,
        session.baseCwd,
        session.command,
        session.args?.join(" "),
        status.label,
        kindMeta.label,
      ].filter(Boolean).join(" ").toLowerCase(),
      session,
    };
  });
  const externalRows: ObservatoryRow[] = externalCodexSessions.map((session) => {
    const workspace = workspaceForExternalCwd(session.cwd, workspaceByRoot);
    return {
      id: `external-codex:${session.id}`,
      source: "external-codex",
      title: session.title || "Untitled Codex session",
      workspaceId: workspace?.id ?? null,
      workspaceLabel: workspace?.label ?? "External Codex",
      location: shortenPath(session.cwd || "unknown cwd"),
      updatedAt: session.updatedAt,
      status: "read-only",
      kindLabel: "Cx",
      kindClassName: "codex",
      rawSearchText: [
        session.title,
        session.cwd,
        workspace?.label,
        session.model,
        session.originator,
        "external codex read-only resume",
      ].filter(Boolean).join(" ").toLowerCase(),
      session,
    };
  });

  return [...managedRows, ...externalRows];
}

function workspaceForExternalCwd(
  cwd: string,
  workspaceByRoot: Map<string, WorkspaceRailWorkspace>,
): WorkspaceRailWorkspace | null {
  if (!cwd) return null;
  const exact = workspaceByRoot.get(cwd);
  if (exact) return exact;
  const matches = Array.from(workspaceByRoot.entries())
    .filter(([root]) => cwd === root || cwd.startsWith(`${root}/`))
    .sort((left, right) => right[0].length - left[0].length);
  return matches[0]?.[1] ?? null;
}

function matchesObservatoryRow(row: ObservatoryRow, query: string): boolean {
  if (!query) return true;
  return query.split(/\s+/).every((part) => row.rawSearchText.includes(part));
}

function compareObservatoryRows(left: ObservatoryRow, right: ObservatoryRow): number {
  const sourceDelta = sourceRank(left.source) - sourceRank(right.source);
  if (sourceDelta !== 0) return sourceDelta;
  return right.updatedAt - left.updatedAt;
}

function sourceRank(source: ObservatoryRow["source"]): number {
  return source === "managed-alfred" ? 0 : 1;
}
