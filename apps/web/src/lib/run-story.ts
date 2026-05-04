import type { RunDetail, RunEventItem } from "./api-client";

export type StoryHighlight = {
  start: number;
  end: number;
  kind: "file" | "command" | "duration" | "count";
  payload: { command?: string; eventId?: string; filePath?: string };
};

export type RunStoryVM = {
  paragraph: string;
  highlights: StoryHighlight[];
};

type StoryStatus = "running" | "waiting" | "failed" | "cancelled" | "completed" | "stale" | "other";

type StoryToken =
  | { highlight?: never; value: string }
  | { highlight: Omit<StoryHighlight, "end" | "start">; value: string };

type Stats = {
  commandCount: number;
  durationMs: number;
  failureCount: number;
  failureReason: string | null;
  fileCount: number;
  lastSeenAgoMs: number;
  longestCommand: { command: string; durationMs: number; eventId: string } | null;
  projectLabel: string;
  sourceLabel: string;
};

const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export function buildRunStoryVM(run: RunDetail, now: Date): RunStoryVM {
  const status = deriveStoryStatus(run, now);
  if (run.events.length === 0) {
    return emptyStoryForStatus(status);
  }

  const stats = computeStats(run, now);
  const stale = status === "stale";

  if (stale) {
    const tokens: StoryToken[] = [
      txt(`${stats.sourceLabel} stopped reporting `),
      durationToken(stats.lastSeenAgoMs),
      txt(" ago."),
    ];
    appendObservedSentence(tokens, observedMetrics(stats), " before that");
    return compose(tokens);
  }

  if (status === "completed") {
    const outcomeText =
      stats.failureCount > 0 ? `with ${stats.failureCount} ${interruptionNoun(stats.failureCount)}.` : "clean.";
    const tokens: StoryToken[] = [
      txt(`${stats.sourceLabel} finished ${stats.projectLabel} - `),
      durationToken(stats.durationMs),
    ];
    const fileMetric = filePathMetric(stats);
    if (fileMetric.length > 0) {
      tokens.push(txt(", "), ...fileMetric);
    }
    tokens.push(txt(`, ${outcomeText}`));

    if (stats.longestCommand) {
      tokens.push(
        txt(" Longest command: "),
        commandToken(stats.longestCommand),
        txt(` at ${formatMmSs(stats.longestCommand.durationMs)}.`),
      );
    }

    return compose(tokens);
  }

  if (status === "failed") {
    const tokens: StoryToken[] = [
      txt(failureLead(stats)),
      durationToken(stats.durationMs),
      txt("."),
    ];
    appendObservedSentence(tokens, observedMetrics(stats), " before that");
    return compose(tokens);
  }

  if (status === "cancelled") {
    const tokens: StoryToken[] = [
      txt(`${stats.sourceLabel} was cancelled after `),
      durationToken(stats.durationMs),
      txt("."),
    ];
    appendObservedSentence(tokens, observedMetrics(stats), " before that");
    return compose(tokens);
  }

  if (status === "waiting") {
    return compose([
      txt(`${stats.sourceLabel} is waiting on you. Last activity `),
      durationToken(stats.lastSeenAgoMs),
      txt(" ago."),
    ]);
  }

  if (status === "running") {
    const tokens: StoryToken[] = [
      txt(`${stats.sourceLabel} is active on ${stats.projectLabel}. Last activity `),
      durationToken(stats.lastSeenAgoMs),
      txt(" ago."),
    ];

    appendObservedSentence(tokens, observedMetrics(stats));
    return compose(tokens);
  }

  return text("Nothing to read yet - Alfred is still listening.");
}

function emptyStoryForStatus(status: StoryStatus): RunStoryVM {
  if (status === "completed") return text("This run closed, but no event stream was captured.");
  if (status === "failed") return text("This run stopped, but no event stream was captured.");
  if (status === "cancelled") return text("This run was cancelled, but no event stream was captured.");
  if (status === "stale") return text("This run went quiet, but no event stream was captured.");
  return text("Nothing to read yet - Alfred is still listening.");
}

