import { describe, expect, it } from "vitest";

import { loadRunnerConfig } from "../config.js";
import { parseRunnerEnv } from "../env.js";

describe("runner env", () => {
  it("uses dev defaults in test mode", () => {
    const env = parseRunnerEnv({ NODE_ENV: "test", HOME: "/tmp/home" });

    expect(env.RUNNER_API_URL).toBe("http://127.0.0.1:4301");
    expect(env.RUNNER_DEVICE_TOKEN).toBe("dev-device-token");
    expect(env.ALFRED_CODEX_HOME).toBe("/tmp/home/.codex");
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

  it("rejects invalid Codex since timestamp", () => {
    expect(() =>
      parseRunnerEnv({
        ALFRED_ALLOW_DEV_CONFIG: "1",
        ALFRED_CODEX_SINCE: "not-a-date",
        HOME: "/tmp/home",
      }),
    ).toThrow(/Invalid ALFRED_CODEX_SINCE/);
  });
});
