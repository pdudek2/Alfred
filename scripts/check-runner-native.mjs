import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const requireFromRunner = createRequire(new URL("../apps/runner/package.json", import.meta.url));

export function checkRunnerNative({
  nodeVersion = process.versions.node,
  loadDatabase = () => requireFromRunner("better-sqlite3"),
} = {}) {
  if (Number(nodeVersion.split(".")[0]) !== 22) {
    throw new Error(`Alfred tests require Node 22.x; found ${nodeVersion}. Select Node 22 and reinstall dependencies.`);
  }

  try {
    const Database = loadDatabase();
    const database = new Database(":memory:");
    try {
      database.prepare("SELECT 1 AS ok").get();
    } finally {
      database.close();
    }
  } catch (error) {
    throw new Error(
      `Runner SQLite native module cannot load under Node ${nodeVersion} (ABI ${process.versions.modules}). Run pnpm rebuild better-sqlite3 under Node 22, then retry.`,
      { cause: error },
    );
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    checkRunnerNative();
  } catch (error) {
    console.error(error.message);
    if (error.cause) console.error(error.cause.message);
    process.exitCode = 1;
  }
}
