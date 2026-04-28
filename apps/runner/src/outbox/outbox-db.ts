import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

import Database from "better-sqlite3";
import type { Database as BetterSqliteDatabase } from "better-sqlite3";

export type OutboxRecord = {
  id: number;
  eventId: string;
  payload: unknown;
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
};

type OutboxRow = {
  id: number;
  event_id: string;
  payload: string;
  attempts: number;
  next_attempt_at: string;
  created_at: string;
};

export class OutboxDb {
  private readonly db: BetterSqliteDatabase;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outbox_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS outbox_events_ready_idx
        ON outbox_events(next_attempt_at, created_at);
    `);
  }

  enqueue(event: { event_id: string; [key: string]: unknown }, now = new Date()): void {
    const timestamp = now.toISOString();

    this.db
      .prepare(
        `
          INSERT OR IGNORE INTO outbox_events (event_id, payload, attempts, next_attempt_at, created_at)
          VALUES (@eventId, @payload, 0, @nextAttemptAt, @createdAt)
        `,
      )
      .run({
        eventId: event.event_id,
        payload: JSON.stringify(event),
        nextAttemptAt: timestamp,
        createdAt: timestamp,
      });
  }

  listReady(limit: number, now = new Date()): OutboxRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT id, event_id, payload, attempts, next_attempt_at, created_at
          FROM outbox_events
          WHERE next_attempt_at <= @now
          ORDER BY created_at ASC
          LIMIT @limit
        `,
      )
      .all({ now: now.toISOString(), limit }) as OutboxRow[];

    return rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      payload: JSON.parse(row.payload) as unknown,
      attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at,
      createdAt: row.created_at,
    }));
  }

  markSent(ids: number[]): void {
    if (ids.length === 0) return;

    const deleteRecord = this.db.prepare("DELETE FROM outbox_events WHERE id = ?");
    const deleteMany = this.db.transaction((recordIds: number[]) => {
      for (const id of recordIds) {
        deleteRecord.run(id);
      }
    });

    deleteMany(ids);
  }

  markFailed(id: number, nextAttemptAt: Date): void {
    this.db
      .prepare(
        `
          UPDATE outbox_events
          SET attempts = attempts + 1,
              next_attempt_at = @nextAttemptAt
          WHERE id = @id
        `,
      )
      .run({ id, nextAttemptAt: nextAttemptAt.toISOString() });
  }

  close(): void {
    this.db.close();
  }
}
