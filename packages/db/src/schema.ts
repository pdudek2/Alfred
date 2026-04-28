import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const LOCAL_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000011";
export const LOCAL_DEVICE_ID = "00000000-0000-4000-8000-000000000101";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAtNow = sql`now()`;

// Convention: repository/service updates must set updated_at to updatedAtNow.
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().default(updatedAtNow);

export const agentSourceEnum = pgEnum("agent_source", [
  "claude-code",
  "codex-cli",
  "openai-agents-sdk",
  "langgraph",
  "custom",
]);

export const privacyModeEnum = pgEnum("privacy_mode", ["minimal", "standard", "full"]);

export const runStatusEnum = pgEnum("run_status", [
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
  "unknown",
]);

export const eventTypeEnum = pgEnum("event_type", [
  "run.started",
  "run.updated",
  "run.completed",
  "run.failed",
  "agent.waiting",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "file.touched",
  "command.executed",
  "test.result",
  "spawn.created",
  "field_report.submitted",
  "alert.raised",
]);

export const missionStatusEnum = pgEnum("mission_status", [
  "planned",
  "running",
  "blocked",
  "completed",
  "cancelled",
]);

export const alertStatusEnum = pgEnum("alert_status", ["open", "acknowledged", "resolved"]);

export const alertSeverityEnum = pgEnum("alert_severity", ["info", "warning", "critical"]);

export const relationTypeEnum = pgEnum("run_relation_type", [
  "parent",
  "child",
  "spawned",
  "continued",
  "related",
]);

export const knowledgeKindEnum = pgEnum("knowledge_kind", [
  "note",
  "decision",
  "preference",
  "fact",
  "risk",
]);

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaces = pgTable("workspaces", {
  id: id(),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  workspaceKey: text("workspace_key").notNull().unique(),
  name: text("name").notNull(),
  privacyMode: privacyModeEnum("privacy_mode").notNull().default("standard"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// devices.id is the canonical external runner UUID from RUNNER_DEVICE_ID/IngestBatch.device_id.
// device_key is only a stable display or registration key scoped to the workspace.
export const devices = pgTable(
  "devices",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    deviceKey: text("device_key").notNull(),
    name: text("name").notNull(),
    platform: text("platform"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("devices_workspace_device_key_unique").on(table.workspaceId, table.deviceKey),
    index("devices_workspace_id_idx").on(table.workspaceId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectKey: text("project_key").notNull(),
    name: text("name").notNull(),
    rootPath: text("root_path"),
    repositoryUrl: text("repository_url"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("projects_workspace_project_key_unique").on(table.workspaceId, table.projectKey),
    index("projects_workspace_id_idx").on(table.workspaceId),
  ],
);

export const missions = pgTable(
  "missions",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    objective: text("objective"),
    status: missionStatusEnum("status").notNull().default("planned"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("missions_workspace_id_idx").on(table.workspaceId),
    index("missions_project_id_idx").on(table.projectId),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
    sourceId: agentSourceEnum("source_id").notNull(),
    sourceRunId: text("source_run_id").notNull(),
    title: text("title"),
    status: runStatusEnum("status").notNull().default("unknown"),
    privacyMode: privacyModeEnum("privacy_mode").notNull().default("standard"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    summary: text("summary"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("runs_workspace_source_run_unique").on(
      table.workspaceId,
      table.sourceId,
      table.sourceRunId,
    ),
    index("runs_workspace_id_idx").on(table.workspaceId),
    index("runs_project_id_idx").on(table.projectId),
    index("runs_mission_id_idx").on(table.missionId),
  ],
);

export const runRelations = pgTable(
  "run_relations",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentRunId: uuid("parent_run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    childRunId: uuid("child_run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    relationType: relationTypeEnum("relation_type").notNull().default("related"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("run_relations_parent_child_type_unique").on(
      table.parentRunId,
      table.childRunId,
      table.relationType,
    ),
    index("run_relations_workspace_id_idx").on(table.workspaceId),
  ],
);

export const events = pgTable(
  "events",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    sourceId: agentSourceEnum("source_id").notNull(),
    sourceRunId: text("source_run_id").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    type: eventTypeEnum("type").notNull(),
    status: runStatusEnum("status"),
    privacyMode: privacyModeEnum("privacy_mode").notNull().default("standard"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("events_workspace_event_id_unique").on(table.workspaceId, table.eventId),
    uniqueIndex("events_workspace_source_event_unique").on(
      table.workspaceId,
      table.sourceId,
      table.sourceEventId,
    ),
    index("events_workspace_occurred_at_idx").on(table.workspaceId, table.occurredAt),
    index("events_run_id_idx").on(table.runId),
  ],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    uri: text("uri").notNull(),
    title: text("title"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("artifacts_workspace_id_idx").on(table.workspaceId),
    index("artifacts_run_id_idx").on(table.runId),
  ],
);

export const fieldReports = pgTable(
  "field_reports",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    sourceId: agentSourceEnum("source_id").notNull(),
    summary: text("summary").notNull(),
    completedWork: jsonb("completed_work").$type<string[]>().notNull().default([]),
    filesTouched: jsonb("files_touched").$type<string[]>().notNull().default([]),
    commandsRun: jsonb("commands_run").$type<string[]>().notNull().default([]),
    testsRun: jsonb("tests_run").$type<string[]>().notNull().default([]),
    decisions: jsonb("decisions").$type<string[]>().notNull().default([]),
    risks: jsonb("risks").$type<string[]>().notNull().default([]),
    blockers: jsonb("blockers").$type<string[]>().notNull().default([]),
    nextSteps: jsonb("next_steps").$type<string[]>().notNull().default([]),
    confidence: text("confidence").notNull().default("medium"),
    needsHumanReview: boolean("needs_human_review").notNull().default(false),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("field_reports_workspace_id_idx").on(table.workspaceId),
    index("field_reports_run_id_idx").on(table.runId),
  ],
);

export const knowledgeEntries = pgTable(
  "knowledge_entries",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    kind: knowledgeKindEnum("kind").notNull().default("note"),
    title: text("title").notNull(),
    content: text("content").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("knowledge_entries_workspace_id_idx").on(table.workspaceId),
    index("knowledge_entries_project_id_idx").on(table.projectId),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    severity: alertSeverityEnum("severity").notNull().default("info"),
    status: alertStatusEnum("status").notNull().default("open"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("alerts_workspace_status_idx").on(table.workspaceId, table.status),
    index("alerts_run_id_idx").on(table.runId),
  ],
);

export const sourceCursors = pgTable(
  "source_cursors",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    sourceId: agentSourceEnum("source_id").notNull(),
    cursorKey: text("cursor_key").notNull(),
    cursorValue: text("cursor_value"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("source_cursors_workspace_source_key_unique").on(
      table.workspaceId,
      table.sourceId,
      table.cursorKey,
    ),
    index("source_cursors_device_id_idx").on(table.deviceId),
  ],
);

export const ingestBatches = pgTable(
  "ingest_batches",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    batchId: uuid("batch_id").notNull(),
    sourceId: agentSourceEnum("source_id"),
    eventCount: integer("event_count").notNull().default(0),
    acceptedCount: integer("accepted_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("ingest_batches_workspace_batch_unique").on(table.workspaceId, table.batchId),
    index("ingest_batches_workspace_id_idx").on(table.workspaceId),
  ],
);
