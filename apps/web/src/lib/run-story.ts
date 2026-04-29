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

type StoryToken =
  | { highlight?: never; value: string }
  | { highlight: Omit<StoryHighlight, "end" | "start">; value: string };

type Stats = {
  commandCount: number;
  durationMs: number;
  failureReason: string | null;
  fileCount: number;
  lastSeenAgoMs: number;
  longestCommand: { command: string; durationMs: number; eventId: string } | null;
  projectLabel: string;
  sourceLabel: string;
  waitingFor: string | null;
};

const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export function buildRunStoryVM(run: RunDetail, now: Date): RunStoryVM {
  if (run.events.length === 0) {
    return text("Nothing to read yet - Alfred is still listening.");
  }

  const status = normalizeStatus(run.status);
  const stats = computeStats(run, now);
  const stale = (status === "running" || status === "waiting") && stats.lastSeenAgoMs > STALE_AFTER_MS;

  if (stale) {
    return compose([
      txt(`${stats.sourceLabel} stopped reporting `),
      durationToken(stats.lastSeenAgoMs),
      txt(` ago. Touched `),
      countToken(stats.fileCount, fileNoun(stats.fileCount)),
      txt(" before that."),
    ]);
  }

  if (status === "completed") {
    const tokens: StoryToken[] = [
      txt(`${stats.sourceLabel} finished ${stats.projectLabel} - `),
      durationToken(stats.durationMs),
      txt(`, `),
      countToken(stats.fileCount, fileNoun(stats.fileCount)),
      txt(", clean."),
    ];

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
    return compose([
      txt(`${stats.sourceLabel} stopped on ${stats.failureReason || "an error"}. Touched `),
      countToken(stats.fileCount, fileNoun(stats.fileCount)),
      txt(" in "),
      durationToken(stats.durationMs),
      txt(" before that."),
    ]);
  }

  if (status === "waiting") {
    return compose([
      txt(`${stats.sourceLabel} is waiting for your ${stats.waitingFor || "approval"}. `),
      countToken(stats.fileCount, fileNoun(stats.fileCount)),
      txt(" touched in "),
      durationToken(stats.durationMs),
      txt(" so far."),
    ]);
  }

  if (status === "running") {
    return compose([
      txt(`${stats.sourceLabel} has been working on ${stats.projectLabel} for `),
      durationToken(stats.durationMs),
      txt(". "),
      countToken(stats.fileCount, fileNoun(stats.fileCount)),
      txt(" touched, "),
      countToken(stats.commandCount, commandNoun(stats.commandCount)),
      txt(" so far."),
    ]);
  }

  return text("Nothing to read yet - Alfred is still listening.");
}

function computeStats(run: RunDetail, now: Date): Stats {
  const startedAt = timestampMs(run.started_at);
  const completedAt = run.completed_at ? timestampMs(run.completed_at) : now.getTime();
  const updatedAt = timestampMs(run.updated_at);
  const durationMs = startedAt > 0 ? Math.max(completedAt - startedAt, 0) : 0;
  const lastSeenAgoMs = updatedAt > 0 ? Math.max(now.getTime() - updatedAt, 0) : 0;
  const filePaths = new Set<string>();
  let commandCount = 0;
  let failureReason: { occurredAt: number; value: string } | null = null;
  let longestCommand: Stats["longestCommand"] = null;
  let waitingFor: string | null = null;

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
      const reason = readFirstString(event.payload, ["error", "message", "reason"]);
      if (reason) {
        const occurredAt = timestampMs(event.occurred_at);
        if (!failureReason || occurredAt >= failureReason.occurredAt) {
          failureReason = { occurredAt, value: reason };
        }
      }
    }

    if (isWaitingEvent(event)) {
      waitingFor = waitingFor ?? readFirstString(event.payload, ["action", "message", "command", "tool_name"]);
    }
  }

  return {
    commandCount,
    durationMs,
    failureReason: failureReason?.value ?? null,
    fileCount: filePaths.size,
    lastSeenAgoMs,
    longestCommand,
    projectLabel: run.project_name?.trim() || run.project_key?.trim() || "this project",
    sourceLabel: humanizeSource(run.source_id),
    waitingFor,
  };
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

function durationToken(durationMs: number): StoryToken {
  return {
    highlight: { kind: "duration", payload: {} },
    value: humanizeDuration(durationMs),
  };
}

function commandNoun(count: number): string {
  return count === 1 ? "command" : "commands";
}

function fileNoun(count: number): string {
  return count === 1 ? "file" : "files";
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

function isWaitingEvent(event: RunEventItem): boolean {
  const type = event.type.toLowerCase();
  const status = event.status?.toLowerCase() ?? "";
  return status === "waiting" || type.includes("wait") || type.includes("approval");
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase();
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
