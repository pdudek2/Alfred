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

    expect(vm.paragraph).toMatch(/waiting for your/i);
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

    expect(vm.paragraph).toMatch(/has been working/i);
    expect(vm.paragraph).toMatch(/Alfred/i);
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

  it("returns a fallback for empty events", () => {
    const detail = detailWith({ events: [] });

    const vm = buildRunStoryVM(detail, now);

    expect(vm.paragraph).toMatch(/Alfred is still listening/i);
    expect(vm.highlights).toEqual([]);
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
