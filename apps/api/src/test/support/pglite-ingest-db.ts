import { PGlite } from "@electric-sql/pglite";
import {
  devices,
  events,
  ingestBatches,
  projects,
  runRelations,
  runs,
  users,
  workspaces,
} from "@alfred/db";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";

const ingestSchema = {
  devices,
  events,
  ingestBatches,
  projects,
  runRelations,
  runs,
  users,
  workspaces,
};

const migrationsFolder = fileURLToPath(
  new URL("../../../../../drizzle", import.meta.url),
);

export async function createPgliteIngestDatabase() {
  const client = new PGlite();
  const db = drizzle({ client, schema: ingestSchema });
  await migrate(db, { migrationsFolder });

  return {
    client,
    db,
    close: () => client.close(),
  };
}
