import { ArrowRight, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { AttentionProjection } from "../attention-projection";
import { presentActivityEvents } from "../activity-presentation";
import type { SessionTile } from "../session-state";
import { terminalSessionDisplayStatus } from "../session-status";
import { TileKindIcon } from "../tile-kind-icon";
import { sessionTileKind, tileKindMeta } from "../tile-kind";
import { attentionActionLabel } from "./InboxDecisionItem";
import "./agents-drawer.css";

type AgentsDrawerWorkspace = {
  id: string;
  label: string;
};

export type AgentsDrawerProps = {
  activeSessions: SessionTile[];
  activeSessionId: string | null;
  activeWorkspaceId: string;
  attentionItems: AttentionProjection[];
  dismissalSuspended?: boolean;
  open: boolean;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  workspaces: AgentsDrawerWorkspace[];
  onClose: () => void;
  onOpenInbox: () => void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onRunAttentionAction: (item: AttentionProjection) => void;
};

export function AgentsDrawer({
  activeSessions,
  activeSessionId,
  activeWorkspaceId,
  attentionItems,
  dismissalSuspended = false,
  open,
  returnFocusRef,
  workspaces,
  onClose,
  onOpenInbox,
  onOpenSession,
  onRunAttentionAction,
}: AgentsDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusOnCloseRef = useRef(false);
  const wasOpenRef = useRef(open);
  const decisions = attentionItems.filter((item) => item.blocksAgent);
  const workspaceLabels = new Map(workspaces.map((workspace) => [workspace.id, workspace.label]));
  const inProgress = [...activeSessions]
    .sort((left, right) => activityAt(right) - activityAt(left)
      || `${left.workspaceId}:${left.id}`.localeCompare(`${right.workspaceId}:${right.id}`));

  const requestClose = useCallback(() => {
    restoreFocusOnCloseRef.current = true;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open || dismissalSuspended) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [dismissalSuspended, open, requestClose]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!wasOpen || open || !restoreFocusOnCloseRef.current) return;
    restoreFocusOnCloseRef.current = false;
    const frame = requestAnimationFrame(() => returnFocusRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, returnFocusRef]);

  return (
    <aside
      className={`agents-drawer ${open ? "open" : "closed"}`}
      aria-label="Agents"
      aria-hidden={open ? "false" : "true"}
      data-testid="agents-drawer"
      inert={!open || undefined}
    >
      <header className="agents-drawer__header">
        <h2>Agents</h2>
        <button ref={closeButtonRef} type="button" aria-label="Close Agents" onClick={requestClose}>
          <X aria-hidden="true" size={15} />
        </button>
      </header>

      <div className="agents-drawer__body">
        <section className="agents-drawer__section" aria-labelledby="agents-needs-decision">
          <header>
            <h3 id="agents-needs-decision">Needs a decision</h3>
            <span>{decisions.length}</span>
          </header>
          {decisions.length === 0 ? (
            <p className="agents-drawer__empty">No decisions waiting.</p>
          ) : (
            <div className="agents-drawer__decision-list">
              {decisions.map((item) => (
                <article className="agents-drawer__decision" key={item.id}>
                  <span className="agents-drawer__decision-mark" aria-hidden="true">
                    <TriangleAlert size={13} strokeWidth={1.9} />
                  </span>
                  <div className="agents-drawer__decision-copy">
                    <div>
                      <strong>{item.sessionTitle}</strong>
                      <small>{item.workspaceLabel}</small>
                    </div>
                    <p title={item.reason}>{item.reason}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`${attentionActionLabel(item)} ${item.sessionTitle}`}
                    onClick={() => {
                      if (item.action.kind === "launch") restoreFocusOnCloseRef.current = true;
                      onRunAttentionAction(item);
                    }}
                  >
                    {attentionActionLabel(item)}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="agents-drawer__section" aria-labelledby="agents-in-progress">
          <header>
            <h3 id="agents-in-progress">In progress</h3>
            <span>{inProgress.length}</span>
          </header>
          {inProgress.length === 0 ? (
            <p className="agents-drawer__empty">No agents running.</p>
          ) : (
            <div className="agents-drawer__work-list">
              {inProgress.map((session) => {
                const workspaceLabel = workspaceLabels.get(session.workspaceId) ?? session.workspaceId;
                const detectedKind = sessionTileKind(session);
                const kind = detectedKind === "codex" || detectedKind === "claude"
                  ? detectedKind
                  : session.command === "claude" ? "claude" : "codex";
                const agentLabel = tileKindMeta(kind).label;
                const detail = latestAgentDetail(session);
                const selected = session.workspaceId === activeWorkspaceId && session.id === activeSessionId;
                return (
                  <button
                    type="button"
                    className={selected ? "is-selected" : undefined}
                    aria-current={selected ? "true" : undefined}
                    aria-label={`Open ${session.title} in ${workspaceLabel}`}
                    key={`${session.workspaceId}:${session.id}`}
                    onClick={() => onOpenSession(session.workspaceId, session.id)}
                  >
                    <span className={`agents-drawer__agent-mark kind-${kind}`} aria-hidden="true">
                      <TileKindIcon kind={kind} size={13} />
                    </span>
                    <span className="agents-drawer__work-copy">
                      <strong>{session.title}</strong>
                      <small>
                        {workspaceLabel} · {agentLabel}
                        <span className="agents-drawer__work-detail" title={detail}> · {detail}</span>
                      </small>
                    </span>
                    <span className="agents-drawer__open-label" aria-hidden="true">Open</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <footer className="agents-drawer__footer">
        <span className="agents-drawer__footer-label">Inbox</span>
        <button type="button" aria-label="Open full Inbox queue" onClick={onOpenInbox}>
          <span>Open full queue</span>
          <ArrowRight aria-hidden="true" size={13} />
        </button>
      </footer>
    </aside>
  );
}

function activityAt(session: SessionTile): number {
  return session.lastActivityAt ?? session.lastOutputAt ?? session.createdAt ?? 0;
}

function latestAgentDetail(session: SessionTile): string {
  const status = terminalSessionDisplayStatus(session);
  const event = presentActivityEvents(session.activityEvents ?? [], { limit: 1 }).visibleEvents[0];
  const approvalWasSuperseded = event?.kind === "approval"
    && status.kind === "active"
    && session.lastOutputAt !== undefined
    && session.lastOutputAt > event.at;
  if (event?.detail.trim() && !approvalWasSuperseded) return event.detail.trim();

  if (status.kind === "starting") return "Starting";
  if (status.kind === "active") return "Working";
  return status.kind === "idle" ? "Quiet" : status.label;
}
