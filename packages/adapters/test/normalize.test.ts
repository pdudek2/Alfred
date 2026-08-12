import { describe, expect, it } from "vitest";

import { IngestEventSchema } from "@alfred/schema";
import { deterministicEventId, normalizeEvent } from "../src/index.js";

describe("normalizeEvent", () => {
  it("creates stable event IDs", () => {
    const base = {
      workspaceId: "00000000-0000-4000-8000-000000000001",
      sourceId: "codex-cli" as const,
      sourceRunId: "run-1",
      sourceEventId: "event-1",
      type: "run.started" as const,
    };

    expect(deterministicEventId(base)).toBe(deterministicEventId(base));
  });

  it("maps camelCase adapter fields to ingest contract", () => {
    const event = normalizeEvent({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      deviceId: "00000000-0000-4000-8000-000000000101",
      projectKey: "Alfred",
      projectName: "Alfred",
      sourceId: "codex-cli",
      sourceRunId: "run-1",
      sourceEventId: "event-1",
      parentSourceRunId: "parent-run-1",
      type: "run.started",
      status: "running",
      privacyMode: "standard",
      occurredAt: "2026-04-28T10:00:00.000Z",
      payload: { title: "Start" },
    });
    const parsed = IngestEventSchema.parse(event);

    expect(event.workspace_id).toBe("00000000-0000-4000-8000-000000000001");
    expect(event.source_id).toBe("codex-cli");
    expect(event.event_id).toHaveLength(64);
    expect(parsed).toMatchObject({
      parent_source_run_id: "parent-run-1",
      project_name: "Alfred",
      payload: { title: "Start" },
      status: "running",
    });
  });
});
