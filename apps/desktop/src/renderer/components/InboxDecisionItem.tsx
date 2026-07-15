import { AlertTriangle, ArrowRight, Play, RotateCcw } from "lucide-react";
import type { AttentionProjection } from "../attention-projection";
import { sessionAgeLabel, sessionAgeTitle } from "../session-time";

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
  const ageLabel = sessionAgeLabel(item.attentionAt);

  return (
    <li
      className={`review-surface-item tone-${item.kind}${selected ? " selected" : ""}`}
      data-testid={`inbox-decision-${item.id}`}
    >
      <button
        type="button"
        className="review-surface-item-main"
        aria-controls={detailId}
        aria-current={selected ? "true" : undefined}
        aria-describedby={selected ? detailId : undefined}
        aria-expanded={selected}
        aria-label={`Open ${item.sessionTitle} in ${item.workspaceLabel}`}
        data-attention-id={item.id}
        data-testid={`inbox-decision-select-${item.id}`}
        onClick={() => onSelect(item.id)}
        tabIndex={selected ? 0 : -1}
      >
        <span className="review-surface-workspace" role="img" aria-label={attentionKindLabel(item)}>
          <AttentionGlyph item={item} />
        </span>
        <span className="review-surface-copy">
          <strong>{item.sessionTitle}</strong>
          <small>{item.workspaceLabel} · {item.sessionId} · {item.provenance}</small>
        </span>
        {ageLabel && (
          <time dateTime={new Date(item.attentionAt).toISOString()} title={sessionAgeTitle(item.attentionAt)}>
            {ageLabel}
          </time>
        )}
        <ArrowRight aria-hidden="true" size={15} />
      </button>

      {selected && (
        <div className="review-surface-note" id={detailId}>
          <p title={item.reason}>{item.reason}</p>
          {item.command && (
            <div className="review-surface-command">
              <span>Command</span>
              <code title={item.command}>{item.command}</code>
            </div>
          )}
          <small>{attentionKindLabel(item)} · {item.provenance}</small>
          <button
            type="button"
            className={`review-surface-primary action-${item.kind}`}
            aria-label={`${actionLabel} ${item.sessionTitle} in ${item.workspaceLabel}`}
            onClick={() => onRunPrimaryAction(item)}
          >
            <ActionGlyph item={item} />
            <span>{actionLabel}</span>
          </button>
        </div>
      )}
    </li>
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

function AttentionGlyph({ item }: { item: AttentionProjection }) {
  switch (item.kind) {
    case "blocked-safety":
      return <AlertTriangle aria-hidden="true" size={14} />;
    case "agent-waiting":
      return <ArrowRight aria-hidden="true" size={14} />;
    case "staged-launch":
      return <Play aria-hidden="true" size={14} />;
    case "recovery":
      return <RotateCcw aria-hidden="true" size={14} />;
  }
}

function ActionGlyph({ item }: { item: AttentionProjection }) {
  switch (item.action.kind) {
    case "open-in-work":
    case "review-edit":
      return <ArrowRight aria-hidden="true" size={14} />;
    case "launch":
      return <Play aria-hidden="true" size={14} />;
    case "resume":
    case "relaunch":
      return <RotateCcw aria-hidden="true" size={14} />;
  }
}
