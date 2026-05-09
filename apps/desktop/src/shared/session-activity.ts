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
  const lines = stripAnsi(data)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const errorLine = lines.find((line) => /\b(error|failed|failure|exception|traceback|fatal)\b/i.test(line));
  if (errorLine) {
    return {
      kind: "error",
      title: "Error reported",
      detail: truncateActivityDetail(errorLine),
    };
  }

  const warningLine = lines.find((line) => /\b(warn(?:ing)?|deprecated|caution)\b/i.test(line));
  if (warningLine) {
    return {
      kind: "warning",
      title: "Warning reported",
      detail: truncateActivityDetail(warningLine),
    };
  }

  const approvalLine = lines.find(
    (line) =>
      /\b(do you want|approve|approval required|requires approval|permission|allow|waiting on you)\b/i.test(line) ||
      /\b(proceed|continue)\?/i.test(line),
  );
  if (approvalLine) {
    return {
      kind: "approval",
      title: "Waiting for approval",
      detail: truncateActivityDetail(approvalLine),
    };
  }

  const toolActivity = lines.map(classifyToolLine).find((activity) => activity !== null);
  if (toolActivity) return toolActivity;

  const commandLine = lines.find((line) =>
    /^(?:[•●⏺]\s*)?(ran|run|running|executed|bash)\s+(.+)/i.test(line),
  );
  if (commandLine) {
    return {
      kind: "command",
      title: "Ran command",
      detail: truncateActivityDetail(cleanActivityLine(commandLine)),
    };
  }

  const fileLine = lines.find((line) =>
    /^(?:[•●⏺]\s*)?(created|deleted|modified|updated|renamed|edited|wrote|written)\s+(.+)/i.test(line) ||
    /\b(created|deleted|modified|updated|renamed|edited|wrote|written)\b.+\.[a-z0-9]+/i.test(line),
  );
  if (fileLine) {
    return {
      kind: "file",
      title: "File activity",
      detail: truncateActivityDetail(cleanActivityLine(fileLine)),
    };
  }

  const planLine = lines.find((line) =>
    /^(?:[•●⏺]\s*)?(plan updated|updated plan|todowrite|todo|task list|next steps)\b/i.test(line),
  );
  if (planLine) {
    return {
      kind: "plan",
      title: "Plan updated",
      detail: truncateActivityDetail(cleanActivityLine(planLine)),
    };
  }

  const readyLine = lines.find((line) => /(^✓|^✔|\b(done|passed|ready|listening|compiled|built|completed)\b)/i.test(line));
  if (readyLine) {
    return {
      kind: "output",
      title: "Progress reported",
      detail: truncateActivityDetail(readyLine),
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
