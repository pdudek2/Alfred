import { events, ingestBatches, projects, runs } from "@alfred/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDrizzleIngestStore,
  ingestBatch,
} from "../services/ingest-service";
import { makeBatch } from "./support/ingest-fixtures";
import {
  createPgliteIngestDatabase,
} from "./support/pglite-ingest-db";

type Fixture = Awaited<ReturnType<typeof createPgliteIngestDatabase>>;

describe("production ingest store", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createPgliteIngestDatabase();
  }, 20_000);

  afterEach(async () => {
    await fixture.close();
  });

  it("persists a new batch through the production Drizzle store", async () => {
    const result = await ingestBatch(
      createDrizzleIngestStore(fixture.db),
      makeBatch(),
    );

    expect(result).toEqual({
      batch_id: "00000000-0000-4000-8000-000000000201",
      accepted_events: 1,
      duplicate_events: 0,
      duplicate_batch: false,
    });
    await expect(fixture.db.select().from(ingestBatches)).resolves.toHaveLength(1);
    await expect(fixture.db.select().from(projects)).resolves.toHaveLength(1);
    await expect(fixture.db.select().from(runs)).resolves.toHaveLength(1);
    await expect(fixture.db.select().from(events)).resolves.toHaveLength(1);
  });
});
