import { ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { isLaunchableStagedSession, type SessionTile } from "../session-state";
import { sessionTileKind, tileKindMeta } from "../tile-kind";
import { AlfredSignalGlyph } from "./AlfredSignalGlyph";
import "./plan-line.css";

type PlanLineProps = {
  drafts: SessionTile[];
  name: string;
  needsYouIds: ReadonlySet<string>;
  onDiscard: (sessionId: string) => void;
  onEdit: (sessionId: string) => void;
  onLaunch: (sessionId: string) => void;
  onLaunchAll: (sessionIds: string[]) => void;
};

export function PlanLine({ drafts, name, needsYouIds, onDiscard, onEdit, onLaunch, onLaunchAll }: PlanLineProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusedIndexRef = useRef(0);
  const readyIds = drafts.filter(isLaunchableStagedSession).map((draft) => draft.id);
  const needsYouCount = drafts.filter((draft) => needsYouIds.has(draft.id)).length;

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => rowButtons(rootRef.current)[0]?.focus());
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  // A launched or discarded draft leaves the list; keep focus on a neighbouring row.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!open || !root || root.contains(document.activeElement)) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    const buttons = rowButtons(root);
    (buttons[Math.min(focusedIndexRef.current, buttons.length - 1)] ?? triggerRef.current)?.focus();
  }, [drafts, open]);

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = rowButtons(rootRef.current);
    const current = buttons.findIndex((button) => button === document.activeElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = Math.min(current + 1, buttons.length - 1);
    if (event.key === "ArrowUp") next = Math.max(current - 1, 0);
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <div className="plan-line" data-open={open ? "" : undefined} ref={rootRef}>
      <div className="plan-line__row">
        <button
          type="button"
          className="plan-line__disclose"
          ref={triggerRef}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen((current) => !current)}
        >
          <DraftGlyph />
          <span className="plan-line__name">{name}</span>
          <span className="plan-line__count">
            {drafts.length === 1 ? "1 draft" : `${drafts.length} drafts`}
            {needsYouCount > 0 && (
              <>
                {" · "}
                <span className="plan-line__signal">{needsYouCount} needs you</span>
              </>
            )}
          </span>
          <ChevronDown className="plan-line__chevron" size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="plan-line__button"
          disabled={readyIds.length === 0}
          title={readyIds.length === 0 ? "No draft is ready to launch" : undefined}
          aria-label={readyIds.length === 0 ? "Launch ready drafts" : `Launch ${readyIds.length} ready draft${readyIds.length === 1 ? "" : "s"}`}
          onClick={() => onLaunchAll(readyIds)}
        >
          {readyIds.length === 0 ? "Launch" : `Launch ${readyIds.length}`}
        </button>
      </div>
      {open && (
        <div
          className="plan-line__drafts"
          id={listId}
          onKeyDown={handleListKeyDown}
          onFocusCapture={(event) => {
            const index = rowButtons(rootRef.current).findIndex((button) => button === (event.target as EventTarget));
            if (index >= 0) focusedIndexRef.current = index;
          }}
        >
          <ul aria-label={`Drafts in ${name}`}>
            {drafts.map((draft) => (
              <DraftRow
                draft={draft}
                key={draft.id}
                needsYou={needsYouIds.has(draft.id)}
                onDiscard={onDiscard}
                onEdit={(sessionId) => {
                  setOpen(false);
                  onEdit(sessionId);
                }}
                onLaunch={onLaunch}
              />
            ))}
          </ul>
          <footer aria-hidden="true">↑↓ to move · Enter launches · Esc closes</footer>
        </div>
      )}
    </div>
  );
}

function DraftRow({
  draft,
  needsYou,
  onDiscard,
  onEdit,
  onLaunch,
}: {
  draft: SessionTile;
  needsYou: boolean;
  onDiscard: (sessionId: string) => void;
  onEdit: (sessionId: string) => void;
  onLaunch: (sessionId: string) => void;
}) {
  const checking = draft.stagedReviewStatus === "checking";
  const blockReason = draft.launchPreflight?.status === "blocked" ? draft.launchPreflight.reason : draft.safetyNote;
  const command = [draft.command ?? "", ...(draft.args ?? [])].join(" ").trim();
  const meta = [
    tileKindMeta(sessionTileKind(draft)).label,
    draft.isolation === "worktree" ? "isolated worktree" : null,
    draft.stagedReviewStatus === "edited" ? "edited" : null,
  ].filter(Boolean).join(" · ");

  return (
    <li className="plan-line__draft" aria-label={`Draft ${draft.title}`}>
      {needsYou ? <AlfredSignalGlyph className="plan-line__glyph signal" /> : checking ? <CheckingGlyph /> : <DraftGlyph />}
      <div className="plan-line__title">
        <strong>{draft.title}</strong>
        <span>{meta}</span>
      </div>
      {checking ? (
        <p className="plan-line__sub">Checking the edited command…</p>
      ) : blockReason ? (
        <p className="plan-line__sub signal" title={blockReason}>Blocked: {blockReason}</p>
      ) : (
        <p className="plan-line__sub" title={command}><code>{command || "(no command)"}</code></p>
      )}
      <div className="plan-line__actions">
        {blockReason && !checking ? (
          <button type="button" className="plan-line__button" data-plan-row onClick={() => onEdit(draft.id)}>
            Edit
          </button>
        ) : (
          <button
            type="button"
            className="plan-line__button"
            data-plan-row
            disabled={checking}
            aria-label={checking ? `Checking edited command: ${draft.title}` : `Launch ${draft.title}`}
            onClick={() => onLaunch(draft.id)}
          >
            Launch
          </button>
        )}
        <button
          type="button"
          className="plan-line__button quiet"
          aria-label={`Discard ${draft.title}`}
          onClick={() => onDiscard(draft.id)}
        >
          Discard
        </button>
      </div>
    </li>
  );
}

function DraftGlyph() {
  return (
    <svg className="plan-line__glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2.2" />
    </svg>
  );
}

function CheckingGlyph() {
  return (
    <svg className="plan-line__glyph checking" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="5.25" fill="none" stroke="var(--border-strong)" strokeWidth="1.5" />
      <path d="M8 2.75a5.25 5.25 0 0 1 5.25 5.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function rowButtons(root: HTMLElement | null): HTMLButtonElement[] {
  return root ? [...root.querySelectorAll<HTMLButtonElement>("[data-plan-row]:not(:disabled)")] : [];
}
