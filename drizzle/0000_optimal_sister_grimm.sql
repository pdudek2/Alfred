CREATE TYPE "public"."agent_source" AS ENUM('claude-code', 'codex-cli', 'openai-agents-sdk', 'langgraph', 'custom');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('run.started', 'run.updated', 'run.completed', 'run.failed', 'agent.waiting', 'tool.started', 'tool.completed', 'tool.failed', 'file.touched', 'command.executed', 'test.result', 'spawn.created', 'field_report.submitted', 'alert.raised');--> statement-breakpoint
CREATE TYPE "public"."knowledge_kind" AS ENUM('note', 'decision', 'preference', 'fact', 'risk');--> statement-breakpoint
CREATE TYPE "public"."mission_status" AS ENUM('planned', 'running', 'blocked', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."privacy_mode" AS ENUM('minimal', 'standard', 'full');--> statement-breakpoint
CREATE TYPE "public"."run_relation_type" AS ENUM('parent', 'child', 'spawned', 'continued', 'related');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'waiting', 'completed', 'failed', 'cancelled', 'unknown');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"mission_id" uuid,
	"run_id" uuid,
	"event_id" uuid,
	"severity" "alert_severity" DEFAULT 'info' NOT NULL,
	"status" "alert_status" DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"mission_id" uuid,
	"run_id" uuid,
	"kind" text NOT NULL,
	"uri" text NOT NULL,
	"title" text,
	"mime_type" text,
	"size_bytes" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"device_key" text NOT NULL,
	"name" text NOT NULL,
	"platform" text,
	"last_seen_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"device_id" uuid,
	"project_id" uuid,
	"run_id" uuid,
	"source_id" "agent_source" NOT NULL,
	"source_run_id" text NOT NULL,
	"source_event_id" text NOT NULL,
	"type" "event_type" NOT NULL,
	"status" "run_status",
	"privacy_mode" "privacy_mode" DEFAULT 'standard' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mission_id" uuid,
	"run_id" uuid,
	"source_id" "agent_source" NOT NULL,
	"summary" text NOT NULL,
	"completed_work" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"files_touched" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commands_run" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tests_run" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"needs_human_review" boolean DEFAULT false NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"device_id" uuid,
	"batch_id" uuid NOT NULL,
	"source_id" "agent_source",
	"event_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"mission_id" uuid,
	"run_id" uuid,
	"kind" "knowledge_kind" DEFAULT 'note' NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"objective" text,
	"status" "mission_status" DEFAULT 'planned' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_key" text NOT NULL,
	"name" text NOT NULL,
	"root_path" text,
	"repository_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parent_run_id" uuid NOT NULL,
	"child_run_id" uuid NOT NULL,
	"relation_type" "run_relation_type" DEFAULT 'related' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"device_id" uuid,
	"project_id" uuid,
	"mission_id" uuid,
	"source_id" "agent_source" NOT NULL,
	"source_run_id" text NOT NULL,
	"title" text,
	"status" "run_status" DEFAULT 'unknown' NOT NULL,
	"privacy_mode" "privacy_mode" DEFAULT 'standard' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"device_id" uuid,
	"source_id" "agent_source" NOT NULL,
	"cursor_key" text NOT NULL,
	"cursor_value" text,
	"last_seen_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"workspace_key" text NOT NULL,
	"name" text NOT NULL,
	"privacy_mode" "privacy_mode" DEFAULT 'standard' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_workspace_key_unique" UNIQUE("workspace_key")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_reports" ADD CONSTRAINT "field_reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_reports" ADD CONSTRAINT "field_reports_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_reports" ADD CONSTRAINT "field_reports_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_batches" ADD CONSTRAINT "ingest_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_batches" ADD CONSTRAINT "ingest_batches_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_relations" ADD CONSTRAINT "run_relations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_relations" ADD CONSTRAINT "run_relations_parent_run_id_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_relations" ADD CONSTRAINT "run_relations_child_run_id_runs_id_fk" FOREIGN KEY ("child_run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_cursors" ADD CONSTRAINT "source_cursors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_cursors" ADD CONSTRAINT "source_cursors_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_workspace_status_idx" ON "alerts" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "alerts_run_id_idx" ON "alerts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "artifacts_workspace_id_idx" ON "artifacts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "artifacts_run_id_idx" ON "artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_workspace_device_key_unique" ON "devices" USING btree ("workspace_id","device_key");--> statement-breakpoint
CREATE INDEX "devices_workspace_id_idx" ON "devices" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_workspace_source_event_unique" ON "events" USING btree ("workspace_id","source_id","source_event_id");--> statement-breakpoint
CREATE INDEX "events_workspace_occurred_at_idx" ON "events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "events_run_id_idx" ON "events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "field_reports_workspace_id_idx" ON "field_reports" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "field_reports_run_id_idx" ON "field_reports" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_batches_workspace_batch_unique" ON "ingest_batches" USING btree ("workspace_id","batch_id");--> statement-breakpoint
CREATE INDEX "ingest_batches_workspace_id_idx" ON "ingest_batches" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "knowledge_entries_workspace_id_idx" ON "knowledge_entries" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "knowledge_entries_project_id_idx" ON "knowledge_entries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "missions_workspace_id_idx" ON "missions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "missions_project_id_idx" ON "missions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_project_key_unique" ON "projects" USING btree ("workspace_id","project_key");--> statement-breakpoint
CREATE INDEX "projects_workspace_id_idx" ON "projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_relations_parent_child_type_unique" ON "run_relations" USING btree ("parent_run_id","child_run_id","relation_type");--> statement-breakpoint
CREATE INDEX "run_relations_workspace_id_idx" ON "run_relations" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_workspace_source_run_unique" ON "runs" USING btree ("workspace_id","source_id","source_run_id");--> statement-breakpoint
CREATE INDEX "runs_workspace_id_idx" ON "runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "runs_project_id_idx" ON "runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "runs_mission_id_idx" ON "runs" USING btree ("mission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_cursors_workspace_source_key_unique" ON "source_cursors" USING btree ("workspace_id","source_id","cursor_key");--> statement-breakpoint
CREATE INDEX "source_cursors_device_id_idx" ON "source_cursors" USING btree ("device_id");