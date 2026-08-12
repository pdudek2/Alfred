import { basename, dirname, relative } from "node:path";

import { normalizeEvent } from "@alfred/adapters";
import { IngestEventSchema, type IngestEvent, type PrivacyMode } from "@alfred/schema";
import fg from "fast-glob";

import { scanJsonlLines, type JsonlScannedLine } from "../jsonl-file.js";
import type { SourceAdapter, SourceCollection } from "../source-adapter.js";
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

export type ClaudeAdapterConfig = {
  claudeHome: string;
  workspaceId: string;
  deviceId: string;
  privacyMode: PrivacyMode;
  claudeSince?: string;
  getCursor?: (key: string) => string | null;
  onWarning?: (message: string) => void;
};

type ClaudeSessionContext = {
  sourceRunId: string;
  projectKey: string;
  startedAt?: string;
  startRecordUuid?: string;
  cwd?: string;
  toolNameById: Map<string, string>;
};

type ParseEventInput = {
  config: ClaudeAdapterConfig;
  context: ClaudeSessionContext;
  sourceEventId: string;
  type:
    | "run.started"
    | "run.updated"
    | "tool.started"
    | "tool.completed"
    | "tool.failed"
    | "agent.waiting";
  status?: "running" | "waiting";
  occurredAt: string;
  payload: Record<string, unknown>;
};

export function createClaudeAdapter(config: ClaudeAdapterConfig): SourceAdapter {
  return {
    sourceId: "claude-code",
    collect: () => collectClaudeEvents(config),
  };
}

export async function collectClaudeEvents(config: ClaudeAdapterConfig): Promise<SourceCollection> {
  const files = await fg("projects/**/*.jsonl", {
    cwd: config.claudeHome,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/skill-injections.jsonl"],
  });
  const events: IngestEvent[] = [];
  const cursorUpdates: SourceCollection["cursorUpdates"] = [];
  let invalidCursorCount = 0;
  let cursorMismatchCount = 0;

  for (const file of files.sort()) {
    const relativeSessionPath = relative(config.claudeHome, file);
    const cursorKey = sourceCursorKey("claude-code", relativeSessionPath);
    const parsed = parseStoredSourceCursor(config.getCursor?.(cursorKey) ?? null);
    const scannedRecords: Array<{ line: JsonlScannedLine; record: unknown }> = [];
    let storedPrefixHash: string | undefined;
    let lastLine: JsonlScannedLine | undefined;
    let invalidLineNumber: number | undefined;

    for await (const line of scanJsonlLines(file, (lineNumber) => {
      invalidLineNumber = lineNumber;
      config.onWarning?.(
        `Skipped corrupt claude-code JSONL in ${relativeSessionPath} at line ${lineNumber}`,
      );
    })) {
      if ("record" in line || line.lineNumber === invalidLineNumber) lastLine = line;
      if (parsed.kind === "position" && line.lineNumber === parsed.cursor.line) {
        storedPrefixHash = line.prefixHash;
      }
      if ("record" in line) scannedRecords.push({ line, record: line.record });
    }

    const positionMatches = parsed.kind === "position"
      && storedPrefixHash !== undefined
      && cursorMatchesFile(parsed.cursor, storedPrefixHash);
    if (parsed.kind === "invalid") invalidCursorCount += 1;
    if (parsed.kind === "position" && !positionMatches) cursorMismatchCount += 1;

    const records = scannedRecords.map(({ record }) => record);
    const legacyContext = claudeSessionContext(records, file);
    const project: SourceProjectPin = positionMatches && parsed.kind === "position"
      ? parsed.cursor.project
      : { key: legacyContext.projectKey, name: legacyContext.projectKey };
    const context = { ...legacyContext, projectKey: project.key };
    const positionalStart = positionMatches && parsed.kind === "position" ? parsed.cursor.line : 0;
    const timeFloor = resolveSourceTimeFloor(
      config.claudeSince,
      positionMatches ? { kind: "none" } : parsed,
    );
    const startRecordIndex = records.findIndex(isClaudeConversationRecord);
    const startRecordLine = scannedRecords[startRecordIndex]?.line.lineNumber;

    if (context.startedAt && startRecordLine !== undefined && startRecordLine > positionalStart) {
      const startedAtMs = Date.parse(context.startedAt);
      if (
        timeFloor === undefined
        || startedAtMs > timeFloor.occurredAtMs
        || (timeFloor.includeEqual && startedAtMs === timeFloor.occurredAtMs)
      ) {
        try {
          events.push(parseEvent({
            config,
            context,
            sourceEventId: `${context.sourceRunId}:started`,
            type: "run.started",
            status: "running",
            occurredAt: new Date(startedAtMs).toISOString(),
            payload: {
              cwd: context.cwd,
            },
          }));
        } catch {
          config.onWarning?.(
            `Skipped invalid claude-code record in ${relativeSessionPath} at index ${startRecordIndex}`,
          );
        }
      }
    }

    scannedRecords.forEach(({ line, record }, index) => {
      if (line.lineNumber <= positionalStart) return;

      try {
        const recordEvents = claudeRecordToEvents(record, index, config, context, file, timeFloor);
        events.push(...recordEvents);
      } catch {
        config.onWarning?.(
          `Skipped invalid claude-code record in ${relativeSessionPath} at index ${index}`,
        );
      }
    });

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
      `Reset ${invalidCursorCount} invalid claude-code cursor${invalidCursorCount === 1 ? "" : "s"}`,
    );
  }
  if (cursorMismatchCount > 0) {
    config.onWarning?.(
      `Replayed ${cursorMismatchCount} claude-code session file${cursorMismatchCount === 1 ? "" : "s"} after cursor mismatch`,
    );
  }

  return { events, cursorUpdates };
}

