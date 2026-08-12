import { basename, relative } from "node:path";

import { normalizeEvent } from "@alfred/adapters";
import { IngestEventSchema, type IngestEvent, type PrivacyMode } from "@alfred/schema";
import fg from "fast-glob";

import type { SourceAdapter, SourceCollection } from "../source-adapter.js";
import { scanJsonlLines, type JsonlScannedLine } from "../jsonl-file.js";
import {
  cursorMatchesFile,
  encodeFileCursor,
  parseStoredSourceCursor,
  resolveSourceTimeFloor,
  sourceCursorKey,
  type SourceProjectPin,
  type SourceTimeFloor,
} from "../source-cursor.js";
import { projectKeyFromCwdPath } from "../worktree-project-key.js";

export type CodexAdapterConfig = {
  codexHome: string;
  workspaceId: string;
  deviceId: string;
  privacyMode: PrivacyMode;
  codexSince?: string;
  getCursor?: (key: string) => string | null;
  onWarning?: (message: string) => void;
};

export function createCodexAdapter(config: CodexAdapterConfig): SourceAdapter {
  return {
    sourceId: "codex-cli",
    collect: () => collectCodexEvents(config),
  };
}

export async function collectCodexEvents(config: CodexAdapterConfig): Promise<SourceCollection> {
  const files = await fg("sessions/**/*.jsonl", {
    cwd: config.codexHome,
    absolute: true,
    onlyFiles: true,
  });
  const events: IngestEvent[] = [];
  const cursorUpdates: SourceCollection["cursorUpdates"] = [];
  let invalidCursorCount = 0;
  let cursorMismatchCount = 0;

  for (const file of files.sort()) {
    const relativeSessionPath = relative(config.codexHome, file);
    const cursorKey = sourceCursorKey("codex-cli", relativeSessionPath);
    const parsed = parseStoredSourceCursor(config.getCursor?.(cursorKey) ?? null);
    let sourceRunId = basename(file, ".jsonl");
    let cwd: string | undefined;
    let foundContext = false;
    let storedPrefixHash: string | undefined;
    let lastLine: JsonlScannedLine | undefined;
    let invalidLineNumber: number | undefined;

    for await (const line of scanJsonlLines(file, (lineNumber) => {
      invalidLineNumber = lineNumber;
      config.onWarning?.(
        `Skipped corrupt codex-cli JSONL in ${relativeSessionPath} at line ${lineNumber}`,
      );
    })) {
      if ("record" in line || line.lineNumber === invalidLineNumber) lastLine = line;
      if (parsed.kind === "position" && line.lineNumber === parsed.cursor.line) {
        storedPrefixHash = line.prefixHash;
      }
      if (foundContext || !("record" in line) || !isRecord(line.record)) continue;

      const record = line.record;
      if (record.type === "session_meta" && isRecord(record.payload)) {
        sourceRunId = stringValue(record.payload.id) ?? sourceRunId;
        cwd = stringValue(record.payload.cwd);
        foundContext = true;
      } else if (record.type === "session.start") {
        sourceRunId = stringValue(record.id) ?? stringValue(record.session_id) ?? sourceRunId;
        cwd = stringValue(record.cwd);
        foundContext = true;
      }
    }

    const positionMatches = parsed.kind === "position"
      && storedPrefixHash !== undefined
      && cursorMatchesFile(parsed.cursor, storedPrefixHash);
    if (parsed.kind === "invalid") invalidCursorCount += 1;
    if (parsed.kind === "position" && !positionMatches) cursorMismatchCount += 1;

    const computedLegacyProjectKey = projectKeyFromCwd(cwd);
    const project: SourceProjectPin = positionMatches && parsed.kind === "position"
      ? parsed.cursor.project
      : { key: computedLegacyProjectKey, name: computedLegacyProjectKey };
    const context: CodexSessionContext = {
      sourceRunId,
      ...(cwd ? { cwd } : {}),
      project,
    };
    const positionalStart = positionMatches && parsed.kind === "position" ? parsed.cursor.line : 0;
    const timeFloor = resolveSourceTimeFloor(
      config.codexSince,
      positionMatches ? { kind: "none" } : parsed,
    );
    let index = 0;

    for await (const line of scanJsonlLines(file)) {
      if (!("record" in line)) continue;
      const recordIndex = index++;
      if (line.lineNumber <= positionalStart) continue;

      try {
        const event = codexRecordToEvent(line.record, recordIndex, config, context, file, timeFloor);
        if (event) events.push(event);
      } catch {
        config.onWarning?.(
          `Skipped invalid codex-cli record in ${relative(config.codexHome, file)} at index ${recordIndex}`,
        );
      }
    }

    if (lastLine) {
      cursorUpdates.push({
        key: cursorKey,
        value: encodeFileCursor({
          v: 1,
          line: lastLine.lineNumber,
          prefixHash: lastLine.prefixHash,
          project,
        }),
      });
    }
  }

  if (invalidCursorCount > 0) {
    config.onWarning?.(
      `Reset ${invalidCursorCount} invalid codex-cli cursor${invalidCursorCount === 1 ? "" : "s"}`,
    );
  }
  if (cursorMismatchCount > 0) {
    config.onWarning?.(
      `Replayed ${cursorMismatchCount} codex-cli session file${cursorMismatchCount === 1 ? "" : "s"} after cursor mismatch`,
    );
  }

  return { events, cursorUpdates };
}

