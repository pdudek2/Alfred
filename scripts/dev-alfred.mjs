#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

const SHUTDOWN_TIMEOUT_MS = 5_000;
const SHUTDOWN_POLL_INTERVAL_MS = 50;

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const supportsProcessGroups = process.platform !== "win32";

const processes = [
  {
    name: "api",
    command: pnpmCommand,
    args: ["--filter", "@alfred/api", "dev"],
    env: {
      ALFRED_ALLOW_DEV_AUTH: "1",
      API_PORT: "4301",
    },
  },
  {
    name: "desktop",
    command: pnpmCommand,
    args: ["--filter", "@alfred/desktop", "dev:electron"],
    env: {
      DESKTOP_PORT: "4310",
    },
  },
  {
    name: "runner",
    command: pnpmCommand,
    args: ["runner:local"],
    env: {
      ALFRED_RUNNER_POLL_MS: "5000",
    },
  },
];

const children = new Map();
const processGroupIds = new Set();
let shuttingDown = false;
let expectedExitCode = 0;
let shutdownPoller;
let shutdownTimer;

function childEnv(defaults) {
  return {
    ...process.env,
    ...Object.fromEntries(
      Object.entries(defaults).filter(([key]) => process.env[key] === undefined),
    ),
  };
}

function prefixStream(name, input, output) {
  let pending = "";

  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";

    for (const line of lines) {
      output.write(`[${name}] ${line}\n`);
    }
  });

  input.on("end", () => {
    if (pending.length > 0) {
      output.write(`[${name}] ${pending}\n`);
      pending = "";
    }
  });
}

function exitCodeForSignal(signal) {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return 1;
}

function finishWhenStopped() {
  if (children.size > 0) return;
  if (supportsProcessGroups) {
    pruneStoppedProcessGroups();
    if (processGroupIds.size > 0) return;
  }
  if (shutdownPoller) clearInterval(shutdownPoller);
  if (shutdownTimer) clearTimeout(shutdownTimer);
  process.exit(expectedExitCode);
}

function signalChild(child, signal) {
  try {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function signalProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
    processGroupIds.delete(processGroupId);
  }
}

function signalManagedProcesses(signal) {
  if (supportsProcessGroups) {
    for (const processGroupId of processGroupIds) {
      signalProcessGroup(processGroupId, signal);
    }
    return;
  }

  for (const child of children.values()) {
    signalChild(child, signal);
  }
}

function pruneStoppedProcessGroups() {
  for (const processGroupId of processGroupIds) {
    try {
      process.kill(-processGroupId, 0);
    } catch (error) {
      if (error?.code === "EPERM") continue;
      if (error?.code !== "ESRCH") throw error;
      processGroupIds.delete(processGroupId);
    }
  }
}

function shutdown(reason, exitCode) {
  if (!shuttingDown) {
    shuttingDown = true;
    expectedExitCode = exitCode;
    if (reason) process.stderr.write(`${reason}\n`);

    signalManagedProcesses("SIGTERM");

    shutdownTimer = setTimeout(() => {
      signalManagedProcesses("SIGKILL");
      process.exit(expectedExitCode);
    }, SHUTDOWN_TIMEOUT_MS);
    if (supportsProcessGroups) {
      shutdownPoller = setInterval(finishWhenStopped, SHUTDOWN_POLL_INTERVAL_MS);
    }
  }

  finishWhenStopped();
}

for (const definition of processes) {
  const child = spawn(definition.command, definition.args, {
    cwd: process.cwd(),
    detached: supportsProcessGroups,
    env: childEnv(definition.env),
    stdio: ["ignore", "pipe", "pipe"],
  });

  children.set(definition.name, child);
  if (supportsProcessGroups && child.pid) {
    processGroupIds.add(child.pid);
  }
  prefixStream(definition.name, child.stdout, process.stdout);
  prefixStream(definition.name, child.stderr, process.stderr);

  child.on("error", (error) => {
    children.delete(definition.name);
    shutdown(
      `[${definition.name}] failed to start: ${error.message}`,
      typeof error.code === "number" ? error.code : 1,
    );
  });

  child.on("exit", (code, signal) => {
    children.delete(definition.name);

    if (shuttingDown) {
      finishWhenStopped();
      return;
    }

    const exitCode = code ?? exitCodeForSignal(signal);
    if (exitCode === 0) {
      shutdown(`[${definition.name}] exited; stopping remaining processes`, 0);
      return;
    }

    const reason =
      code === null
        ? `[${definition.name}] exited with signal ${signal}; stopping remaining processes`
        : `[${definition.name}] exited with code ${code}; stopping remaining processes`;
    shutdown(reason, exitCode);
  });
}

process.on("SIGINT", () => {
  shutdown("Received SIGINT; stopping Alfred dev processes", 130);
});

process.on("SIGTERM", () => {
  shutdown("Received SIGTERM; stopping Alfred dev processes", 143);
});
