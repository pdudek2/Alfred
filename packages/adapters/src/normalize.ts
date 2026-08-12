import { createHash } from "node:crypto";

import type { AgentSource, EventType, PrivacyMode, RunStatus } from "@alfred/schema";

export type NormalizedEventInput = {
  workspaceId: string;
  deviceId: string;
  projectKey: string;
  projectName?: string;
  sourceId: AgentSource;
  sourceRunId: string;
  sourceEventId: string;
  parentSourceRunId?: string;
  type: EventType;
  status?: RunStatus;
  privacyMode: PrivacyMode;
  occurredAt: string;
  payload: Record<string, unknown>;
};

export function deterministicEventId(
  input: Pick<
    NormalizedEventInput,
    "workspaceId" | "sourceId" | "sourceRunId" | "sourceEventId" | "type"
  >,
): string {
  return createHash("sha256")
    .update([input.workspaceId, input.sourceId, input.sourceRunId, input.sourceEventId, input.type].join("\n"))
    .digest("hex");
}

export function normalizeEvent(input: NormalizedEventInput) {
  return {
    event_id: deterministicEventId(input),
    workspace_id: input.workspaceId,
    device_id: input.deviceId,
    project_key: input.projectKey,
    ...(input.projectName ? { project_name: input.projectName } : {}),
    source_id: input.sourceId,
    source_run_id: input.sourceRunId,
    source_event_id: input.sourceEventId,
    parent_source_run_id: input.parentSourceRunId,
    type: input.type,
    status: input.status,
    privacy_mode: input.privacyMode,
    occurred_at: input.occurredAt,
    payload: input.payload,
  };
}
