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
const OLDER_PHASE_INITIAL_LIMIT = 8;
const OLDER_PHASE_PAGE_SIZE = 24;

type DetailsState = {
  isOpen: boolean;
  runId: string;
};

type OlderPhasesState = DetailsState & {
  visibleLimit: number;
};

export function RunReader({ detail, now, onClose }: RunReaderProps) {
  const [expandedHighlight, setExpandedHighlight] = useState<StoryHighlight | null>(null);
  const [rawEventsState, setRawEventsState] = useState<DetailsState>(() => ({
    isOpen: false,
    runId: detail.id,
  }));
  const [olderPhasesState, setOlderPhasesState] = useState<OlderPhasesState>(() => ({
    isOpen: false,
    runId: detail.id,
    visibleLimit: OLDER_PHASE_INITIAL_LIMIT,
  }));
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const card = useMemo(() => buildRunCardVM(detail, now), [detail, now]);
  const story = useMemo(() => buildRunStoryVM(detail, now), [detail, now]);
  const phases = useMemo(() => buildRunPhases(detail.events), [detail.events]);
  const visibleRecentPhases = useMemo(() => takeRecentFirst(phases, phases.length - 1, RECENT_PHASE_LIMIT), [phases]);
  const olderPhaseCount = Math.max(phases.length - RECENT_PHASE_LIMIT, 0);
  const rawEventsOpen = rawEventsState.runId === detail.id && rawEventsState.isOpen;
  const olderPhasesOpen = olderPhasesState.runId === detail.id && olderPhasesState.isOpen;
  const olderPhaseVisibleLimit = olderPhasesOpen ? olderPhasesState.visibleLimit : OLDER_PHASE_INITIAL_LIMIT;
  const visibleOlderPhases = useMemo(
    () =>
      olderPhasesOpen
        ? takeRecentFirst(phases, phases.length - RECENT_PHASE_LIMIT - 1, olderPhaseVisibleLimit)
        : [],
    [olderPhaseVisibleLimit, olderPhasesOpen, phases],
  );
  const olderPhasesRemaining = Math.max(olderPhaseCount - visibleOlderPhases.length, 0);
  const nextOlderPhasePageSize = Math.min(OLDER_PHASE_PAGE_SIZE, olderPhasesRemaining);
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
        {olderPhaseCount > 0 ? (
          <details
            className="run-reader-overflow"
            open={olderPhasesOpen}
            onToggle={(event) => {
              const isOpen = event.currentTarget.open;
              setOlderPhasesState({
                isOpen,
                runId: detail.id,
                visibleLimit: OLDER_PHASE_INITIAL_LIMIT,
              });
            }}
          >
            <summary>
              {olderPhasesOpen
                ? `Showing ${visibleOlderPhases.length} of ${olderPhaseCount} older ${phaseNoun(olderPhaseCount)}`
                : `Show ${olderPhaseCount} older ${phaseNoun(olderPhaseCount)}`}
            </summary>
            <ol className="run-reader-phase-list">
              {visibleOlderPhases.map((phase) => (
                <RunReaderPhase phase={phase} key={phase.id} />
              ))}
            </ol>
            {olderPhasesRemaining > 0 ? (
              <button
                type="button"
                className="run-reader-show-more"
                onClick={() =>
                  setOlderPhasesState((state) => {
                    const currentVisibleLimit =
                      state.runId === detail.id && state.isOpen ? state.visibleLimit : OLDER_PHASE_INITIAL_LIMIT;

                    return {
                      isOpen: true,
                      runId: detail.id,
                      visibleLimit: Math.min(currentVisibleLimit + OLDER_PHASE_PAGE_SIZE, olderPhaseCount),
                    };
                  })
                }
              >
                Show {nextOlderPhasePageSize} more older {phaseNoun(nextOlderPhasePageSize)}
              </button>
            ) : null}
          </details>
        ) : null}
      </section>

      <details
        className="run-reader-raw"
        open={rawEventsOpen}
        onToggle={(event) =>
          setRawEventsState({
            isOpen: event.currentTarget.open,
            runId: detail.id,
          })
        }
      >
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

function takeRecentFirst(phases: RunPhaseVM[], startIndex: number, limit: number): RunPhaseVM[] {
  const visiblePhases: RunPhaseVM[] = [];

  for (let index = startIndex; index >= 0 && visiblePhases.length < limit; index -= 1) {
    const phase = phases[index];
    if (phase) visiblePhases.push(phase);
  }

  return visiblePhases;
}

function phaseNoun(count: number): string {
  return count === 1 ? "phase" : "phases";
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
