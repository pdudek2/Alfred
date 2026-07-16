import { ChevronRight } from "lucide-react";
import type { AttentionProjection } from "../attention-projection";
import { sessionAgeLabel, sessionAgeTitle } from "../session-time";
import { AlfredSignalGlyph } from "./AlfredSignalGlyph";

export type InboxDecisionItemProps = {
  item: AttentionProjection;
  selected: boolean;
  onSelect: (id: string) => void;
  onRunPrimaryAction: (item: AttentionProjection) => void;
};

export function InboxDecisionItem({
  item,
  selected,
  onSelect,
  onRunPrimaryAction,
}: InboxDecisionItemProps) {
  const detailId = `inbox-decision-detail-${encodeURIComponent(item.id)}`;
  const actionLabel = attentionActionLabel(item);
  const kindLabel = attentionKindLabel(item);
  const ageLabel = sessionAgeLabel(item.attentionAt);
  const fullAccessibleName = `${kindLabel}: ${item.sessionTitle}, project ${item.workspaceLabel}, session ${item.sessionId}, ${item.provenance}, action ${actionLabel}`;

  return (
    <li
      className={`inbox-docket__item inbox-docket__item--${item.kind}`}
      aria-expanded={selected}
      data-testid={`inbox-decision-${item.id}`}
    >
      <button
        type="button"
        className="inbox-docket__item-row"
        aria-controls={detailId}
        aria-current={selected ? "true" : undefined}
        aria-describedby={selected ? detailId : undefined}
        aria-expanded={selected}
        aria-label={fullAccessibleName}
        data-attention-id={item.id}
        data-testid={`inbox-decision-select-${item.id}`}
        onClick={() => onSelect(item.id)}
        tabIndex={selected ? 0 : -1}
      >
        <span
          className={`inbox-docket__glyph inbox-docket__glyph--${glyphTone(item)}`}
          role="img"
          aria-label={kindLabel}
        >
          <AttentionGlyph item={item} />
        </span>
        <span className="inbox-docket__item-copy">
          <strong>{item.sessionTitle}</strong>
          <small>{item.sessionId} · {item.workspaceLabel}</small>
        </span>
        {item.attentionAt !== undefined && ageLabel && (
          <time dateTime={new Date(item.attentionAt).toISOString()} title={sessionAgeTitle(item.attentionAt)}>
            {ageLabel}
          </time>
        )}
        <span className="inbox-docket__disclosure" aria-hidden="true">
          <ChevronRight size={12} />
        </span>
      </button>

      <div
        className="inbox-docket__detail"
        id={detailId}
        aria-hidden={selected ? undefined : "true"}
        inert={!selected || undefined}
      >
        <div className="inbox-docket__detail-clip">
          <div className="inbox-docket__detail-grid">
            <div className="inbox-docket__detail-main">
              <h3>{detailHeading(item)}</h3>
              {item.command ? (
                <code title={item.command}>{item.command}</code>
              ) : (
                <blockquote title={item.reason}>{item.reason}</blockquote>
              )}
              {item.command && <p title={item.reason}>{item.reason}</p>}
              <button
                type="button"
                className="inbox-docket__primary"
                aria-label={`${actionLabel} ${item.sessionTitle} in ${item.workspaceLabel}`}
                onClick={() => onRunPrimaryAction(item)}
              >
                {actionLabel}
              </button>
            </div>
            <dl className="inbox-docket__facts">
              <Fact label="Project" value={item.workspaceLabel} />
              <Fact label="Session" value={item.sessionTitle} />
              {ageLabel && <Fact label="Received" value={`${ageLabel} ago`} technical />}
              <Fact label="Provenance" value={item.provenance} technical />
              <div className={`inbox-docket__state inbox-docket__state--${glyphTone(item)}`}>
                <dt className="visually-hidden">State</dt>
                <dd>{attentionStateLabel(item)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </li>
  );
}

function Fact({ label, value, technical = false }: { label: string; value: string; technical?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={technical ? "inbox-docket__technical" : undefined} title={value}>{value}</dd>
    </div>
  );
}

export function attentionActionLabel(item: AttentionProjection): string {
  switch (item.action.kind) {
    case "open-in-work":
      return "Open in Work";
    case "launch":
      return "Launch";
    case "review-edit":
      return "Review / Edit";
    case "resume":
      return "Resume";
    case "relaunch":
      return item.action.confirmation === "required" ? "Review relaunch" : "Relaunch";
  }
}

function detailHeading(item: AttentionProjection): string {
  switch (item.kind) {
    case "blocked-safety":
      return "Why launch is blocked";
    case "agent-waiting":
      return "Latest signal";
    case "staged-launch":
      return "Staged command";
    case "recovery":
      return "Recovery";
  }
}

function attentionKindLabel(item: AttentionProjection): string {
  switch (item.kind) {
    case "blocked-safety":
      return "Safety review";
    case "agent-waiting":
      return "Agent waiting";
    case "staged-launch":
      return "Staged launch";
    case "recovery":
      return "Recovery";
  }
}

function attentionStateLabel(item: AttentionProjection): string {
  switch (item.kind) {
    case "blocked-safety":
      return "Blocked · safety";
    case "agent-waiting":
      return "Needs response · inferred";
    case "staged-launch":
      return "Staged · structured";
    case "recovery":
      return "Recovery · runtime";
  }
}

function glyphTone(item: AttentionProjection): "blocked" | "waiting" | "staged" | "recovery" {
  switch (item.kind) {
    case "blocked-safety":
      return "blocked";
    case "agent-waiting":
      return "waiting";
    case "staged-launch":
      return "staged";
    case "recovery":
      return "recovery";
  }
}

function AttentionGlyph({ item }: { item: AttentionProjection }) {
  switch (item.kind) {
    case "blocked-safety":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 3 20 7v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7zM8 16l8-8" />
        </svg>
      );
    case "agent-waiting":
      return <AlfredSignalGlyph />;
    case "staged-launch":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M5 7h14v12H5zM8 4h8v3M9 11l-2 2 2 2M15 11l2 2-2 2" />
        </svg>
      );
    case "recovery":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="m9 6-5 5 5 5M5 11h8a6 6 0 1 1 0 12" />
        </svg>
      );
  }
}
