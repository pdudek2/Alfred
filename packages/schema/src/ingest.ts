import { z } from "zod";

import { AgentSource, EventType, PrivacyMode, RunStatus } from "./enums.js";

export const IngestEventSchema = z.object({
  event_id: z.string().min(12),
  workspace_id: z.string().uuid(),
  device_id: z.string().uuid(),
  project_key: z.string().min(1),
  source_id: AgentSource,
  source_run_id: z.string().min(1),
  source_event_id: z.string().min(1),
  parent_source_run_id: z.string().optional(),
  type: EventType,
  status: RunStatus.optional(),
  privacy_mode: PrivacyMode.default("standard"),
  occurred_at: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const IngestBatchSchema = z.object({
  batch_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  device_id: z.string().uuid(),
  sent_at: z.string().datetime(),
  events: z.array(IngestEventSchema).min(1).max(500),
});

export type IngestEventInput = z.input<typeof IngestEventSchema>;
export type IngestEvent = z.output<typeof IngestEventSchema>;
export type IngestBatchInput = z.input<typeof IngestBatchSchema>;
export type IngestBatch = z.output<typeof IngestBatchSchema>;
