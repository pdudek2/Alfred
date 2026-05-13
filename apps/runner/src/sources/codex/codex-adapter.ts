import { basename } from "node:path";

import { normalizeEvent } from "@alfred/adapters";
import { IngestEventSchema, type IngestEvent, type PrivacyMode } from "@alfred/schema";
import fg from "fast-glob";

import type { SourceAdapter } from "../source-adapter.js";
import { readJsonlRecords } from "./codex-jsonl.js";

export type CodexAdapterConfig = {
  codexHome: string;
  workspaceId: string;
  deviceId: string;
  privacyMode: PrivacyMode;
  codexSince?: string;
};

export function createCodexAdapter(config: CodexAdapterConfig): SourceAdapter {
  return {
    sourceId: "codex-cli",
    collect: () => collectCodexEvents(config),
  };
}

export async function collectCodexEvents(config: CodexAdapterConfig): Promise<IngestEvent[]> {
  const files = await fg("sessions/**/*.jsonl", {
    cwd: config.codexHome,
    absolute: true,
    onlyFiles: true,
  });
  const events: IngestEvent[] = [];
  const codexSinceMs = config.codexSince === undefined ? undefined : Date.parse(config.codexSince);

  for (const file of files.sort()) {
    const context = await codexSessionContextFromFile(file);
    let index = 0;

    for await (const record of readJsonlRecords(file)) {
      const event = codexRecordToEvent(record, index, config, context, codexSinceMs);
      if (event) {
        events.push(event);
      }
      index += 1;
    }
  }

  return events;
}

function codexRecordToEvent(
  record: unknown,
  index: number,
  config: CodexAdapterConfig,
  context: CodexSessionContext,
  codexSinceMs?: number,
): IngestEvent | null {
  if (!isRecord(record)) return null;

  const type = stringValue(record.type);
  const occurredAt = stringValue(record.timestamp);
  const occurredAtMs = occurredAt === undefined ? Number.NaN : Date.parse(occurredAt);
  if (!type || !occurredAt || Number.isNaN(occurredAtMs)) return null;
  if (codexSinceMs !== undefined && occurredAtMs <= codexSinceMs) return null;

  if (isRecord(record.payload)) {
    return codexEnvelopeToEvent(record.payload, type, occurredAt, index, config, context);
  }

  const sourceRunId = stringValue(record.session_id) ?? stringValue(record.id);
  if (!sourceRunId) return null;

  const sourceEventId = stringValue(record.id) ?? `${type}:${occurredAt}:${index}`;
  const cwd = stringValue(record.cwd);
  const projectKey = projectKeyFromCwd(cwd);

  if (type === "session.start") {
    return parseEvent({
      config,
      projectKey,
      sourceRunId,
      sourceEventId,
      type: "run.started",
      status: "running",
      occurredAt,
      payload: {
        cwd,
      },
    });
  }

  if (type === "tool.call") {
    return parseEvent({
      config,
      projectKey,
      sourceRunId,
      sourceEventId,
      type: "tool.started",
      occurredAt,
      payload: {
        tool_name: stringValue(record.tool),
      },
    });
  }

  if (type === "tool.result") {
    const status = stringValue(record.status);
    return parseEvent({
      config,
      projectKey,
      sourceRunId,
      sourceEventId,
      type: status === "failed" ? "tool.failed" : "tool.completed",
      occurredAt,
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
      projectKey,
      sourceRunId,
      sourceEventId,
      type: status === "failed" ? "run.failed" : "run.completed",
      status: status === "failed" ? "failed" : "completed",
      occurredAt,
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
  projectKey: string;
};

async function codexSessionContextFromFile(file: string): Promise<CodexSessionContext> {
  let payload: Record<string, unknown> = {};

  for await (const record of readJsonlRecords(file)) {
    if (isRecord(record) && record.type === "session_meta" && isRecord(record.payload)) {
      payload = record.payload;
      break;
    }
  }

  const sourceRunId = stringValue(payload.id) ?? basename(file, ".jsonl");
  const cwd = stringValue(payload.cwd);

  return {
    sourceRunId,
    ...(cwd ? { cwd } : {}),
    projectKey: projectKeyFromCwd(cwd),
  };
}

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
      projectKey: context.projectKey,
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
      projectKey: context.projectKey,
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
      projectKey: context.projectKey,
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
      projectKey: context.projectKey,
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
      projectKey: context.projectKey,
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
      projectKey: projectKeyFromCwd(stringValue(payload.cwd) ?? context.cwd),
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
  if (!cwd) return "unknown-project";
  return basename(cwd) || "unknown-project";
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
  return (
    stringValue(payload.call_id) ??
    stringValue(payload.turn_id) ??
    stringValue(payload.id) ??
    `${envelopeType}:${occurredAt}:${index}`
  );
}
