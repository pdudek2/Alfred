#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

import { readEnvFile } from "./lib/env-file.mjs";
import {
  buildRunnerEnv,
  buildRunnerProgramArgs,
  DEFAULT_LABEL,
  defaultPaths,
  fileExists,
  launchctlArgs,
  renderLaunchAgentPlist,
} from "./lib/runner-service.mjs";

const repoRoot = process.cwd();
const paths = defaultPaths(repoRoot);

const command = process.argv[2] ?? "help";
const envPath = readArg("--env") ?? paths.envPath;

if (command === "install") {
  await install();
} else if (command === "run") {
  await run();
} else if (command === "start") {
  await start();
} else if (command === "status") {
  await status();
} else if (command === "stop") {
  await stop();
} else if (command === "restart") {
  await restart();
} else if (command === "uninstall") {
  await uninstall();
} else if (command === "logs") {
  await logs();
} else {
  help();
}

async function install() {
  await mkdir(paths.stateDir, { recursive: true });
  await mkdir(path.dirname(paths.plistPath), { recursive: true });
  const plist = renderLaunchAgentPlist({
    label: DEFAULT_LABEL,
    repoRoot,
    nodeBin: process.execPath,
    envPath,
    stdoutPath: paths.stdoutPath,
    stderrPath: paths.stderrPath,
  });
  await writeFile(paths.plistPath, plist, "utf8");
  console.log(`Installed ${paths.plistPath}`);
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

async function start() {
  await runCommand("launchctl", launchctlArgs("bootstrap", paths.plistPath));
  await runCommand("launchctl", launchctlArgs("kickstart", DEFAULT_LABEL));
  console.log(`Started ${DEFAULT_LABEL}`);
}

async function status() {
  const envExists = await fileExists(envPath);
  console.log(`env: ${envExists ? "present" : "missing"} ${envPath}`);
  console.log(`plist: ${(await fileExists(paths.plistPath)) ? "present" : "missing"} ${paths.plistPath}`);
  console.log(`logs: ${paths.stdoutPath}`);
  console.log("api: use `node scripts/dev-doctor.mjs` for heartbeat truth");
  if (!envExists) process.exitCode = 1;
}

async function stop() {
  await runCommand("launchctl", launchctlArgs("bootout", paths.plistPath), {
    allowFailure: isNonFatalLaunchdStop,
  });
  console.log(`Stopped ${DEFAULT_LABEL}`);
}

async function restart() {
  await stop();
  await install();
  await start();
}

async function uninstall() {
  await stop();
  await rm(paths.plistPath, { force: true });
  console.log(`Uninstalled ${paths.plistPath}`);
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

function runCommand(commandName, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      const result = { code, stdout, stderr };
      if (code === 0 || options.allowFailure?.(result)) {
        resolve(result);
        return;
      }

      reject(new Error(`${commandName} ${args.join(" ")} failed with ${code}: ${stderr || stdout}`));
    });
  });
}

function isNonFatalLaunchdStop(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  return /not bootstrapped|No such process|Could not find service|Service is not loaded|Load failed|Boot-out failed: 5|Input\/output error/i.test(output);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function help() {
  console.log(`Usage:
  node scripts/runner-service.mjs install [--env path]
  node scripts/runner-service.mjs run [--env path]
  node scripts/runner-service.mjs start
  node scripts/runner-service.mjs status [--env path]
  node scripts/runner-service.mjs stop
  node scripts/runner-service.mjs restart [--env path]
  node scripts/runner-service.mjs uninstall
  node scripts/runner-service.mjs logs
`);
}
