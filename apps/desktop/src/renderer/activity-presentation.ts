import type { SessionActivityEvent } from "./session-state";

export type ActivityPresentationLayer = "raw" | "signal" | "work";

export type PresentedActivity = {
  hiddenRawCount: number;
  rawEvents: SessionActivityEvent[];
  visibleEvents: SessionActivityEvent[];
};

const DEFAULT_VISIBLE_LIMIT = 8;

export function presentActivityEvents(
  events: SessionActivityEvent[],
  {
    includeRaw = false,
    limit = DEFAULT_VISIBLE_LIMIT,
  }: {
    includeRaw?: boolean;
    limit?: number;
  } = {},
): PresentedActivity {
  const ordered = [...events].sort((left, right) => right.at - left.at);
  const rawEvents = ordered.filter((event) => classifyActivityPresentationLayer(event) === "raw");
  const primaryEvents = ordered.filter((event) => classifyActivityPresentationLayer(event) !== "raw");
  const sourceEvents = includeRaw ? ordered : primaryEvents;

  return {
    hiddenRawCount: includeRaw ? 0 : rawEvents.length,
    rawEvents,
    visibleEvents: sourceEvents.slice(0, limit),
  };
}

export function meaningfulSignalEvents(events: SessionActivityEvent[]): SessionActivityEvent[] {
  return [...events]
    .filter((event) => classifyActivityPresentationLayer(event) === "signal")
    .sort((left, right) => left.at - right.at);
}

export function classifyActivityPresentationLayer(event: SessionActivityEvent): ActivityPresentationLayer {
  if (isRawActivity(event)) return "raw";

  switch (event.kind) {
    case "approval":
    case "error":
    case "warning":
      return "signal";
    case "file":
    case "command":
    case "plan":
    case "tool":
      return "work";
    case "output":
      return isUsefulOutput(event) ? "signal" : "raw";
    case "lifecycle":
      return isUsefulLifecycle(event) ? "signal" : "raw";
  }
}

function isRawActivity(event: SessionActivityEvent): boolean {
  const text = `${event.title} ${event.detail} ${payloadText(event)}`.toLowerCase();
  return [
    "sessionstart hook",
    "userpromptsubmit hook",
    "posttooluse hook",
    "pretooluse hook",
    "stop hook",
    "hook (completed)",
    "hook (failed)",
    "failed to parse plugin hooks config",
    "call purge mcp tool",
    "ctx_",
    "context-mode",
    "git diff --check",
    "git diff --name-status",
    "git diff --stat",
    "git status --short",
    "whitespace/error",
  ].some((pattern) => text.includes(pattern));
}

function isUsefulOutput(event: SessionActivityEvent): boolean {
  const text = `${event.title} ${event.detail}`.toLowerCase();
  if (text.includes("hello! i'm ready to assist")) return false;
  if (text.includes("ready in ")) return false;
  return text.length > 12;
}

function isUsefulLifecycle(event: SessionActivityEvent): boolean {
  const text = `${event.title} ${event.detail}`.toLowerCase();
  return (
    text.includes("session attached") ||
    text.includes("process exited") ||
    text.includes("transcript restored") ||
    text.includes("applied to project") ||
    text.includes("checkout diff reviewed") ||
    text.includes("relaunching session") ||
    text.includes("restarting session")
  );
}

function payloadText(event: SessionActivityEvent): string {
  if (!event.payload) return "";
  switch (event.payload.type) {
    case "approval":
      return event.payload.prompt;
    case "command":
      return event.payload.command;
    case "error":
      return event.payload.message;
    case "file":
      return event.payload.path;
    case "plan":
      return event.payload.summary;
    case "tool":
      return `${event.payload.name} ${event.payload.input}`;
    case "warning":
      return event.payload.message;
  }
}
