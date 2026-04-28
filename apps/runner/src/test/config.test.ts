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
});
