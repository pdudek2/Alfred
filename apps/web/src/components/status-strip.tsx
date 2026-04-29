import type { RunListItem } from "../lib/api-client";
import { buildOverviewVM, buildRunCardVM } from "../lib/run-view-model";

type StatusStripProps = {
  runs: RunListItem[];
  selectedRunId: string | null;
  onSelectRun(runId: string): void;
};

const SUMMARY_CELLS = [
  { key: "needsAttentionCount", label: "Needs you", className: "needs" },
  { key: "liveCount", label: "Live", className: "live" },
  { key: "doneCount", label: "Done", className: "done" },
] as const;

export function StatusStrip({ runs, selectedRunId, onSelectRun }: StatusStripProps) {
  const overview = buildOverviewVM(runs);
  const liveRuns = runs.map((run) => buildRunCardVM(run)).filter((run) => run.isLive);
  const visibleLiveRuns = liveRuns.slice(0, 6);
  const hiddenLiveRunCount = Math.max(0, liveRuns.length - visibleLiveRuns.length);

  return (
    <section className="status-strip" aria-label="Run summary" aria-live="polite">
      <div className="status-strip-cells">
        {SUMMARY_CELLS.map((cell) => (
          <div className={`status-cell status-cell-${cell.className}`} key={cell.key}>
            <strong>{overview[cell.key]}</strong>
            <span>{cell.label}</span>
          </div>
        ))}
        <div className="status-cell status-cell-total">
          <strong>{overview.totalCount}</strong>
          <span>Loaded</span>
        </div>
      </div>

      <div className="live-run-strip" aria-label="Live runs">
        {visibleLiveRuns.length === 0 ? (
          <span className="live-run-empty">All quiet. No live sessions need attention.</span>
        ) : (
          <>
            {visibleLiveRuns.map((run) => (
              <button
                aria-current={run.id === selectedRunId ? "true" : undefined}
                className="live-run-chip"
                key={run.id}
                onClick={() => onSelectRun(run.id)}
                type="button"
              >
                <span className={`live-run-dot live-run-dot-${run.status}`} aria-hidden="true" />
                <span>{run.projectLabel}</span>
                <small>{run.sourceLabel}</small>
              </button>
            ))}
            {hiddenLiveRunCount > 0 ? <span className="live-run-more">+{hiddenLiveRunCount} more live</span> : null}
          </>
        )}
      </div>
    </section>
  );
}
