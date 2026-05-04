import { useMemo, useState } from "react";

import type { RunListItem } from "../lib/api-client";
import { computeObservatoryLayout } from "../lib/observatory-layout";
import { buildRunCardVM } from "../lib/run-view-model";

type ObservatoryProps = {
  now: Date;
  onSelectRun: (runId: string) => void;
  runs: RunListItem[];
};

type Scope = "today" | "7d" | "30d" | "all";

const SCOPE_LABELS: Array<{ id: Scope; label: string }> = [
  { id: "today", label: "today" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "all", label: "all" },
];

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const VIEWPORT = { width: 1200, height: 720 };

export function Observatory({ runs, now, onSelectRun }: ObservatoryProps) {
  const [scope, setScope] = useState<Scope>("7d");
  const visibleRuns = useMemo(() => filterByScope(runs, scope, now), [runs, scope, now]);
  const observatoryRuns = useMemo(
    () => visibleRuns.map((run) => ({ ...run, status: buildRunCardVM(run, now).status })),
    [visibleRuns, now],
  );
  const layout = useMemo(() => computeObservatoryLayout(observatoryRuns, VIEWPORT), [observatoryRuns]);

  return (
    <section className="observatory" aria-label="Agent observatory">
      <header className="observatory-head">
        <div>
          <h2>{scopeTitle(scope)}</h2>
          <p className="observatory-subtitle">
            {layout.clusters.length} projects, {visibleRuns.length} signals
          </p>
        </div>
      </header>

      <svg
        aria-label="Observatory star map"
        className="observatory-canvas"
        preserveAspectRatio="xMidYMid meet"
        role="group"
        viewBox={`0 0 ${VIEWPORT.width} ${VIEWPORT.height}`}
      >
        <defs>
          <radialGradient id="observatory-live-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#88a87a" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#88a87a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="observatory-amber-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#d4a64a" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#d4a64a" stopOpacity="0" />
          </radialGradient>
        </defs>

        {layout.clusters.map((cluster) => (
          <g key={cluster.label} data-cluster-label={cluster.label}>
            <ellipse
              className="observatory-cluster"
              cx={cluster.center.x}
              cy={cluster.center.y}
              rx={cluster.radius}
              ry={cluster.radius * 0.78}
            />
            <text
              className="observatory-cluster-label"
              textAnchor="middle"
              x={cluster.center.x}
              y={cluster.center.y - cluster.radius - 12}
            >
              {cluster.label}
            </text>
          </g>
        ))}

        {layout.edges.map((edge, index) => (
          <line
            className={edge.crossCluster ? "observatory-edge observatory-edge-cross" : "observatory-edge"}
            key={`edge-${index}`}
            x1={edge.from.x}
            x2={edge.to.x}
            y1={edge.from.y}
            y2={edge.to.y}
          />
        ))}

        {layout.clusters.flatMap((cluster) =>
          [...cluster.nodes].sort(compareNodeLayer).map((node) => {
            const halo = haloFor(node.status);
            return (
              <g
                aria-label={`Open ${node.projectLabel} ${statusLabel(node.status)} run`}
                className="observatory-node"
                data-node-run-id={node.runId}
                key={node.runId}
                onClick={() => onSelectRun(node.runId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectRun(node.runId);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <title>{node.projectLabel} · {node.status}</title>
                {halo ? (
                  <circle
                    className={halo.className}
                    cx={node.position.x}
                    cy={node.position.y}
                    r={halo.radius}
                  />
                ) : null}
                <circle
                  className={`observatory-dot observatory-dot-${stateClass(node.status)}`}
                  cx={node.position.x}
                  cy={node.position.y}
                  r={radiusFor(node.status)}
                />
                <circle
                  className="observatory-hit-target"
                  cx={node.position.x}
                  cy={node.position.y}
                  r={10}
                />
              </g>
            );
          }),
        )}
      </svg>

      <div aria-label="Time scope" className="observatory-scope" role="group">
        {SCOPE_LABELS.map((entry) => (
          <button
            aria-pressed={scope === entry.id}
            className={scope === entry.id ? "observatory-scope-pill observatory-scope-pill-active" : "observatory-scope-pill"}
            key={entry.id}
            onClick={() => setScope(entry.id)}
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div aria-label="Signal legend" className="observatory-legend">
        <span className="observatory-legend-key">
          <span className="observatory-legend-dot observatory-legend-dot-live" aria-hidden="true" />
          live
        </span>
        <span className="observatory-legend-key">
          <span className="observatory-legend-dot observatory-legend-dot-waiting" aria-hidden="true" />
          needs you
        </span>
        <span className="observatory-legend-key">
          <span className="observatory-legend-dot observatory-legend-dot-failed" aria-hidden="true" />
          failed
        </span>
        <span className="observatory-legend-key">
          <span className="observatory-legend-dot observatory-legend-dot-quiet" aria-hidden="true" />
          quiet
        </span>
      </div>
    </section>
  );
}

function filterByScope(runs: RunListItem[], scope: Scope, now: Date): RunListItem[] {
  if (scope === "all") return runs;

  const cutoff =
    scope === "today"
      ? startOfLocalDay(now).getTime()
      : now.getTime() - (scope === "7d" ? 7 * ONE_DAY_MS : 30 * ONE_DAY_MS);

  return runs.filter((run) => {
    const reference = new Date(run.last_activity_at || run.updated_at).getTime();
    return reference >= cutoff;
  });
}

function scopeTitle(scope: Scope): string {
  if (scope === "today") return "Today's sky";
  if (scope === "7d") return "Seven-day sky";
  if (scope === "30d") return "Thirty-day sky";
  return "All signals";
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function haloFor(status: string): { className: string; radius: number } | null {
  if (status === "running") return { className: "observatory-halo observatory-halo-live", radius: 9 };
  if (status === "waiting") return { className: "observatory-halo observatory-halo-needs", radius: 11 };
  return null;
}

function radiusFor(status: string): number {
  if (status === "running") return 3.2;
  if (status === "waiting") return 3.6;
  if (status === "stale") return 2;
  if (status === "cancelled") return 2.5;
  return 2.5;
}

function stateClass(status: string): string {
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "waiting") return "waiting";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "stale";
}

function statusLabel(status: string): string {
  if (status === "stale") return "quiet";
  if (status === "waiting") return "needs you";
  return status;
}

function compareNodeLayer(
  left: { runId: string; status: string },
  right: { runId: string; status: string },
): number {
  return statusLayer(left.status) - statusLayer(right.status) || left.runId.localeCompare(right.runId);
}

function statusLayer(status: string): number {
  if (status === "running") return 5;
  if (status === "waiting") return 4;
  if (status === "failed" || status === "cancelled") return 3;
  if (status === "completed") return 2;
  return 1;
}
