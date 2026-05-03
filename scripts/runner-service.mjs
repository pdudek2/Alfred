#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

import { readEnvFile } from "./lib/env-file.mjs";
import {
  buildRunnerServiceDoctorReport,
  buildRunnerEnv,
  buildRunnerProgramArgs,
  DEFAULT_LABEL,
  defaultPaths,
  fileExists,
  launchctlArgs,
  parseLaunchdPrint,
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
} else if (command === "doctor") {
  await doctor();
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
  await writeFile(paths.stdoutPath, "", "utf8");
  await writeFile(paths.stderrPath, "", "utf8");
  const plist = renderLaunchAgentPlist({
    label: DEFAULT_LABEL,
    repoRoot,
    nodeBin: process.execPath,
    envPath,
    stdoutPath: paths.stdoutPath,
    stderrPath: paths.stderrPath,
    workingDir: paths.stateDir,
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
    tsxCliPath: path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    repoRoot,
  });

  await new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      cwd: repoRoot,
      env,
      stdio: "inherit",
    });

    const signalHandlers = new Map();

    for (const signal of ["SIGINT", "SIGTERM"]) {
      const handler = () => child.kill(signal);
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      for (const [signalName, handler] of signalHandlers) {
        process.off(signalName, handler);
      }

      if (signal) {
        process.kill(process.pid, signal);
        return;
      }

      process.exitCode = code ?? 1;
      resolve();
    });
  });
}

async function start() {
  await runCommand("launchctl", launchctlArgs("bootstrap", paths.plistPath));
  await runCommand("launchctl", launchctlArgs("kickstart", DEFAULT_LABEL));
  console.log(`Started ${DEFAULT_LABEL}`);
}

async function status() {
  const envExists = await fileExists(envPath);
  const plistExists = await fileExists(paths.plistPath);
  const launchdResult = await readLaunchdStatus();
  const launchd = launchdResult.code === 0 ? parseLaunchdPrint(launchdResult.stdout) : null;
  console.log(`env: ${envExists ? "present" : "missing"} ${envPath}`);
  console.log(`plist: ${plistExists ? "present" : "missing"} ${paths.plistPath}`);
  if (launchd?.loaded) {
    console.log(`launchd: loaded${launchd.pid ? `, pid ${launchd.pid}` : ""}${launchd.state ? `, state ${launchd.state}` : ""}`);
  } else {
    console.log("launchd: missing");
  }
  console.log(`logs: ${paths.stdoutPath}`);
  console.log("doctor: run `pnpm runner:service:doctor` for launchd runner checks");
  if (!envExists || !plistExists || !launchd?.running) process.exitCode = 1;
}

async function doctor() {
  const envExists = await fileExists(envPath);
  const plistExists = await fileExists(paths.plistPath);
  const launchdResult = await readLaunchdStatus();
  const stdoutTail = await readTail(paths.stdoutPath);
  const stderrTail = await readTail(paths.stderrPath);
  const report = buildRunnerServiceDoctorReport({
    envExists,
    launchdError: launchdResult.stderr || launchdResult.stdout,
    launchdPrint: launchdResult.code === 0 ? launchdResult.stdout : "",
    plistExists,
    stderrTail,
    stdoutTail,
  });

  for (const line of report.lines) {
    console.log(line);
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
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

async function readLaunchdStatus() {
  try {
    return await runCommand("launchctl", launchctlArgs("print", DEFAULT_LABEL), {
      allowFailure: () => true,
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { code: 127, stdout: "", stderr: "launchctl unavailable" };
    }
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
  node scripts/runner-service.mjs doctor [--env path]
  node scripts/runner-service.mjs stop
  node scripts/runner-service.mjs restart [--env path]
  node scripts/runner-service.mjs uninstall
  node scripts/runner-service.mjs logs
`);
}
