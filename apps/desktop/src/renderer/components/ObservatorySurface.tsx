import { ChevronRight, ExternalLink, FolderGit2, Layers3, Play, RefreshCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { ExternalCodexSessionSummary } from "../../shared/session-index-ipc";
import type { SessionTile } from "../session-state";
import { terminalSessionDisplayStatus } from "../session-status";
import { sessionAgeLabel } from "../session-time";
import { sessionTileKind, tileKindMeta } from "../tile-kind";
import { TileKindIcon } from "../tile-kind-icon";
import { shortenPath } from "../path-display";
import { findWorkspaceForCwd } from "../workspace-path-matching";
import type { WorkspaceRailWorkspace } from "./WorkspaceRail";

type ObservatorySurfaceProps = {
  activeWorkspaceId: string;
  externalCodexSessions: ExternalCodexSessionSummary[];
  externalSessionIndexingEnabled?: boolean;
  externalSessionsError?: string | null;
  loadingExternalSessions: boolean;
  sessions: SessionTile[];
  workspaces: WorkspaceRailWorkspace[];
  onOpenManagedSession: (workspaceId: string, sessionId: string) => void;
  onRefreshExternalSessions: () => void;
  onResumeExternalCodexSession: (session: ExternalCodexSessionSummary) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onTrustExternalCodexWorkspace?: (session: ExternalCodexSessionSummary) => void;
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
  externalSessionIndexingEnabled = true,
  externalSessionsError,
  loadingExternalSessions,
  sessions,
  workspaces,
  onOpenManagedSession,
  onRefreshExternalSessions,
  onResumeExternalCodexSession,
  onSelectWorkspace,
  onTrustExternalCodexWorkspace,
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
        <button
          type="button"
          onClick={onRefreshExternalSessions}
          disabled={loadingExternalSessions || !externalSessionIndexingEnabled}
        >
          <RefreshCcw size={15} />
          <span>{!externalSessionIndexingEnabled ? "Disabled" : loadingExternalSessions ? "Refreshing" : "Refresh"}</span>
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

      {!externalSessionIndexingEnabled && (
        <div className="observatory-refresh-status" role="status">
          <strong>External Codex indexing is off.</strong>
          <span>Turn it on in Local Data & Privacy to browse external Codex sessions.</span>
        </div>
      )}

      {externalSessionIndexingEnabled && externalSessionsError && (
        <div className="observatory-refresh-status" role="status">
          <strong>Showing last successful results.</strong>
          <span>{externalSessionsError}</span>
        </div>
      )}

      <div className="observatory-grid">
        <aside className="observatory-projects" aria-label="Projects">
          <div className="observatory-column-heading">
            <span>Projects</span>
            <strong>{workspaces.length}</strong>
          </div>
          <button
            type="button"
            className={`observatory-project ${selectedProjectId === "all" ? "active" : ""}`}
            aria-label={`All projects, ${rows.length} sessions`}
            onClick={() => {
              setSelectedProjectId("all");
              setSelectedRowId(null);
            }}
          >
            <span className="observatory-project-marker" aria-hidden="true">
              <Layers3 size={14} />
            </span>
            <span className="observatory-project-copy">
              <span>All</span>
              <small>Every indexed session</small>
            </span>
            <strong className="observatory-project-count">{rows.length}</strong>
            <ChevronRight className="observatory-project-arrow" size={14} aria-hidden="true" />
          </button>
          {workspaces.map((workspace) => {
            const count = rows.filter((row) => row.workspaceId === workspace.id).length;
            return (
              <button
                type="button"
                className={`observatory-project ${workspace.id === selectedProjectId ? "active" : ""} ${
                  workspace.id === activeWorkspaceId ? "current" : ""
                }`}
                aria-label={`${workspace.label}, ${count} sessions`}
                key={workspace.id}
                onClick={() => {
                  onSelectWorkspace(workspace.id);
                  setSelectedProjectId(workspace.id);
                  setSelectedRowId(null);
                }}
              >
                <span className="observatory-project-marker" aria-hidden="true">
                  <FolderGit2 size={14} />
                </span>
                <span className="observatory-project-copy">
                  <span>{workspace.label}</span>
                  <small>{workspace.rootPath ? shortenPath(workspace.rootPath) : "scratch desk"}</small>
                </span>
                <strong className="observatory-project-count">{count}</strong>
                <ChevronRight className="observatory-project-arrow" size={14} aria-hidden="true" />
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
              {...(onTrustExternalCodexWorkspace ? { onTrustExternalCodexWorkspace } : {})}
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
  onTrustExternalCodexWorkspace,
}: {
  row: ObservatoryRow;
  onOpenManagedSession: (workspaceId: string, sessionId: string) => void;
  onResumeExternalCodexSession: (session: ExternalCodexSessionSummary) => void;
  onTrustExternalCodexWorkspace?: (session: ExternalCodexSessionSummary) => void;
}) {
  return (
    <div className={`observatory-detail-card source-${row.source}`}>
      <span>{row.source === "managed-alfred" ? "Managed by Alfred" : "External Codex"}</span>
      <strong>{row.title}</strong>
      <p>{detailCopy(row)}</p>
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
        <button
          type="button"
          disabled={!row.workspaceId && !onTrustExternalCodexWorkspace}
          onClick={() => {
            if (row.workspaceId) {
              onResumeExternalCodexSession(row.session);
              return;
            }
            onTrustExternalCodexWorkspace?.(row.session);
          }}
        >
          <Play size={15} />
          <span>{row.workspaceId ? "Resume in Alfred" : "Trust workspace first"}</span>
        </button>
      )}
    </div>
  );
}

function detailCopy(row: ObservatoryRow): string {
  if (row.source === "managed-alfred") return "Live or saved terminal managed by Alfred.";
  if (!row.workspaceId) return "Add this folder as a workspace before resuming this Codex session.";
  return "Read-only Codex history. Resume creates a new Alfred terminal.";
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
  const managedRows: ObservatoryRow[] = sessions.map((session) => {
    const workspace =
      (session.baseCwd ? findWorkspaceForCwd(session.baseCwd, workspaces) : null) ??
      findWorkspaceForCwd(session.cwd, workspaces) ??
      workspaceById.get(session.workspaceId);
    const workspaceId = workspace?.id ?? session.workspaceId;
    const status = terminalSessionDisplayStatus(session);
    const kind = sessionTileKind(session);
    const kindMeta = tileKindMeta(kind);
    const updatedAt = session.lastActivityAt ?? session.lastOutputAt ?? session.createdAt ?? 0;
    const location = session.cwd || workspace?.rootPath || "local desk";
    return {
      id: `managed:${workspaceId}:${session.id}`,
      source: "managed-alfred",
      title: session.title,
      workspaceId,
      workspaceLabel: workspace?.label ?? workspaceId,
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
    const workspace = findWorkspaceForCwd(session.cwd, workspaces);
    return {
      id: `external-codex:${session.id}`,
      source: "external-codex",
      title: session.title || "Untitled Codex session",
      workspaceId: workspace?.id ?? null,
      workspaceLabel: workspace?.label ?? "External Codex",
      location: shortenPath(session.cwd || "unknown cwd"),
      updatedAt: session.updatedAt,
      status: workspace ? "read-only" : "untrusted cwd",
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
