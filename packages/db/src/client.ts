import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema.js";

const DEFAULT_DATABASE_URL = "postgresql://alfred:alfred@localhost:54329/alfred";

export type Database = ReturnType<typeof createDb>;

export function createPool(connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL) {
  return new pg.Pool({ connectionString });
}

export function createDb(pool = createPool()) {
  return drizzle(pool, { schema });
}
