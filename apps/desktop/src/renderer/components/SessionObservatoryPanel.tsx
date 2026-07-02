import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { SessionTile } from "../session-state";
import { terminalSessionDisplayStatus } from "../session-status";
import { sessionAgeLabel } from "../session-time";
import { sessionTileKind, tileKindMeta } from "../tile-kind";
import { TileKindIcon } from "../tile-kind-icon";
import { shortenPath } from "../path-display";
import type { WorkspaceRailWorkspace } from "./WorkspaceRail";

type SessionObservatoryPanelProps = {
  activeWorkspaceId: string;
  sessions: SessionTile[];
  workspaces: WorkspaceRailWorkspace[];
  onClose: () => void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
};

export function SessionObservatoryPanel({
  activeWorkspaceId,
  sessions,
  workspaces,
  onClose,
  onOpenSession,
}: SessionObservatoryPanelProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const workspaceById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    [workspaces],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      sessions
        .map((session) => toSessionRow(session, workspaceById, activeWorkspaceId))
        .filter((row) => matchesSessionRow(row, normalizedQuery))
        .sort(compareSessionRows),
    [activeWorkspaceId, normalizedQuery, sessions, workspaceById],
  );

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus();
      }
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") return;
    trapDialogFocus(event, panelRef.current);
  };

  return (
    <div className="session-observatory-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="session-observatory-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Session quick switch"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="session-observatory-header">
          <div>
            <span>Quick switch</span>
            <strong>Session quick switch</strong>
            <small>Jump to a live or saved session</small>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="session-observatory-close"
            onClick={onClose}
            aria-label="Close session quick switch"
          >
            <X size={15} />
          </button>
        </header>

        <div className="session-observatory-search">
          <Search size={15} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search sessions, workspace, cwd, branch..."
            aria-label="Search sessions"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {rows.length === 0 ? (
          <div className="session-observatory-empty" role="status">
            <span>No matching sessions</span>
            <strong>Try a workspace name, agent, branch, or path.</strong>
          </div>
        ) : (
          <ul className="session-observatory-list" aria-label="Session quick switch results">
            {rows.map((row) => (
              <li className={`session-observatory-row status-${row.status.kind}`} key={row.key}>
                <button
                  type="button"
                  className="session-observatory-main"
                  onClick={() => {
                    onOpenSession(row.workspaceId, row.sessionId);
                    onClose();
                  }}
                >
                  <span className={`session-observatory-kind ${row.kindMeta.className}`} title={row.kindMeta.label}>
                    <TileKindIcon kind={row.kind} />
                    <span>{row.kindMeta.shortLabel}</span>
                  </span>
                  <span className="session-observatory-copy">
                    <strong>{row.title}</strong>
                    <small>{row.workspaceLabel} · {row.location}</small>
                  </span>
                  <span className="session-observatory-meta">
                    {row.age && <time>{row.age}</time>}
                    <span>{row.status.label}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type SessionObservatoryRow = {
  age: string | null;
  key: string;
  kind: ReturnType<typeof sessionTileKind>;
  kindMeta: ReturnType<typeof tileKindMeta>;
  location: string;
  rawSearchText: string;
  sessionId: string;
  status: ReturnType<typeof terminalSessionDisplayStatus>;
  title: string;
  workspaceId: string;
  workspaceLabel: string;
};

function toSessionRow(
  session: SessionTile,
  workspaceById: Map<string, WorkspaceRailWorkspace>,
  activeWorkspaceId: string,
): SessionObservatoryRow {
  const workspace = workspaceById.get(session.workspaceId);
  const workspaceLabel = workspace?.label ?? `Workspace ${session.workspaceId}`;
  const status = terminalSessionDisplayStatus(session);
  const kind = sessionTileKind(session);
  const kindMeta = tileKindMeta(kind);
  const age = sessionAgeLabel(session.lastActivityAt ?? session.createdAt);
  const location = session.branchName
    ? `${shortenPath(session.branchName)} branch`
    : shortenPath(session.cwd || workspace?.rootPath || "local desk");
  const rawSearchText = [
    session.title,
    workspaceLabel,
    session.cwd,
    session.branchName,
    session.baseCwd,
    session.command,
    session.args?.join(" "),
    kindMeta.label,
    status.label,
    session.workspaceId === activeWorkspaceId ? "current" : "",
  ].filter(Boolean).join(" ").toLowerCase();

  return {
    age,
    key: `${session.workspaceId}-${session.id}`,
    kind,
    kindMeta,
    location,
    rawSearchText,
    sessionId: session.id,
    status,
    title: session.title,
    workspaceId: session.workspaceId,
    workspaceLabel,
  };
}

function matchesSessionRow(row: SessionObservatoryRow, query: string): boolean {
  if (!query) return true;
  return query.split(/\s+/).every((part) => row.rawSearchText.includes(part));
}

function compareSessionRows(left: SessionObservatoryRow, right: SessionObservatoryRow): number {
  const statusDelta = statusRank(left.status.kind) - statusRank(right.status.kind);
  if (statusDelta !== 0) return statusDelta;
  return left.title.localeCompare(right.title);
}

function statusRank(kind: ReturnType<typeof terminalSessionDisplayStatus>["kind"]): number {
  switch (kind) {
    case "waiting":
    case "blocked":
    case "error":
      return 0;
    case "active":
    case "starting":
      return 1;
    case "staged":
    case "checking":
      return 2;
    case "restored":
    case "done":
      return 3;
    case "idle":
      return 4;
    case "runtime":
      return 5;
  }
}

function trapDialogFocus(event: KeyboardEvent<HTMLDivElement>, root: HTMLElement | null): void {
  const focusable = focusableElements(root);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function focusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("disabled") && !element.getAttribute("aria-hidden"));
}
