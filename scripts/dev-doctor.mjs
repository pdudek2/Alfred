#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";
import process from "node:process";

const COMMAND_TIMEOUT_MS = 15_000;
const DOCKER_TIMEOUT_MS = 5_000;
const HTTP_TIMEOUT_MS = 3_000;
const TCP_TIMEOUT_MS = 2_000;
const MAX_COMMAND_BUFFER = 4 * 1024 * 1024;
const POSTGRES_CONTAINER_NAME = "alfred-refoundation-postgres";
const REQUIRED_REPO_COMMANDS = ["test", "typecheck", "build"];

const root = process.cwd();
const results = [];

function record(status, check, detail, action) {
  const suffix = action ? ` | Action: ${action}` : "";
  console.log(`${status} ${check}: ${detail}${suffix}`);
  results.push({ status, check });
}

function pass(check, detail) {
  record("PASS", check, detail);
}

function fail(check, detail, action) {
  record("FAIL", check, detail, action);
}

function firstUsefulLine(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function compact(value, maxLength = 180) {
  const oneLine = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (oneLine.length <= maxLength) return oneLine;
  return `${oneLine.slice(0, maxLength - 3)}...`;
}

function describeCommandFailure(result) {
  if (result.timedOut) return `timed out after ${result.timeoutMs}ms`;
  if (result.errorCode === "ENOENT") return "command not found";
  return compact(
    firstUsefulLine(result.stderr) ||
      firstUsefulLine(result.stdout) ||
      result.errorMessage ||
      `exit code ${result.exitCode ?? "unknown"}`,
  );
}

function runCommand(command, args, options = {}) {
  const timeout = options.timeout ?? COMMAND_TIMEOUT_MS;

  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: root,
        env: process.env,
        maxBuffer: MAX_COMMAND_BUFFER,
        timeout,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode:
            typeof error?.code === "number"
              ? error.code
              : error
                ? undefined
                : 0,
          errorCode:
            typeof error?.code === "string" ? error.code : undefined,
          errorMessage: error?.message,
          timedOut: Boolean(error?.killed),
          timeoutMs: timeout,
        });
      },
    );
  });
}

