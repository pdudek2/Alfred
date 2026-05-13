import type { RunCardVM } from "../lib/run-view-model";
import { normalizeStatus } from "../lib/status";

type RunRowProps = {
  card: RunCardVM;
  subtitle: string;
  selected: boolean;
  onSelect: (runId: string) => void;
};

const STATE_CLASS_KEYS = new Set(["running", "waiting", "failed", "completed", "stale", "cancelled"]);

export function RunRow({ card, subtitle, selected, onSelect }: RunRowProps) {
  const stateKey = stateClassKey(card.status);
  const label = stateLabel(card.status);
  const className = [
    "reader-run-row",
    `reader-state-${stateKey}`,
    selected ? "reader-run-row--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={className}
      onClick={() => onSelect(card.id)}
      type="button"
    >
      <span className="reader-run-row__dot" aria-hidden="true" />
      <span className="reader-run-row__body">
        <span className="reader-run-row__title">{card.headline}</span>
        <span className="reader-run-row__subtitle">{subtitle}</span>
      </span>
      <span className="reader-run-row__meta">
        <span className="reader-run-row__duration">{card.durationLabel}</span>
        <span className="reader-run-row__state">{label}</span>
      </span>
    </button>
  );
}

function stateLabel(status: string): string {
  const normalized = normalizeStatus(status, "other");
  if (normalized === "waiting") return "needs you";
  if (normalized === "completed") return "ok";
  if (normalized === "cancelled") return "cancelled";
  return normalized;
}

function stateClassKey(status: string): string {
  const normalized = normalizeStatus(status, "other");
  return STATE_CLASS_KEYS.has(normalized) ? normalized : "other";
}
