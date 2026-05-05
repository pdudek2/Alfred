import { describe, expect, it } from "vitest";

import type { RunEventItem } from "../lib/api-client";
import { buildRunPhases, eventLine } from "../lib/run-phases";

const baseEvent: RunEventItem = {
  event_id: "event-id",
  id: "event-id",
  occurred_at: "2026-04-28T10:00:00.000Z",
  payload: {},
  source_event_id: "source-event-id",
  status: null,
  type: "tool.started",
};

describe("buildRunPhases", () => {
  it("groups adjacent events into human-readable phases", () => {
    const phases = buildRunPhases([
      event("run", "run.started", "2026-04-28T10:00:00.000Z", { tool_name: "session" }),
      event("read-1", "tool.started", "2026-04-28T10:00:01.000Z", { tool_name: "Read", file_path: "apps/api/src/app.ts" }),
      event("read-2", "tool.started", "2026-04-28T10:00:02.000Z", { tool_name: "Read", file_path: "apps/api/src/routes/auth.ts" }),
      event("edit", "tool.started", "2026-04-28T10:00:03.000Z", { tool_name: "Edit", file_path: "apps/api/src/routes/auth.ts" }),
      event("test", "tool.completed", "2026-04-28T10:00:04.000Z", { command: "pnpm --filter @alfred/api test", tool_name: "exec_command" }),
      event("fail", "tool.failed", "2026-04-28T10:00:05.000Z", { command: "pnpm build", tool_name: "exec_command" }),
    ]);

    expect(phases.map((phase) => [phase.kind, phase.title, phase.summary])).toEqual([
      ["session", "Opened the session", "1 event"],
      ["read", "Read the project", "2 reads"],
      ["edit", "Changed files", "1 change"],
      ["test", "Checked the work", "1 check"],
      ["failure", "Hit a problem", "1 failure"],
    ]);
    expect(phases[1]?.events.map((event) => event.label)).toEqual(["Read started", "Read started"]);
    expect(phases[3]?.events[0]?.label).toBe("Finished pnpm --filter @alfred/api test");
  });

  it("keeps long adjacent phases linear while preserving counts and labels", () => {
    const events = Array.from({ length: 200 }, (_, index) =>
      event(`read-${index}`, "tool.started", timestampAtSecond(index), { tool_name: "Read" }),
    );

    const phases = buildRunPhases(events);

    expect(phases).toHaveLength(1);
    expect(phases[0]?.eventCount).toBe(200);
    expect(phases[0]?.summary).toBe("200 reads");
    expect(phases[0]?.events).toHaveLength(200);
    expect(phases[0]?.events[0]?.label).toBe("Read started");
    expect(phases[0]?.endedAt).toBe(timestampAtSecond(199));
  });
});

describe("eventLine", () => {
  it("describes run and command events without exposing raw event names", () => {
    expect(eventLine(event("run", "run.started", "2026-04-28T10:00:00.000Z", {}))).toBe("Session opened");
    expect(eventLine(event("cmd", "tool.started", "2026-04-28T10:00:01.000Z", { command: "pnpm test", tool_name: "exec_command" }))).toBe("Started pnpm test");
  });
});

function event(id: string, type: string, occurredAt: string, payload: Record<string, unknown>): RunEventItem {
  return {
    ...baseEvent,
    event_id: id,
    id,
    occurred_at: occurredAt,
    payload,
    source_event_id: `source-${id}`,
    type,
  };
}

function timestampAtSecond(offset: number): string {
  return new Date(Date.UTC(2026, 3, 28, 10, 0, offset)).toISOString();
}