async function readJsonFile(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

async function readEnvFile(path) {
  try {
    const raw = await readFile(path, "utf8");
    const values = {};

    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const separator = line.indexOf("=");
      if (separator === -1) continue;

      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    }

    return values;
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function resolveConfig(key, envFile, envExample, fallback) {
  return process.env[key] ?? envFile[key] ?? envExample[key] ?? fallback;
}

function parsePositivePort(value, fallback) {
  const port = Number.parseInt(String(value), 10);
  if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
  return fallback;
}

function parseDatabaseEndpoint(rawDatabaseUrl) {
  try {
    const url = new URL(rawDatabaseUrl);
    return {
      host: url.hostname || "127.0.0.1",
      port: parsePositivePort(url.port || "5432", 5432),
    };
  } catch {
    return undefined;
  }
}

async function loadConfig() {
  const envFile = await readEnvFile(".env");
  const envExample = await readEnvFile(".env.example");
  const apiPort = parsePositivePort(
    resolveConfig("API_PORT", envFile, envExample, "4301"),
    4301,
  );
  const webPort = parsePositivePort(
    resolveConfig("WEB_PORT", envFile, envExample, "4300"),
    4300,
  );
  const databaseUrl = resolveConfig(
    "DATABASE_URL",
    envFile,
    envExample,
    "postgres://alfred:alfred@127.0.0.1:54329/alfred",
  );

  return {
    apiPort,
    apiHealthUrl:
      process.env.API_HEALTH_URL ?? `http://127.0.0.1:${apiPort}/health`,
    databaseEndpoint: parseDatabaseEndpoint(databaseUrl),
    webPort,
    webHealthUrl: process.env.WEB_HEALTH_URL ?? `http://127.0.0.1:${webPort}/`,
  };
}

function startApiCommand(port) {
  return `ALFRED_ALLOW_DEV_AUTH=1 API_PORT=${port} pnpm --filter @alfred/api dev`;
}

function startWebCommand(port) {
  if (port === 4300) return "pnpm --filter @alfred/web dev";
  return `pnpm --filter @alfred/web dev -- --host 127.0.0.1 --port ${port}`;
}

async function checkRepoCommands() {
  let packageJson;
  try {
    packageJson = await readJsonFile("package.json");
  } catch (error) {
    fail(
      "repo package",
      `cannot read package.json (${compact(error.message)})`,
      "run from the repository root",
    );
    return false;
  }

  const scripts = packageJson.scripts ?? {};
  const missingScripts = REQUIRED_REPO_COMMANDS.filter((name) => !scripts[name]);
  if (missingScripts.length === 0) {
    pass(
      "repo package",
      `root scripts present: ${REQUIRED_REPO_COMMANDS.join(", ")}`,
    );
  } else {
    fail(
      "repo package",
      `missing root scripts: ${missingScripts.join(", ")}`,
      "restore the missing package.json scripts before relying on repo checks",
    );
  }

  const pnpm = await runCommand("pnpm", ["--version"], {
    timeout: COMMAND_TIMEOUT_MS,
  });
  if (!pnpm.ok) {
    fail(
      "repo pnpm",
      describeCommandFailure(pnpm),
      "install pnpm 10.x or enable Corepack",
    );
    return false;
  }
  pass("repo pnpm", `available (${compact(pnpm.stdout)})`);

  const dryRun = await runCommand(
    "pnpm",
    ["exec", "turbo", "run", ...REQUIRED_REPO_COMMANDS, "--dry=json"],
    { timeout: COMMAND_TIMEOUT_MS },
  );
  if (!dryRun.ok) {
    fail(
      "repo commands",
      `turbo dry-run failed (${describeCommandFailure(dryRun)})`,
      "run `pnpm install`, then retry `pnpm exec turbo run test typecheck build --dry=json`",
    );
    return false;
  }

  const plan = parseTurboDryRun(dryRun.stdout);
  if (!plan) {
    fail(
      "repo commands",
      "turbo dry-run completed, but its JSON output could not be parsed",
      "rerun `pnpm exec turbo run test typecheck build --dry=json` and inspect the output",
    );
    return false;
  }

  const plannedTasks = new Set((plan.tasks ?? []).map((task) => task.task));
  const missingFromPlan = REQUIRED_REPO_COMMANDS.filter(
    (name) => !plannedTasks.has(name),
  );
  if (missingFromPlan.length > 0) {
    fail(
      "repo commands",
      `turbo plan is missing: ${missingFromPlan.join(", ")}`,
      "check turbo task configuration and workspace package scripts",
    );
    return false;
  }

  pass(
    "repo commands",
    `turbo dry-run resolves ${REQUIRED_REPO_COMMANDS.join(", ")} (${plan.tasks.length} tasks)`,
  );
  return true;
}

function parseTurboDryRun(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;

  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

async function checkDocker() {
  const version = await runCommand("docker", ["--version"], {
    timeout: DOCKER_TIMEOUT_MS,
  });
  if (!version.ok) {
    fail(
      "docker cli",
      describeCommandFailure(version),
      "install Docker Desktop or ensure `docker` is on PATH",
    );
    return false;
  }
  pass("docker cli", compact(version.stdout));

  const daemon = await runCommand(
    "docker",
    ["info", "--format", "{{.ServerVersion}}"],
    { timeout: DOCKER_TIMEOUT_MS },
  );
  if (!daemon.ok) {
    fail(
      "docker daemon",
      describeCommandFailure(daemon),
      "start Docker Desktop and verify `docker info` works in this shell",
    );
    return false;
  }

  pass("docker daemon", `reachable (server ${compact(daemon.stdout)})`);
  return true;
}

async function checkPostgres(dockerDaemonAvailable, databaseEndpoint) {
  if (!dockerDaemonAvailable) {
    fail(
      "postgres container",
      "not checked because Docker daemon is unavailable",
      "start Docker Desktop, then run `docker compose up -d postgres`",
    );
  } else {
    const inspect = await runCommand(
      "docker",
      [
        "inspect",
        POSTGRES_CONTAINER_NAME,
        "--format",
        "{{json .State}}",
      ],
      { timeout: DOCKER_TIMEOUT_MS },
    );

    if (!inspect.ok) {
      fail(
        "postgres container",
        `${POSTGRES_CONTAINER_NAME} not found or not inspectable (${describeCommandFailure(inspect)})`,
        "run `docker compose up -d postgres`",
      );
    } else {
      const state = parseJsonLine(inspect.stdout);
      const health = state?.Health?.Status;

      if (!state?.Running) {
        fail(
          "postgres container",
          `container state is ${state?.Status ?? "not running"}`,
          "run `docker compose up -d postgres`",
        );
      } else if (health && health !== "healthy") {
        fail(
          "postgres container",
          `container is running but health is ${health}`,
          "wait for Postgres or inspect `docker logs alfred-refoundation-postgres`",
        );
      } else {
        pass(
          "postgres container",
          health ? `running and ${health}` : "running",
        );
      }

      if (state?.Running) {
        await checkPostgresReadiness();
      }
    }
  }

  await checkPostgresTcp(databaseEndpoint);
}

function parseJsonLine(value) {
  try {
    return JSON.parse(String(value).trim());
  } catch {
    return undefined;
  }
}

async function checkPostgresReadiness() {
  const ready = await runCommand(
    "docker",
    [
      "exec",
      POSTGRES_CONTAINER_NAME,
      "pg_isready",
      "-U",
      "alfred",
      "-d",
      "alfred",
    ],
    { timeout: DOCKER_TIMEOUT_MS },
  );

  if (!ready.ok) {
    fail(
      "postgres readiness",
      describeCommandFailure(ready),
      "wait for Postgres healthcheck or run `docker compose up -d postgres`",
    );
    return;
  }

  pass("postgres readiness", compact(ready.stdout));
}

async function checkPostgresTcp(databaseEndpoint) {
  if (!databaseEndpoint) {
    fail(
      "postgres tcp",
      "DATABASE_URL could not be parsed",
      "set DATABASE_URL, or copy .env.example to .env",
    );
    return;
  }

  const result = await connectTcp(
    databaseEndpoint.host,
    databaseEndpoint.port,
    TCP_TIMEOUT_MS,
  );
  if (!result.ok) {
    fail(
      "postgres tcp",
      `${databaseEndpoint.host}:${databaseEndpoint.port} is not reachable (${result.error})`,
      "start Postgres with `docker compose up -d postgres`",
    );
    return;
  }

  pass(
    "postgres tcp",
    `${databaseEndpoint.host}:${databaseEndpoint.port} accepts TCP connections`,
  );
}

function connectTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host, port });

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    }

    const timer = setTimeout(() => {
      finish({ ok: false, error: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    socket.once("connect", () => finish({ ok: true }));
    socket.once("error", (error) => {
      finish({ ok: false, error: error.code ?? error.message });
    });
  });
}

async function checkApiHealth(config) {
  const result = await fetchText(config.apiHealthUrl, {
    accept: "application/json",
    timeoutMs: HTTP_TIMEOUT_MS,
  });

  if (!result.ok) {
    fail(
      "api health",
      `${config.apiHealthUrl} failed (${result.error})`,
      startApiCommand(config.apiPort),
    );
    return;
  }

  if (result.status < 200 || result.status >= 300) {
    fail(
      "api health",
      `${config.apiHealthUrl} returned HTTP ${result.status}`,
      "inspect API logs and verify `/health` is mounted",
    );
    return;
  }

  const payload = parseJsonLine(result.body);
  if (payload?.ok !== true || payload?.service !== "alfred-api") {
    fail(
      "api health",
      `unexpected payload: ${compact(result.body)}`,
      "verify the process on the API port is Alfred API",
    );
    return;
  }

  pass(
    "api health",
    `${config.apiHealthUrl} returned ok=true (${payload.service})`,
  );
}

async function checkWebHealth(config) {
  const result = await fetchText(config.webHealthUrl, {
    accept: "text/html",
    timeoutMs: HTTP_TIMEOUT_MS,
  });

  if (!result.ok) {
    fail(
      "web health",
      `${config.webHealthUrl} failed (${result.error})`,
      startWebCommand(config.webPort),
    );
    return;
  }

  if (result.status < 200 || result.status >= 300) {
    fail(
      "web health",
      `${config.webHealthUrl} returned HTTP ${result.status}`,
      "inspect the web dev server logs",
    );
    return;
  }

  if (!result.body.includes('id="root"') && !result.body.includes("Vite")) {
    fail(
      "web health",
      `unexpected HTML response: ${compact(result.body)}`,
      "verify the process on the web port is the Alfred web app",
    );
    return;
  }

  pass("web health", `${config.webHealthUrl} returned app HTML`);
}

async function fetchText(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { accept: options.accept },
      signal: controller.signal,
    });
    const body = await response.text();
    return {
      ok: true,
      body,
      status: response.status,
    };
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? `timeout after ${options.timeoutMs}ms`
        : describeFetchError(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function describeFetchError(error) {
  const cause = error?.cause;
  if (cause?.code) {
    const address = cause.address ? ` ${cause.address}` : "";
    const port = cause.port ? `:${cause.port}` : "";
    return `${cause.code}${address}${port}`;
  }

  return compact(error?.message ?? error);
}

async function main() {
  console.log("Alfred dev doctor (read-only)");

  const config = await loadConfig();
  pass(
    "config",
    `API ${config.apiHealthUrl}, web ${config.webHealthUrl}`,
  );

  await checkRepoCommands();
  const dockerDaemonAvailable = await checkDocker();
  await checkPostgres(dockerDaemonAvailable, config.databaseEndpoint);
  await checkApiHealth(config);
  await checkWebHealth(config);

  const failed = results.filter((result) => result.status === "FAIL").length;
  const passed = results.filter((result) => result.status === "PASS").length;
  console.log(`Summary: ${passed} passed, ${failed} failed.`);

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  fail(
    "doctor",
    compact(error?.stack ?? error),
    "fix the unexpected script error and rerun `node scripts/dev-doctor.mjs`",
  );
  process.exitCode = 1;
});
