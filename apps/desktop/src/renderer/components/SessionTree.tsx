import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { activitySentence, pendingApproval, waitingSentence } from "../../shared/activity-presentation";
import { pendingRuntimeBlocker } from "../../shared/session-activity";
import type { SessionTile } from "../session-state";
import { SESSION_STATE_LABELS, sessionState, type SessionDisplayStatus, type SessionStateKind } from "../session-status";
import { sessionAgeLabel } from "../session-time";
import { sessionTileKind } from "../tile-kind";
import { TileKindIcon } from "../tile-kind-icon";
import { SessionPeek } from "./SessionPeek";
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
// A shell says what it does while it is busy; an agent's row has a second line whenever there is something to say.
const PREVIEW_KINDS: ReadonlySet<SessionStateKind> = new Set(["needs-you", "your-turn", "working", "running"]);
// Mid-turn the row says what is happening: the question has to be read, and the counts only move at a turn's end.
const ACTIVITY_FIRST_KINDS: ReadonlySet<SessionStateKind> = new Set(["needs-you", "working"]);
// A collapsed parent counts its workers by these states, in this order.
const COUNTED_KINDS: readonly SessionStateKind[] = ["needs-you", "your-turn", "working", "running", "failed", "done"];
// Widths of the hover actions in session-tree.css: 24px icon buttons, Pin as text, 2px apart.
const ICON_ACTION_WIDTH = 24;
const PIN_ACTION_WIDTH = 32;
const ACTION_GAP = 2;
// A card waits for the pointer to rest; once one is open, the next row's card follows at once.
const PEEK_DELAY_MS = 500;
const PEEK_LINGER_MS = 100;

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
type PeekControl = {
  peekId: string;
  openPeekSessionId: string | null;
  showPeek: (sessionId: string, entry: HTMLElement, at: "now" | "after-delay") => void;
  hidePeek: (at: "now" | "after-delay") => void;
};

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
  const peekId = useId();
  const [peek, setPeek] = useState<{ sessionId: string; anchor: DOMRect } | null>(null);
  const peekTimer = useRef<number | undefined>(undefined);
  const showPeek: PeekControl["showPeek"] = (sessionId, entry, at) => {
    window.clearTimeout(peekTimer.current);
    const open = () => setPeek({ sessionId, anchor: entry.getBoundingClientRect() });
    if (at === "now" || peek) open();
    else peekTimer.current = window.setTimeout(open, PEEK_DELAY_MS);
  };
  const hidePeek: PeekControl["hidePeek"] = (at) => {
    window.clearTimeout(peekTimer.current);
    if (at === "now") setPeek(null);
    else peekTimer.current = window.setTimeout(() => setPeek(null), PEEK_LINGER_MS);
  };
  // The card is placed once; scrolling or resizing would leave it beside another row.
  useEffect(() => {
    if (!peek) return;
    const close = () => setPeek(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [peek]);
  useEffect(() => () => window.clearTimeout(peekTimer.current), []);
  const peekNode = peek ? findNode(roots, peek.sessionId) : undefined;
  const peekControl: PeekControl = { peekId, openPeekSessionId: peekNode ? peek!.sessionId : null, showPeek, hidePeek };
  const rowProps = { focusSessionId, now, peekControl, pinnedSessionId, collapsedParentIds, onFocusSession, onNewWorker, onPinSession, onToggleWorkers };
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
      {peek && peekNode && (
        <SessionPeek
          id={peekId}
          session={peekNode.session}
          kind={sessionTileKind(peekNode.session)}
          projectLabel={workspaceLabel}
          now={now}
          anchor={peek.anchor}
        />
      )}
    </div>
  );
}

function findNode(nodes: readonly TreeNode[], sessionId: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.session.id === sessionId) return node;
    const worker = findNode(node.workers, sessionId);
    if (worker) return worker;
  }
  return undefined;
}