function deriveStoryStatus(run: RunDetail, now: Date): StoryStatus {
  const lifecycleStatus = normalizeKnownStatus(run.lifecycle_status ?? "");
  if (
    (lifecycleStatus === "running" || lifecycleStatus === "waiting") &&
    isStaleRun(run, now)
  ) {
    return "stale";
  }

  if (lifecycleStatus !== "other") {
    return lifecycleStatus;
  }

  const status = normalizeKnownStatus(run.status);
  if ((status === "other") && run.completed_at) {
    return "completed";
  }

  if ((status === "running" || status === "waiting") && isStaleRun(run, now)) {
    return "stale";
  }

  return status;
}

function computeStats(run: RunDetail, now: Date): Stats {
  const startedAt = timestampMs(run.started_at);
  const completedAt = run.completed_at ? timestampMs(run.completed_at) : now.getTime();
  const updatedAt = timestampMs(run.last_activity_at || latestEventOccurredAt(run.events) || run.updated_at);
  const durationMs = startedAt > 0 ? Math.max(completedAt - startedAt, 0) : 0;
  const lastSeenAgoMs = updatedAt > 0 ? Math.max(now.getTime() - updatedAt, 0) : 0;
  const filePaths = new Set<string>();
  let commandCount = 0;
  let failureCount = 0;
  let failureReason: { occurredAt: number; value: string } | null = null;
  let longestCommand: Stats["longestCommand"] = null;

  for (const event of run.events) {
    const filePath = readFirstString(event.payload, ["file_path", "filePath", "path"]);
    if (filePath) {
      filePaths.add(filePath);
    }

    const toolName = readFirstString(event.payload, ["tool_name", "toolName", "name"]);
    const command = readFirstString(event.payload, ["command", "cmd"]);
    if (toolName === "exec_command" || command) {
      commandCount += 1;
      const commandLabel = command || toolName || "command";
      const durationMsForCommand = readNumber(event.payload, "duration_ms") ?? readNumber(event.payload, "durationMs") ?? 0;
      if (!longestCommand || durationMsForCommand > longestCommand.durationMs) {
        longestCommand = { command: commandLabel, durationMs: durationMsForCommand, eventId: event.id };
      }
    }

    if (isFailureEvent(event)) {
      failureCount += 1;
      const reason = readFirstString(event.payload, ["error", "message", "reason"]);
      if (reason) {
        const occurredAt = timestampMs(event.occurred_at);
        if (!failureReason || occurredAt >= failureReason.occurredAt) {
          failureReason = { occurredAt, value: reason };
        }
      }
    }
  }

  return {
    commandCount,
    durationMs,
    failureCount,
    failureReason: failureReason?.value ?? null,
    fileCount: filePaths.size,
    lastSeenAgoMs,
    longestCommand,
    projectLabel: run.project_name?.trim() || run.project_key?.trim() || "this project",
    sourceLabel: humanizeSource(run.source_id),
  };
}

function failureLead(stats: Stats): string {
  const reason = stats.failureReason?.trim();
  if (!reason) return `${stats.sourceLabel} stopped after `;
  if (reason.toLowerCase() === "interrupted") return `${stats.sourceLabel} was interrupted after `;
  return `${stats.sourceLabel} stopped on ${reason} after `;
}

function latestEventOccurredAt(events: RunEventItem[]): string | null {
  let latest: string | null = null;
  for (const event of events) {
    if (!latest || timestampMs(event.occurred_at) > timestampMs(latest)) {
      latest = event.occurred_at;
    }
  }
  return latest;
}

function compose(tokens: StoryToken[]): RunStoryVM {
  let paragraph = "";
  const highlights: StoryHighlight[] = [];

  for (const token of tokens) {
    const start = paragraph.length;
    paragraph += token.value;
    if (token.highlight && token.value.length > 0) {
      highlights.push({ ...token.highlight, start, end: paragraph.length });
    }
  }

  return { paragraph, highlights };
}

