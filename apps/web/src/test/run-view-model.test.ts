import { describe, expect, it } from "vitest";

import type { RunEventItem, RunListItem } from "../lib/api-client";
import {
  buildActivityGroups,
  buildOverviewVM,
  buildRunCardVM,
  buildRunFactsVM,
  buildRunListVM,
  buildTimeGroupedFeedVM,
  toRunDetailViewModel,
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
    expect(overview.needsAttentionCount).toBe(1);
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
    expect(card.summaryLabel).toMatch(/^Codex · waiting since Apr 28, /);
    expect(card.summaryLabel).not.toContain("11:00");
  });

  it("falls back sanely when runtime title and source run id are not strings", () => {
    const dirtyRun = {
      ...waitingRun,
      id: "run-dirty-labels",
      title: 42,
      source_run_id: { nested: "codex-run" },
    } as unknown as RunListItem;

    expect(() => buildRunCardVM(dirtyRun, NOW)).not.toThrow();

    const card = buildRunCardVM(dirtyRun, NOW);
    expect(card.title).toBe("run-dirty-labels");
    expect(card.intent).toBe("waiting on you");
    expect(card.sourceRunId).toBe("");
    expect(typeof card.sourceRunId).toBe("string");
  });

  it("builds detail VM with render-safe sourceRunId for dirty source run ids", () => {
    const dirtyRun = {
      ...waitingRun,
      id: "run-dirty-detail",
      title: null,
      source_run_id: { nested: "codex-run" },
    } as unknown as RunListItem;

    expect(() => toRunDetailViewModel(dirtyRun, NOW)).not.toThrow();

    const detail = toRunDetailViewModel(dirtyRun, NOW);
    expect(detail.title).toBe("Billing");
    expect(detail.subtitle).toBe("run-dirty-detail");
    expect(detail.sourceRunId).toBe("");
    expect(typeof detail.sourceRunId).toBe("string");
  });

  it("filters waiting runs into Needs without mixing failed runs into that tab", () => {
    const vm = buildRunListVM(runs, {
      tab: "needs",
      query: "codex",
      grouping: "project",
      now: NOW,
    });

    expect(vm.filteredCount).toBe(1);
    expect(vm.groups).toEqual([
      {
        key: "Billing",
        label: "Billing",
        count: 1,
        runs: [expect.objectContaining({ id: "run-waiting" })],
      },
    ]);
  });

  it("filters failed runs into Problems instead of Needs", () => {
    const vm = buildRunListVM(runs, {
      tab: "problems",
      query: "codex",
      grouping: "project",
      now: NOW,
    });

    expect(vm.filteredCount).toBe(1);
    expect(vm.groups).toEqual([
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
    expect(byStatus.groups.map((group) => group.key)).toEqual(["waiting", "running", "failed", "completed"]);
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

  it("uses source activity rather than database updated_at to detect stale waiting runs", () => {
    const reingestedRun: RunListItem = {
      ...waitingRun,
      id: "run-reingested-stale",
      status: "waiting",
      last_activity_at: "2026-04-28T08:00:00.000Z",
      updated_at: "2026-04-28T11:29:00.000Z",
    };

    const card = buildRunCardVM(reingestedRun, NOW);
    const overview = buildOverviewVM([reingestedRun], NOW);
    const needs = buildRunListVM([reingestedRun], { tab: "needs", query: "", grouping: "status", now: NOW });

    expect(card.status).toBe("stale");
    expect(card.sourceStatus).toBe("waiting");
    expect(card.summaryLabel).toMatch(/^Codex · last heard Apr 28, /);
    expect(card.updatedAt).toBe("2026-04-28T08:00:00.000Z");
    expect(overview.liveCount).toBe(0);
    expect(overview.needsAttentionCount).toBe(0);
    expect(needs.filteredCount).toBe(0);
  });

  it("prefers API lifecycle_status over local stale inference when present", () => {
    const apiClassifiedRun: RunListItem = {
      ...waitingRun,
      id: "run-api-lifecycle",
      status: "waiting",
      lifecycle_status: "stale",
      last_activity_at: "2026-04-28T11:29:00.000Z",
      updated_at: "2026-04-28T11:29:00.000Z",
    };

    const card = buildRunCardVM(apiClassifiedRun, NOW);
    const needs = buildRunListVM([apiClassifiedRun], { tab: "needs", query: "", grouping: "status", now: NOW });

    expect(card.status).toBe("stale");
    expect(card.sourceStatus).toBe("waiting");
    expect(card.needsAttention).toBe(false);
    expect(needs.filteredCount).toBe(0);
  });

  it("keeps failed runs in a separate Problems feed section", () => {
    const feed = buildTimeGroupedFeedVM(runs, NOW);

    expect(feed.sections.map((section) => section.label)).toEqual(["Needs you", "Running", "Problems", "Done"]);
    expect(feed.sections.find((section) => section.label === "Needs you")?.runs.map((run) => run.id)).toEqual([
      "run-waiting",
    ]);
    expect(feed.sections.find((section) => section.label === "Problems")?.runs.map((run) => run.id)).toEqual([
      "run-failed",
    ]);
  });

  it("treats unknown runs with completed_at as completed in the reader", () => {
    const unknownCompletedRun: RunListItem = {
      ...runFixture,
      id: "run-unknown-completed",
      status: "unknown",
      title: null,
      completed_at: "2026-04-28T10:03:00.000Z",
      updated_at: "2026-04-28T10:03:00.000Z",
    };

    const card = buildRunCardVM(unknownCompletedRun, NOW);
    const overview = buildOverviewVM([unknownCompletedRun], NOW);
    const done = buildRunListVM([unknownCompletedRun], { tab: "done", query: "", grouping: "flat", now: NOW });

    expect(card.status).toBe("completed");
    expect(card.sourceStatus).toBe("unknown");
    expect(card.intent).toBe("closed session");
    expect(card.summaryLabel).toMatch(/^Codex · closed /);
    expect(card.isDone).toBe(true);
    expect(overview.doneCount).toBe(1);
    expect(done.filteredCount).toBe(1);
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

describe("buildTimeGroupedFeedVM", () => {
  const now = new Date(2026, 3, 29, 11, 0, 0, 0);

  it("groups live runs by whether they are running or need attention", () => {
    const runs = [
      { ...runFixture, id: "r1", status: "running", updated_at: localIso(2026, 3, 29, 10, 55) },
      { ...runFixture, id: "r2", status: "waiting", updated_at: localIso(2026, 3, 29, 10, 50) },
      { ...runFixture, id: "r3", status: "completed", updated_at: localIso(2026, 3, 29, 8, 0) },
    ];
    const vm = buildTimeGroupedFeedVM(runs, now);

    expect(vm.sections.map((section) => section.label)).toEqual(["Needs you", "Running", "Done"]);
    expect(vm.sections.find((section) => section.label === "Needs you")?.runs.map((run) => run.id)).toEqual(["r2"]);
    expect(vm.sections.find((section) => section.label === "Running")?.runs.map((run) => run.id)).toEqual(["r1"]);
  });

  it("places terminal successful runs into Done regardless of local calendar boundaries", () => {
    const runs = [
      {
        ...runFixture,
        id: "r1",
        status: "completed",
        started_at: localIso(2026, 3, 15, 7, 0),
        completed_at: localIso(2026, 3, 29, 7, 30),
        updated_at: localIso(2026, 3, 29, 7, 30),
      },
    ];
    const vm = buildTimeGroupedFeedVM(runs, now);
    const done = vm.sections.find((section) => section.label === "Done")!;
    expect(done.runs.map((run) => run.id)).toEqual(["r1"]);
  });

  it("places failures in Problems", () => {
    const runs = [
      {
        ...failedRun,
        id: "failed-needs-review",
        started_at: localIso(2026, 3, 28, 10, 0),
        completed_at: localIso(2026, 3, 28, 10, 10),
        updated_at: localIso(2026, 3, 28, 10, 10),
      },
    ];
    const vm = buildTimeGroupedFeedVM(runs, now);
    const problems = vm.sections.find((section) => section.label === "Problems")!;
    expect(problems.runs.map((run) => run.id)).toEqual(["failed-needs-review"]);
  });

  it("places stale active runs into Quiet archive", () => {
    const runs = [
      {
        ...runFixture,
        id: "r1",
        status: "running",
        started_at: localIso(2026, 3, 26, 10, 0),
        completed_at: null,
        updated_at: localIso(2026, 3, 26, 10, 10),
      },
    ];
    const vm = buildTimeGroupedFeedVM(runs, now);
    const quiet = vm.sections.find((section) => section.label === "Quiet archive")!;
    expect(quiet.runs.map((run) => run.id)).toEqual(["r1"]);
  });

  it("does not place stale running or waiting runs in Running or Needs you", () => {
    const runs = [
      { ...runFixture, id: "stale-running", status: "running", updated_at: localIso(2026, 3, 29, 8, 30) },
      { ...runFixture, id: "stale-waiting", status: "waiting", updated_at: localIso(2026, 3, 29, 8, 20) },
    ];
    const vm = buildTimeGroupedFeedVM(runs, now);

    expect(vm.sections.find((section) => section.label === "Running")).toBeUndefined();
    expect(vm.sections.find((section) => section.label === "Needs you")).toBeUndefined();
    expect(vm.sections.find((section) => section.label === "Quiet archive")?.runs.map((run) => run.id)).toEqual([
      "stale-running",
      "stale-waiting",
    ]);
  });

  it("omits empty sections", () => {
    const runs = [{ ...runFixture, id: "r1", status: "running", updated_at: now.toISOString() }];
    const vm = buildTimeGroupedFeedVM(runs, now);
    expect(vm.sections.map((section) => section.label)).toEqual(["Running"]);
  });
});

describe("RunCardVM.intent", () => {
  const now = new Date("2026-04-29T11:00:00.000Z");

  it("uses the run title when present", () => {
    const card = buildRunCardVM({ ...runFixture, title: "ingest retry pipeline" }, now);
    expect(card.intent).toBe("ingest retry pipeline");
  });

  it("hides machine source_run_id from intent when no human title exists", () => {
    const card = buildRunCardVM({ ...runFixture, title: null }, now);

    expect(card.intent).toBe("quiet session");
    expect(card.headline).toBe("Alfred · quiet session");
    expect(card.summaryLabel).toMatch(/^Codex · last heard /);
    expect(card.searchText).toContain(runFixture.source_run_id);
  });

  it("falls back to source_run_id when title is empty", () => {
    const card = buildRunCardVM({ ...runFixture, title: "", source_run_id: "source-id" }, now);

    expect(card.title).toBe("source-id");
    expect(card.intent).toBe("source-id");
  });

  it("falls back to normalized source_run_id when title is whitespace-only", () => {
    const card = buildRunCardVM({ ...runFixture, title: "   ", source_run_id: " source-id " }, now);

    expect(card.title).toBe("source-id");
    expect(card.intent).toBe("source-id");
    expect(card.sourceRunId).toBe("source-id");
  });

  it("trims source_run_id for title and intent fallback labels", () => {
    const card = buildRunCardVM({ ...runFixture, id: "run-with-padded-source", title: null, source_run_id: " padded-id " }, now);

    expect(card.title).toBe("padded-id");
    expect(card.intent).toBe("padded-id");
    expect(card.sourceRunId).toBe("padded-id");
    expect(card.searchText).toContain("padded-id");
    expect(card.searchText).toContain("run-with-padded-source");
  });

  it("falls back past whitespace-only source_run_id for title and derives intent from effective status", () => {
    const card = buildRunCardVM({ ...runFixture, id: "run-with-blank-source", title: null, source_run_id: "   " }, now);

    expect(card.title).toBe("run-with-blank-source");
    expect(card.intent).toBe("quiet session");
    expect(card.sourceRunId).toBe("");
  });

  it("derives intent from effective status when neither title nor source_run_id exists", () => {
    const card = buildRunCardVM({ ...runFixture, title: null, source_run_id: "" }, now);
    expect(card.intent).toBe("quiet session");
  });
});

function localIso(year: number, monthIndex: number, day: number, hour: number, minute: number): string {
  return new Date(year, monthIndex, day, hour, minute, 0, 0).toISOString();
}

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
