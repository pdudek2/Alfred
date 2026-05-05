import { describe, expect, it } from "vitest";

import type { RunDetail, RunEventItem } from "../lib/api-client";
import { buildRunStoryVM } from "../lib/run-story";
import { runDetailFixture, runFixture } from "./fixtures";

const now = new Date("2026-04-28T10:30:00.000Z");

function detailWith(overrides: Partial<RunDetail>): RunDetail {
  return { ...runDetailFixture, ...overrides };
}

function eventWith(overrides: Partial<RunEventItem>): RunEventItem {
  return {
    id: "event-extra",
    event_id: "event-extra",
    source_event_id: "source-extra",
    type: "tool.started",
    status: null,
    occurred_at: "2026-04-28T09:30:00.000Z",
    payload: {},
    ...overrides,
  };
}

describe("buildRunStoryVM", () => {
  it("describes a completed run", () => {
    const detail = detailWith({
      ...runFixture,
      status: "completed",
      started_at: "2026-04-28T09:00:00.000Z",
      completed_at: "2026-04-28T09:47:00.000Z",
      events: [
        ...runDetailFixture.events,
        eventWith({
          id: "event-command",
          payload: { command: "pnpm test", duration_ms: 125_000, tool_name: "exec_command" },
        }),
      ],
    });

    const vm = buildRunStoryVM(detail, now);

    expect(vm.paragraph).toMatch(/Codex finished Alfred/i);
    expect(vm.paragraph).toMatch(/47 minutes/i);
    expect(vm.paragraph).toMatch(/Longest command: pnpm test at 2:05/i);
  });

  it("does not call a completed run clean when failures happened during the session", () => {
    const detail = detailWith({
      ...runFixture,
      status: "completed",
      started_at: "2026-04-28T09:00:00.000Z",
      completed_at: "2026-04-28T09:47:00.000Z",
      events: [
        ...runDetailFixture.events,
        eventWith({
          id: "event-failed-tool",
          occurred_at: "2026-04-28T09:30:00.000Z",
          status: "failed",
          type: "tool.failed",
          payload: { error: "test command failed once" },
        }),
      ],
    });

    const vm = buildRunStoryVM(detail, now);

    expect(vm.paragraph).toMatch(/Codex finished Alfred/i);
    expect(vm.paragraph).not.toMatch(/clean/i);
    expect(vm.paragraph).toMatch(/1 interruption/i);
  });

  it("describes a failed run using the most recent failure reason", () => {
    const detail = detailWith({
      status: "failed",
      events: [
        ...runDetailFixture.events,
        eventWith({
          id: "event-old-fail",
          occurred_at: "2026-04-28T09:20:00.000Z",
          status: "failed",
          type: "tool.failed",
          payload: { error: "old error" },
        }),
        eventWith({
          id: "event-new-fail",
          occurred_at: "2026-04-28T09:30:00.000Z",
          status: "failed",
          type: "tool.failed",
          payload: { error: "type error in RunCardVM.subtitle" },
        }),
      ],
    });

    const vm = buildRunStoryVM(detail, now);

    expect(vm.paragraph).toMatch(/stopped on/i);
    expect(vm.paragraph).toMatch(/type error/i);
    expect(vm.paragraph).not.toMatch(/old error/i);
  });

  it("describes an interrupted failed run without saying stopped on interrupted", () => {
    const detail = detailWith({
      status: "failed",
      started_at: "2026-04-28T10:00:00.000Z",
      completed_at: "2026-04-28T10:08:00.000Z",
      events: [
        eventWith({
          id: "event-interrupted",
          occurred_at: "2026-04-28T10:08:00.000Z",
          status: "failed",
          type: "run.failed",
          payload: { reason: "interrupted" },
        }),
      ],
    });

    const vm = buildRunStoryVM(detail, now);

    expect(vm.paragraph).toMatch(/Codex was interrupted after 8 minutes/i);
    expect(vm.paragraph).not.toMatch(/stopped on interrupted/i);
  });

  it("describes a cancelled run as cancelled", () => {
    const detail = detailWith({
      status: "cancelled",
      started_at: "2026-04-28T10:00:00.000Z",
      completed_at: "2026-04-28T10:04:00.000Z",
      events: [
        eventWith({
          id: "event-cancelled",
          occurred_at: "2026-04-28T10:04:00.000Z",
          status: "cancelled",
          type: "run.updated",
          payload: { reason: "cancelled" },
        }),
      ],
    });

    const vm = buildRunStoryVM(detail, now);

    expect(vm.paragraph).toMatch(/Codex was cancelled after 4 minutes/i);
  });

  it("describes a waiting run", () => {
    const detail = detailWith({
      status: "waiting",
      events: [
        ...runDetailFixture.events,
        eventWith({
          status: "waiting",
          type: "approval.requested",
          payload: { message: "approval" },
        }),
      ],
    });

    const vm = buildRunStoryVM(detail, now);

    expect(vm.paragraph).toBe("Codex is waiting on you. Last activity 29 minutes ago.");
    expect(vm.paragraph).not.toMatch(/files touched|so far/i);
  });

  it("does not describe a waiting run as working for the whole stale session age", () => {
    const detail = detailWith({
      status: "waiting",
      started_at: "2026-04-23T00:00:00.000Z",
      completed_at: null,
      updated_at: "2026-04-28T10:29:30.000Z",
      last_activity_at: "2026-04-28T10:29:30.000Z",
      events: [
        eventWith({
          id: "event-waiting",
          occurred_at: "2026-04-28T10:29:30.000Z",
          status: "waiting",
          type: "agent.waiting",
          payload: { message: "waiting on you" },
        }),
      ],
    });

    const vm = buildRunStoryVM(detail, now);

    expect(vm.paragraph).toBe("Codex is waiting on you. Last activity 30 seconds ago.");
    expect(vm.paragraph).not.toMatch(/131 hours|5 days|files touched|so far/i);
  });

  it("describes a running run", () => {
    const detail = detailWith({
      status: "running",
      completed_at: null,
      events: [
        ...runDetailFixture.events,
        eventWith({ payload: { file_path: "apps/web/src/app.tsx" } }),
      ],
    });

    const vm = buildRunStoryVM(detail, now);

    expect(vm.paragraph).toMatch(/is active on/i);
    expect(vm.paragraph).toMatch(/Alfred/i);
    expect(vm.paragraph).toMatch(/1 file path observed/i);
    expect(vm.paragraph).toMatch(/Last activity/i);
  });

  it("does not report zero touched files when no file paths were observed", () => {
    const detail = detailWith({
      status: "running",
      completed_at: null,
      events: [
        eventWith({
          id: "event-command",
          payload: { command: "pnpm test", duration_ms: 125_000, tool_name: "exec_command" },
        }),
      ],
    });

    const vm = buildRunStoryVM(detail, now);

    expect(vm.paragraph).not.toMatch(/\b0 files touched\b/i);
    expect(vm.paragraph).toMatch(/1 command observed/i);
  });

  it("describes a stale run", () => {
    const detail = detailWith({
      status: "running",
      completed_at: null,
      last_activity_at: "2026-04-28T05:00:00.000Z",
      updated_at: "2026-04-28T05:00:00.000Z",
    });

    const vm = buildRunStoryVM(detail, now);

    expect(vm.paragraph).toMatch(/stopped reporting/i);
  });

  it("still describes lifecycle-running quiet runs as stale when last activity is old", () => {
    const detail = detailWith({
      completed_at: null,
      lifecycle_status: "running",
      last_activity_at: "2026-04-28T05:00:00.000Z",
      status: "running",
      updated_at: "2026-04-28T05:00:00.000Z",
    });

    const vm = buildRunStoryVM(detail, now);

    expect(vm.paragraph).toMatch(/stopped reporting/i);
    expect(vm.paragraph).not.toMatch(/is active on/i);
  });

  it("returns a listening fallback for active empty-event runs", () => {
    const detail = detailWith({ events: [] });

    const vm = buildRunStoryVM(detail, now);

    expect(vm.paragraph).toMatch(/Alfred is still listening/i);
    expect(vm.highlights).toEqual([]);
  });

  it("does not describe terminal empty-event runs as still listening", () => {
    expect(buildRunStoryVM(detailWith({ status: "completed", events: [] }), now).paragraph).toBe(
      "This run closed, but no event stream was captured.",
    );
    expect(buildRunStoryVM(detailWith({ status: "failed", events: [] }), now).paragraph).toBe(
      "This run stopped, but no event stream was captured.",
    );
    expect(buildRunStoryVM(detailWith({ status: "cancelled", events: [] }), now).paragraph).toBe(
      "This run was cancelled, but no event stream was captured.",
    );
  });

  it("uses lifecycle status for terminal empty-event runs when raw status is unknown", () => {
    const vm = buildRunStoryVM(
      detailWith({
        completed_at: "2026-04-28T10:05:00.000Z",
        events: [],
        lifecycle_status: "completed",
        status: "unknown",
      }),
      now,
    );

    expect(vm.paragraph).toBe("This run closed, but no event stream was captured.");
  });

  it("uses lifecycle status for the story branch when raw status is unknown", () => {
    const detail = detailWith({
      completed_at: "2026-04-28T10:05:00.000Z",
      events: [
        eventWith({
          id: "event-command",
          payload: { command: "pnpm test", duration_ms: 20_000, tool_name: "exec_command" },
        }),
      ],
      lifecycle_status: "completed",
      status: "unknown",
    });

    const vm = buildRunStoryVM(detail, now);

    expect(vm.paragraph).toMatch(/Codex finished Alfred/i);
    expect(vm.paragraph).not.toMatch(/still listening/i);
  });

  it("falls back to completed_at when raw status is unknown and lifecycle is absent", () => {
    const vm = buildRunStoryVM(
      detailWith({
        completed_at: "2026-04-28T10:05:00.000Z",
        events: [],
        status: "unknown",
      }),
      now,
    );

    expect(vm.paragraph).toBe("This run closed, but no event stream was captured.");
  });

  it("does not describe lifecycle-stale empty runs as still listening", () => {
    const vm = buildRunStoryVM(
      detailWith({
        completed_at: null,
        events: [],
        lifecycle_status: "stale",
        status: "running",
      }),
      now,
    );

    expect(vm.paragraph).toBe("This run went quiet, but no event stream was captured.");
  });

  it("provides highlight ranges that align with substrings", () => {
    const detail = detailWith({
      ...runFixture,
      status: "completed",
      started_at: "2026-04-28T09:00:00.000Z",
      completed_at: "2026-04-28T09:47:00.000Z",
      events: [
        ...runDetailFixture.events,
        eventWith({
          payload: { command: "pnpm test", duration_ms: 125_000, tool_name: "exec_command" },
        }),
      ],
    });

    const vm = buildRunStoryVM(detail, now);

    expect(vm.highlights.length).toBeGreaterThan(0);
    for (const highlight of vm.highlights) {
      const slice = vm.paragraph.slice(highlight.start, highlight.end);
      expect(slice.length).toBeGreaterThan(0);
    }
  });
});