function codexRecordToEvent(
  record: unknown,
  index: number,
  config: CodexAdapterConfig,
  context: CodexSessionContext,
  file: string,
  timeFloor?: SourceTimeFloor,
): IngestEvent | null {
  if (!isRecord(record)) return null;

  const type = stringValue(record.type);
  const occurredAt = stringValue(record.timestamp);
  const occurredAtMs = occurredAt === undefined ? Number.NaN : Date.parse(occurredAt);
  if (!type) return null;
  if (Number.isNaN(occurredAtMs)) {
    config.onWarning?.(
      `Skipped invalid codex-cli record in ${relative(config.codexHome, file)} at index ${index}`,
    );
    return null;
  }
  if (
    timeFloor
    && (occurredAtMs < timeFloor.occurredAtMs
      || (!timeFloor.includeEqual && occurredAtMs === timeFloor.occurredAtMs))
  ) return null;
  const normalizedOccurredAt = new Date(occurredAtMs).toISOString();

  if (isRecord(record.payload)) {
    return codexEnvelopeToEvent(record.payload, type, normalizedOccurredAt, index, config, context);
  }

  const sourceEventId = stringValue(record.id) ?? `${type}:${normalizedOccurredAt}:${index}`;

  if (type === "session.start") {
    return parseEvent({
      config,
      projectKey: context.project.key,
      sourceRunId: context.sourceRunId,
      sourceEventId,
      type: "run.started",
      status: "running",
      occurredAt: normalizedOccurredAt,
      payload: {
        cwd: context.cwd,
      },
    });
  }

  if (type === "tool.call") {
    return parseEvent({
      config,
      projectKey: context.project.key,
      sourceRunId: context.sourceRunId,
      sourceEventId,
      type: "tool.started",
      occurredAt: normalizedOccurredAt,
      payload: {
        tool_name: stringValue(record.tool),
      },
    });
  }

  if (type === "tool.result") {
    const status = stringValue(record.status);
    return parseEvent({
      config,
      projectKey: context.project.key,
      sourceRunId: context.sourceRunId,
      sourceEventId,
      type: status === "failed" ? "tool.failed" : "tool.completed",
      occurredAt: normalizedOccurredAt,
      payload: {
        tool_name: stringValue(record.tool),
        status,
      },
    });
  }

  if (type === "session.end") {
    const status = stringValue(record.status);
    return parseEvent({
      config,
      projectKey: context.project.key,
      sourceRunId: context.sourceRunId,
      sourceEventId,
      type: status === "failed" ? "run.failed" : "run.completed",
      status: status === "failed" ? "failed" : "completed",
      occurredAt: normalizedOccurredAt,
      payload: {
        status,
      },
    });
  }

  return null;
}

type CodexSessionContext = {
  sourceRunId: string;
  cwd?: string;
  project: SourceProjectPin;
};

