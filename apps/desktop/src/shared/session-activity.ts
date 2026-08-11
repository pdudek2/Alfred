import { stripTerminalControlSequences, stripTerminalControlSequencesWithRemainder } from "./session-title.js";

export type SessionActivityEventKind =
  | "approval"
  | "command"
  | "error"
  | "file"
  | "lifecycle"
  | "output"
  | "plan"
  | "tool"
  | "warning";

export type SessionActivityPayload =
  | { type: "approval"; prompt: string }
  | { type: "command"; command: string }
  | { type: "error"; message: string }
  | {
      type: "file";
      operation: "created" | "deleted" | "edited" | "read" | "renamed" | "updated" | "wrote";
      path: string;
    }
  | { type: "plan"; summary: string }
  | { type: "tool"; name: string; input: string }
  | { type: "warning"; message: string };

type FileActivityOperation = Extract<SessionActivityPayload, { type: "file" }>["operation"];

export type SessionActivityEvent = {
  id: string;
  kind: SessionActivityEventKind;
  title: string;
  detail: string;
  at: number;
  payload?: SessionActivityPayload;
};

export type SessionActivityInput = {
  kind: SessionActivityEventKind;
  title: string;
  detail: string;
  payload?: SessionActivityPayload;
};

export type TerminalOutputActivityStreamState = {
  carry: string;
  terminalControlCarry?: string;
};

export type TerminalOutputActivityChunkResult = {
  activities: SessionActivityInput[];
  state: TerminalOutputActivityStreamState;
};

const MAX_ACTIVITY_CARRY = 4_096;

export function classifyTerminalOutputChunk(
  state: TerminalOutputActivityStreamState,
  data: string,
): TerminalOutputActivityChunkResult {
  const stripped = stripTerminalControlSequencesWithRemainder(`${state.terminalControlCarry ?? ""}${data}`);
  const normalized = `${state.carry}${stripped.text}`.replace(/\r/g, "\n");
  const segments = normalized.split("\n");
  const unfinished = normalized.endsWith("\n") ? "" : (segments.pop() ?? "");
  const activities = segments.flatMap((segment) => {
    const line = segment.trim();
    if (!line) return [];
    const activity = classifyOutputLine(line);
    return activity ? [activity] : [];
  });
  const prompt = selfTerminatingApproval(unfinished);
  if (prompt) activities.push(prompt);

  return {
    activities,
    state: {
      carry: prompt ? "" : unfinished.slice(-MAX_ACTIVITY_CARRY),
      ...(stripped.remainder ? { terminalControlCarry: stripped.remainder } : {}),
    },
  };
}

function selfTerminatingApproval(value: string): SessionActivityInput | null {
  const line = value.trim();
  if (!line || !(/\?\s*$/.test(line) || /(?:\[|\()\s*y\s*\/\s*n\s*(?:\]|\))\s*$/i.test(line))) {
    return null;
  }
  const activity = classifyOutputLine(line);
  return activity?.kind === "approval" ? activity : null;
}

export function appendActivityEvent(
  events: SessionActivityEvent[] | undefined,
  ownerId: string,
  activity: SessionActivityInput,
  now = Date.now(),
  maxEvents = 40,
): { events: SessionActivityEvent[]; lastActivityAt: number } {
  const previousEvents = events ?? [];
  const lastEvent = previousEvents.at(-1);
  if (
    lastEvent &&
    lastEvent.kind === activity.kind &&
    lastEvent.title === activity.title &&
    lastEvent.detail === activity.detail &&
    payloadKey(lastEvent.payload) === payloadKey(activity.payload)
  ) {
    return { events: previousEvents, lastActivityAt: now };
  }

  const sequence = nextActivityEventSequence(previousEvents, ownerId);
  const event: SessionActivityEvent = {
    id: `${ownerId}-activity-${now}-${sequence}`,
    kind: activity.kind,
    title: activity.title,
    detail: activity.detail,
    ...(activity.payload === undefined ? {} : { payload: activity.payload }),
    at: now,
  };

  return {
    events: [...previousEvents, event].slice(-maxEvents),
    lastActivityAt: now,
  };
}

