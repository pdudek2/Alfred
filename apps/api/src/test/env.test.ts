import { describe, expect, it } from "vitest";

import { parseApiEnv } from "../env";

const hostedEnv = {
  NODE_ENV: "production",
  RUNNER_DEVICE_TOKEN: "fixture-runner-token",
} satisfies NodeJS.ProcessEnv;

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

  it("keeps DATABASE_URL optional outside hosted runtime", () => {
    const parsed = parseApiEnv({
      NODE_ENV: "development",
      RUNNER_DEVICE_TOKEN: "token",
    });

    expect(parsed.DATABASE_URL).toBeUndefined();
  });

  it("requires DATABASE_URL in hosted runtime", () => {
    expect(() => parseApiEnv(hostedEnv)).toThrow(/DATABASE_URL/);
  });

  it.each([
    "not-a-url",
    "https://database.example.test/alfred",
  ])("rejects hosted non-PostgreSQL DATABASE_URL %s", (DATABASE_URL) => {
    expect(() => parseApiEnv({ ...hostedEnv, DATABASE_URL })).toThrow(/DATABASE_URL|postgres/i);
  });

  it.each([
    "postgres://alfred:secret@db.example.test:5432/alfred",
    "postgresql://alfred:secret@db.example.test:5432/alfred",
  ])("accepts hosted PostgreSQL DATABASE_URL %s", (DATABASE_URL) => {
    expect(parseApiEnv({ ...hostedEnv, DATABASE_URL })).toMatchObject({ DATABASE_URL });
  });

  it("rejects hosted dev auth with the default device token", () => {
    expect(() =>
      parseApiEnv({
        ALFRED_ALLOW_DEV_AUTH: "1",
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://alfred:secret@db.example.test:5432/alfred",
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
      DATABASE_URL: "postgresql://alfred:secret@db.example.test:5432/alfred",
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
