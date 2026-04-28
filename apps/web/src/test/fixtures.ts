import type { RunDetail, RunListItem } from "../lib/api-client";

export const runFixture: RunListItem = {
  id: "run-1",
  workspace_id: "00000000-0000-4000-8000-000000000001",
  project_id: "project-1",
  project_key: "Alfred",
  project_name: "Alfred",
  source_id: "codex-cli",
  source_run_id: "codex-run-1",
  status: "running",
  title: null,
  started_at: "2026-04-28T10:00:00.000Z",
  completed_at: null,
  updated_at: "2026-04-28T10:01:00.000Z",
  created_at: "2026-04-28T10:00:00.000Z",
};

export const completedRunFixture: RunListItem = {
  ...runFixture,
  id: "run-2",
  source_run_id: "codex-run-2",
  status: "completed",
  started_at: "2026-04-28T09:00:00.000Z",
  completed_at: "2026-04-28T09:42:00.000Z",
};

export const runDetailFixture: RunDetail = {
  ...runFixture,
  events: [
    {
      id: "event-1",
      event_id: "event-000000000001",
      source_event_id: "source-event-1",
      type: "run.started",
      status: "running",
      occurred_at: "2026-04-28T10:00:00.000Z",
      payload: { tool_name: "session" },
    },
    {
      id: "event-2",
      event_id: "event-000000000002",
      source_event_id: "source-event-2",
      type: "tool.started",
      status: null,
      occurred_at: "2026-04-28T10:00:01.000Z",
      payload: { tool_name: "exec_command" },
    },
  ],
};