function nextActivityEventSequence(events: SessionActivityEvent[], ownerId: string): number {
  const prefix = `${ownerId}-activity-`;
  const latestSequence = events.reduce((latest, event) => {
    if (!event.id.startsWith(prefix)) return latest;
    const separator = event.id.lastIndexOf("-");
    if (separator < prefix.length) return latest;
    const sequence = Number(event.id.slice(separator + 1));
    return Number.isSafeInteger(sequence) && sequence > latest ? sequence : latest;
  }, 0);
  return latestSequence + 1;
}

export function classifyTerminalOutputActivity(data: string): SessionActivityInput | null {
  return classifyTerminalOutputActivities(data)[0] ?? null;
}

export function classifyTerminalOutputActivities(data: string): SessionActivityInput[] {
  return normalizedOutputLines(data).flatMap((line) => {
    const activity = classifyOutputLine(line);
    return activity ? [activity] : [];
  });
}

function normalizedOutputLines(data: string): string[] {
  return stripTerminalControlSequences(data)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function classifyOutputLine(line: string): SessionActivityInput | null {
  const toolActivity = classifyToolLine(line);
  if (toolActivity) return toolActivity;

  if (
    /\b(error|failed|failure|exception|traceback|fatal|permission denied|access denied|not permitted)\b/i.test(line)
  ) {
    const detail = truncateActivityDetail(line);
    return {
      kind: "error",
      title: "Error reported",
      detail,
      payload: { type: "error", message: detail },
    };
  }

  if (/\b(warn(?:ing)?|deprecated|caution)\b/i.test(line)) {
    const detail = truncateActivityDetail(line);
    return {
      kind: "warning",
      title: "Warning reported",
      detail,
      payload: { type: "warning", message: detail },
    };
  }

  if (
    /\b(do you want|approve|approval required|requires approval|permission|allow|waiting on you)\b/i.test(line) ||
    /\b(proceed|continue)\?/i.test(line)
  ) {
    const detail = truncateActivityDetail(line);
    return {
      kind: "approval",
      title: "Waiting for approval",
      detail,
      payload: { type: "approval", prompt: detail },
    };
  }

  const commandMatch = line.match(/^(?:[•●⏺]\s*)?(?:ran|run|running|executed|bash)\s+(.+)/i);
  if (commandMatch) {
    const detail = truncateActivityDetail(cleanActivityLine(line));
    return {
      kind: "command",
      title: "Ran command",
      detail,
      payload: { type: "command", command: commandFromDetail(commandMatch[1] ?? detail) },
    };
  }

  const fileActivity = classifyFileLine(line);
  if (fileActivity) return fileActivity;

  if (/^(?:[•●⏺]\s*)?(plan updated|updated plan|todowrite|todo|task list|next steps)\b/i.test(line)) {
    const detail = truncateActivityDetail(cleanActivityLine(line));
    return {
      kind: "plan",
      title: "Plan updated",
      detail,
      payload: { type: "plan", summary: detail },
    };
  }

  if (/(^✓|^✔|\b(done|passed|ready|listening|compiled|built|completed)\b|\bbuild complete\b)/i.test(line)) {
    return {
      kind: "output",
      title: "Progress reported",
      detail: truncateActivityDetail(line),
    };
  }

  return null;
}

function classifyFileLine(line: string): SessionActivityInput | null {
  const operation = fileOperationFromLine(line);
  if (!operation) return null;

  const detail = truncateActivityDetail(cleanActivityLine(line));
  const path = extractPath(detail);
  if (!path) return null;

  return {
    kind: "file",
    title: "File activity",
    detail,
    payload: { type: "file", operation, path },
  };
}

function classifyToolLine(line: string): SessionActivityInput | null {
  const match = line.match(/^(?:[•●⏺]\s*)?([A-Za-z][A-Za-z0-9_-]*)\((.*)\)$/);
  if (!match) return null;

  const toolName = match[1] ?? "";
  const rawDetail = match[2] ?? "";
  const detail = truncateActivityDetail(rawDetail.trim() || cleanActivityLine(line));
  const normalizedTool = toolName.toLowerCase();
  const firstArgument = firstToolArgument(rawDetail);

  if (normalizedTool === "bash") {
    return {
      kind: "command",
      title: "Ran command",
      detail,
      payload: { type: "command", command: firstArgument || commandFromDetail(detail) },
    };
  }

  const fileOperation = fileOperationFromTool(normalizedTool);
  if (fileOperation) {
    const path = firstArgument || extractPath(detail);
    return {
      kind: "file",
      title: `${toolName} file`,
      detail,
      ...(path ? { payload: { type: "file", operation: fileOperation, path } } : {}),
    };
  }

  if (normalizedTool === "todowrite") {
    return {
      kind: "plan",
      title: "Plan updated",
      detail,
      payload: { type: "plan", summary: detail },
    };
  }

  return {
    kind: "tool",
    title: `${toolName} tool`,
    detail,
    payload: { type: "tool", name: toolName, input: detail },
  };
}

function cleanActivityLine(value: string): string {
  return value.replace(/^[•●⏺]\s*/, "").trim();
}

function truncateActivityDetail(value: string): string {
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

function payloadKey(payload: SessionActivityPayload | undefined): string {
  return payload === undefined ? "" : JSON.stringify(payload);
}

function commandFromDetail(detail: string): string {
  return stripMatchingQuotes(detail.trim());
}

function firstToolArgument(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const quote = trimmed[0];
  if (quote === "\"" || quote === "'" || quote === "`") {
    let escaped = false;
    for (let index = 1; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        return unescapeQuoted(trimmed.slice(1, index));
      }
    }
  }

  const jsonPath = trimmed.match(
    /(?:^|[,{\s])(?:path|file_path|filename|command)\s*[:=]\s*["']([^"']+)["']/i,
  );
  if (jsonPath?.[1]) return jsonPath[1];

  return trimmed.split(",")[0]?.trim() ?? "";
}

function stripMatchingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === "\"" || first === "'" || first === "`") && first === last) {
    return unescapeQuoted(value.slice(1, -1));
  }
  return value;
}

