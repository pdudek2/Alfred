import type { RunEventItem } from "./api-client";
import { formatDateTime } from "./time";

export type RunPhaseKind = "session" | "read" | "edit" | "command" | "test" | "failure" | "waiting" | "other";

export type RunPhaseEventVM = {
  id: string;
  label: string;
  occurredAt: string;
  occurredAtLabel: string;
};

export type RunPhaseVM = {
  id: string;
  kind: RunPhaseKind;
  title: string;
  summary: string;
  eventCount: number;
  startedAt: string;
  startedAtLabel: string;
  endedAt: string;
  endedAtLabel: string;
  events: RunPhaseEventVM[];
};

const PHASE_TITLES: Record<RunPhaseKind, string> = {
  command: "Ran commands",
  edit: "Changed files",
  failure: "Hit a problem",
  other: "Noted activity",
  read: "Read the project",
  session: "Opened the session",
  test: "Checked the work",
  waiting: "Waited on you",
};

export function buildRunPhases(events: RunEventItem[]): RunPhaseVM[] {
  const sortedEvents = [...events].sort(compareEvents);
  const phases: RunPhaseVM[] = [];

  for (const event of sortedEvents) {
    const kind = phaseKind(event);
    const last = phases.at(-1);
    const phaseEvent = toPhaseEvent(event);

    if (last && last.kind === kind) {
      appendPhaseEvent(last, phaseEvent);
      continue;
    }

    phases.push(createPhase(kind, phaseEvent));
  }

  return phases;
}

export function eventLine(event: RunEventItem): string {
  const type = event.type.toLowerCase();
  const toolName = readString(event.payload.tool_name) ?? readString(event.payload.toolName) ?? readString(event.payload.name);
  const toolLabel = toolName ? humanizeToolName(toolName) : "Tool";
  const command = readString(event.payload.command) ?? readString(event.payload.cmd);

  if (type === "run.started") return "Session opened";
  if (type === "run.completed" || type === "run.finished") return "Session closed";
  if (type === "run.failed") return "Session interrupted";
  if (type === "tool.started") return command ? `Started ${command}` : `${toolLabel} started`;
  if (type === "tool.completed" || type === "tool.finished") return command ? `Finished ${command}` : `${toolLabel} finished`;
  if (type === "tool.failed") return command ? `Failed ${command}` : `${toolLabel} failed`;
  if (type.includes("approval") || type.includes("waiting")) return "Waiting on you";

  return event.type;
}

function createPhase(kind: RunPhaseKind, event: RunPhaseEventVM): RunPhaseVM {
  return {
    endedAt: event.occurredAt,
    endedAtLabel: event.occurredAtLabel,
    eventCount: 1,
    events: [event],
    id: event.id,
    kind,
    startedAt: event.occurredAt,
    startedAtLabel: event.occurredAtLabel,
    summary: summaryFor(kind, 1),
    title: PHASE_TITLES[kind],
  };
}

function appendPhaseEvent(phase: RunPhaseVM, event: RunPhaseEventVM): void {
  phase.endedAt = event.occurredAt;
  phase.endedAtLabel = event.occurredAtLabel;
  phase.eventCount += 1;
  phase.events.push(event);
  phase.summary = summaryFor(phase.kind, phase.eventCount);
}

function summaryFor(kind: RunPhaseKind, count: number): string {
  const unit = summaryUnit(kind);
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function summaryUnit(kind: RunPhaseKind): string {
  if (kind === "read") return "read";
  if (kind === "edit") return "change";
  if (kind === "command") return "command";
  if (kind === "test") return "check";
  if (kind === "failure") return "failure";
  if (kind === "waiting") return "pause";
  return "event";
}

function toPhaseEvent(event: RunEventItem): RunPhaseEventVM {
  return {
    id: event.id,
    label: eventLine(event),
    occurredAt: event.occurred_at,
    occurredAtLabel: formatDateTime(event.occurred_at),
  };
}

function phaseKind(event: RunEventItem): RunPhaseKind {
  const type = event.type.toLowerCase();
  const status = event.status?.toLowerCase() ?? "";
  const toolName = readString(event.payload.tool_name) ?? readString(event.payload.toolName) ?? readString(event.payload.name);
  const command = readString(event.payload.command) ?? readString(event.payload.cmd);
  const normalizedTool = toolName?.toLowerCase() ?? "";

  if (status === "failed" || status === "error" || type.includes("fail") || type.includes("error")) {
    return "failure";
  }

  if (status === "waiting" || type.includes("wait") || type.includes("approval") || type.includes("input")) {
    return "waiting";
  }

  if (command && looksLikeTestCommand(command)) {
    return "test";
  }

  if (normalizedTool === "read" || normalizedTool === "grep" || normalizedTool === "glob") {
    return "read";
  }

  if (normalizedTool === "edit" || normalizedTool === "multiedit" || normalizedTool === "write") {
    return "edit";
  }

  if (normalizedTool === "exec_command" || normalizedTool === "bash" || command) {
    return "command";
  }

  if (type.startsWith("run.")) {
    return "session";
  }

  return "other";
}

function looksLikeTestCommand(command: string): boolean {
  return /\b(test|vitest|playwright|typecheck|tsc|build|lint)\b/i.test(command);
}

function compareEvents(left: RunEventItem, right: RunEventItem): number {
  return new Date(left.occurred_at).getTime() - new Date(right.occurred_at).getTime() || left.id.localeCompare(right.id);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function humanizeToolName(value: string): string {
  if (value === "exec_command" || value === "Bash") return "Command";
  if (value === "Read") return "Read";
  if (value === "Edit" || value === "MultiEdit") return "Edit";
  if (value === "Write") return "Write";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
