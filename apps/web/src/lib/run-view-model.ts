import type { RunDetail, RunEventItem, RunListItem } from "./api-client";
import { formatDateTime, formatDuration } from "./time";

export type RunTab = "all" | "live" | "needs" | "problems" | "done";
export type TriageTab = RunTab;
export type RunGrouping = "status" | "project" | "flat";
export type ActivityKind = "failure" | "waiting" | "tool" | "run" | "other";
export type RunTriageState = "running" | "waiting" | "failed" | "cancelled" | "completed" | "stale" | "other";

export const STALE_RUN_AFTER_MS = 2 * 60 * 60 * 1000;

export type RunListOptions = {
  tab: RunTab;
  query: string;
  grouping: RunGrouping;
  now?: Date;
};

export type RunCardVM = {
  id: string;
  headline: string;
  title: string;
  intent: string;
  projectLabel: string;
  summaryLabel: string;
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

export type FeedSectionLabel = "Needs you" | "Running" | "Problems" | "Quiet archive" | "Done" | "Other";

export type TimeGroupedFeedVM = {
  sections: Array<{ label: FeedSectionLabel; runs: RunCardVM[] }>;
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
  { id: "problems", label: "Problems" },
  { id: "done", label: "Done" },
];

const ACTIVITY_ORDER: ActivityKind[] = ["failure", "waiting", "tool", "run", "other"];
const FEED_SECTION_ORDER: FeedSectionLabel[] = ["Needs you", "Running", "Problems", "Quiet archive", "Done", "Other"];

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

function deriveIntent({
  projectLabel,
  sourceRunLabel,
  status,
  titleLabel,
}: {
  projectLabel: string;
  sourceRunLabel: string;
  status: string;
  titleLabel: string;
}): string {
  if (isHumanIntent(titleLabel, projectLabel)) {
    return titleLabel;
  }

  if (isHumanIntent(sourceRunLabel, projectLabel)) {
    return sourceRunLabel;
  }

  if (status === "waiting") return "waiting on you";
  if (status === "running") return "active session";
  if (status === "completed") return "closed session";
  if (status === "failed") return "interrupted session";
  if (status === "cancelled") return "cancelled session";
  if (status === "stale") return "quiet session";
  return "agent session";
}

function isHumanIntent(value: string, projectLabel: string): boolean {
  if (!value) return false;
  if (value.toLowerCase() === projectLabel.toLowerCase()) return false;
  return !looksLikeMachineId(value);
}

function looksLikeMachineId(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (/^[0-9a-f]{8,}-[0-9a-f-]{12,}$/i.test(normalized)) return true;
  if (/^[0-9a-f]{20,}$/i.test(normalized)) return true;
  if (/^codex-run-[\w-]+$/i.test(normalized)) return true;
  if (/^[\w-]*[0-9a-f]{8,}[\w-]*$/i.test(normalized) && normalized.length >= 16) return true;
  return false;
}

function buildCardSummaryLabel(run: RunListItem, sourceLabel: string, status: string): string {
  const source = humanizeSourceId(sourceLabel);
  const activityAt = runActivityAt(run);
  const timestamp = run.completed_at ?? run.started_at ?? activityAt;
  const timeLabel = formatDateTime(timestamp);

  if (status === "waiting") return `${source} · waiting since ${formatDateTime(activityAt)}`;
  if (status === "running") return `${source} · active since ${timeLabel}`;
  if (status === "completed") return `${source} · closed ${timeLabel}`;
  if (status === "failed") return `${source} · failed ${timeLabel}`;
  if (status === "cancelled") return `${source} · cancelled ${timeLabel}`;
  if (status === "stale") return `${source} · last heard ${formatDateTime(activityAt)}`;
  return `${source} · ${timeLabel}`;
}

function humanizeSourceId(sourceId: string): string {
  const normalized = sourceId.toLowerCase();
  if (normalized.startsWith("codex")) return "Codex";
  if (normalized.startsWith("claude")) return "Claude";
  return sourceId || "Agent";
}

export function buildOverviewVM(runs: RunListItem[], now = new Date()): RunOverviewVM {
  const orderedRuns = sortRuns(runs);
  const latestUpdatedAt = orderedRuns[0] ? runActivityAt(orderedRuns[0]) : null;

  return {
    totalCount: runs.length,
    liveCount: runs.filter((run) => isLiveRun(run, now)).length,
    needsAttentionCount: runs.filter((run) => needsAttention(run, now)).length,
    doneCount: runs.filter((run) => isDoneRun(run, now)).length,
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
  const activityAt = runActivityAt(run);
  const titleLabel = stringLabel(run.title);
  const sourceRunLabel = stringLabel(run.source_run_id);
  const sourceRunId = sourceRunLabel;
  const title = titleLabel || sourceRunLabel || run.id;
  const projectLabel = getProjectLabel(run);
  const sourceLabel = run.source_id || "unknown source";
  const sourceStatus = normalizeStatus(run.status);
  const status = effectiveStatus(run, now);
  const intent = deriveIntent({ projectLabel, sourceRunLabel, status, titleLabel });
  const headline = `${projectLabel} · ${intent}`;
  const durationLabel = status === "stale" ? "quiet" : formatDuration(run.started_at, run.completed_at);

  return {
    id: run.id,
    headline,
    title,
    intent,
    projectLabel,
    summaryLabel: buildCardSummaryLabel(run, sourceLabel, status),
    sourceLabel,
    sourceRunId,
    status,
    sourceStatus,
    statusLabel: status,
    startedAt: run.started_at,
    startedAtLabel: formatDateTime(run.started_at),
    completedAt: run.completed_at,
    completedAtLabel: formatDateTime(run.completed_at),
    updatedAt: activityAt,
    updatedAtLabel: formatDateTime(activityAt),
    durationLabel,
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
  const buckets: Record<FeedSectionLabel, RunCardVM[]> = {
    "Needs you": [],
    Running: [],
    Problems: [],
    "Quiet archive": [],
    Done: [],
    Other: [],
  };

  for (const card of cards) {
    buckets[feedSectionForCard(card)].push(card);
  }

  return {
    sections: FEED_SECTION_ORDER.filter((label) => buckets[label].length > 0).map((label) => ({
      label,
      runs: buckets[label],
    })),
  };
}

function feedSectionForCard(card: RunCardVM): FeedSectionLabel {
  if (card.status === "waiting") return "Needs you";
  if (card.status === "running") return "Running";
  if (card.status === "failed" || card.status === "cancelled") return "Problems";
  if (card.status === "stale") return "Quiet archive";
  if (card.status === "completed") return "Done";
  return "Other";
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
  if (tab === "problems") return card.status === "failed" || card.status === "cancelled";
  return card.isDone;
}

function isLiveRun(run: RunListItem, now = new Date()): boolean {
  const status = effectiveStatus(run, now);
  return status === "running" || status === "waiting";
}

function needsAttention(run: RunListItem, now = new Date()): boolean {
  const status = effectiveStatus(run, now);
  return status === "waiting";
}

function isDoneRun(run: RunListItem, now = new Date()): boolean {
  return effectiveStatus(run, now) === "completed";
}

function sortRuns(runs: RunListItem[]): RunListItem[] {
  return [...runs].sort((left, right) => compareTimestampDesc(runActivityAt(left), runActivityAt(right)) || left.id.localeCompare(right.id));
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
  if (normalized === "cancelled") return "cancelled";
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
  const order = ["waiting", "running", "failed", "cancelled", "completed", "stale"];
  const index = order.indexOf(status);
  return index === -1 ? order.length : index;
}

function effectiveStatus(run: RunListItem, now = new Date()): string {
  const lifecycleStatus = normalizeStatus(run.lifecycle_status ?? "");
  if (lifecycleStatus !== "unknown") {
    return lifecycleStatus;
  }

  const status = normalizeStatus(run.status);
  if ((status === "unknown" || status === "other") && run.completed_at) {
    return "completed";
  }

  if ((status === "running" || status === "waiting") && isStaleRun(run, now)) {
    return "stale";
  }

  return status;
}

function isStaleRun(run: RunListItem, now: Date): boolean {
  const lastSeenAt = timestampMs(runActivityAt(run));
  const nowMs = now.getTime();
  return Number.isFinite(nowMs) && lastSeenAt > 0 && nowMs - lastSeenAt > STALE_RUN_AFTER_MS;
}

function runActivityAt(run: RunListItem): string {
  return run.last_activity_at || run.updated_at;
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
