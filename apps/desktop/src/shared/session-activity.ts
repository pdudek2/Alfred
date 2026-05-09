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

export type SessionActivityEvent = {
  id: string;
  kind: SessionActivityEventKind;
  title: string;
  detail: string;
  at: number;
};

export type SessionActivityInput = {
  kind: SessionActivityEventKind;
  title: string;
  detail: string;
};

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
    lastEvent.detail === activity.detail
  ) {
    return { events: previousEvents, lastActivityAt: now };
  }

  const event: SessionActivityEvent = {
    id: `${ownerId}-activity-${now}-${previousEvents.length + 1}`,
    ...activity,
    at: now,
  };

  return {
    events: [...previousEvents, event].slice(-maxEvents),
    lastActivityAt: now,
  };
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
  return stripAnsi(data)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function classifyOutputLine(line: string): SessionActivityInput | null {
  if (/\b(error|failed|failure|exception|traceback|fatal)\b/i.test(line)) {
    return {
      kind: "error",
      title: "Error reported",
      detail: truncateActivityDetail(line),
    };
  }

  if (/\b(warn(?:ing)?|deprecated|caution)\b/i.test(line)) {
    return {
      kind: "warning",
      title: "Warning reported",
      detail: truncateActivityDetail(line),
    };
  }

  if (
    /\b(do you want|approve|approval required|requires approval|permission|allow|waiting on you)\b/i.test(line) ||
    /\b(proceed|continue)\?/i.test(line)
  ) {
    return {
      kind: "approval",
      title: "Waiting for approval",
      detail: truncateActivityDetail(line),
    };
  }

  const toolActivity = classifyToolLine(line);
  if (toolActivity) return toolActivity;

  if (/^(?:[•●⏺]\s*)?(ran|run|running|executed|bash)\s+(.+)/i.test(line)) {
    return {
      kind: "command",
      title: "Ran command",
      detail: truncateActivityDetail(cleanActivityLine(line)),
    };
  }

  if (
    /^(?:[•●⏺]\s*)?(created|deleted|modified|updated|renamed|edited|wrote|written)\s+(.+)/i.test(line) ||
    /\b(created|deleted|modified|updated|renamed|edited|wrote|written)\b.+\.[a-z0-9]+/i.test(line)
  ) {
    return {
      kind: "file",
      title: "File activity",
      detail: truncateActivityDetail(cleanActivityLine(line)),
    };
  }

  if (/^(?:[•●⏺]\s*)?(plan updated|updated plan|todowrite|todo|task list|next steps)\b/i.test(line)) {
    return {
      kind: "plan",
      title: "Plan updated",
      detail: truncateActivityDetail(cleanActivityLine(line)),
    };
  }

  if (/(^✓|^✔|\b(done|passed|ready|listening|compiled|built|completed)\b)/i.test(line)) {
    return {
      kind: "output",
      title: "Progress reported",
      detail: truncateActivityDetail(line),
    };
  }

  return null;
}

function classifyToolLine(line: string): SessionActivityInput | null {
  const match = line.match(/^(?:[•●⏺]\s*)?([A-Za-z][A-Za-z0-9_-]*)\((.*)\)$/);
  if (!match) return null;

  const toolName = match[1] ?? "";
  const rawDetail = match[2] ?? "";
  const detail = truncateActivityDetail(rawDetail.trim() || cleanActivityLine(line));
  const normalizedTool = toolName.toLowerCase();

  if (normalizedTool === "bash") {
    return {
      kind: "command",
      title: "Ran command",
      detail,
    };
  }

  if (["edit", "multiedit", "read", "write"].includes(normalizedTool)) {
    return {
      kind: "file",
      title: `${toolName} file`,
      detail,
    };
  }

  if (normalizedTool === "todowrite") {
    return {
      kind: "plan",
      title: "Plan updated",
      detail,
    };
  }

  return {
    kind: "tool",
    title: `${toolName} tool`,
    detail,
  };
}

function cleanActivityLine(value: string): string {
  return value.replace(/^[•●⏺]\s*/, "").trim();
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function truncateActivityDetail(value: string): string {
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}
