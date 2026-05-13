import { describe, expect, it } from "vitest";

import { loadRunnerConfig } from "../config.js";
import { parseRunnerEnv } from "../env.js";

describe("runner env", () => {
  it("uses dev defaults in test mode", () => {
    const env = parseRunnerEnv({ NODE_ENV: "test", HOME: "/tmp/home" });

    expect(env.RUNNER_API_URL).toBe("http://127.0.0.1:4301");
    expect(env.RUNNER_DEVICE_TOKEN).toBe("dev-device-token");
    expect(env.ALFRED_SOURCES).toEqual(["codex"]);
    expect(env.ALFRED_RUNNER_POLL_MS).toBe(5_000);
    expect(env.ALFRED_CODEX_HOME).toBe("apps/runner/src/test/fixtures/codex-home");
    expect(env.ALFRED_CLAUDE_HOME).toBe("apps/runner/src/test/fixtures/claude-home");
  });

  it("does not read real agent homes when dev config is enabled", () => {
    const env = parseRunnerEnv({ ALFRED_ALLOW_DEV_CONFIG: "1", HOME: "/Users/patryk" });

    expect(env.ALFRED_CODEX_HOME).not.toBe("/Users/patryk/.codex");
    expect(env.ALFRED_CLAUDE_HOME).not.toBe("/Users/patryk/.claude");
  });

  it("allows explicit source homes to override safe dev defaults", () => {
    const env = parseRunnerEnv({
      ALFRED_ALLOW_DEV_CONFIG: "1",
      ALFRED_CODEX_HOME: "/tmp/codex-fixture",
      ALFRED_CLAUDE_HOME: "/tmp/claude-fixture",
      HOME: "/Users/patryk",
    });

    expect(env.ALFRED_CODEX_HOME).toBe("/tmp/codex-fixture");
    expect(env.ALFRED_CLAUDE_HOME).toBe("/tmp/claude-fixture");
  });

  it("requires credentials outside dev opt-in", () => {
    expect(() => parseRunnerEnv({ NODE_ENV: "production", HOME: "/tmp/home" })).toThrow(
      /RUNNER_DEVICE_TOKEN/,
    );
  });

  it("rejects invalid workspace id", () => {
    expect(() =>
      parseRunnerEnv({
        ALFRED_ALLOW_DEV_CONFIG: "1",
        RUNNER_WORKSPACE_ID: "not-a-uuid",
        HOME: "/tmp/home",
      }),
    ).toThrow(/Invalid RUNNER_WORKSPACE_ID/);
  });

  it("normalizes api url", () => {
    const config = loadRunnerConfig(
      parseRunnerEnv({
        ALFRED_ALLOW_DEV_CONFIG: "1",
        RUNNER_API_URL: "http://127.0.0.1:4301/",
        HOME: "/tmp/home",
      }),
    );

    expect(config.apiUrl).toBe("http://127.0.0.1:4301");
  });

  it("loads optional Vercel automation bypass secret", () => {
    const env = parseRunnerEnv({
      ALFRED_ALLOW_DEV_CONFIG: "1",
      VERCEL_AUTOMATION_BYPASS_SECRET: "bypass-1",
      HOME: "/tmp/home",
    });
    const config = loadRunnerConfig(env);

    expect(env.VERCEL_AUTOMATION_BYPASS_SECRET).toBe("bypass-1");
    expect(config.vercelAutomationBypassSecret).toBe("bypass-1");
  });

  it("loads optional Codex since timestamp", () => {
    const env = parseRunnerEnv({
      ALFRED_ALLOW_DEV_CONFIG: "1",
      ALFRED_CODEX_SINCE: "2026-04-28T10:00:02.000Z",
      HOME: "/tmp/home",
    });
    const config = loadRunnerConfig(env);

    expect(env.ALFRED_CODEX_SINCE).toBe("2026-04-28T10:00:02.000Z");
    expect(config.codexSince).toBe("2026-04-28T10:00:02.000Z");
  });

  it("loads optional runner poll interval", () => {
    const env = parseRunnerEnv({
      ALFRED_ALLOW_DEV_CONFIG: "1",
      ALFRED_RUNNER_POLL_MS: "2000",
      HOME: "/tmp/home",
    });
    const config = loadRunnerConfig(env);

    expect(env.ALFRED_RUNNER_POLL_MS).toBe(2_000);
    expect(config.pollMs).toBe(2_000);
  });

  it("rejects invalid runner poll interval", () => {
    expect(() =>
      parseRunnerEnv({
        ALFRED_ALLOW_DEV_CONFIG: "1",
        ALFRED_RUNNER_POLL_MS: "250",
        HOME: "/tmp/home",
      }),
    ).toThrow(/Invalid ALFRED_RUNNER_POLL_MS/);
  });

  it("rejects invalid Codex since timestamp", () => {
    expect(() =>
      parseRunnerEnv({
        ALFRED_ALLOW_DEV_CONFIG: "1",
        ALFRED_CODEX_SINCE: "not-a-date",
        HOME: "/tmp/home",
      }),
    ).toThrow(/Invalid ALFRED_CODEX_SINCE/);
  });

  it("parses runner sources", () => {
    const env = parseRunnerEnv({
      ALFRED_ALLOW_DEV_CONFIG: "1",
      ALFRED_SOURCES: " codex, claude ",
      HOME: "/tmp/home",
    });
    const config = loadRunnerConfig(env);

    expect(env.ALFRED_SOURCES).toEqual(["codex", "claude"]);
    expect(config.runnerSources).toEqual(["codex", "claude"]);
  });

  it("rejects empty runner sources", () => {
    expect(() =>
      parseRunnerEnv({
        ALFRED_ALLOW_DEV_CONFIG: "1",
        ALFRED_SOURCES: "codex, , claude",
        HOME: "/tmp/home",
      }),
    ).toThrow(/Invalid ALFRED_SOURCES/);
  });

  it("rejects unknown runner sources", () => {
    expect(() =>
      parseRunnerEnv({
        ALFRED_ALLOW_DEV_CONFIG: "1",
        ALFRED_SOURCES: "codex, cursor",
        HOME: "/tmp/home",
      }),
    ).toThrow(/Invalid ALFRED_SOURCES/);
  });

  it("loads optional Claude since timestamp", () => {
    const env = parseRunnerEnv({
      ALFRED_ALLOW_DEV_CONFIG: "1",
      ALFRED_CLAUDE_SINCE: "2026-04-28T10:00:02.000Z",
      HOME: "/tmp/home",
    });
    const config = loadRunnerConfig(env);

    expect(env.ALFRED_CLAUDE_SINCE).toBe("2026-04-28T10:00:02.000Z");
    expect(config.claudeSince).toBe("2026-04-28T10:00:02.000Z");
  });

  it("rejects invalid Claude since timestamp", () => {
    expect(() =>
      parseRunnerEnv({
        ALFRED_ALLOW_DEV_CONFIG: "1",
        ALFRED_CLAUDE_SINCE: "not-a-date",
        HOME: "/tmp/home",
      }),
    ).toThrow(/Invalid ALFRED_CLAUDE_SINCE/);
  });
});
