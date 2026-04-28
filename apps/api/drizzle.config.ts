import { defineConfig } from "drizzle-kit";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = path.dirname(fileURLToPath(import.meta.url));
const refoundationRoot = path.resolve(apiDir, "../..");
const drizzleOut = path.relative(process.cwd(), path.resolve(refoundationRoot, "drizzle")) || ".";

export default defineConfig({
  schema: path.resolve(refoundationRoot, "packages/db/src/schema.ts"),
  out: drizzleOut,
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://alfred:alfred@localhost:54329/alfred",
  },
});
