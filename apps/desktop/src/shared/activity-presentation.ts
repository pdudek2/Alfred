import type { SessionActivityEvent } from "./session-activity.js";

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
  // Newest first; events of the same millisecond (a burst of hooks, one output chunk) keep their order, latest on top.
  const ordered = [...events].reverse().sort((left, right) => right.at - left.at);
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
    case "prompt":
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
    text.includes("approved for launch") ||
    text.includes("session attached") ||
    text.includes("process exited") ||
    text.includes("transcript restored") ||
    text.includes("applied to project") ||
    text.includes("checkout diff reviewed") ||
    text.includes("relaunching session") ||
    text.includes("resuming session") ||
    text.includes("session asleep") ||
    text.includes("restarting session")
  );
}

type FileOperation = Extract<NonNullable<SessionActivityEvent["payload"]>, { type: "file" }>["operation"];
type ApprovalAsk = { verb: string; object: string } | { question: string };

const FILE_VERBS: Record<FileOperation, string> = {
  created: "Created",
  deleted: "Deleted",
  edited: "Edited",
  read: "Read",
  renamed: "Renamed",
  updated: "Updated",
  wrote: "Wrote",
};

const CLAUDE_TOOL_VERBS: Record<string, string> = {
  Bash: "run",
  Edit: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  WebFetch: "fetch",
  Write: "write",
};

// Claude tools that can ask for permission without a verb of their own above.
const OTHER_CLAUDE_TOOLS = new Set(["Agent", "Glob", "Grep", "Read", "Skill", "Task", "WebSearch"]);

/** One plain sentence per activity, as the v4 Details board writes them: "Edited session-status.ts", "Ran pnpm test". */
export function activitySentence(event: SessionActivityEvent): string {
  const payload = event.payload;
  switch (event.kind) {
    case "approval":
      return askedSentence(payload?.type === "approval" ? payload.prompt : event.detail);
    case "command": {
      const description = payload?.type === "command" ? payload.description?.trim() : undefined;
      if (description) return description;
      const command = payload?.type === "command" ? payload.command : event.detail;
      return command ? `Ran ${withoutOutputPlumbing(firstLine(command))}` : event.title;
    }
    case "file":
      return payload?.type === "file" ? `${FILE_VERBS[payload.operation]} ${fileName(payload.path)}` : event.detail || event.title;
    case "tool":
      if (payload?.type !== "tool") return event.title;
      return payload.input ? `Used ${payload.name} (${payload.input})` : `Used ${payload.name}`;
    // "Plan updated", "Checkout diff reviewed": the title reads as a sentence.
    case "plan":
      return event.title;
    case "prompt":
      return `You asked: ${event.detail}`;
    // Alfred writes these: the title names the step, the detail's first sentence says what happened.
    case "lifecycle":
      return event.detail.split(/(?<=\.)\s+/)[0] || event.title;
    // Errors, warnings and output are the agent's own line.
    case "error":
    case "warning":
    case "output":
      return event.detail || event.title;
  }
}

/** The prompt a waiting session asked, whatever activity was recorded after it. */
export function pendingApproval(events: SessionActivityEvent[] | undefined): SessionActivityEvent | undefined {
  return events?.slice().reverse().find((event) => event.kind === "approval");
}

/** Why a session waits, as Needs you and the session strip say it: "Wants to edit session-status.ts", or "Claude wants to …". */
export function waitingSentence(event: SessionActivityEvent, subject?: string): string {
  if (event.kind !== "approval") return activitySentence(event);
  const ask = readApproval(event.payload?.type === "approval" ? event.payload.prompt : event.detail);
  // A question needs no verb of its own: "Implement this plan?", or "Codex asks: Implement this plan?".
  if ("question" in ask) return subject ? `${subject} asks: ${ask.question}` : ask.question;
  return `${subject ? `${subject} wants` : "Wants"} to ${ask.verb} ${ask.object}`;
}

function askedSentence(prompt: string): string {
  const ask = readApproval(prompt);
  return "question" in ask ? `Asked: ${ask.question}` : `Asked to ${ask.verb} ${ask.object}`;
}

/**
 * What an approval asks for, read from the agent's own words: Codex's notification ("Approval requested: <command>",
 * "Codex wants to edit <file>", "Plan mode prompt: <question>") or Claude's hook detail ("<tool>: <target>").
 * Anything else is the question as the terminal printed it.
 */
function readApproval(prompt: string): ApprovalAsk {
  const text = prompt.trim();
  const [, command] = /^approval requested:\s*([\s\S]+)$/i.exec(text) ?? [];
  if (command) return { verb: "run", object: firstLine(command) };
  const [, server] = /^approval requested by\s+(.+)$/i.exec(text) ?? [];
  if (server) return { verb: "use", object: server };
  const [, edited] = /^codex wants to edit\s+(.+)$/i.exec(text) ?? [];
  if (edited) return { verb: "edit", object: fileName(edited) };
  const [, planQuestion] = /^plan mode prompt:\s*(.+)$/i.exec(text) ?? [];
  if (planQuestion) return { question: planQuestion };

  const [, tool = "", target = ""] = /^([A-Za-z][\w-]*):\s*([\s\S]+)$/.exec(text) ?? [];
  if (tool === "ExitPlanMode") return { verb: "start on", object: "the plan" };
  const verb = CLAUDE_TOOL_VERBS[tool];
  if (verb && target !== "waiting for approval") {
    return { verb, object: verb === "edit" || verb === "write" ? fileName(target) : firstLine(target) };
  }
  const [, mcpServer, mcpTool] = /^mcp__(.+?)__(.+)$/.exec(tool) ?? [];
  if (mcpServer && mcpTool) return { verb: "use", object: `${mcpTool} from ${mcpServer}` };
  if (verb || OTHER_CLAUDE_TOOLS.has(tool)) return { verb: "use", object: tool };
  return { question: text };
}

function fileName(path: string): string {
  return path.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

// `2>&1`, `| tail -40`, `| head -n 5` at the end only trim what the agent reads back; the command is what came before.
const OUTPUT_PLUMBING = /(?:\s+2>&1|\s*\|\s*(?:head|tail)\s+(?:-n\s*)?-?\d+)+$/;

function withoutOutputPlumbing(command: string): string {
  return command.replace(OUTPUT_PLUMBING, "") || command;
}

function firstLine(text: string): string {
  return text.trim().split("\n", 1)[0]?.trim() || text;
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
