import { describe, expect, it } from "vitest";

import { IngestEventSchema } from "@alfred/schema";
import { normalizeEvent } from "../src/index.js";

const validInput = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  deviceId: "00000000-0000-4000-8000-000000000101",
  projectKey: "Alfred",
  sourceId: "codex-cli",
  sourceRunId: "run-1",
  sourceEventId: "event-1",
  parentSourceRunId: "parent-run-1",
  type: "run.started",
  status: "running",
  privacyMode: "standard",
  occurredAt: "2026-04-28T10:00:00.000Z",
  payload: { title: "Start" },
} as const;

describe("normalizeEvent", () => {
  it("keeps event IDs stable across project display-name corrections", () => {
    const original = normalizeEvent({ ...validInput, projectName: "Alfred" });
    const renamed = normalizeEvent({ ...validInput, projectName: "Alfred Desktop" });

    expect(renamed.event_id).toBe(original.event_id);
  });

  it("rejects an explicitly provided empty project name", () => {
    expect(() => IngestEventSchema.parse(normalizeEvent({
      ...validInput,
      projectName: "",
    }))).toThrow();
  });

  it("maps camelCase adapter fields to ingest contract", () => {
    const event = normalizeEvent({
      ...validInput,
      projectName: "Alfred",
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