function codexEnvelopeToEvent(
  payload: Record<string, unknown>,
  envelopeType: string,
  occurredAt: string,
  index: number,
  config: CodexAdapterConfig,
  context: CodexSessionContext,
): IngestEvent | null {
  const payloadType = stringValue(payload.type);
  const sourceEventId = sourceEventIdFor(payload, envelopeType, occurredAt, index);

  if (envelopeType === "session_meta") {
    return parseEvent({
      config,
      projectKey: context.project.key,
      sourceRunId: context.sourceRunId,
      sourceEventId,
      type: "run.started",
      status: "running",
      occurredAt,
      payload: {
        cwd: context.cwd,
        cli_version: stringValue(payload.cli_version),
        model_provider: stringValue(payload.model_provider),
        source: stringValue(payload.source),
        agent_role: stringValue(payload.agent_role),
      },
    });
  }

  if (payloadType === "task_complete") {
    return parseEvent({
      config,
      projectKey: context.project.key,
      sourceRunId: context.sourceRunId,
      sourceEventId,
      type: "agent.waiting",
      status: "waiting",
      occurredAt,
      payload: {
        duration_ms: numberValue(payload.duration_ms),
      },
    });
  }

  if (payloadType === "turn_aborted") {
    return parseEvent({
      config,
      projectKey: context.project.key,
      sourceRunId: context.sourceRunId,
      sourceEventId,
      type: "run.failed",
      status: "failed",
      occurredAt,
      payload: {
        duration_ms: numberValue(payload.duration_ms),
        reason: stringValue(payload.reason),
      },
    });
  }

  if (payloadType === "function_call" || payloadType === "custom_tool_call" || payloadType === "tool_search_call") {
    return parseEvent({
      config,
      projectKey: context.project.key,
      sourceRunId: context.sourceRunId,
      sourceEventId,
      type: "tool.started",
      occurredAt,
      payload: {
        tool_name: stringValue(payload.name) ?? payloadType,
        status: stringValue(payload.status),
      },
    });
  }

  if (
    payloadType === "function_call_output" ||
    payloadType === "custom_tool_call_output" ||
    payloadType === "tool_search_output" ||
    payloadType === "mcp_tool_call_end"
  ) {
    return parseEvent({
      config,
      projectKey: context.project.key,
      sourceRunId: context.sourceRunId,
      sourceEventId,
      type: "tool.completed",
      occurredAt,
      payload: {
        tool_name: payloadType,
        status: stringValue(payload.status) ?? "completed",
      },
    });
  }

  if (payloadType === "exec_command_end") {
    return parseEvent({
      config,
      projectKey: context.project.key,
      sourceRunId: context.sourceRunId,
      sourceEventId,
      type: "command.executed",
      occurredAt,
      payload: {
        tool_name: "exec_command",
        status: stringValue(payload.status),
        exit_code: numberValue(payload.exit_code),
        duration_ms: numberValue(payload.duration),
      },
    });
  }

  return null;
}

type ParseEventInput = {
  config: CodexAdapterConfig;
  projectKey: string;
  sourceRunId: string;
  sourceEventId: string;
  type:
    | "run.started"
    | "run.completed"
    | "run.failed"
    | "agent.waiting"
    | "tool.started"
    | "tool.completed"
    | "tool.failed"
    | "command.executed";
  status?: "running" | "waiting" | "completed" | "failed";
  occurredAt: string;
  payload: Record<string, unknown>;
};

function parseEvent(input: ParseEventInput): IngestEvent {
  const normalizedInput = {
    workspaceId: input.config.workspaceId,
    deviceId: input.config.deviceId,
    projectKey: input.projectKey,
    sourceId: "codex-cli" as const,
    sourceRunId: input.sourceRunId,
    sourceEventId: input.sourceEventId,
    type: input.type,
    privacyMode: input.config.privacyMode,
    occurredAt: input.occurredAt,
    payload: input.payload,
    ...(input.status ? { status: input.status } : {}),
  };

  return IngestEventSchema.parse(
    normalizeEvent(normalizedInput),
  );
}

function projectKeyFromCwd(cwd: string | undefined): string {
  return projectKeyFromCwdPath(cwd) ?? "unknown-project";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sourceEventIdFor(
  payload: Record<string, unknown>,
  envelopeType: string,
  occurredAt: string,
  index: number,
): string {
  const payloadType = stringValue(payload.type);
  const callId = stringValue(payload.call_id);
  if (callId && isCallPayloadType(payloadType)) return `${callId}:call`;
  if (callId && isOutputPayloadType(payloadType)) return `${callId}:output`;

  return (
    callId ??
    stringValue(payload.turn_id) ??
    stringValue(payload.id) ??
    `${envelopeType}:${occurredAt}:${index}`
  );
}

function isCallPayloadType(payloadType: string | undefined): boolean {
  return payloadType === "function_call" || payloadType === "custom_tool_call" || payloadType === "tool_search_call";
}

function isOutputPayloadType(payloadType: string | undefined): boolean {
  return (
    payloadType === "function_call_output" ||
    payloadType === "custom_tool_call_output" ||
    payloadType === "tool_search_output" ||
    payloadType === "mcp_tool_call_end"
  );
}
