import type { RunListItem } from "./api-client";

export type ObservatoryNode = {
  position: Point;
  projectLabel: string;
  runId: string;
  status: string;
};

export type ObservatoryCluster = {
  center: Point;
  label: string;
  nodes: ObservatoryNode[];
  radius: number;
};

export type ObservatoryEdge = {
  crossCluster: boolean;
  from: Point;
  to: Point;
};

export type ObservatoryLayout = {
  clusters: ObservatoryCluster[];
  edges: ObservatoryEdge[];
};

export type ObservatoryViewport = {
  height: number;
  width: number;
};

type Point = {
  x: number;
  y: number;
};

type RunWithParent = RunListItem & {
  parent_run_id?: string | null;
};

export function computeObservatoryLayout(runs: RunWithParent[], viewport: ObservatoryViewport): ObservatoryLayout {
  const groups = groupRunsByProject(runs);
  const labels = [...groups.keys()].sort((left, right) => {
    const sizeDelta = (groups.get(right)?.length ?? 0) - (groups.get(left)?.length ?? 0);
    return sizeDelta || left.localeCompare(right);
  });
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  const orbit = Math.max(Math.min(viewport.width, viewport.height) / 3, 120);
  const clusterRadius = Math.max(Math.min(viewport.width, viewport.height) / 6, 60);
  const clusterPadding = clusterRadius + 32;
  const positionByRunId = new Map<string, Point>();
  const clusterByRunId = new Map<string, string>();

  const clusters = labels.map((label, index) => {
    const clusterCenter = clampPoint(clusterCenterFor(label, index, labels.length, center, orbit), viewport, clusterPadding);
    const runsForCluster = [...(groups.get(label) ?? [])].sort((left, right) => left.id.localeCompare(right.id));
    const nodes = runsForCluster.map((run) => {
      const position = clampPoint(nodePositionFor(run.id, clusterCenter, clusterRadius), viewport, 18);
      positionByRunId.set(run.id, position);
      clusterByRunId.set(run.id, label);
      return {
        position,
        projectLabel: label,
        runId: run.id,
        status: run.status,
      };
    });

    return {
      center: clusterCenter,
      label,
      nodes,
      radius: clusterRadius,
    };
  });

  const edges = runs.flatMap((run): ObservatoryEdge[] => {
    if (!run.parent_run_id) return [];
    const from = positionByRunId.get(run.parent_run_id);
    const to = positionByRunId.get(run.id);
    if (!from || !to) return [];

    return [
      {
        crossCluster: clusterByRunId.get(run.parent_run_id) !== clusterByRunId.get(run.id),
        from,
        to,
      },
    ];
  });

  return { clusters, edges };
}

function clusterCenterFor(label: string, index: number, count: number, center: Point, orbit: number): Point {
  if (count <= 1) return center;

  const baseAngle = (index / count) * 2 * Math.PI;
  const jitter = ((hash(label) % 360) / 360) * 0.3;
  const angle = baseAngle + jitter;
  return {
    x: center.x + Math.cos(angle) * orbit,
    y: center.y + Math.sin(angle) * orbit,
  };
}

function groupRunsByProject(runs: RunWithParent[]): Map<string, RunWithParent[]> {
  const groups = new Map<string, RunWithParent[]>();

  for (const run of runs) {
    const label = run.project_name?.trim() || run.project_key?.trim() || "untitled";
    groups.set(label, [...(groups.get(label) ?? []), run]);
  }

  return groups;
}

function nodePositionFor(runId: string, center: Point, clusterRadius: number): Point {
  const angle = ((hash(runId) % 360) / 360) * 2 * Math.PI;
  const radius = clusterRadius * (0.4 + ((hash(`${runId}:radius`) % 100) / 100) * 0.5);

  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function clampPoint(point: Point, viewport: ObservatoryViewport, padding = 0): Point {
  return {
    x: clamp(point.x, padding, viewport.width - padding),
    y: clamp(point.y, padding, viewport.height - padding),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function hash(input: string): number {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }

  return value >>> 0;
}
