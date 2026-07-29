import { describe, expect, it } from "vitest";

import { parseApiEnv } from "../env";

describe("api env", () => {
  it("allows local dev auth with development defaults", () => {
    expect(
      parseApiEnv({
        ALFRED_ALLOW_DEV_AUTH: "1",
      }),
    ).toMatchObject({
      DEV_AUTH_ENABLED: true,
      RUNNER_DEVICE_TOKEN: "dev-device-token",
    });
  });

  it("rejects hosted dev auth with the default device token", () => {
    expect(() =>
      parseApiEnv({
        ALFRED_ALLOW_DEV_AUTH: "1",
        NODE_ENV: "production",
      }),
    ).toThrow(/RUNNER_DEVICE_TOKEN/);
  });

  it("ignores retired browser auth configuration for hosted device auth", () => {
    const parsed = parseApiEnv({
      ALFRED_ALLOW_DEV_AUTH: "1",
      APP_BASE_URL: "https://alfred.example.test",
      AUTH_DEV_SESSION_TOKEN: "retired-session-token",
      AUTH_OIDC_CLIENT_ID: "retired-client",
      AUTH_OIDC_CLIENT_SECRET: "retired-secret",
      AUTH_OIDC_ISSUER: "https://idp.example.test",
      NODE_ENV: "production",
      RUNNER_DEVICE_TOKEN: "preview-device-token",
    });

    expect(parsed).toMatchObject({
      DEV_AUTH_ENABLED: true,
      RUNNER_DEVICE_TOKEN: "preview-device-token",
    });
    for (const key of [
      "APP_BASE_URL",
      "AUTH_DEV_SESSION_TOKEN",
      "AUTH_OIDC_CLIENT_ID",
      "AUTH_OIDC_CLIENT_SECRET",
      "AUTH_OIDC_ISSUER",
    ]) {
      expect(parsed).not.toHaveProperty(key);
    }
  });
});
