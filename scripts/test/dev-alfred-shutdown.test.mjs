import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cleanupPids = new Set();

describe("Alfred dev launcher shutdown", { skip: process.platform === "win32" }, () => {
  afterEach(async () => {
    for (const pid of cleanupPids) {
      signalProcess(pid, "SIGKILL");
    }
    await waitFor(() => [...cleanupPids].every((pid) => !isProcessAlive(pid)), 1_000);
    cleanupPids.clear();
  });

  it("force-kills stubborn process groups after their wrappers exit", { timeout: 10_000 }, async () => {
    const fixtureDirectory = mkdtempSync(path.join(tmpdir(), "alfred-dev-shutdown-"));
    const pidFile = path.join(fixtureDirectory, "descendants.pid");
    const wrapperPidFile = path.join(fixtureDirectory, "wrappers.pid");
    const fakePnpm = path.join(fixtureDirectory, "pnpm");
    let launcher;
    let launcherStderr = "";

    try {
      writeFileSync(fakePnpm, fakePnpmSource(), "utf8");
      chmodSync(fakePnpm, 0o755);

      launcher = spawn(process.execPath, ["scripts/dev-alfred.mjs"], {
        cwd: repoRoot,
        env: {
          ...process.env,
          ALFRED_TEST_DESCENDANT_PID_FILE: pidFile,
          ALFRED_TEST_IGNORE_SIGTERM: "1",
          ALFRED_TEST_WRAPPER_PID_FILE: wrapperPidFile,
          PATH: `${fixtureDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
        },
        stdio: ["ignore", "ignore", "pipe"],
      });
      launcher.stderr.setEncoding("utf8");
      launcher.stderr.on("data", (chunk) => {
        launcherStderr += chunk;
      });

      const descendantPids = await waitForDescendantPids(pidFile, 3, 2_000, () => launcherStderr);
      descendantPids.forEach((pid) => cleanupPids.add(pid));

      launcher.kill("SIGTERM");
      const result = await waitForExit(launcher, 7_000);

      assert.deepEqual(result, { code: 143, signal: null });
      assert.equal(
        await waitFor(() => descendantPids.every((pid) => !isProcessAlive(pid)), 1_000),
        true,
        `stubborn descendants survived launcher shutdown: ${descendantPids.filter(isProcessAlive).join(", ")}`,
      );
    } finally {
      if (launcher && launcher.exitCode === null && launcher.signalCode === null) {
        launcher.kill("SIGTERM");
        await waitForExit(launcher, 7_000).catch(async () => {
          launcher.kill("SIGKILL");
          await waitForExit(launcher, 1_000).catch(() => undefined);
        });
      }
      killFixtureProcessGroups(wrapperPidFile);
      rmSync(fixtureDirectory, { force: true, recursive: true });
    }
  });

  it("exits promptly when every managed process stops on SIGTERM", { timeout: 5_000 }, async () => {
    const fixtureDirectory = mkdtempSync(path.join(tmpdir(), "alfred-dev-clean-shutdown-"));
    const pidFile = path.join(fixtureDirectory, "descendants.pid");
    const wrapperPidFile = path.join(fixtureDirectory, "wrappers.pid");
    const fakePnpm = path.join(fixtureDirectory, "pnpm");
    let launcher;
    let launcherStderr = "";

    try {
      writeFileSync(fakePnpm, fakePnpmSource(), "utf8");
      chmodSync(fakePnpm, 0o755);

      launcher = spawn(process.execPath, ["scripts/dev-alfred.mjs"], {
        cwd: repoRoot,
        env: {
          ...process.env,
          ALFRED_TEST_DESCENDANT_PID_FILE: pidFile,
          ALFRED_TEST_SIGTERM_DELAY_MS: "200",
          ALFRED_TEST_WRAPPER_PID_FILE: wrapperPidFile,
          PATH: `${fixtureDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
        },
        stdio: ["ignore", "ignore", "pipe"],
      });
      launcher.stderr.setEncoding("utf8");
      launcher.stderr.on("data", (chunk) => {
        launcherStderr += chunk;
      });

      const descendantPids = await waitForDescendantPids(pidFile, 3, 2_000, () => launcherStderr);
      descendantPids.forEach((pid) => cleanupPids.add(pid));

      launcher.kill("SIGTERM");

      assert.deepEqual(
        await waitForExit(launcher, 2_000),
        { code: 143, signal: null },
        launcherStderr,
      );
      assert.equal(
        await waitFor(() => descendantPids.every((pid) => !isProcessAlive(pid)), 500),
        true,
      );
    } finally {
      if (launcher && launcher.exitCode === null && launcher.signalCode === null) {
        launcher.kill("SIGTERM");
        await waitForExit(launcher, 7_000).catch(async () => {
          launcher.kill("SIGKILL");
          await waitForExit(launcher, 1_000).catch(() => undefined);
        });
      }
      killFixtureProcessGroups(wrapperPidFile);
      rmSync(fixtureDirectory, { force: true, recursive: true });
    }
  });
});

function fakePnpmSource() {
  return `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { appendFileSync } = require("node:fs");

const pidFile = process.env.ALFRED_TEST_DESCENDANT_PID_FILE;
appendFileSync(process.env.ALFRED_TEST_WRAPPER_PID_FILE, String(process.pid) + "\\n");
const descendantScript = [
  'const { appendFileSync } = require("node:fs");',
  'const shutdownDelayMs = Number.parseInt(process.env.ALFRED_TEST_SIGTERM_DELAY_MS ?? "0", 10);',
  'if (process.env.ALFRED_TEST_IGNORE_SIGTERM === "1") process.on("SIGTERM", () => {});',
  'else if (shutdownDelayMs > 0) process.on("SIGTERM", () => setTimeout(() => process.exit(0), shutdownDelayMs));',
  'appendFileSync(process.argv[1], String(process.pid) + "\\\\n");',
  'setInterval(() => {}, 1000);',
].join("\\n");

spawn(process.execPath, ["-e", descendantScript, pidFile], {
  stdio: ["ignore", "ignore", "inherit"],
});
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
`;
}

async function waitForDescendantPids(pidFile, count, timeoutMs, diagnostic) {
  let pids = [];
  const ready = await waitFor(() => {
    try {
      pids = readFileSync(pidFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(Number);
      return pids.length === count;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }, timeoutMs);

  assert.equal(
    ready,
    true,
    `expected ${count} synthetic descendants, found ${pids.length}\n${diagnostic()}`,
  );
  return pids;
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }

    const timeout = setTimeout(() => {
      reject(new Error(`process ${child.pid} did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function signalProcess(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function killFixtureProcessGroups(pidFile) {
  let processGroupIds;
  try {
    processGroupIds = readFileSync(pidFile, "utf8").trim().split("\n").filter(Boolean).map(Number);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const processGroupId of processGroupIds) {
    try {
      process.kill(-processGroupId, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
}