function claudeSessionContext(records: unknown[], file: string): ClaudeSessionContext {
  const sourceRunId =
    firstString(records, "sessionId") ??
    basename(file, ".jsonl");
  const contextRecord = records.find(isClaudeConversationRecord);
  const cwd = isRecord(contextRecord) ? stringValue(contextRecord.cwd) : undefined;
  const startedAt = isRecord(contextRecord) ? stringValue(contextRecord.timestamp) : undefined;
  const startRecordUuid = isRecord(contextRecord) ? stringValue(contextRecord.uuid) : undefined;

  return {
    sourceRunId,
    projectKey: projectKeyFromCwd(cwd) ?? projectKeyFromClaudeProjectPath(file),
    toolNameById: toolNameMap(records),
    ...(startedAt ? { startedAt } : {}),
    ...(startRecordUuid ? { startRecordUuid } : {}),
    ...(cwd ? { cwd } : {}),
  };
}

function claudeRecordToEvents(
  record: unknown,
  index: number,
  config: ClaudeAdapterConfig,
  context: ClaudeSessionContext,
  file: string,
  timeFloor?: SourceTimeFloor,
): IngestEvent[] {
  if (!isRecord(record)) return [];

  const type = stringValue(record.type);
  const occurredAt = stringValue(record.timestamp);
  const occurredAtMs = occurredAt === undefined ? Number.NaN : Date.parse(occurredAt);
  if (!type) return [];
  if (Number.isNaN(occurredAtMs)) {
    config.onWarning?.(
      `Skipped invalid claude-code record in ${relative(config.claudeHome, file)} at index ${index}`,
    );
    return [];
  }
  if (
    timeFloor
    && (occurredAtMs < timeFloor.occurredAtMs
      || (!timeFloor.includeEqual && occurredAtMs === timeFloor.occurredAtMs))
  ) return [];
  const normalizedOccurredAt = new Date(occurredAtMs).toISOString();

  const recordEventId = sourceEventIdForRecord(record, type, normalizedOccurredAt, index);
  if (type === "assistant") {
    return assistantRecordToEvents(record, recordEventId, normalizedOccurredAt, config, context);
  }

  if (type === "user") {
    return userRecordToEvents(record, recordEventId, normalizedOccurredAt, config, context);
  }

  if (type === "system" && stringValue(record.subtype) === "turn_duration") {
    return [
      parseEvent({
        config,
        context,
        sourceEventId: recordEventId,
        type: "run.updated",
        status: "waiting",
        occurredAt: normalizedOccurredAt,
        payload: {
          subtype: "turn_duration",
          duration_ms: numberValue(record.durationMs),
          message_count: numberValue(record.messageCount),
        },
      }),
    ];
  }

  return [];
}

function assistantRecordToEvents(
  record: Record<string, unknown>,
  recordEventId: string,
  occurredAt: string,
  config: ClaudeAdapterConfig,
  context: ClaudeSessionContext,
): IngestEvent[] {
  const message = isRecord(record.message) ? record.message : undefined;
  if (!message) return [];

  const events: IngestEvent[] = [];
  const content = Array.isArray(message.content) ? message.content : [];
  content.forEach((item, itemIndex) => {
    if (!isRecord(item) || item.type !== "tool_use") return;

    const toolUseId = stringValue(item.id) ?? `${recordEventId}:tool:${itemIndex}`;
    events.push(
      parseEvent({
        config,
        context,
        sourceEventId: toolUseId,
        type: "tool.started",
        occurredAt,
        payload: {
          tool_name: stringValue(item.name) ?? "tool_use",
          tool_use_id: toolUseId,
          message_id: stringValue(message.id),
          stop_reason: stringValue(message.stop_reason),
          input_keys: inputKeys(item.input),
        },
      }),
    );
  });

  const stopReason = stringValue(message.stop_reason);
  if (stopReason === "end_turn" || stopReason === "stop_sequence") {
    events.push(
      parseEvent({
        config,
        context,
        sourceEventId: recordEventId,
        type: "agent.waiting",
        status: "waiting",
        occurredAt,
        payload: {
          stop_reason: stopReason,
          message_id: stringValue(message.id),
          model: stringValue(message.model),
          content_types: contentTypes(content),
        },
      }),
    );
  }

  return events;
}

