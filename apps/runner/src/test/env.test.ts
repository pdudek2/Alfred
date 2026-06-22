import { describe, expect, it } from "vitest";

import { parseRunnerEnv } from "../env.js";

const requiredEnv = {
  RUNNER_DEVICE_TOKEN: "token-1",
  RUNNER_WORKSPACE_ID: "00000000-0000-4000-8000-000000000001",
  RUNNER_DEVICE_ID: "00000000-0000-4000-8000-000000000101",
  ALFRED_CODEX_HOME: "/tmp/codex",
  ALFRED_CLAUDE_HOME: "/tmp/claude",
};

describe("parseRunnerEnv", () => {
  it("rejects remote plaintext runner API URLs", () => {
    expect(() =>
      parseRunnerEnv({
        ...requiredEnv,
        RUNNER_API_URL: "http://alfred.example.test",
      }),
    ).toThrow("RUNNER_API_URL must use HTTPS unless it targets a local address");
  });

  it("allows loopback plaintext runner API URLs for local development", () => {
    expect(
      parseRunnerEnv({
        ...requiredEnv,
        RUNNER_API_URL: "http://127.0.0.1:4301",
      }),
    ).toMatchObject({ RUNNER_API_URL: "http://127.0.0.1:4301" });
    expect(
      parseRunnerEnv({
        ...requiredEnv,
        RUNNER_API_URL: "http://localhost:4301",
      }),
    ).toMatchObject({ RUNNER_API_URL: "http://localhost:4301" });
  });
});
