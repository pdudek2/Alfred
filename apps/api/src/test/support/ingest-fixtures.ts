import { IngestBatchSchema, type IngestBatch } from "@alfred/schema";

export const workspaceId = "00000000-0000-4000-8000-000000000001";
export const deviceId = "00000000-0000-4000-8000-000000000101";

type BatchEventOverrides = Partial<IngestBatch["events"][number]>;

export function makeBatch(
  batchId = "00000000-0000-4000-8000-000000000201",
  eventOverrides: BatchEventOverrides = {},
): IngestBatch {
  return IngestBatchSchema.parse({
    batch_id: batchId,
    workspace_id: workspaceId,
    device_id: deviceId,
    sent_at: "2026-01-01T10:00:00.000Z",
    events: [
      {
        event_id: "event-000000000001",
        workspace_id: workspaceId,
        device_id: deviceId,
        project_key: "alfred",
        source_id: "codex-cli",
        source_run_id: "run-1",
        source_event_id: "source-event-1",
        type: "run.started",
        status: "running",
        privacy_mode: "standard",
        occurred_at: "2026-01-01T10:00:00.000Z",
        payload: { cwd: "/Users/patryk/Desktop/Alfred" },
        ...eventOverrides,
      },
    ],
  });
}
