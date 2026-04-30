import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { RunDetail, RunEventItem } from "../lib/api-client";
import { buildRunStoryVM, type StoryHighlight } from "../lib/run-story";
import { buildRunCardVM } from "../lib/run-view-model";
import { formatDateTime } from "../lib/time";
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

export function RunReader({ detail, now, onClose }: RunReaderProps) {
  const [expandedHighlight, setExpandedHighlight] = useState<StoryHighlight | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const card = useMemo(() => buildRunCardVM(detail, now), [detail, now]);
  const story = useMemo(() => buildRunStoryVM(detail, now), [detail, now]);
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
          <h3>Activity</h3>
          <span>{detail.events.length}</span>
        </header>
        <ol className="run-reader-event-list">
          {detail.events.slice(0, 12).map((event) => (
            <RunReaderEvent event={event} key={event.id} />
          ))}
        </ol>
        {detail.events.length > 12 ? (
          <details className="run-reader-overflow">
            <summary>Show {detail.events.length - 12} older</summary>
            <ol className="run-reader-event-list">
              {detail.events.slice(12).map((event) => (
                <RunReaderEvent event={event} key={event.id} />
              ))}
            </ol>
          </details>
        ) : null}
      </section>

      <details className="run-reader-raw">
        <summary>‹ raw events</summary>
        <div className="run-reader-raw-list">
          {detail.events.map((event) => (
            <EventPayload key={event.id} payload={event.payload} />
          ))}
        </div>
      </details>
    </aside>
  );

  function trapFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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

function RunReaderEvent({ event }: { event: RunEventItem }) {
  return (
    <li className="run-reader-event">
      <time className="run-reader-event-time" dateTime={event.occurred_at}>
        {formatDateTime(event.occurred_at)}
      </time>
      <span className="run-reader-event-line">{eventLine(event)}</span>
    </li>
  );
}

function eventLine(event: RunEventItem): string {
  const type = event.type.toLowerCase();
  const toolName = readString(event.payload.tool_name) ?? readString(event.payload.toolName) ?? readString(event.payload.name);
  const toolLabel = toolName ? humanizeToolName(toolName) : "Tool";

  if (type === "run.started") return "Session opened";
  if (type === "run.completed" || type === "run.finished") return "Session closed";
  if (type === "run.failed") return "Session interrupted";
  if (type === "tool.started") return `${toolLabel} started`;
  if (type === "tool.completed" || type === "tool.finished") return `${toolLabel} finished`;
  if (type === "tool.failed") return `${toolLabel} failed`;
  if (type.includes("approval") || type.includes("waiting")) return "Waiting on you";

  return event.type;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function humanizeToolName(value: string): string {
  if (value === "exec_command" || value === "Bash") return "Command";
  if (value === "Read") return "Read";
  if (value === "Edit" || value === "MultiEdit") return "Edit";
  if (value === "Write") return "Write";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
