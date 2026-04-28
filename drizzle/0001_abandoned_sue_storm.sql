ALTER TABLE "events" ADD COLUMN "event_id" text;--> statement-breakpoint
UPDATE "events" SET "event_id" = 'legacy:' || "id" WHERE "event_id" IS NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "event_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "events_workspace_event_id_unique" ON "events" USING btree ("workspace_id","event_id");
