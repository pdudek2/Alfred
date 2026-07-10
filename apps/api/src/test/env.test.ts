import { describe, expect, it } from "vitest";

import { parseApiEnv } from "../env";

describe("api env", () => {
  it("allows local dev auth with development defaults", () => {
    expect(
      parseApiEnv({
        ALFRED_ALLOW_DEV_AUTH: "1",
      }),
    ).toMatchObject({
      APP_BASE_URL: "http://127.0.0.1:4301",
      AUTH_DEV_SESSION_TOKEN: "dev-session-token",
      DEV_AUTH_ENABLED: true,
      RUNNER_DEVICE_TOKEN: "dev-device-token",
    });
  });

  it("rejects hosted dev auth with default secrets", () => {
    expect(() =>
      parseApiEnv({
        ALFRED_ALLOW_DEV_AUTH: "1",
        NODE_ENV: "production",
      }),
    ).toThrow(/AUTH_DEV_SESSION_TOKEN/);
  });

  it("allows hosted dev auth only with explicit non-default secrets", () => {
    expect(
      parseApiEnv({
        ALFRED_ALLOW_DEV_AUTH: "1",
        AUTH_DEV_SESSION_TOKEN: "preview-session-token",
        NODE_ENV: "production",
        RUNNER_DEVICE_TOKEN: "preview-device-token",
      }),
    ).toMatchObject({
      AUTH_DEV_SESSION_TOKEN: "preview-session-token",
      DEV_AUTH_ENABLED: true,
      RUNNER_DEVICE_TOKEN: "preview-device-token",
    });
  });
});