function TreeItem({
  node,
  parentTitle,
  focusSessionId,
  now,
  peekControl,
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
  now: number;
  peekControl: PeekControl;
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
  const agent = kind === "claude" || kind === "codex";
  const preview = agent || PREVIEW_KINDS.has(status.kind) ? sessionPreviewLine(session, status) : null;
  const changes = agent && !ACTIVITY_FIRST_KINDS.has(status.kind) ? session.changeStats : undefined;
  const lead = changes ? <ChangeCounts {...changes} /> : preview && <span className="session-tree-preview">{preview}</span>;
  const age = agent && lead ? sessionAgeLabel(session.lastActivityAt, now) : null;
  const meta = collapsed ? <WorkerCounts workers={workers} /> : lead && <>{lead}{age && <span className="session-tree-age">{age}</span>}</>;
  const peeking = peekControl.openPeekSessionId === session.id;
  const describedBy = [meta ? metaId : null, parentTitle === undefined ? null : parentId, peeking ? peekControl.peekId : null]
    .filter(Boolean).join(" ");
  const pressed = useRef(false);
  const actions = (workers.length > 0 ? 1 : 0) + (canPin ? 1 : 0) + (canAddWorker ? 1 : 0);
  // The title makes room for the row's actions on hover instead of running under them.
  const actionsWidth = (workers.length > 0 ? ICON_ACTION_WIDTH : 0) + (canPin ? PIN_ACTION_WIDTH : 0)
    + (canAddWorker ? ICON_ACTION_WIDTH : 0) + Math.max(0, actions - 1) * ACTION_GAP;
  const childProps = { focusSessionId, now, peekControl, pinnedSessionId, collapsedParentIds, onFocusSession, onNewWorker, onPinSession, onToggleWorkers };

  return (
    <li className={`session-tree-item${parentTitle === undefined ? "" : " is-worker"}`}>
      <div
        className={`session-tree-entry${focused ? " is-focused" : ""}`}
        style={{ "--tree-actions": `${actionsWidth}px` } as CSSProperties}
        onMouseEnter={(event) => peekControl.showPeek(session.id, event.currentTarget, "after-delay")}
        onMouseLeave={() => peekControl.hidePeek("after-delay")}
      >
        <button
          type="button"
          className="session-tree-row"
          data-session-id={session.id}
          aria-current={focused ? "true" : undefined}
          aria-describedby={describedBy || undefined}
          onClick={() => onFocusSession(session.id)}
          // A row reached from the keyboard shows its card at once; one clicked already shows on hover.
          onPointerDown={() => { pressed.current = true; }}
          onFocus={(event) => {
            if (!pressed.current) peekControl.showPeek(session.id, event.currentTarget.parentElement!, "now");
            pressed.current = false;
          }}
          onBlur={() => peekControl.hidePeek("now")}
          onKeyDown={(event) => { if (event.key === "Escape" && peeking) peekControl.hidePeek("now"); }}
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

function ChangeCounts({ additions, deletions }: NonNullable<SessionTile["changeStats"]>) {
  return (
    <span className="session-tree-changes">
      <span className="details-additions">+{additions}</span>
      <span className="details-deletions">−{deletions}</span>
    </span>
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
export function sessionPreviewLine(
  session: Pick<SessionTile, "activityEvents" | "servingUrl">,
  status: SessionDisplayStatus,
): string | null {
  if (status.kind === "running" && session.servingUrl) {
    const { host, port } = new URL(session.servingUrl);
    return port ? `Serving on port ${port}` : `Serving on ${host}`;
  }
  const approval = status.kind === "needs-you" && status.reason === "approval" ? pendingApproval(session.activityEvents) : undefined;
  if (approval) return waitingSentence(approval);
  const blocker = status.kind === "needs-you" && status.reason === "runtime-blocker"
    ? pendingRuntimeBlocker(session.activityEvents)
    : undefined;
  if (blocker) return activitySentence(blocker);
  const events = session.activityEvents ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.kind !== "lifecycle") return activitySentence(event);
  }
  return null;
}