function text(value: string): RunStoryVM {
  return { highlights: [], paragraph: value };
}

function txt(value: string): StoryToken {
  return { value };
}

function commandToken(command: NonNullable<Stats["longestCommand"]>): StoryToken {
  return {
    highlight: { kind: "command", payload: { command: command.command, eventId: command.eventId } },
    value: command.command,
  };
}

function countToken(count: number, noun: string): StoryToken {
  return {
    highlight: { kind: "count", payload: {} },
    value: `${count} ${noun}`,
  };
}

function appendObservedSentence(tokens: StoryToken[], metrics: StoryToken[], suffix = "") {
  if (metrics.length === 0) return;
  tokens.push(txt(" "), ...metrics, txt(`${suffix}.`));
}

function observedMetrics(stats: Stats): StoryToken[] {
  const metrics: StoryToken[][] = [];
  const fileMetric = filePathMetric(stats);
  if (fileMetric.length > 0) metrics.push(fileMetric);
  if (stats.commandCount > 0) {
    metrics.push([countToken(stats.commandCount, commandNoun(stats.commandCount)), txt(" observed")]);
  }
  return joinMetricTokens(metrics);
}

function filePathMetric(stats: Stats): StoryToken[] {
  if (stats.fileCount <= 0) return [];
  return [countToken(stats.fileCount, filePathNoun(stats.fileCount)), txt(" observed in events")];
}

function joinMetricTokens(metrics: StoryToken[][]): StoryToken[] {
  return metrics.flatMap((metric, index) => (index === 0 ? metric : [txt(", "), ...metric]));
}

function durationToken(durationMs: number): StoryToken {
  return {
    highlight: { kind: "duration", payload: {} },
    value: humanizeDuration(durationMs),
  };
}

function commandNoun(count: number): string {
  return count === 1 ? "command" : "commands";
}

function filePathNoun(count: number): string {
  return count === 1 ? "file path" : "file paths";
}

function interruptionNoun(count: number): string {
  return count === 1 ? "interruption" : "interruptions";
}

function formatMmSs(ms: number): string {
  const totalSeconds = Math.max(Math.round(ms / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function humanizeDuration(ms: number): string {
  const seconds = Math.max(Math.floor(ms / 1000), 0);
  if (seconds < 60) {
    return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  return `${hours} ${hours === 1 ? "hour" : "hours"} ${remainingMinutes} ${remainingMinutes === 1 ? "minute" : "minutes"}`;
}

function humanizeSource(sourceId: string): string {
  const normalized = sourceId.toLowerCase();
  if (normalized.startsWith("codex")) return "Codex";
  if (normalized.startsWith("claude")) return "Claude";
  return sourceId || "Agent";
}

function isFailureEvent(event: RunEventItem): boolean {
  const type = event.type.toLowerCase();
  const status = event.status?.toLowerCase() ?? "";
  return status === "failed" || status === "error" || type.includes("fail") || type.includes("error");
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase();
}

function normalizeKnownStatus(status: string): StoryStatus {
  const normalized = normalizeStatus(status);
  if (normalized === "running") return "running";
  if (normalized === "waiting") return "waiting";
  if (normalized === "failed") return "failed";
  if (normalized === "cancelled") return "cancelled";
  if (normalized === "completed") return "completed";
  if (normalized === "stale") return "stale";
  return "other";
}

function isStaleRun(run: RunDetail, now: Date): boolean {
  const lastSeenAt = timestampMs(run.last_activity_at || latestEventOccurredAt(run.events) || run.updated_at);
  const nowMs = now.getTime();
  return Number.isFinite(nowMs) && lastSeenAt > 0 && nowMs - lastSeenAt > STALE_AFTER_MS;
}

function readFirstString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timestampMs(value: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
