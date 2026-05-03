#!/usr/bin/env node

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

import { readEnvFile } from "./lib/env-file.mjs";
import {
  buildRunnerEnv,
  buildRunnerProgramArgs,
  defaultPaths,
  fileExists,
} from "./lib/runner-service.mjs";

const repoRoot = process.cwd();
const paths = defaultPaths(repoRoot);

const command = process.argv[2] ?? "help";
const envPath = readArg("--env") ?? paths.envPath;

if (command === "run") {
  await run();
} else if (command === "status") {
  await status();
} else if (command === "logs") {
  await logs();
} else {
  help();
}

async function run() {
  await mkdir(paths.stateDir, { recursive: true });
  const fileEnv = await readEnvFile(envPath);
  const env = buildRunnerEnv({ repoRoot, fileEnv });
  const args = buildRunnerProgramArgs({
    nodeBin: process.execPath,
    tsxBin: path.join(repoRoot, "node_modules", ".bin", "tsx"),
    repoRoot,
  });

  const child = spawn(args[0], args.slice(1), {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exitCode = code ?? 1;
  });
}

async function status() {
  const envExists = await fileExists(envPath);
  console.log(`env: ${envExists ? "present" : "missing"} ${envPath}`);
  console.log(`logs: ${paths.stdoutPath}`);
  console.log("api: use `node scripts/dev-doctor.mjs` for heartbeat truth");
  if (!envExists) process.exitCode = 1;
}

async function logs() {
  const stdout = await readTail(paths.stdoutPath);
  const stderr = await readTail(paths.stderrPath);
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

async function readTail(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw.split(/\r?\n/).slice(-80).join("\n");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function help() {
  console.log(`Usage:
  node scripts/runner-service.mjs run [--env path]
  node scripts/runner-service.mjs status [--env path]
  node scripts/runner-service.mjs logs
`);
}
