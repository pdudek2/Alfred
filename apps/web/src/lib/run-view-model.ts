import type { RunDetail, RunEventItem, RunListItem } from "./api-client";
import { formatDateTime, formatDuration } from "./time";

export type RunTab = "all" | "live" | "needs" | "done";
export type TriageTab = RunTab;
export type RunGrouping = "status" | "project" | "flat";
export type ActivityKind = "failure" | "waiting" | "tool" | "run" | "other";
export type RunTriageState = "running" | "waiting" | "failed" | "completed" | "stale" | "other";

export const STALE_RUN_AFTER_MS = 2 * 60 * 60 * 1000;

export type RunListOptions = {
  tab: RunTab;
  query: string;
  grouping: RunGrouping;
  now?: Date;
};

export type RunCardVM = {
  id: string;
  title: string;
  intent: string;
  projectLabel: string;
  sourceLabel: string;
  sourceRunId: string;
  status: string;
  sourceStatus: string;
  statusLabel: string;
  startedAt: string | null;
  startedAtLabel: string;
  completedAt: string | null;
  completedAtLabel: string;
  updatedAt: string;
  updatedAtLabel: string;
  durationLabel: string;
  isLive: boolean;
  needsAttention: boolean;
  isDone: boolean;
  searchText: string;
};

export type RunListGroupVM = {
  key: string;
  label: string;
  count: number;
  runs: RunCardVM[];
};

export type RunListVM = {
  tab: RunTab;
  query: string;
  grouping: RunGrouping;
  totalCount: number;
  filteredCount: number;
  groups: RunListGroupVM[];
};

export type TimeGroupedFeedSectionLabel = "Now" | "Today" | "Earlier this week" | "Older";

export type TimeGroupedFeedVM = {
  sections: Array<{ label: TimeGroupedFeedSectionLabel; runs: RunCardVM[] }>;
};

export type RunOverviewVM = {
  totalCount: number;
  liveCount: number;
  needsAttentionCount: number;
  doneCount: number;
  statusCounts: Array<{ status: string; count: number }>;
  projectCounts: Array<{ key: string; label: string; count: number }>;
  latestUpdatedAt: string | null;
  latestUpdatedAtLabel: string;
};

export type RunFactVM = {
  label: string;
  value: string;
};

export type RunFactsVM = {
  runId: string;
  title: string;
  facts: RunFactVM[];
  eventCount: number;
  activityGroups: ActivityGroupVM[];
};

export type ActivityEventVM = {
  id: string;
  type: string;
  status: string | null;
  occurredAt: string;
  occurredAtLabel: string;
  payload: Record<string, unknown>;
};

export type ActivityGroupVM = {
  kind: ActivityKind;
  label: string;
  count: number;
  events: ActivityEventVM[];
};

export type TriageRunVM = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  startedAt: string;
  duration: string;
  projectLabel: string;
  sourceLabel: string;
  sourceRunId: string;
  triageState: RunTriageState;
  searchText: string;
};

export type TriageRunGroupVM = {
  label: string;
  runs: TriageRunVM[];
};

export type RunDetailVM = {
  id: string;
  title: string;
  subtitle: string;
  source: string;
  sourceRunId: string;
  status: string;
  triageState: RunTriageState;
  startedAt: string;
  completedAt: string;
  duration: string;
  events: RunEventItem[];
  raw: RunDetail | RunListItem;
};

export const TRIAGE_TABS: Array<{ id: TriageTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "needs", label: "Needs" },
  { id: "done", label: "Done" },
];

const ACTIVITY_ORDER: ActivityKind[] = ["failure", "waiting", "tool", "run", "other"];
const TIME_GROUP_ORDER: TimeGroupedFeedSectionLabel[] = ["Now", "Today", "Earlier this week", "Older"];

const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  failure: "Failures",
  waiting: "Waiting",
  tool: "Tool activity",
  run: "Run events",
  other: "Other events",
};

