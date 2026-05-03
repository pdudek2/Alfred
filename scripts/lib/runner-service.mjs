import { access } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_LABEL = "com.alfred.runner";

export function defaultPaths(repoRoot) {
  const stateDir = path.join(os.homedir(), "Library", "Application Support", "Alfred", "runner");
  return {
    stateDir,
    envPath: path.join(repoRoot, ".secrets", "runner.env"),
    stdoutPath: path.join(stateDir, "launchd.out.log"),
    stderrPath: path.join(stateDir, "launchd.err.log"),
    plistPath: path.join(os.homedir(), "Library", "LaunchAgents", `${DEFAULT_LABEL}.plist`),
  };
}

export function buildRunnerProgramArgs({ nodeBin, tsxCliPath, repoRoot }) {
  return [
    nodeBin,
    tsxCliPath,
    path.join(repoRoot, "apps", "runner", "src", "index.ts"),
  ];
}

export function buildRunnerEnv({ repoRoot, fileEnv, baseEnv = process.env }) {
  return {
    ...baseEnv,
    ...fileEnv,
    ALFRED_ALLOW_DEV_CONFIG: fileEnv.ALFRED_ALLOW_DEV_CONFIG ?? "0",
    ALFRED_RUNNER_LOOP: "1",
    ALFRED_SOURCES: fileEnv.ALFRED_SOURCES ?? "codex",
    ALFRED_PRIVACY_MODE: fileEnv.ALFRED_PRIVACY_MODE ?? "standard",
    ALFRED_RUNNER_POLL_MS: fileEnv.ALFRED_RUNNER_POLL_MS ?? "5000",
    ALFRED_RUNNER_DB_PATH:
      fileEnv.ALFRED_RUNNER_DB_PATH ??
      path.join(repoRoot, "apps", "runner", ".alfred-runner", "cloud-outbox.sqlite"),
  };
}

export function renderLaunchAgentPlist({ label, repoRoot, nodeBin, envPath, stdoutPath, stderrPath, workingDir }) {
  const scriptPath = path.join(repoRoot, "scripts", "runner-service.mjs");
  const command = [
    "cd",
    shellQuote(repoRoot),
    "&&",
    "exec",
    shellQuote(nodeBin),
    shellQuote(scriptPath),
    "run",
    "--env",
    shellQuote(envPath),
  ].join(" ");
  const args = ["/bin/zsh", "-c", command];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${escapeXml(arg)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(workingDir ?? repoRoot)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(stderrPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
`;
}

export async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function launchctlArgs(action, labelOrPath) {
  const uid = process.getuid?.();
  const guiTarget = uid === undefined ? undefined : `gui/${uid}`;
  const serviceTarget = guiTarget === undefined ? labelOrPath : `${guiTarget}/${labelOrPath}`;

  if (action === "bootstrap") return ["bootstrap", guiTarget, labelOrPath].filter(Boolean);
  if (action === "bootout") return ["bootout", guiTarget, labelOrPath].filter(Boolean);
  if (action === "kickstart") return ["kickstart", "-k", serviceTarget].filter(Boolean);
  if (action === "print") return ["print", serviceTarget].filter(Boolean);

  throw new Error(`Unknown launchctl action: ${action}`);
}

export function parseLaunchdPrint(output) {
  const pidMatch = output.match(/^\s*pid = (\d+)/m);
  const stateMatch = output.match(/^\s*state = (.+)$/m);
  const lastExitStatusMatch = output.match(/^\s*last exit (?:code|status) = (-?\d+)/m);

  return {
    loaded: output.trim().length > 0,
    lastExitStatus: lastExitStatusMatch ? Number(lastExitStatusMatch[1]) : null,
    pid: pidMatch ? Number(pidMatch[1]) : null,
    running: Boolean(pidMatch),
    state: stateMatch?.[1]?.trim() ?? null,
  };
}

export function buildRunnerServiceDoctorReport({
  envExists,
  launchdError = "",
  launchdPrint = "",
  plistExists,
  stderrTail = "",
  stdoutTail = "",
}) {
  const launchd = parseLaunchdPrint(launchdPrint);
  const bootLogSeen = /Alfred runner watching|Alfred runner collected/i.test(stdoutTail);
  const runnerBooted = launchd.running && bootLogSeen;
  const lines = [
    `env: ${envExists ? "present" : "missing"}`,
    `plist: ${plistExists ? "present" : "missing"}`,
    launchd.loaded
      ? `launchd: loaded${launchd.running ? `, pid ${launchd.pid}` : ""}${launchd.state ? `, state ${launchd.state}` : ""}`
      : `launchd: missing${launchdError ? ` (${firstLine(launchdError)})` : ""}`,
    `runner boot log: ${bootLogSeen ? (launchd.running ? "seen" : "seen, but service is not running") : "missing"}`,
  ];

  if (launchd.lastExitStatus !== null) {
    lines.push(`last exit status: ${launchd.lastExitStatus}`);
  }

  if (stderrTail.trim()) {
    lines.push("stderr: has recent output; inspect `pnpm runner:service:logs`");
  }

  const stderrQuiet = !stderrTail.trim();
  const ok = envExists && plistExists && launchd.running && runnerBooted && stderrQuiet;

  return { bootLogSeen, launchd, lines, ok, runnerBooted, stderrQuiet };
}

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function firstLine(value) {
  return value.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "unknown";
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
