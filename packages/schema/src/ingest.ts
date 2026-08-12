import { z } from "zod";

import { AgentSource, EventType, PrivacyMode, RunStatus } from "./enums.js";

export const IngestEventSchema = z.object({
  event_id: z.string().min(12),
  workspace_id: z.string().uuid(),
  device_id: z.string().uuid(),
  project_key: z.string().min(1),
  project_name: z.string().trim().min(1).max(160).optional(),
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

export const IngestBatchSchema = z
  .object({
    batch_id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    device_id: z.string().uuid(),
    sent_at: z.string().datetime(),
    events: z.array(IngestEventSchema).min(1).max(500),
  })
  .superRefine((batch, ctx) => {
    batch.events.forEach((event, index) => {
      if (event.workspace_id !== batch.workspace_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "event workspace_id must match batch workspace_id",
          path: ["events", index, "workspace_id"],
        });
      }

      if (event.device_id !== batch.device_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "event device_id must match batch device_id",
          path: ["events", index, "device_id"],
        });
      }
    });
  });

export type IngestEventInput = z.input<typeof IngestEventSchema>;
export type IngestEvent = z.output<typeof IngestEventSchema>;
export type IngestBatchInput = z.input<typeof IngestBatchSchema>;
export type IngestBatch = z.output<typeof IngestBatchSchema>;
