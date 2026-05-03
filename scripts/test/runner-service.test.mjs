import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseEnvFileContent } from "../lib/env-file.mjs";
import {
  buildRunnerEnv,
  buildRunnerProgramArgs,
  launchctlArgs,
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
});
