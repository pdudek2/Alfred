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
  resolveStableNodeBin,
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
    assert.match(paths.stateDir, /Library\/Application Support\/Alfred\/runner$/);
    assert.equal(paths.stdoutPath, `${paths.stateDir}/launchd.out.log`);
    assert.equal(paths.stderrPath, `${paths.stateDir}/launchd.err.log`);
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

  it("renders a direct launchd plist without a shell launcher or env sourcing", () => {
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
    assert.match(plist, /<string>\/opt\/homebrew\/bin\/node<\/string>/);
    assert.match(plist, /<string>\/repo\/scripts\/runner-service\.mjs<\/string>/);
    assert.match(plist, /<string>run<\/string>/);
    assert.match(plist, /<string>--env<\/string>/);
    assert.match(plist, /<string>\/repo\/\.secrets\/runner\.env<\/string>/);
    assert.match(plist, /<string>\/repo<\/string>/);
    assert.match(plist, /runner-service\.mjs/);
    assert.match(plist, /launchd\.out\.log/);
    assert.doesNotMatch(plist, /<string>\/bin\/zsh<\/string>/);
    assert.doesNotMatch(plist, /<string>-c<\/string>/);
    assert.doesNotMatch(plist, /&amp;&amp;/);
    assert.doesNotMatch(plist, /source/);
  });

  it("prefers a stable node executable from PATH over a versioned current process", async () => {
    const seen = [];
    const nodeBin = await resolveStableNodeBin({
      fallbackNodeBin: "/opt/homebrew/Cellar/node/25.6.1/bin/node",
      pathEnv: "/opt/homebrew/bin:/usr/local/bin",
      exists: async (candidate) => {
        seen.push(candidate);
        return candidate === "/opt/homebrew/bin/node";
      },
    });

    assert.equal(nodeBin, "/opt/homebrew/bin/node");
    assert.deepEqual(seen, ["/opt/homebrew/bin/node"]);
  });

  it("falls back to the current process when PATH does not expose node", async () => {
    const nodeBin = await resolveStableNodeBin({
      fallbackNodeBin: "/opt/homebrew/Cellar/node/25.6.1/bin/node",
      pathEnv: "/missing/bin",
      exists: async () => false,
    });

    assert.equal(nodeBin, "/opt/homebrew/Cellar/node/25.6.1/bin/node");
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
    assert.equal(report.stderrQuiet, true);
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

  it("keeps service doctor healthy with a running pid and boot log even when stderr has older recoverable output", () => {
    const report = buildRunnerServiceDoctorReport({
      envExists: true,
      launchdPrint: "state = running\npid = 4242\n",
      plistExists: true,
      stderrTail: "Error: invalid runner token",
      stdoutTail: "Alfred runner watching every 5000ms",
    });

    assert.equal(report.ok, true);
    assert.equal(report.stderrQuiet, false);
    assert.match(report.lines.join("\n"), /stderr: has recent output/);
  });
});
