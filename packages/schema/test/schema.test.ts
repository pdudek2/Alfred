import { describe, expect, it } from "vitest";

import {
  FieldReportSchema,
  IngestBatchSchema,
  PrivacyPolicySchema,
  RUN_LIFECYCLE_STATUSES,
} from "../src/index";
import type { IngestBatch, IngestBatchInput } from "../src/index";

const validEvent = {
  event_id: "evt_000000000001",
  workspace_id: "00000000-0000-4000-8000-000000000001",
  device_id: "00000000-0000-4000-8000-000000000101",
  project_key: "/Users/patryk/Desktop/Alfred",
  source_id: "codex-cli",
  source_run_id: "thread-1",
  source_event_id: "thread-1:updated",
  type: "run.updated",
  occurred_at: "2026-04-27T20:00:00.000Z",
} satisfies IngestBatchInput["events"][number];

const validBatch = {
  batch_id: "00000000-0000-4000-8000-000000000201",
  workspace_id: "00000000-0000-4000-8000-000000000001",
  device_id: "00000000-0000-4000-8000-000000000101",
  sent_at: "2026-04-27T20:00:00.000Z",
  events: [validEvent],
} satisfies IngestBatchInput;

describe("schema contracts", () => {
  it("accepts a minimal standard ingest batch", () => {
    const parsed: IngestBatch = IngestBatchSchema.parse(validBatch);

    expect(parsed.events[0].privacy_mode).toBe("standard");
  });

  it("rejects invalid ingest source ids", () => {
    const batch = {
      ...validBatch,
      events: [{ ...validEvent, source_id: "terminal" }],
    };

    expect(() => IngestBatchSchema.parse(batch)).toThrow();
  });

  it("rejects invalid workspace and device ids", () => {
    expect(() =>
      IngestBatchSchema.parse({ ...validBatch, workspace_id: "workspace-1" }),
    ).toThrow();

    expect(() =>
      IngestBatchSchema.parse({ ...validBatch, device_id: "device-1" }),
    ).toThrow();
  });

  it("accepts 500 events and rejects 501 events", () => {
    const fiveHundredEvents = Array.from({ length: 500 }, (_, index) => ({
      ...validEvent,
      event_id: `evt_${String(index).padStart(12, "0")}`,
      source_event_id: `thread-1:${index}`,
    }));

    expect(
      IngestBatchSchema.parse({ ...validBatch, events: fiveHundredEvents })
        .events,
    ).toHaveLength(500);

    expect(() =>
      IngestBatchSchema.parse({
        ...validBatch,
        events: [
          ...fiveHundredEvents,
          {
            ...validEvent,
            event_id: "evt_000000000500",
            source_event_id: "thread-1:500",
          },
        ],
      }),
    ).toThrow();
  });

  it("allows input to omit defaulted fields and returns parsed defaults", () => {
    const parsed = IngestBatchSchema.parse(validBatch);

    expect(parsed.events[0]).toMatchObject({
      privacy_mode: "standard",
      payload: {},
    });
  });

  it("rejects ingest events outside the batch workspace or device", () => {
    expect(() =>
      IngestBatchSchema.parse({
        ...validBatch,
        events: [
          {
            ...validEvent,
            workspace_id: "00000000-0000-4000-8000-000000000999",
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      IngestBatchSchema.parse({
        ...validBatch,
        events: [
          {
            ...validEvent,
            device_id: "00000000-0000-4000-8000-000000000999",
          },
        ],
      }),
    ).toThrow();
  });

  it("defaults field report arrays", () => {
    const parsed = FieldReportSchema.parse({
      source_id: "claude-code",
      summary: "Implemented the runner outbox.",
    });

    expect(parsed.completed_work).toEqual([]);
    expect(parsed.confidence).toBe("medium");
  });

  it("denies secret-looking artifacts by default", () => {
    const parsed = PrivacyPolicySchema.parse({});
    expect(parsed.mode).toBe("standard");
    expect(parsed.denied_artifact_globs).toContain(".env");
  });

  it("exports the current run lifecycle status vocabulary", () => {
    expect(RUN_LIFECYCLE_STATUSES).toEqual([
      "running",
      "waiting",
      "failed",
      "cancelled",
      "completed",
      "stale",
      "other",
    ]);
  });
});
