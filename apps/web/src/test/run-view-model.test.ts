import { describe, expect, it } from "vitest";

import type { RunEventItem, RunListItem } from "../lib/api-client";
import {
  buildActivityGroups,
  buildOverviewVM,
  buildRunCardVM,
  buildRunFactsVM,
  buildRunListVM,
} from "../lib/run-view-model";
import { completedRunFixture, runFixture } from "./fixtures";

const NOW = new Date("2026-04-28T11:30:00.000Z");

const waitingRun: RunListItem = {
  ...runFixture,
  id: "run-waiting",
  project_name: "Billing",
  project_key: "BILL",
  source_run_id: "codex-waiting",
  status: "waiting",
  title: "Needs approval",
  started_at: "2026-04-28T11:00:00.000Z",
  completed_at: null,
  updated_at: "2026-04-28T11:10:00.000Z",
  created_at: "2026-04-28T11:00:00.000Z",
};

const failedRun: RunListItem = {
  ...runFixture,
  id: "run-failed",
  project_name: null,
  project_key: "Ops",
  source_run_id: "codex-failed",
  status: "failed",
  title: "Broken deployment",
  started_at: "2026-04-28T10:30:00.000Z",
  completed_at: "2026-04-28T10:35:00.000Z",
  updated_at: "2026-04-28T10:35:00.000Z",
  created_at: "2026-04-28T10:30:00.000Z",
};

const completedRun: RunListItem = {
  ...completedRunFixture,
  id: "run-completed",
  project_name: "Alfred",
  project_key: "ALF",
  source_run_id: "codex-completed",
  status: "completed",
  title: "Ship triage UI",
  updated_at: "2026-04-28T09:42:00.000Z",
};

const runs = [completedRun, waitingRun, failedRun, runFixture];

describe("run view model", () => {
  it("builds overview counts without mutating input ordering", () => {
    const originalOrder = runs.map((run) => run.id);
    const overview = buildOverviewVM(runs, NOW);

    expect(runs.map((run) => run.id)).toEqual(originalOrder);
    expect(overview.totalCount).toBe(4);
    expect(overview.liveCount).toBe(2);
    expect(overview.needsAttentionCount).toBe(2);
    expect(overview.doneCount).toBe(1);
    expect(overview.latestUpdatedAt).toBe("2026-04-28T11:10:00.000Z");
    expect(overview.statusCounts).toEqual([
      { key: "completed", status: "completed", count: 1 },
      { key: "failed", status: "failed", count: 1 },
      { key: "running", status: "running", count: 1 },
      { key: "waiting", status: "waiting", count: 1 },
    ]);
  });

  it("builds run card labels and status buckets", () => {
    const card = buildRunCardVM(waitingRun, NOW);

    expect(card).toMatchObject({
      id: "run-waiting",
      title: "Needs approval",
      projectLabel: "Billing",
      sourceLabel: "codex-cli",
      status: "waiting",
      isLive: true,
      needsAttention: true,
      isDone: false,
      durationLabel: "open",
    });
    expect(card.searchText).toContain("needs approval");
    expect(card.searchText).toContain("billing");
  });

  it("filters by tab and query, then groups by project deterministically", () => {
    const vm = buildRunListVM(runs, {
      tab: "needs",
      query: "codex",
      grouping: "project",
      now: NOW,
    });

    expect(vm.filteredCount).toBe(2);
    expect(vm.groups).toEqual([
      {
        key: "Billing",
        label: "Billing",
        count: 1,
        runs: [expect.objectContaining({ id: "run-waiting" })],
      },
      {
        key: "Ops",
        label: "Ops",
        count: 1,
        runs: [expect.objectContaining({ id: "run-failed" })],
      },
    ]);
  });

  it("supports flat and status grouped run lists", () => {
    const flat = buildRunListVM(runs, { tab: "done", query: "", grouping: "flat", now: NOW });
    const byStatus = buildRunListVM(runs, { tab: "all", query: "", grouping: "status", now: NOW });

    expect(flat.groups).toHaveLength(1);
    expect(flat.groups[0]).toMatchObject({
      key: "all",
      count: 1,
      runs: [expect.objectContaining({ id: "run-completed" })],
    });
    expect(byStatus.groups.map((group) => group.key)).toEqual(["running", "waiting", "failed", "completed"]);
  });

  it("builds run facts and includes deterministic activity groups", () => {
    const facts = buildRunFactsVM(waitingRun, activityEvents);

    expect(facts.runId).toBe("run-waiting");
    expect(facts.eventCount).toBe(5);
    expect(facts.facts).toContainEqual({ label: "Project", value: "Billing" });
    expect(facts.activityGroups.map((group) => [group.kind, group.count])).toEqual([
      ["failure", 1],
      ["waiting", 1],
      ["tool", 1],
      ["run", 1],
      ["other", 1],
    ]);
  });

  it("marks silent active runs as stale without counting them as live or needs attention", () => {
    const staleRun: RunListItem = {
      ...waitingRun,
      id: "run-stale",
      status: "running",
      updated_at: "2026-04-28T08:00:00.000Z",
    };

    const card = buildRunCardVM(staleRun, NOW);
    const overview = buildOverviewVM([staleRun], NOW);
    const live = buildRunListVM([staleRun], { tab: "live", query: "", grouping: "status", now: NOW });

    expect(card.status).toBe("stale");
    expect(card.sourceStatus).toBe("running");
    expect(card.isLive).toBe(false);
    expect(card.needsAttention).toBe(false);
    expect(overview.liveCount).toBe(0);
    expect(live.filteredCount).toBe(0);
  });

  it("groups activity honestly by event kind and preserves chronological order inside groups", () => {
    const groups = buildActivityGroups(activityEvents);

    expect(groups.map((group) => group.kind)).toEqual(["failure", "waiting", "tool", "run", "other"]);
    expect(groups.find((group) => group.kind === "failure")?.events.map((event) => event.id)).toEqual(["event-4"]);
    expect(groups.find((group) => group.kind === "tool")?.events).toEqual([
      expect.objectContaining({
        id: "event-2",
        type: "tool.started",
        payload: { tool_name: "exec_command" },
      }),
    ]);
  });
});

const activityEvents: RunEventItem[] = [
  {
    id: "event-3",
    event_id: "event-3",
    source_event_id: "source-event-3",
    type: "run.started",
    status: "running",
    occurred_at: "2026-04-28T11:00:00.000Z",
    payload: {},
  },
  {
    id: "event-5",
    event_id: "event-5",
    source_event_id: "source-event-5",
    type: "message.created",
    status: null,
    occurred_at: "2026-04-28T11:00:04.000Z",
    payload: { text: "plain event" },
  },
  {
    id: "event-2",
    event_id: "event-2",
    source_event_id: "source-event-2",
    type: "tool.started",
    status: null,
    occurred_at: "2026-04-28T11:00:01.000Z",
    payload: { tool_name: "exec_command" },
  },
  {
    id: "event-4",
    event_id: "event-4",
    source_event_id: "source-event-4",
    type: "tool.failed",
    status: "failed",
    occurred_at: "2026-04-28T11:00:03.000Z",
    payload: { tool_name: "exec_command" },
  },
  {
    id: "event-1",
    event_id: "event-1",
    source_event_id: "source-event-1",
    type: "approval.waiting",
    status: "waiting",
    occurred_at: "2026-04-28T11:00:02.000Z",
    payload: {},
  },
];