function unescapeQuoted(value: string): string {
  return value.replace(/\\(["'`\\])/g, "$1");
}

function fileOperationFromTool(tool: string): FileActivityOperation | null {
  switch (tool) {
    case "edit":
    case "multiedit":
      return "edited";
    case "read":
      return "read";
    case "write":
      return "wrote";
    default:
      return null;
  }
}

function fileOperationFromLine(line: string): FileActivityOperation | null {
  if (/\bcreated\b/i.test(line)) return "created";
  if (/\bdeleted\b/i.test(line)) return "deleted";
  if (/\brenamed\b/i.test(line)) return "renamed";
  if (/\b(updated|modified)\b/i.test(line)) return "updated";
  if (/\bedited\b/i.test(line)) return "edited";
  if (/\b(wrote|written)\b/i.test(line)) return "wrote";
  return null;
}

function extractPath(value: string): string {
  const namedPath = value.match(
    /(?:^|[,{\s])(?:path|file_path|filename|file)\s*[:=]\s*["']?([^"',)\s]+)["']?/i,
  );
  const namedCandidate = normalizePathCandidate(namedPath?.[1]);
  if (isLikelyPath(namedCandidate)) return namedCandidate;

  const quotedMatches = value.matchAll(/["'`]([^"'`]+)["'`]/g);
  for (const match of quotedMatches) {
    const candidate = normalizePathCandidate(match[1]);
    if (isLikelyPath(candidate)) return candidate;
  }

  const operationRemainder = value.match(
    /^(?:created|deleted|modified|updated|renamed|edited|wrote|written)\s+(.+)$/i,
  )?.[1];
  const source = operationRemainder ?? value;
  const tokens = source.split(/\s+/);

  for (const token of tokens) {
    const candidate = normalizePathCandidate(token);
    if (isLikelyPath(candidate)) return candidate;
  }

  return "";
}

function normalizePathCandidate(value: string | undefined): string {
  if (!value) return "";
  return value
    .trim()
    .replace(/^["'`([{<]+/, "")
    .replace(/[>"'`)\]},.;:]+$/, "");
}

function isLikelyPath(value: string): boolean {
  if (!value) return false;
  if (/^(?:https?:|version$|v?\d+(?:\.\d+)+$)/i.test(value)) return false;
  if (/^(?:\.{1,2}\/|\/|~\/)/.test(value)) return true;
  if (/^\.env(?:\.[A-Za-z0-9_-]+)?$/.test(value)) return true;
  if (/^\.[A-Za-z0-9_-]+$/.test(value)) return true;
  if (/^(?:Dockerfile|Makefile|Procfile|README|LICENSE|CHANGELOG)$/i.test(value)) return true;
  if (value.includes("/")) return /[A-Za-z_@-]/.test(value);
  return /^[A-Za-z0-9_@-]+\.[A-Za-z][A-Za-z0-9_-]*$/.test(value);
}
