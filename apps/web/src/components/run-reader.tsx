import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { RunDetail } from "../lib/api-client";
import { buildRunPhases, type RunPhaseVM } from "../lib/run-phases";
import { buildRunStoryVM, type StoryHighlight } from "../lib/run-story";
import { buildRunCardVM } from "../lib/run-view-model";
import { useKeyboardShortcut } from "../lib/use-keyboard-shortcut";
import { EventPayload } from "./event-payload";
import { RunStory } from "./run-story";

type RunReaderProps = {
  detail: RunDetail;
  now: Date;
  onClose: () => void;
};

const STATE_LABEL: Record<string, string> = {
  cancelled: "cancelled",
  completed: "ok",
  failed: "failed",
  running: "running",
  stale: "stale",
  waiting: "needs you",
};

const RECENT_PHASE_LIMIT = 8;
const OLDER_PHASE_PREVIEW_LIMIT = 8;

export function RunReader({ detail, now, onClose }: RunReaderProps) {
  const [expandedHighlight, setExpandedHighlight] = useState<StoryHighlight | null>(null);
  const [rawEventsOpen, setRawEventsOpen] = useState(false);
  const [olderPhasesOpen, setOlderPhasesOpen] = useState(false);
  const [allOlderPhasesOpen, setAllOlderPhasesOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const card = useMemo(() => buildRunCardVM(detail, now), [detail, now]);
  const story = useMemo(() => buildRunStoryVM(detail, now), [detail, now]);
  const phases = useMemo(() => buildRunPhases(detail.events), [detail.events]);
  const recentPhases = useMemo(() => [...phases].reverse(), [phases]);
  const visibleRecentPhases = recentPhases.slice(0, RECENT_PHASE_LIMIT);
  const olderPhases = recentPhases.slice(RECENT_PHASE_LIMIT);
  const visibleOlderPhases = olderPhasesOpen
    ? olderPhases.slice(0, allOlderPhasesOpen ? olderPhases.length : OLDER_PHASE_PREVIEW_LIMIT)
    : [];
  const highlightedEvent = expandedHighlight?.payload.eventId
    ? detail.events.find((event) => event.id === expandedHighlight.payload.eventId)
    : null;

  useKeyboardShortcut("escape", onClose);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    return () => {
      restoreFocusRef.current?.focus();
    };
  }, []);

  return (
    <aside
      className="run-reader"
      role="dialog"
      aria-modal="true"
      aria-labelledby="run-reader-title"
      aria-describedby="run-reader-subtitle"
      onKeyDown={trapFocus}
      ref={dialogRef}
    >
      <header className="run-reader-header">
        <div className="run-reader-titles">
          <p className="run-reader-kicker">{card.sourceLabel}</p>
          <h2 id="run-reader-title">{card.headline}</h2>
          <p className="run-reader-subtitle" id="run-reader-subtitle">
            {card.sourceLabel} · {STATE_LABEL[card.status] ?? card.status} · {card.durationLabel}
          </p>
        </div>
        <button
          type="button"
          className="run-reader-close"
          aria-label="Close run reader"
          onClick={onClose}
          ref={closeButtonRef}
        >
          esc
        </button>
      </header>

      <section className="run-reader-story" aria-label="Run story">
        <RunStory vm={story} onHighlightClick={setExpandedHighlight} />
        {highlightedEvent ? (
          <div className="run-reader-highlight-payload">
            <p>Story highlight payload</p>
            <EventPayload payload={highlightedEvent.payload} />
          </div>
        ) : null}
      </section>

      <section className="run-reader-activity" aria-label="Activity">
        <header className="run-reader-section-header">
          <h3>Recent phases</h3>
          <span>{phases.length} phases · {detail.events.length} events</span>
        </header>
        <ol className="run-reader-phase-list">
          {visibleRecentPhases.map((phase) => (
            <RunReaderPhase phase={phase} key={phase.id} />
          ))}
        </ol>
        {olderPhases.length > 0 ? (
          <details
            className="run-reader-overflow"
            onToggle={(event) => {
              setOlderPhasesOpen(event.currentTarget.open);
              if (!event.currentTarget.open) setAllOlderPhasesOpen(false);
            }}
          >
            <summary onClick={() => setOlderPhasesOpen(true)}>
              Show {olderPhases.length} older phases
            </summary>
            <ol className="run-reader-phase-list">
              {visibleOlderPhases.map((phase) => (
                <RunReaderPhase phase={phase} key={phase.id} />
              ))}
            </ol>
            {!allOlderPhasesOpen && olderPhases.length > OLDER_PHASE_PREVIEW_LIMIT ? (
              <button
                type="button"
                className="run-reader-show-all"
                onClick={() => setAllOlderPhasesOpen(true)}
              >
                Show all {olderPhases.length} older phases
              </button>
            ) : null}
          </details>
        ) : null}
      </section>

      <details className="run-reader-raw" onToggle={(event) => setRawEventsOpen(event.currentTarget.open)}>
        <summary>‹ raw events</summary>
        {rawEventsOpen ? (
          <div className="run-reader-raw-list">
            {detail.events.map((event) => (
              <EventPayload key={event.id} payload={event.payload} />
            ))}
          </div>
        ) : null}
      </details>
    </aside>
  );

  function trapFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, summary, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const items = focusable ? Array.from(focusable).filter((item) => !item.hasAttribute("disabled")) : [];
    if (items.length === 0) return;

    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function RunReaderPhase({ phase }: { phase: RunPhaseVM }) {
  return (
    <li className={`run-reader-phase run-reader-phase-${phase.kind}`}>
      <time className="run-reader-phase-time" dateTime={phase.startedAt}>
        {phase.startedAtLabel}
      </time>
      <span className="run-reader-phase-body">
        <span className="run-reader-phase-title">{phase.title}</span>
        <span className="run-reader-phase-summary">{phase.summary}</span>
        <span className="run-reader-phase-events">
          {phase.events.slice(0, 3).map((event) => (
            <span className="run-reader-phase-event" key={event.id}>{event.label}</span>
          ))}
          {phase.events.length > 3 ? (
            <span className="run-reader-phase-event run-reader-phase-event-muted">
              +{phase.events.length - 3} more
            </span>
          ) : null}
        </span>
      </span>
    </li>
  );
}
