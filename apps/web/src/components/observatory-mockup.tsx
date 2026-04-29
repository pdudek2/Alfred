import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { CSSProperties } from "react";

import type { RunDetail, RunListItem } from "../lib/api-client";
import {
  buildActivityGroups,
  buildOverviewVM,
  buildRunCardVM,
  toRunDetailViewModel,
  type RunCardVM,
} from "../lib/run-view-model";
import { formatDateTime } from "../lib/time";
import { StatusPill } from "./status-pill";

type ObservatoryMockupProps = {
  autoRefresh: boolean;
  lastSyncedAt: string | null;
  loading: boolean;
  onRefresh(): void;
  onSelectRun(runId: string): void;
  onToggleLive(): void;
  runs: RunListItem[];
  selectedRun: RunDetail | RunListItem | null;
  selectedRunId: string | null;
};

type ConstellationNode = {
  run: RunCardVM;
  x: number;
  y: number;
  weight: number;
};

export function ObservatoryMockup({
  autoRefresh,
  lastSyncedAt,
  loading,
  onRefresh,
  onSelectRun,
  onToggleLive,
  runs,
  selectedRun,
  selectedRunId,
}: ObservatoryMockupProps) {
  const cards = runs.map((run) => buildRunCardVM(run));
  const overview = buildOverviewVM(runs);
  const selected = selectedRun ? toRunDetailViewModel(selectedRun) : null;
  const selectedCard = cards.find((run) => run.id === selectedRunId) ?? cards[0] ?? null;
  const nodes = buildNodes(cards);
  const focusRuns = cards
    .filter((run) => run.needsAttention || run.isLive || run.status === "stale")
    .slice(0, 7);
  const completedRuns = cards.filter((run) => run.isDone).slice(0, 3);
  const eventGroups = selectedRun && "events" in selectedRun ? buildActivityGroups(selectedRun.events) : [];
  const toolGroup = eventGroups.find((group) => group.kind === "tool");
  const failureGroup = eventGroups.find((group) => group.kind === "failure");
  const waitingGroup = eventGroups.find((group) => group.kind === "waiting");

  return (
    <main className="mockup-shell">
      <header className="mockup-topline">
        <div className="mockup-brand">
          <span className="mockup-brand-mark" aria-hidden="true">
            A
          </span>
          <div>
            <p>Agent observatory</p>
            <h1>Alfred</h1>
          </div>
        </div>

        <div className="mockup-actions">
          <div className="mockup-sync" aria-label="Sync state">
            <span className={`mockup-live-light ${autoRefresh ? "is-live" : ""}`} aria-hidden="true" />
            <span>{autoRefresh ? "Live watch" : "Paused"}</span>
            <span>{lastSyncedAt ? formatDateTime(lastSyncedAt) : "not synced"}</span>
          </div>
          <button className="mockup-action" onClick={onToggleLive} type="button">
            {autoRefresh ? <Pause aria-hidden="true" size={16} /> : <Play aria-hidden="true" size={16} />}
            {autoRefresh ? "Pause" : "Resume"}
          </button>
          <button className="mockup-icon-action" disabled={loading} onClick={onRefresh} type="button" aria-label="Refresh runs">
            <RefreshCw aria-hidden="true" size={18} />
          </button>
        </div>
      </header>

      <section className="mockup-command">
        <aside className="mockup-brief" aria-label="Run brief">
          <div className="mockup-brief-line">
            <Sparkles aria-hidden="true" size={16} />
            <span>{stateLine(overview)}</span>
          </div>

          <div className="mockup-metrics">
            <Metric value={overview.needsAttentionCount} label="Needs you" tone="amber" />
            <Metric value={overview.liveCount} label="Live" tone="cyan" />
            <Metric value={overview.doneCount} label="Done" tone="green" />
            <Metric value={overview.totalCount} label="Known" tone="paper" />
          </div>

          <div className="mockup-queue">
            <p className="mockup-section-label">Attention field</p>
            {focusRuns.length === 0 ? (
              <div className="mockup-empty-note">No active pressure. The archive is quiet.</div>
            ) : (
              focusRuns.map((run) => (
                <button
                  aria-current={run.id === selectedRunId ? "true" : undefined}
                  className="mockup-queue-row"
                  key={run.id}
                  onClick={() => onSelectRun(run.id)}
                  type="button"
                >
                  <span className={`mockup-status-dot status-${run.status}`} aria-hidden="true" />
                  <span>
                    <strong>{run.projectLabel}</strong>
                    <small>{run.sourceLabel}</small>
                  </span>
                  <StatusPill status={run.status} />
                </button>
              ))
            )}
          </div>

          <div className="mockup-queue mockup-queue-muted">
            <p className="mockup-section-label">Recent closure</p>
            {completedRuns.map((run) => (
              <button
                aria-current={run.id === selectedRunId ? "true" : undefined}
                className="mockup-queue-row"
                key={run.id}
                onClick={() => onSelectRun(run.id)}
                type="button"
              >
                <CheckCircle2 aria-hidden="true" size={15} />
                <span>
                  <strong>{run.projectLabel}</strong>
                  <small>{run.durationLabel}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="mockup-sky" aria-label="Live agent constellation">
          <div className="mockup-sky-header">
            <div>
              <p>Living map</p>
              <h2>Sessions as a field, not a table</h2>
            </div>
            <span>{runs.length} signals</span>
          </div>

          <div className="constellation-stage">
            <svg className="constellation-lines" viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">
              {nodes.map((node) => (
                <line
                  className={`constellation-line line-${node.run.status}`}
                  key={node.run.id}
                  x1="50"
                  x2={node.x}
                  y1="52"
                  y2={node.y}
                />
              ))}
            </svg>
            <div className="constellation-core">
              <span>Alfred</span>
              <strong>{overview.liveCount + overview.needsAttentionCount}</strong>
            </div>
            {nodes.map((node) => (
              <button
                aria-label={`${node.run.projectLabel} ${node.run.status}`}
                aria-current={node.run.id === selectedRunId ? "true" : undefined}
                className={`constellation-node node-${node.run.status}`}
                key={node.run.id}
                onClick={() => onSelectRun(node.run.id)}
                style={
                  {
                    "--node-x": `${node.x}%`,
                    "--node-y": `${node.y}%`,
                    "--node-size": `${node.weight}px`,
                  } as CSSProperties
                }
                type="button"
              >
                <span>{initials(node.run.projectLabel)}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="mockup-reader" aria-label="Selected run reader">
          {selected ? (
            <>
              <header className="mockup-reader-head">
                <p>{selected.source}</p>
                <h2>{selected.title}</h2>
                <span>{selected.subtitle}</span>
                <StatusPill status={selected.status} />
              </header>

              <div className="mockup-reader-state">
                {statusIcon(selected.status)}
                <div>
                  <strong>{readerHeadline(selected.status)}</strong>
                  <p>{readerCopy(selected.status)}</p>
                </div>
              </div>

              <dl className="mockup-facts">
                <div>
                  <dt>Started</dt>
                  <dd>{selected.startedAt}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{selected.duration}</dd>
                </div>
                <div>
                  <dt>Tools</dt>
                  <dd>{toolGroup?.count ?? 0}</dd>
                </div>
                <div>
                  <dt>Interruptions</dt>
                  <dd>{(failureGroup?.count ?? 0) + (waitingGroup?.count ?? 0)}</dd>
                </div>
              </dl>

              <div className="mockup-story">
                <p className="mockup-section-label">Session story</p>
                {eventGroups.length === 0 ? (
                  <div className="mockup-empty-note">No event detail loaded yet.</div>
                ) : (
                  eventGroups.slice(0, 4).map((group) => (
                    <div className={`mockup-story-row story-${group.kind}`} key={group.kind}>
                      <span>{group.count}</span>
                      <div>
                        <strong>{storyTitle(group.kind)}</strong>
                        <small>{group.label}</small>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="mockup-reader-empty">Select a signal from the field.</div>
          )}
        </aside>
      </section>
    </main>
  );
}

function Metric({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className={`mockup-metric metric-${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function buildNodes(cards: RunCardVM[]): ConstellationNode[] {
  const visible = cards.slice(0, 28);
  const total = Math.max(visible.length, 1);

  return visible.map((run, index) => {
    const ring = index < 8 ? 0 : 1;
    const ringIndex = ring === 0 ? index : index - 8;
    const ringTotal = ring === 0 ? Math.min(total, 8) : Math.max(total - 8, 1);
    const angle = -Math.PI / 2 + (ringIndex / ringTotal) * Math.PI * 2 + (ring === 1 ? 0.18 : 0);
    const radiusX = ring === 0 ? 27 : 42;
    const radiusY = ring === 0 ? 25 : 37;
    const x = 50 + Math.cos(angle) * radiusX;
    const y = 52 + Math.sin(angle) * radiusY;
    const weight = run.needsAttention ? 48 : run.isLive ? 44 : run.isDone ? 36 : 32;

    return {
      run,
      x: clamp(x, 10, 90),
      y: clamp(y, 12, 88),
      weight,
    };
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function initials(label: string) {
  const words = label.split(/[\s_-]+/).filter(Boolean);
  return (words[0]?.[0] ?? "A").toUpperCase() + (words[1]?.[0] ?? "").toUpperCase();
}

function stateLine(overview: ReturnType<typeof buildOverviewVM>) {
  if (overview.needsAttentionCount > 0) {
    return `${overview.needsAttentionCount} sessions need you. Alfred is holding the room.`;
  }
  if (overview.liveCount > 0) {
    return `${overview.liveCount} live sessions are moving. No intervention requested.`;
  }
  return `All quiet. ${overview.doneCount} runs closed, ${overview.totalCount - overview.doneCount} resting in memory.`;
}

function statusIcon(status: string) {
  if (status === "failed" || status === "waiting") return <AlertTriangle aria-hidden="true" size={20} />;
  if (status === "completed") return <CheckCircle2 aria-hidden="true" size={20} />;
  if (status === "running") return <Activity aria-hidden="true" size={20} />;
  return <Clock3 aria-hidden="true" size={20} />;
}

function readerHeadline(status: string) {
  if (status === "completed") return "Closed cleanly";
  if (status === "running") return "Still in motion";
  if (status === "waiting") return "Waiting on you";
  if (status === "failed") return "Interrupted";
  if (status === "stale") return "Quiet, probably abandoned";
  return "Unclassified signal";
}

function readerCopy(status: string) {
  if (status === "completed") return "This session reached a terminal successful state.";
  if (status === "running") return "Fresh activity is still arriving during live refresh.";
  if (status === "waiting") return "The agent may need approval, context, or an outside decision.";
  if (status === "failed") return "Something broke. The failure group should be the first place to inspect.";
  if (status === "stale") return "No fresh activity for a while. Alfred keeps it visible, but out of the live field.";
  return "Alfred has captured the run but cannot confidently classify it yet.";
}

function storyTitle(kind: ReturnType<typeof buildActivityGroups>[number]["kind"]) {
  if (kind === "failure") return "Friction";
  if (kind === "waiting") return "Human gate";
  if (kind === "tool") return "Work performed";
  if (kind === "run") return "Lifecycle";
  return "Trace";
}