function stringLabel(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function buildOverviewVM(runs: RunListItem[], now = new Date()): RunOverviewVM {
  const orderedRuns = sortRuns(runs);
  const latestUpdatedAt = orderedRuns[0]?.updated_at ?? null;

  return {
    totalCount: runs.length,
    liveCount: runs.filter((run) => isLiveRun(run, now)).length,
    needsAttentionCount: runs.filter((run) => needsAttention(run, now)).length,
    doneCount: runs.filter(isDoneRun).length,
    statusCounts: countBy(runs, (run) => effectiveStatus(run, now)),
    projectCounts: countBy(runs, projectKey).map((item) => ({
      ...item,
      label: projectLabelForKey(item.key, runs),
    })),
    latestUpdatedAt,
    latestUpdatedAtLabel: formatDateTime(latestUpdatedAt),
  };
}

export function buildRunCardVM(run: RunListItem, now = new Date()): RunCardVM {
  const titleLabel = stringLabel(run.title);
  const sourceRunLabel = stringLabel(run.source_run_id);
  const sourceRunId = sourceRunLabel;
  const title = titleLabel || sourceRunLabel || run.id;
  const intent = titleLabel || sourceRunLabel || "untitled run";
  const projectLabel = getProjectLabel(run);
  const sourceLabel = run.source_id || "unknown source";
  const sourceStatus = normalizeStatus(run.status);
  const status = effectiveStatus(run, now);

  return {
    id: run.id,
    title,
    intent,
    projectLabel,
    sourceLabel,
    sourceRunId,
    status,
    sourceStatus,
    statusLabel: status,
    startedAt: run.started_at,
    startedAtLabel: formatDateTime(run.started_at),
    completedAt: run.completed_at,
    completedAtLabel: formatDateTime(run.completed_at),
    updatedAt: run.updated_at,
    updatedAtLabel: formatDateTime(run.updated_at),
    durationLabel: formatDuration(run.started_at, run.completed_at),
    isLive: isLiveRun(run, now),
    needsAttention: needsAttention(run, now),
    isDone: isDoneRun(run),
    searchText: [title, projectLabel, sourceLabel, sourceRunId, run.id, status].join(" ").toLowerCase(),
  };
}

export function filterRunsForTriage(runs: RunListItem[], tab: TriageTab, query = "", now = new Date()): TriageRunVM[] {
  return buildRunListVM(runs, { tab, query, grouping: "flat", now }).groups.flatMap((group) =>
    group.runs.map(toTriageRunVM),
  );
}

export function groupRunViewModels(runs: TriageRunVM[]): TriageRunGroupVM[] {
  const groups = new Map<string, TriageRunVM[]>();

  for (const run of runs) {
    const groupRuns = groups.get(run.projectLabel) ?? [];
    groupRuns.push(run);
    groups.set(run.projectLabel, groupRuns);
  }

  return [...groups.entries()]
    .sort(([leftLabel, leftRuns], [rightLabel, rightRuns]) => rightRuns.length - leftRuns.length || leftLabel.localeCompare(rightLabel))
    .map(([label, groupRuns]) => ({ label, runs: groupRuns }));
}

export function tabCount(runs: RunListItem[], tab: TriageTab, now = new Date()): number {
  return runs.filter((run) => matchesTab(buildRunCardVM(run, now), tab)).length;
}

export function toRunDetailViewModel(run: RunDetail | RunListItem, now = new Date()): RunDetailVM {
  const card = buildRunCardVM(run, now);
  const events = "events" in run ? [...run.events].sort(compareEvents) : [];

  return {
    id: card.id,
    title: card.projectLabel,
    subtitle: card.title,
    source: card.sourceLabel,
    sourceRunId: card.sourceRunId,
    status: card.status,
    triageState: triageState(card.status),
    startedAt: card.startedAtLabel,
    completedAt: card.completedAtLabel,
    duration: card.durationLabel,
    events,
    raw: run,
  };
}

export function buildRunListVM(runs: RunListItem[], options: RunListOptions): RunListVM {
  const query = options.query.trim().toLowerCase();
  const now = options.now ?? new Date();
  const cards = sortRuns(runs)
    .map((run) => buildRunCardVM(run, now))
    .filter((card) => matchesTab(card, options.tab))
    .filter((card) => !query || card.searchText.includes(query));

  return {
    tab: options.tab,
    query: options.query,
    grouping: options.grouping,
    totalCount: runs.length,
    filteredCount: cards.length,
    groups: groupCards(cards, options.grouping),
  };
}

export function buildTimeGroupedFeedVM(runs: RunListItem[], now = new Date()): TimeGroupedFeedVM {
  const cards = sortRuns(runs).map((run) => buildRunCardVM(run, now));
  const buckets: Record<TimeGroupedFeedSectionLabel, RunCardVM[]> = {
    Now: [],
    Today: [],
    "Earlier this week": [],
    Older: [],
  };
  // Feed recency follows local calendar boundaries: today first, then Monday-start current week.
  const startOfToday = startOfLocalDay(now);
  const startOfWeek = startOfLocalWeek(now);

  for (const card of cards) {
    if (card.isLive) {
      buckets.Now.push(card);
      continue;
    }

    const reference = timestampMs(card.updatedAt);

    if (reference >= startOfToday.getTime()) {
      buckets.Today.push(card);
    } else if (reference >= startOfWeek.getTime()) {
      buckets["Earlier this week"].push(card);
    } else {
      buckets.Older.push(card);
    }
  }

  return {
    sections: TIME_GROUP_ORDER.filter((label) => buckets[label].length > 0).map((label) => ({
      label,
      runs: buckets[label],
    })),
  };
}

function startOfLocalDay(value: Date): Date {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  return start;
}

function startOfLocalWeek(value: Date): Date {
  const start = startOfLocalDay(value);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

export function buildRunFactsVM(run: RunListItem, events: RunEventItem[]): RunFactsVM {
  const title = run.title?.trim() || run.source_run_id || run.id;

  return {
    runId: run.id,
    title,
    facts: [
      { label: "Project", value: getProjectLabel(run) },
      { label: "Source", value: run.source_id || "unknown source" },
      { label: "Status", value: normalizeStatus(run.status) },
      { label: "Started", value: formatDateTime(run.started_at) },
      { label: "Completed", value: formatDateTime(run.completed_at) },
      { label: "Duration", value: formatDuration(run.started_at, run.completed_at) },
      { label: "Updated", value: formatDateTime(run.updated_at) },
    ],
    eventCount: events.length,
    activityGroups: buildActivityGroups(events),
  };
}

export function buildActivityGroups(events: RunEventItem[]): ActivityGroupVM[] {
  const sortedEvents = [...events].sort(compareEvents);
  const groups = new Map<ActivityKind, ActivityEventVM[]>();

  for (const event of sortedEvents) {
    const kind = activityKind(event);
    const groupEvents = groups.get(kind) ?? [];
    groupEvents.push({
      id: event.id,
      type: event.type,
      status: event.status,
      occurredAt: event.occurred_at,
      occurredAtLabel: formatDateTime(event.occurred_at),
      payload: event.payload,
    });
    groups.set(kind, groupEvents);
  }

  return ACTIVITY_ORDER.flatMap((kind) => {
    const groupEvents = groups.get(kind) ?? [];
    if (groupEvents.length === 0) return [];
    return [{ kind, label: ACTIVITY_LABELS[kind], count: groupEvents.length, events: groupEvents }];
  });
}

function groupCards(cards: RunCardVM[], grouping: RunGrouping): RunListGroupVM[] {
  if (grouping === "flat") {
    return [{ key: "all", label: "All runs", count: cards.length, runs: cards }];
  }

  const groupMap = new Map<string, RunCardVM[]>();
  for (const card of cards) {
    const key = grouping === "status" ? card.status : card.projectLabel;
    const groupCards = groupMap.get(key) ?? [];
    groupCards.push(card);
    groupMap.set(key, groupCards);
  }

  return [...groupMap.entries()]
    .sort(([leftKey, leftRuns], [rightKey, rightRuns]) => {
      if (grouping === "status") return compareStatusGroups(leftKey, rightKey);
      const countDelta = rightRuns.length - leftRuns.length;
      return countDelta || leftKey.localeCompare(rightKey);
    })
    .map(([key, groupRuns]) => ({
      key,
      label: key,
      count: groupRuns.length,
      runs: groupRuns,
    }));
}

function matchesTab(card: RunCardVM, tab: RunTab): boolean {
  if (tab === "all") return true;
  if (tab === "live") return card.isLive;
  if (tab === "needs") return card.needsAttention;
  return card.isDone;
}

function isLiveRun(run: RunListItem, now = new Date()): boolean {
  const status = effectiveStatus(run, now);
  return status === "running" || status === "waiting";
}

function needsAttention(run: RunListItem, now = new Date()): boolean {
  const status = effectiveStatus(run, now);
  return status === "waiting" || status === "failed";
}

function isDoneRun(run: RunListItem): boolean {
  return normalizeStatus(run.status) === "completed";
}

function sortRuns(runs: RunListItem[]): RunListItem[] {
  return [...runs].sort((left, right) => compareTimestampDesc(left.updated_at, right.updated_at) || left.id.localeCompare(right.id));
}

function compareEvents(left: RunEventItem, right: RunEventItem): number {
  return compareTimestampAsc(left.occurred_at, right.occurred_at) || left.id.localeCompare(right.id);
}

function compareTimestampDesc(left: string | null, right: string | null): number {
  return timestampMs(right) - timestampMs(left);
}

function compareTimestampAsc(left: string | null, right: string | null): number {
  return timestampMs(left) - timestampMs(right);
}

function timestampMs(value: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function toTriageRunVM(card: RunCardVM): TriageRunVM {
  return {
    id: card.id,
    title: card.projectLabel,
    subtitle: card.sourceLabel,
    status: card.status,
    startedAt: card.startedAtLabel,
    duration: card.durationLabel,
    projectLabel: card.projectLabel,
    sourceLabel: card.sourceLabel,
    sourceRunId: card.sourceRunId,
    triageState: triageState(card.status),
    searchText: card.searchText,
  };
}

function countBy<T>(items: T[], keyForItem: (item: T) => string): Array<{ key: string; status: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyForItem(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([leftKey, leftCount], [rightKey, rightCount]) => rightCount - leftCount || leftKey.localeCompare(rightKey))
    .map(([key, count]) => ({ key, status: key, count }));
}

function projectLabelForKey(key: string, runs: RunListItem[]): string {
  return runs.find((run) => projectKey(run) === key && getProjectLabel(run) !== "unknown project")
    ? key
    : "unknown project";
}

function projectKey(run: RunListItem): string {
  return getProjectLabel(run);
}

function getProjectLabel(run: RunListItem): string {
  return run.project_name?.trim() || run.project_key?.trim() || "unknown project";
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase() || "unknown";
}

function triageState(status: string): RunTriageState {
  const normalized = normalizeStatus(status);
  if (normalized === "running") return "running";
  if (normalized === "waiting") return "waiting";
  if (normalized === "failed") return "failed";
  if (normalized === "completed") return "completed";
  if (normalized === "stale") return "stale";
  return "other";
}

function compareStatusGroups(left: string, right: string): number {
  const leftIndex = statusGroupOrder(left);
  const rightIndex = statusGroupOrder(right);
  return leftIndex - rightIndex || left.localeCompare(right);
}

function statusGroupOrder(status: string): number {
  const order = ["running", "waiting", "failed", "completed", "stale"];
  const index = order.indexOf(status);
  return index === -1 ? order.length : index;
}

function effectiveStatus(run: RunListItem, now = new Date()): string {
  const status = normalizeStatus(run.status);
  if ((status === "running" || status === "waiting") && isStaleRun(run, now)) {
    return "stale";
  }

  return status;
}

function isStaleRun(run: RunListItem, now: Date): boolean {
  const lastSeenAt = timestampMs(run.updated_at);
  const nowMs = now.getTime();
  return Number.isFinite(nowMs) && lastSeenAt > 0 && nowMs - lastSeenAt > STALE_RUN_AFTER_MS;
}

function activityKind(event: RunEventItem): ActivityKind {
  const type = event.type.toLowerCase();
  const status = event.status?.toLowerCase() ?? "";

  if (status === "failed" || status === "error" || type.includes("fail") || type.includes("error")) {
    return "failure";
  }

  if (status === "waiting" || type.includes("wait") || type.includes("approval") || type.includes("input")) {
    return "waiting";
  }

  if (type.startsWith("tool.") || typeof event.payload.tool_name === "string") {
    return "tool";
  }

  if (type.startsWith("run.")) {
    return "run";
  }

  return "other";
}
