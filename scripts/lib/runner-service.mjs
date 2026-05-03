import { access } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_LABEL = "com.alfred.runner";

export function defaultPaths(repoRoot) {
  const stateDir = path.join(repoRoot, ".alfred-runner");
  return {
    stateDir,
    envPath: path.join(repoRoot, ".secrets", "runner.env"),
    pidPath: path.join(stateDir, "runner-service.pid"),
    stdoutPath: path.join(stateDir, "launchd.out.log"),
    stderrPath: path.join(stateDir, "launchd.err.log"),
    plistPath: path.join(os.homedir(), "Library", "LaunchAgents", `${DEFAULT_LABEL}.plist`),
  };
}

export function buildRunnerProgramArgs({ nodeBin, tsxBin, repoRoot }) {
  return [
    nodeBin,
    tsxBin,
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

export function renderLaunchAgentPlist({ label, repoRoot, nodeBin, envPath, stdoutPath, stderrPath }) {
  const scriptPath = path.join(repoRoot, "scripts", "runner-service.mjs");
  const args = [nodeBin, scriptPath, "run", "--env", envPath];
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
  <string>${escapeXml(repoRoot)}</string>
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

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
