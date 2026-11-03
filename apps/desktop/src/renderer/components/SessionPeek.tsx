import { Folder, GitBranch } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { activitySentence } from "../../shared/activity-presentation";
import type { SessionTile } from "../session-state";
import { sessionAgeLabel } from "../session-time";
import { tileKindMeta, type TileKind } from "../tile-kind";
import { TileKindIcon } from "../tile-kind-icon";
import "./session-peek.css";

const LATEST_COUNT = 3;
const EDGE = 8;

/** A rail row's card: everything the row has no room for. It reads only, so the pointer passes through it. */
export function SessionPeek({ id, session, kind, projectLabel, now, anchor }: {
  id: string;
  session: SessionTile;
  kind: TileKind;
  projectLabel: string;
  now: number;
  anchor: DOMRect;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const latest = (session.activityEvents ?? []).filter((event) => event.kind !== "lifecycle").slice(-LATEST_COUNT).reverse();
  // A card opened low in the window rises until it fits.
  useLayoutEffect(() => {
    const card = cardRef.current;
    const overflow = card ? card.getBoundingClientRect().bottom - (window.innerHeight - EDGE) : 0;
    if (card && overflow > 0) card.style.top = `${Math.max(EDGE, anchor.top - overflow)}px`;
  }, [anchor]);

  return createPortal(
    <div className="session-peek" id={id} ref={cardRef} role="tooltip" style={{ left: anchor.right + 12, top: anchor.top }}>
      <p className="session-peek-title">{session.title}</p>
      <div className="session-peek-facts">
        <span><Folder aria-hidden="true" size={12} /><span>{projectLabel}</span></span>
        {session.branchName && <span><GitBranch aria-hidden="true" size={12} /><span>{session.branchName}</span></span>}
        <span>
          <span className={`session-peek-kind kind-${kind}`} aria-hidden="true"><TileKindIcon kind={kind} size={12} /></span>
          <span>{tileKindMeta(kind).label}</span>
        </span>
        {session.changeStats && (
          <span className="session-peek-changes">
            <span className="details-additions">+{session.changeStats.additions}</span>
            <span className="details-deletions">−{session.changeStats.deletions}</span>
            <span>in this conversation</span>
          </span>
        )}
      </div>
      {latest.length > 0 && (
        <section className="session-peek-latest" aria-label="Latest">
          <h3>Latest</h3>
          <ul>
            {latest.map((event) => (
              <li key={event.id}>
                <span>{activitySentence(event)}</span>
                <span className="session-peek-age">{sessionAgeLabel(event.at, now)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>,
    document.body,
  );
}
