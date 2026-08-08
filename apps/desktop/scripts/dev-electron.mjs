import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { electronArguments } from "./dev-electron-config.mjs";

const require = createRequire(import.meta.url);
const electron = require("electron");
const vitePackagePath = require.resolve("vite/package.json");
const vitePackage = require(vitePackagePath);
const viteBin = fileURLToPath(new URL(vitePackage.bin.vite, `file://${vitePackagePath}`));

const appDirectory = fileURLToPath(new URL("..", import.meta.url));
const host = "127.0.0.1";
const port = readPort(process.env.DESKTOP_PORT, 4310);
const devServerUrl = `http://${host}:${port}`;
let viteProcess = null;
let electronProcess = null;
let shuttingDown = false;

try {
  if (!(await isReachable(devServerUrl))) {
    viteProcess = spawn(process.execPath, [viteBin, "--host", host, "--port", String(port), "--strictPort"], {
      cwd: appDirectory,
      env: process.env,
      stdio: "inherit",
    });
    await waitForServer(devServerUrl, viteProcess);
  }

  electronProcess = spawn(electron, electronArguments(process.env.ALFRED_DESKTOP_USER_DATA_DIR), {
    cwd: appDirectory,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devServerUrl,
    },
    stdio: "inherit",
  });

  electronProcess.on("exit", (code, signal) => {
    shutdown(signal);
    process.exit(code ?? 0);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  shutdown();
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown(signal);
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill(signal ?? "SIGTERM");
  }
  if (viteProcess && !viteProcess.killed) {
    viteProcess.kill(signal ?? "SIGTERM");
  }
}

async function waitForServer(url, processToWatch) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    if (processToWatch.exitCode !== null) {
      throw new Error(`Vite dev server exited before ${url} became reachable.`);
    }
    if (await isReachable(url)) {
      return;
    }
    await delay(150);
  }

  throw new Error(`Timed out waiting for Vite dev server at ${url}.`);
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readPort(value, fallback) {
  const port = Number.parseInt(value ?? "", 10);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : fallback;
}
