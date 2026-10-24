import { ChevronDown, Plus } from "lucide-react";
import { useId, type CSSProperties } from "react";
import { activitySentence, pendingApproval, waitingSentence } from "../../shared/activity-presentation";
import type { SessionTile } from "../session-state";
import { SESSION_STATE_LABELS, sessionState, type SessionDisplayStatus, type SessionStateKind } from "../session-status";
import { sessionTileKind } from "../tile-kind";
import { TileKindIcon } from "../tile-kind-icon";
import { SessionStatusGlyph } from "./SessionStatusGlyph";
import "./session-tree.css";

// Contract order; ended sessions share the last place. Asleep sessions and drafts are not on the tree.
const TREE_RANKS: ReadonlyArray<readonly SessionStateKind[]> = [
  ["needs-you"],
  ["your-turn"],
  ["working"],
  ["running"],
  ["idle"],
  ["failed", "done", "unavailable"],
];
// Rows that wait for you or are busy say what they do on a second line; idle and ended rows are one line.
const PREVIEW_KINDS: ReadonlySet<SessionStateKind> = new Set(["needs-you", "your-turn", "working", "running"]);
// A collapsed parent counts its workers by these states, in this order.
const COUNTED_KINDS: readonly SessionStateKind[] = ["needs-you", "your-turn", "working", "running", "failed", "done"];
// Widths of the hover actions in session-tree.css: 24px icon buttons, Pin as text, 2px apart.
const ICON_ACTION_WIDTH = 24;
const PIN_ACTION_WIDTH = 32;
const ACTION_GAP = 2;

type SessionTreeProps = {
  asleepCount: number;
  collapsedParentIds: ReadonlySet<string>;
  focusSessionId: string | null;
  now: number;
  pinnedSessionId: string | null;
  /** The active project's sessions on the deck. */
  sessions: readonly SessionTile[];
  workspaceLabel: string;
  onFocusSession: (sessionId: string) => void;
  onNewWorker: (parentSessionId: string) => void;
  onOpenAsleep: () => void;
  onPinSession: (sessionId: string) => void;
  onToggleWorkers: (parentSessionId: string) => void;
};

type TreeNode = { session: SessionTile; status: SessionDisplayStatus; workers: TreeNode[] };

export function sessionTree(sessions: readonly SessionTile[], now: number): TreeNode[] {
  const rank = (status: SessionDisplayStatus) => TREE_RANKS.findIndex((kinds) => kinds.includes(status.kind));
  const nodes = sessions
    .map((session) => ({ session, status: sessionState(session, "ready", now), workers: [] as TreeNode[] }))
    .filter((node) => rank(node.status) >= 0);
  const byId = new Map(nodes.map((node) => [node.session.id, node]));
  // One level only: a session hangs under its parent when the parent is itself on top; otherwise it is on top.
  const topIds = new Set(nodes.filter((node) => !hasShownParent(node.session, byId)).map((node) => node.session.id));
  const order = (left: TreeNode, right: TreeNode) => rank(left.status) - rank(right.status);
  const roots: TreeNode[] = [];
  for (const node of nodes) {
    const parentId = node.session.parentSessionId;
    if (parentId && topIds.has(parentId) && !topIds.has(node.session.id)) byId.get(parentId)!.workers.push(node);
    else roots.push(node);
  }
  for (const root of roots) root.workers.sort(order);
  return roots.sort(order);
}

function hasShownParent(session: SessionTile, byId: ReadonlyMap<string, TreeNode>): boolean {
  return session.parentSessionId !== undefined && session.parentSessionId !== session.id && byId.has(session.parentSessionId);
}

export function SessionTree({
  asleepCount,
  collapsedParentIds,
  focusSessionId,
  now,
  pinnedSessionId,
  sessions,
  workspaceLabel,
  onFocusSession,
  onNewWorker,
  onOpenAsleep,
  onPinSession,
  onToggleWorkers,
}: SessionTreeProps) {
  const roots = sessionTree(sessions, now);
  const rowProps = { focusSessionId, pinnedSessionId, collapsedParentIds, onFocusSession, onNewWorker, onPinSession, onToggleWorkers };
  if (roots.length === 0 && asleepCount === 0) return null;
  return (
    <div className="session-tree">
      {roots.length > 0 && (
        <ul className="session-tree-list" aria-label={`Sessions in ${workspaceLabel}`}>
          {roots.map((node) => <TreeItem key={node.session.id} node={node} {...rowProps} />)}
        </ul>
      )}
      {asleepCount > 0 && (
        <button
          type="button"
          className="session-tree-asleep"
          aria-label={`Browse ${asleepCount} asleep session${asleepCount === 1 ? "" : "s"}`}
          onClick={onOpenAsleep}
        >
          <SessionStatusGlyph kind="asleep" label="asleep" />
          <span>{asleepCount} asleep</span>
        </button>
      )}
    </div>
  );
}