function userRecordToEvents(
  record: Record<string, unknown>,
  recordEventId: string,
  occurredAt: string,
  config: ClaudeAdapterConfig,
  context: ClaudeSessionContext,
): IngestEvent[] {
  const message = isRecord(record.message) ? record.message : undefined;
  if (!message) return [];

  const content = Array.isArray(message.content) ? message.content : [];
  const toolResults = content.filter((item): item is Record<string, unknown> =>
    isRecord(item) && item.type === "tool_result",
  );

  if (toolResults.length > 0) {
    return toolResults.map((item, itemIndex) => {
      const toolUseId = stringValue(item.tool_use_id) ?? `${recordEventId}:tool-result:${itemIndex}`;
      const failed = item.is_error === true;
      return parseEvent({
        config,
        context,
        sourceEventId: `${toolUseId}:result:${recordEventId}`,
        type: failed ? "tool.failed" : "tool.completed",
        occurredAt,
        payload: {
          tool_name: context.toolNameById.get(toolUseId) ?? "tool_result",
          tool_use_id: toolUseId,
          status: failed ? "failed" : "completed",
          is_error: failed,
        },
      });
    });
  }

  if (recordEventId === context.startRecordUuid) return [];
  if (stringValue(message.role) !== "user") return [];

  return [
    parseEvent({
      config,
      context,
      sourceEventId: recordEventId,
      type: "run.updated",
      status: "running",
      occurredAt,
      payload: {
        role: "user",
        user_type: stringValue(record.userType),
      },
    }),
  ];
}

function parseEvent(input: ParseEventInput): IngestEvent {
  const normalizedInput = {
    workspaceId: input.config.workspaceId,
    deviceId: input.config.deviceId,
    projectKey: input.context.projectKey,
    sourceId: "claude-code" as const,
    sourceRunId: input.context.sourceRunId,
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

function toolNameMap(records: unknown[]): Map<string, string> {
  const tools = new Map<string, string>();

  for (const record of records) {
    if (!isRecord(record) || record.type !== "assistant") continue;
    const message = isRecord(record.message) ? record.message : undefined;
    const content = Array.isArray(message?.content) ? message.content : [];

    for (const item of content) {
      if (!isRecord(item) || item.type !== "tool_use") continue;
      const toolUseId = stringValue(item.id);
      const toolName = stringValue(item.name);
      if (toolUseId && toolName) tools.set(toolUseId, toolName);
    }
  }

  return tools;
}

function isClaudeConversationRecord(record: unknown): record is Record<string, unknown> {
  if (!isRecord(record)) return false;
  const type = stringValue(record.type);
  const timestamp = stringValue(record.timestamp);
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) return false;
  return type === "user" || type === "assistant" || type === "system";
}

function firstString(records: unknown[], key: string): string | undefined {
  for (const record of records) {
    if (!isRecord(record)) continue;
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return undefined;
}

function projectKeyFromCwd(cwd: string | undefined): string | undefined {
  return projectKeyFromCwdPath(cwd);
}

function projectKeyFromClaudeProjectPath(file: string): string {
  const encodedProject = basename(dirname(file));
  const normalizedProject = encodedProject.replace(/^-+/, "");
  const commonRootMarkers = [
    "-Desktop-",
    "-Documents-",
    "-Developer-",
    "-Projects-",
    "-repos-",
    "-src-",
    "-workspaces-",
  ];

  for (const marker of commonRootMarkers) {
    const markerIndex = normalizedProject.lastIndexOf(marker);
    if (markerIndex < 0) continue;
    const projectName = normalizedProject.slice(markerIndex + marker.length);
    if (projectName) return projectName;
  }

  const segments = encodedProject.split("-").filter(Boolean);
  return segments.at(-1) ?? "unknown-project";
}

function sourceEventIdForRecord(
  record: Record<string, unknown>,
  type: string,
  occurredAt: string,
  index: number,
): string {
  return (
    stringValue(record.uuid) ??
    stringValue(record.messageId) ??
    `${type}:${occurredAt}:${index}`
  );
}

function contentTypes(content: unknown[]): string[] {
  return content
    .map((item) => isRecord(item) ? stringValue(item.type) : undefined)
    .filter((value): value is string => value !== undefined);
}

function inputKeys(input: unknown): string[] {
  if (!isRecord(input)) return [];
  return Object.keys(input).sort();
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
