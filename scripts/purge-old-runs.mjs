#!/usr/bin/env node
// Local helper to purge old `runs` rows.
// Default mode is dry-run: prints SQL and (if a DB is reachable) the count of
// rows that would be affected. Use --execute to actually delete.
//
// Usage:
//   node scripts/purge-old-runs.mjs --before <ISO timestamp> [--workspace <uuid>]
//                                   [--execute] [--database-url <url>]
//                                   [--self-test]
//
// Examples:
//   node scripts/purge-old-runs.mjs --before 2026-04-28T00:00:00.000Z
//   DATABASE_URL=... node scripts/purge-old-runs.mjs --before 2026-01-01T00:00:00Z --execute

const DEFAULT_DATABASE_URL = "postgresql://alfred:alfred@localhost:54329/alfred";

function parseArgs(argv) {
  const args = {
    before: null,
    workspace: null,
    execute: false,
    databaseUrl: null,
    selfTest: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--before": args.before = next(); break;
      case "--workspace": args.workspace = next(); break;
      case "--database-url": args.databaseUrl = next(); break;
      case "--execute": args.execute = true; break;
      case "--self-test": args.selfTest = true; break;
      case "-h":
      case "--help": args.help = true; break;
      default: throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function validateIsoTimestamp(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("--before must be a non-empty ISO 8601 timestamp");
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`--before is not a valid ISO timestamp: ${value}`);
  }
  return d.toISOString();
}

function validateUuidOrNull(value) {
  if (value == null) return null;
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!re.test(value)) throw new Error(`--workspace is not a valid uuid: ${value}`);
  return value;
}

// Older-than = terminal run with completed_at < cutoff. Children (events,
// artifacts, field_reports, knowledge_entries, alerts) use ON DELETE SET NULL;
// run_relations cascades. Deleting a run nulls those FKs rather than removing
// the rows themselves.
function buildSelectSql(workspaceId) {
  const where = ["status IN ('completed', 'failed', 'cancelled')", "completed_at < $1"];
  if (workspaceId) where.push("workspace_id = $2");
  return `SELECT count(*)::int AS n FROM runs WHERE ${where.join(" AND ")};`;
}

function buildDeleteSql(workspaceId) {
  const where = ["status IN ('completed', 'failed', 'cancelled')", "completed_at < $1"];
  if (workspaceId) where.push("workspace_id = $2");
  return `DELETE FROM runs WHERE ${where.join(" AND ")};`;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node scripts/purge-old-runs.mjs --before <ISO> [options]",
      "",
      "Options:",
      "  --before <ISO>        Cutoff ISO 8601 timestamp (required).",
      "  --workspace <uuid>    Restrict purge to a workspace.",
      "  --execute             Actually delete rows. Default is dry-run.",
      "  --database-url <url>  Override DATABASE_URL.",
      "  --self-test           Run argument/SQL self-tests and exit.",
      "  -h, --help            Show this help.",
      "",
    ].join("\n"),
  );
}

function selfTest() {
  const assertEq = (a, b, label) => {
    const av = JSON.stringify(a);
    const bv = JSON.stringify(b);
    if (av !== bv) throw new Error(`self-test failed: ${label}: ${av} !== ${bv}`);
  };
  assertEq(parseArgs(["--before", "2026-01-01T00:00:00Z"]).before, "2026-01-01T00:00:00Z", "parse before");
  assertEq(parseArgs(["--execute"]).execute, true, "parse execute");
  assertEq(
    validateIsoTimestamp("2026-04-28T00:00:00.000Z"),
    "2026-04-28T00:00:00.000Z",
    "iso roundtrip",
  );
  let threw = false;
  try { validateIsoTimestamp("not-a-date"); } catch { threw = true; }
  if (!threw) throw new Error("self-test failed: bad iso did not throw");
  assertEq(
    buildDeleteSql(null),
    "DELETE FROM runs WHERE status IN ('completed', 'failed', 'cancelled') AND completed_at < $1;",
    "delete sql no workspace",
  );
  assertEq(
    buildDeleteSql("00000000-0000-4000-8000-000000000001"),
    "DELETE FROM runs WHERE status IN ('completed', 'failed', 'cancelled') AND completed_at < $1 AND workspace_id = $2;",
    "delete sql with workspace",
  );
  assertEq(
    buildSelectSql(null),
    "SELECT count(*)::int AS n FROM runs WHERE status IN ('completed', 'failed', 'cancelled') AND completed_at < $1;",
    "select sql",
  );
  threw = false;
  try { validateUuidOrNull("nope"); } catch { threw = true; }
  if (!threw) throw new Error("self-test failed: bad uuid did not throw");
  process.stdout.write("self-test ok\n");
}

async function loadPg() {
  // pg is a workspace dependency of packages/db; reach in directly so the
  // script does not require root-level installs.
  try {
    return (await import("pg")).default;
  } catch {
    const url = new URL(
      "../node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js",
      import.meta.url,
    );
    return (await import(url.href)).default ?? (await import(url.href));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return 0; }
  if (args.selfTest) { selfTest(); return 0; }
  if (!args.before) {
    printHelp();
    process.stderr.write("\nerror: --before <ISO> is required\n");
    return 2;
  }

  const cutoff = validateIsoTimestamp(args.before);
  const workspaceId = validateUuidOrNull(args.workspace);
  const databaseUrl = args.databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const params = workspaceId ? [cutoff, workspaceId] : [cutoff];

  const selectSql = buildSelectSql(workspaceId);
  const deleteSql = buildDeleteSql(workspaceId);
  const mode = args.execute ? "EXECUTE" : "DRY-RUN";

  process.stdout.write(`mode:        ${mode}\n`);
  process.stdout.write(`cutoff:      ${cutoff}\n`);
  process.stdout.write(`workspace:   ${workspaceId ?? "<all>"}\n`);
  process.stdout.write(`database:    ${redactUrl(databaseUrl)}\n`);
  process.stdout.write("\n-- SQL --\n");
  process.stdout.write(`${selectSql}  -- params: ${JSON.stringify(params)}\n`);
  if (args.execute) {
    process.stdout.write("BEGIN;\n");
    process.stdout.write(`${deleteSql}  -- params: ${JSON.stringify(params)}\n`);
    process.stdout.write("COMMIT;\n");
  } else {
    process.stdout.write(`-- would run: ${deleteSql}  -- params: ${JSON.stringify(params)}\n`);
    process.stdout.write("-- (dry-run; pass --execute to actually delete)\n");
  }

  // For dry-run, attempt a count but tolerate missing DB.
  if (!args.execute) {
    try {
      const pg = await loadPg();
      const pool = new pg.Pool({ connectionString: databaseUrl });
      try {
        const res = await pool.query(selectSql, params);
        process.stdout.write(`\nwould delete: ${res.rows[0]?.n ?? 0} row(s)\n`);
      } finally {
        await pool.end();
      }
    } catch (err) {
      process.stdout.write(`\n-- skipped row count (db unreachable): ${err.message}\n`);
    }
    return 0;
  }

  // Execute path
  const pg = await loadPg();
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query(selectSql, params);
    const willDelete = before.rows[0]?.n ?? 0;
    const res = await client.query(deleteSql, params);
    await client.query("COMMIT");
    process.stdout.write(`\nmatched:     ${willDelete}\n`);
    process.stdout.write(`deleted:     ${res.rowCount}\n`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
  return 0;
}

function redactUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<invalid url>";
  }
}

main().then(
  (code) => process.exit(code ?? 0),
  (err) => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  },
);
