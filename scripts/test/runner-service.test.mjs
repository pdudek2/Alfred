import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseEnvFileContent } from "../lib/env-file.mjs";
import {
  buildRunnerServiceDoctorReport,
  buildRunnerEnv,
  buildRunnerProgramArgs,
  defaultPaths,
  launchctlArgs,
  parseLaunchdPrint,
  renderLaunchAgentPlist,
} from "../lib/runner-service.mjs";

describe("parseEnvFileContent", () => {
  it("parses comments, unquoted values, and quoted values", () => {
    const result = parseEnvFileContent(`
      # comment
      RUNNER_API_URL=https://example.com
      ALFRED_SOURCES="codex"
      ALFRED_PRIVACY_MODE='standard'
    `);

    assert.deepEqual(result, {
      RUNNER_API_URL: "https://example.com",
      ALFRED_SOURCES: "codex",
      ALFRED_PRIVACY_MODE: "standard",
    });
  });

  it("rejects lines without keys", () => {
    assert.throws(
      () => parseEnvFileContent("=missing-key"),
      /Invalid env line 1/,
    );
  });

  it("does not expand shell syntax", () => {
    const result = parseEnvFileContent("RUNNER_API_URL=$HOME/no-shell");
    assert.equal(result.RUNNER_API_URL, "$HOME/no-shell");
  });
});

describe("runner service helpers", () => {
  it("keeps service state paths focused on launchd logs and secrets", () => {
    const paths = defaultPaths("/repo");

    assert.equal(paths.envPath, "/repo/.secrets/runner.env");
    assert.equal(paths.stdoutPath, "/repo/.alfred-runner/launchd.out.log");
    assert.equal(paths.stderrPath, "/repo/.alfred-runner/launchd.err.log");
    assert.equal(Object.hasOwn(paths, "pidPath"), false);
  });

  it("builds a direct tsx runner command without shell sourcing", () => {
    assert.deepEqual(
      buildRunnerProgramArgs({
        nodeBin: "/opt/homebrew/bin/node",
        tsxCliPath: "/repo/node_modules/tsx/dist/cli.mjs",
        repoRoot: "/repo",
      }),
      [
        "/opt/homebrew/bin/node",
        "/repo/node_modules/tsx/dist/cli.mjs",
        "/repo/apps/runner/src/index.ts",
      ],
    );
  });

  it("builds runner env without printing secrets", () => {
    const env = buildRunnerEnv({
      repoRoot: "/repo",
      fileEnv: {
        RUNNER_API_URL: "https://alfred.example",
        RUNNER_DEVICE_TOKEN: "secret-token",
      },
      baseEnv: { HOME: "/Users/patryk" },
    });

    assert.equal(env.RUNNER_API_URL, "https://alfred.example");
    assert.equal(env.RUNNER_DEVICE_TOKEN, "secret-token");
    assert.equal(env.ALFRED_RUNNER_LOOP, "1");
    assert.equal(env.ALFRED_RUNNER_DB_PATH, "/repo/apps/runner/.alfred-runner/cloud-outbox.sqlite");
  });

  it("renders a launchd plist with ProgramArguments and log paths", () => {
    const plist = renderLaunchAgentPlist({
      label: "com.alfred.runner",
      repoRoot: "/repo",
      nodeBin: "/opt/homebrew/bin/node",
      envPath: "/repo/.secrets/runner.env",
      stdoutPath: "/repo/.alfred-runner/launchd.out.log",
      stderrPath: "/repo/.alfred-runner/launchd.err.log",
    });

    assert.match(plist, /<key>Label<\/key>/);
    assert.match(plist, /com.alfred.runner/);
    assert.match(plist, /runner-service\.mjs/);
    assert.match(plist, /<string>run<\/string>/);
    assert.match(plist, /<string>--env<\/string>/);
    assert.match(plist, /launchd\.out\.log/);
    assert.doesNotMatch(plist, /source/);
  });

  it("builds launchctl gui target arguments", () => {
    const guiTarget = `gui/${process.getuid()}`;

    assert.deepEqual(launchctlArgs("bootstrap", "/tmp/com.alfred.runner.plist"), [
      "bootstrap",
      guiTarget,
      "/tmp/com.alfred.runner.plist",
    ]);
    assert.deepEqual(launchctlArgs("kickstart", "com.alfred.runner"), [
      "kickstart",
      "-k",
      `${guiTarget}/com.alfred.runner`,
    ]);
  });

  it("parses launchctl print output for a running service", () => {
    const parsed = parseLaunchdPrint(`
gui/501/com.alfred.runner = {
  active count = 1
  path = /Users/patryk/Library/LaunchAgents/com.alfred.runner.plist
  state = running
  pid = 4242
  last exit status = 0
}
    `);

    assert.deepEqual(parsed, {
      loaded: true,
      lastExitStatus: 0,
      pid: 4242,
      running: true,
      state: "running",
    });
  });

  it("marks service doctor healthy only when launchd has a running pid and runner booted", () => {
    const report = buildRunnerServiceDoctorReport({
      envExists: true,
      launchdPrint: "state = running\npid = 4242\n",
      plistExists: true,
      stdoutTail: "Alfred runner watching every 5000ms",
    });

    assert.equal(report.ok, true);
    assert.deepEqual(report.lines.slice(0, 4), [
      "env: present",
      "plist: present",
      "launchd: loaded, pid 4242, state running",
      "runner boot log: seen",
    ]);
  });

  it("marks service doctor unhealthy when launchd is missing or logs never show the runner", () => {
    const report = buildRunnerServiceDoctorReport({
      envExists: true,
      launchdError: "Could not find service \"com.alfred.runner\" in domain",
      launchdPrint: "",
      plistExists: true,
      stdoutTail: "",
    });

    assert.equal(report.ok, false);
    assert.match(report.lines.join("\n"), /launchd: missing/);
    assert.match(report.lines.join("\n"), /runner boot log: missing/);
  });

  it("does not treat stale launchd logs as a healthy running service", () => {
    const report = buildRunnerServiceDoctorReport({
      envExists: true,
      launchdError: "Could not find service \"com.alfred.runner\" in domain",
      launchdPrint: "",
      plistExists: false,
      stdoutTail: "Alfred runner watching every 5000ms",
    });

    assert.equal(report.ok, false);
    assert.equal(report.bootLogSeen, true);
    assert.equal(report.runnerBooted, false);
    assert.match(report.lines.join("\n"), /runner boot log: seen, but service is not running/);
  });
});