function TreeItem({
  node,
  parentTitle,
  focusSessionId,
  pinnedSessionId,
  collapsedParentIds,
  onFocusSession,
  onNewWorker,
  onPinSession,
  onToggleWorkers,
}: {
  node: TreeNode;
  parentTitle?: string;
  focusSessionId: string | null;
  pinnedSessionId: string | null;
  collapsedParentIds: ReadonlySet<string>;
  onFocusSession: (sessionId: string) => void;
  onNewWorker: (parentSessionId: string) => void;
  onPinSession: (sessionId: string) => void;
  onToggleWorkers: (parentSessionId: string) => void;
}) {
  const { session, status, workers } = node;
  const titleId = useId();
  const metaId = useId();
  const parentId = useId();
  const collapsed = workers.length > 0 && collapsedParentIds.has(session.id);
  const focused = session.id === focusSessionId;
  const kind = sessionTileKind(session);
  const canPin = !focused && session.id !== pinnedSessionId;
  const canAddWorker = parentTitle === undefined && (kind === "claude" || kind === "codex");
  const preview = PREVIEW_KINDS.has(status.kind) ? sessionPreviewLine(session, status) : null;
  const meta = collapsed ? <WorkerCounts workers={workers} /> : preview;
  const describedBy = [meta ? metaId : null, parentTitle === undefined ? null : parentId].filter(Boolean).join(" ");
  const actions = (workers.length > 0 ? 1 : 0) + (canPin ? 1 : 0) + (canAddWorker ? 1 : 0);
  // The title makes room for the row's actions on hover instead of running under them.
  const actionsWidth = (workers.length > 0 ? ICON_ACTION_WIDTH : 0) + (canPin ? PIN_ACTION_WIDTH : 0)
    + (canAddWorker ? ICON_ACTION_WIDTH : 0) + Math.max(0, actions - 1) * ACTION_GAP;
  const childProps = { focusSessionId, pinnedSessionId, collapsedParentIds, onFocusSession, onNewWorker, onPinSession, onToggleWorkers };

  return (
    <li className={`session-tree-item${parentTitle === undefined ? "" : " is-worker"}`}>
      <div className={`session-tree-entry${focused ? " is-focused" : ""}`} style={{ "--tree-actions": `${actionsWidth}px` } as CSSProperties}>
        <button
          type="button"
          className="session-tree-row"
          data-session-id={session.id}
          aria-current={focused ? "true" : undefined}
          aria-describedby={describedBy || undefined}
          onClick={() => onFocusSession(session.id)}
          title={session.title}
        >
          <span className={`session-tree-kind kind-${kind}`} aria-hidden="true"><TileKindIcon kind={kind} size={14} /></span>
          <span className="session-tree-title" id={titleId}>{session.title}</span>
          <SessionStatusGlyph kind={status.kind} label={status.label} className="session-tree-state" />
          {meta && <span className="session-tree-meta" id={metaId}>{meta}</span>}
          {parentTitle !== undefined && <span className="visually-hidden" id={parentId}>{`Worker of ${parentTitle}`}</span>}
        </button>
        {/* Siblings of the row, not inside it: a button cannot hold another. They take the glyph's place on hover. */}
        {actions > 0 && (
          <span className="session-tree-actions">
            {workers.length > 0 && (
              <button
                type="button"
                className="session-tree-action session-tree-toggle"
                aria-expanded={!collapsed}
                aria-label={`${collapsed ? "Show" : "Hide"} workers of ${session.title}`}
                onClick={() => onToggleWorkers(session.id)}
              >
                <ChevronDown aria-hidden="true" size={13} />
              </button>
            )}
            {canPin && (
              <button type="button" className="session-tree-action session-tree-pin" aria-label="Pin under the focus" aria-describedby={titleId} onClick={() => onPinSession(session.id)}>
                Pin
              </button>
            )}
            {canAddWorker && (
              <button type="button" className="session-tree-action" aria-label={`New worker for ${session.title}`} onClick={() => onNewWorker(session.id)}>
                <Plus aria-hidden="true" size={13} />
              </button>
            )}
          </span>
        )}
      </div>
      {workers.length > 0 && !collapsed && (
        <ul className="session-tree-workers" aria-label={`Workers of ${session.title}`}>
          {workers.map((worker) => <TreeItem key={worker.session.id} node={worker} parentTitle={session.title} {...childProps} />)}
        </ul>
      )}
    </li>
  );
}

function WorkerCounts({ workers }: { workers: readonly TreeNode[] }) {
  const counts = COUNTED_KINDS
    .map((kind) => ({ kind, count: workers.filter((worker) => worker.status.kind === kind).length }))
    .filter((entry) => entry.count > 0);
  return (
    <>
      {`${workers.length} worker${workers.length === 1 ? "" : "s"}`}
      {counts.map(({ kind, count }) => (
        <span className="session-tree-count" key={kind}>
          <SessionStatusGlyph kind={kind} label={SESSION_STATE_LABELS[kind]} size={11} />
          {count}
        </span>
      ))}
    </>
  );
}

/**
 * A row's second line. The contract asks for the last output lines, but the bottom of an agent's screen is its
 * input box, so the latest classified activity stands in. It uses the sentences of the other surfaces: what a
 * waiting session asks as Needs you says it, the rest as Details.
 */
export function sessionPreviewLine(session: Pick<SessionTile, "activityEvents">, status: SessionDisplayStatus): string | null {
  const approval = status.kind === "needs-you" && status.reason === "approval" ? pendingApproval(session.activityEvents) : undefined;
  if (approval) return waitingSentence(approval);
  const events = session.activityEvents ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.kind !== "lifecycle") return activitySentence(event);
  }
  return null;
}
